"use server";

import { IntegrationProvider, IntegrationStatus, PlatformRole, Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { PLATFORM_ROLES } from "@/modules/settings/access-control";
import { prisma } from "@/server/db";
import { requireAdmin } from "@/server/auth/authorization";
import { getAuthenticatedContext } from "@/server/tenant-context";
import {
  buildQuoteSourceDirectoryConfig,
  parseIntegrationStatus,
  parseQuoteSourceDirectory,
  QUOTE_SOURCE_DIRECTORY_NAME
} from "@/modules/settings/quote-sources";
import type {
  ApolloCadenceAutomationMode,
  ApolloSequenceMappingEntry,
  QuoteToolTarget
} from "@/modules/settings/types";
import { fetchSevenLAvailableCarriers } from "@/server/integrations/seven-l";
import { fetchApolloRepDirectory, fetchApolloSequenceDirectory } from "@/server/integrations/apollo";
import { getLtlRatePortalShell } from "@/modules/ltl-rate-portal/queries";
import { buildApolloRepMappingConfig, parseApolloRepMapping } from "@/modules/settings/apollo-rep-mapping";
import {
  buildApolloSequenceConfig,
  buildSearchProfileApolloSequenceConfig,
  buildApolloSequenceMappingsWithDefaults,
  parseApolloSequenceDirectory,
  parseApolloSequenceMapping,
  parseSearchProfileApolloSequenceMapping
} from "@/modules/settings/apollo-sequence-mapping";

type TradeMiningScoringConfigMutationClient = typeof prisma & {
  tradeMiningScoringConfig?: {
    upsert(args: {
      where: { tenantId: string };
      update: Record<string, unknown>;
      create: Record<string, unknown>;
    }): Promise<unknown>;
  };
  tenantRoleModuleAccess: {
    upsert(args: {
      where: {
        tenantId_role_moduleId: {
          tenantId: string;
          role: PlatformRole;
          moduleId: string;
        };
      };
      update: { enabled: boolean };
      create: {
        tenantId: string;
        role: PlatformRole;
        moduleId: string;
        enabled: boolean;
      };
    }): Promise<unknown>;
  };
  tenantRolePolicy: {
    upsert(args: {
      where: {
        tenantId_role: {
          tenantId: string;
          role: PlatformRole;
        };
      };
      update: { canMutate: boolean };
      create: {
        tenantId: string;
        role: PlatformRole;
        canMutate: boolean;
      };
    }): Promise<unknown>;
  };
};

async function authorizeSettingsMutation() {
  const context = await getAuthenticatedContext();
  requireAdmin(context);
  return context;
}

function parsePlatformRole(value: FormDataEntryValue | null): PlatformRole {
  if (typeof value !== "string" || !PLATFORM_ROLES.includes(value as PlatformRole)) {
    throw new Error("Select a valid platform role.");
  }

  return value as PlatformRole;
}

export async function createUpsQuoteSourceAction(formData: FormData) {
  const context = await authorizeSettingsMutation();
  const displayName = readRequired(formData, "displayName");
  const shipperNumber = readRequired(formData, "shipperNumber").toUpperCase();
  const countryCode = readCountry(formData.get("countryCode"));
  const originPostalCode = readRequired(formData, "originPostalCode").toUpperCase();
  const originLabel = readRequired(formData, "originLabel");
  const originStateProvince = readOptional(formData, "originStateProvince")?.toUpperCase();
  const status = parseIntegrationStatus(formData.get("status"));
  const dryRun = formData.get("dryRun") === "true";
  const toolTargets = readToolTargets(formData);

  const existingUpsRecords = await prisma.integrationCredential.findMany({
    where: {
      tenantId: context.tenantId,
      provider: IntegrationProvider.UPS
    },
    select: {
      id: true,
      publicConfig: true
    }
  });

  const existingRecord = existingUpsRecords.find((record) => {
    if (!record.publicConfig || typeof record.publicConfig !== "object") {
      return false;
    }

    const config = record.publicConfig as Record<string, unknown>;
    return config.shipperNumber === shipperNumber;
  });

  const publicConfig = {
    countryCode,
    shipperNumber,
    originPostalCode,
    originLabel,
    originStateProvince,
    dryRun,
    toolTargets
  };

  if (existingRecord) {
    await prisma.integrationCredential.update({
      where: {
        id: existingRecord.id
      },
      data: {
        name: displayName,
        status,
        publicConfig
      }
    });
  } else {
    await prisma.integrationCredential.create({
      data: {
        tenantId: context.tenantId,
        provider: IntegrationProvider.UPS,
        name: displayName,
        status,
        publicConfig
      }
    });
  }

  revalidateSettingsSurfaces();
}

export async function createCarrierPlaceholderAction(formData: FormData) {
  const context = await authorizeSettingsMutation();
  const displayName = readRequired(formData, "displayName");
  const carrierName = readRequired(formData, "carrierName");
  const carrierCode = readRequired(formData, "carrierCode").toUpperCase();
  const status = parseIntegrationStatus(formData.get("status"));
  const toolTargets = readToolTargets(formData);
  const notes = readOptional(formData, "notes");

  const existingDirectory = await prisma.integrationCredential.findFirst({
    where: {
      tenantId: context.tenantId,
      provider: IntegrationProvider.OPENCLAW,
      name: QUOTE_SOURCE_DIRECTORY_NAME
    },
    select: {
      id: true,
      publicConfig: true
    }
  });

  const entries = parseQuoteSourceDirectory(existingDirectory?.publicConfig);
  entries.push({
    id: crypto.randomUUID(),
    displayName,
    carrierName,
    carrierCode,
    status,
    readiness: "planned",
    toolTargets,
    notes
  });

  const directoryConfig = buildQuoteSourceDirectoryConfig(entries);

  if (existingDirectory) {
    await prisma.integrationCredential.update({
      where: {
        id: existingDirectory.id
      },
      data: {
        status: entries.some((entry) => entry.status === IntegrationStatus.ACTIVE)
          ? IntegrationStatus.ACTIVE
          : IntegrationStatus.DISABLED,
        publicConfig: directoryConfig
      }
    });
  } else {
    await prisma.integrationCredential.create({
      data: {
        tenantId: context.tenantId,
        provider: IntegrationProvider.OPENCLAW,
        name: QUOTE_SOURCE_DIRECTORY_NAME,
        status,
        publicConfig: directoryConfig
      }
    });
  }

  revalidateSettingsSurfaces();
}

export async function syncSevenLCarriersAction(formData: FormData) {
  const context = await authorizeSettingsMutation();
  const accountId = readRequired(formData, "accountId");
  const shell = await getLtlRatePortalShell(context);
  const account = shell.accounts.find((candidate) => candidate.id === accountId);

  if (!account) {
    throw new Error("The selected 7L account is not available for this tenant.");
  }

  const importedCarriers = await fetchSevenLAvailableCarriers(account);
  const existingByHash = new Map(account.carriers.map((carrier) => [carrier.carrierHash, carrier]));

  await prisma.integrationCredential.update({
    where: {
      id: account.id
    },
    data: {
      publicConfig: {
        baseUrl: account.baseUrl,
        defaultUom: account.defaultUom,
        strictResult: account.strictResult,
        harmonizedCharges: account.harmonizedCharges,
        dryRun: false,
        carrierMode: account.carrierMode,
        carriers: importedCarriers.map((carrier) => ({
          ...carrier,
          enabled: existingByHash.get(carrier.carrierHash)?.enabled ?? true
        }))
      }
    }
  });

  revalidateSettingsSurfaces();
  revalidatePath("/ltl-rate-portal");
}

export async function updateSevenLCarrierSelectionAction(formData: FormData) {
  const context = await authorizeSettingsMutation();
  const accountId = readRequired(formData, "accountId");
  const selectedCarrierHashes = new Set(
    formData
      .getAll("enabledCarrierHash")
      .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
  );
  const shell = await getLtlRatePortalShell(context);
  const account = shell.accounts.find((candidate) => candidate.id === accountId);

  if (!account) {
    throw new Error("The selected 7L account is not available for this tenant.");
  }

  await prisma.integrationCredential.update({
    where: {
      id: account.id
    },
    data: {
      publicConfig: {
        baseUrl: account.baseUrl,
        defaultUom: account.defaultUom,
        strictResult: account.strictResult,
        harmonizedCharges: account.harmonizedCharges,
        dryRun: account.dryRun,
        carrierMode: account.carrierMode,
        carriers: account.carriers.map((carrier) => ({
          ...carrier,
          enabled: selectedCarrierHashes.has(carrier.carrierHash)
        }))
      }
    }
  });

  revalidateSettingsSurfaces();
  revalidatePath("/ltl-rate-portal");
}

export async function saveTradeMiningScoringSettingsAction(formData: FormData) {
  const context = await authorizeSettingsMutation();
  const tradeMiningScoringClient = prisma as TradeMiningScoringConfigMutationClient;

  if (!tradeMiningScoringClient.tradeMiningScoringConfig) {
    throw new Error("TradeMining scoring config is unavailable until Prisma Client is regenerated.");
  }

  const scoringConfigData = {
    recentWindowDays: readRequiredInteger(formData, "recentWindowDays", 7, 365),
    comparisonWindowDays: readRequiredInteger(formData, "comparisonWindowDays", 7, 365),
    lookbackWindowDays: readRequiredInteger(formData, "lookbackWindowDays", 30, 365),
    momentumWeight: readRequiredInteger(formData, "momentumWeight", 0, 100),
    marketFitWeight: readRequiredInteger(formData, "marketFitWeight", 0, 100),
    industryFitWeight: readRequiredInteger(formData, "industryFitWeight", 0, 100),
    companySizeWeight: readRequiredInteger(formData, "companySizeWeight", 0, 100),
    roleWeight: readRequiredInteger(formData, "roleWeight", 0, 100),
    confidenceWeight: readRequiredInteger(formData, "confidenceWeight", 0, 100),
    workflowWeight: readRequiredInteger(formData, "workflowWeight", 0, 100),
    preferredOriginCountries: readStringList(formData, "preferredOriginCountries"),
    penalizedOriginCountries: readStringList(formData, "penalizedOriginCountries"),
    preferredOriginPorts: readStringList(formData, "preferredOriginPorts"),
    penalizedOriginPorts: readStringList(formData, "penalizedOriginPorts"),
    preferredDestinationMarkets: readStringList(formData, "preferredDestinationMarkets"),
    penalizedDestinationMarkets: readStringList(formData, "penalizedDestinationMarkets"),
    preferredIndustryKeywords: readStringList(formData, "preferredIndustryKeywords"),
    penalizedIndustryKeywords: readStringList(formData, "penalizedIndustryKeywords"),
    preferredHsCodePrefixes: readStringList(formData, "preferredHsCodePrefixes"),
    penalizedHsCodePrefixes: readStringList(formData, "penalizedHsCodePrefixes"),
    oversizeTeuThreshold: readOptionalDecimal(formData, "oversizeTeuThreshold"),
    oversizeShipmentCount30dThreshold: readOptionalInteger(formData, "oversizeShipmentCount30dThreshold", 1, 500),
    oversizePenalty: readRequiredInteger(formData, "oversizePenalty", 0, 100),
    midMarketTeuMin: readOptionalDecimal(formData, "midMarketTeuMin"),
    midMarketTeuMax: readOptionalDecimal(formData, "midMarketTeuMax"),
    midMarketBoost: readRequiredInteger(formData, "midMarketBoost", 0, 100),
    contactDecisionMakerWeight: readRequiredInteger(formData, "contactDecisionMakerWeight", 0, 100),
    contactManagerWeight: readRequiredInteger(formData, "contactManagerWeight", 0, 100),
    contactLogisticsDepartmentWeight: readRequiredInteger(formData, "contactLogisticsDepartmentWeight", 0, 100),
    contactWeakFunctionPenalty: readRequiredInteger(formData, "contactWeakFunctionPenalty", 0, 100),
    contactCompanyContextWeight: readRequiredInteger(formData, "contactCompanyContextWeight", 0, 50),
    contactEmailWeight: readRequiredInteger(formData, "contactEmailWeight", 0, 50),
    contactLinkedinWeight: readRequiredInteger(formData, "contactLinkedinWeight", 0, 50),
    contactPhoneWeight: readRequiredInteger(formData, "contactPhoneWeight", 0, 50),
    contactPrimaryContactBoost: readRequiredInteger(formData, "contactPrimaryContactBoost", 0, 50),
    contactApprovedStatusBoost: readRequiredInteger(formData, "contactApprovedStatusBoost", 0, 50),
    contactReviewingStatusBoost: readRequiredInteger(formData, "contactReviewingStatusBoost", 0, 50),
    contactTier1Threshold: readRequiredInteger(formData, "contactTier1Threshold", 0, 100),
    contactTier2Threshold: readRequiredInteger(formData, "contactTier2Threshold", 0, 100),
    contactTier3Threshold: readRequiredInteger(formData, "contactTier3Threshold", 0, 100),
    preferredContactTitleKeywords: readStringList(formData, "preferredContactTitleKeywords"),
    penalizedContactTitleKeywords: readStringList(formData, "penalizedContactTitleKeywords"),
    preferredContactDepartments: readStringList(formData, "preferredContactDepartments"),
    penalizedContactDepartments: readStringList(formData, "penalizedContactDepartments"),
    aiClassificationEnabled: formData.get("aiClassificationEnabled") === "true",
    aiModel: readOptional(formData, "aiModel") ?? null
  };

  try {
    await tradeMiningScoringClient.tradeMiningScoringConfig.upsert({
      where: {
        tenantId: context.tenantId
      },
      update: scoringConfigData,
      create: {
        tenantId: context.tenantId,
        ...scoringConfigData
      }
    });
  } catch (error) {
    if (isMissingTradeMiningScoringSchemaError(error)) {
      throw new Error("The local database is missing the latest TradeMining scoring migration. Run the new Prisma migration, then save again.");
    }

    throw error;
  }

  revalidateSettingsSurfaces();
  revalidatePath("/lead-gen/candidates");
  revalidatePath("/dashboard");
}

export async function saveTenantUserAccessAction(formData: FormData) {
  const context = await authorizeSettingsMutation();
  const email = readRequired(formData, "email").toLowerCase();
  const name = readOptional(formData, "name");
  const role = parsePlatformRole(formData.get("role"));

  const user = await prisma.user.upsert({
    where: { email },
    update: {
      name: name ?? undefined
    },
    create: {
      email,
      name: name ?? null
    }
  });

  await prisma.membership.upsert({
    where: {
      tenantId_userId: {
        tenantId: context.tenantId,
        userId: user.id
      }
    },
    update: {
      role
    },
    create: {
      tenantId: context.tenantId,
      userId: user.id,
      role
    }
  });

  revalidateSettingsSurfaces();
}

export async function removeTenantUserAccessAction(formData: FormData) {
  const context = await authorizeSettingsMutation();
  const membershipId = readRequired(formData, "membershipId");

  await prisma.membership.deleteMany({
    where: {
      id: membershipId,
      tenantId: context.tenantId
    }
  });

  revalidateSettingsSurfaces();
}

export async function saveRoleModuleAccessAction(formData: FormData) {
  const context = await authorizeSettingsMutation();
  const roleAccessClient = prisma as TradeMiningScoringConfigMutationClient;
  const rawValues = formData
    .getAll("roleModuleAccess")
    .filter((value): value is string => typeof value === "string" && value.includes("::"));
  const selectedKeys = new Set(rawValues);
  const mutableRoles = new Set(
    formData
      .getAll("roleCanMutate")
      .filter((value): value is string => typeof value === "string")
  );
  const modules = await prisma.module.findMany({
    orderBy: {
      name: "asc"
    },
    select: {
      id: true,
      key: true
    }
  });

  for (const role of PLATFORM_ROLES) {
    const canMutate =
      role === PlatformRole.ADMIN ? true : role === PlatformRole.READ_ONLY ? false : mutableRoles.has(role);

    await roleAccessClient.tenantRolePolicy.upsert({
      where: {
        tenantId_role: {
          tenantId: context.tenantId,
          role
        }
      },
      update: {
        canMutate
      },
      create: {
        tenantId: context.tenantId,
        role,
        canMutate
      }
    });

    for (const moduleRecord of modules) {
      const composite = `${role}::${moduleRecord.key}`;
      const enabled = selectedKeys.has(composite);

      await roleAccessClient.tenantRoleModuleAccess.upsert({
        where: {
          tenantId_role_moduleId: {
            tenantId: context.tenantId,
            role,
            moduleId: moduleRecord.id
          }
        },
        update: {
          enabled
        },
        create: {
          tenantId: context.tenantId,
          role,
          moduleId: moduleRecord.id,
          enabled
        }
      });
    }
  }

  revalidateSettingsSurfaces();
}

export async function saveApolloRepMappingAction(formData: FormData) {
  const context = await authorizeSettingsMutation();
  const entries = readApolloRepMappingEntries(formData);

  const existing = await prisma.integrationCredential.findFirst({
    where: {
      tenantId: context.tenantId,
      provider: IntegrationProvider.APOLLO
    },
    select: {
      id: true,
      publicConfig: true
    }
  });
  const publicConfig = mergeApolloPublicConfig(existing?.publicConfig, buildApolloRepMappingConfig(entries));

  if (existing) {
    await prisma.integrationCredential.update({
      where: {
        id: existing.id
      },
      data: {
        name: "Apollo Rep Mapping",
        status: entries.some((entry) => entry.active) ? IntegrationStatus.ACTIVE : IntegrationStatus.DISABLED,
        publicConfig
      }
    });
  } else {
    await prisma.integrationCredential.create({
      data: {
        tenantId: context.tenantId,
        provider: IntegrationProvider.APOLLO,
        name: "Apollo Rep Mapping",
        status: entries.some((entry) => entry.active) ? IntegrationStatus.ACTIVE : IntegrationStatus.DISABLED,
        publicConfig
      }
    });
  }

  revalidateSettingsSurfaces();
  revalidatePath("/lead-gen/pipeline");
  revalidatePath("/lead-gen/contacts");
}

export async function syncApolloRepMappingAction() {
  const context = await authorizeSettingsMutation();
  const syncedUsers = await fetchApolloRepDirectory();

  if (syncedUsers.length === 0) {
    throw new Error("Apollo returned no teammates to sync. The existing rep mapping was left unchanged.");
  }

  const existing = await prisma.integrationCredential.findFirst({
    where: {
      tenantId: context.tenantId,
      provider: IntegrationProvider.APOLLO
    },
    select: {
      id: true,
      publicConfig: true
    }
  });

  const existingEntries = parseApolloRepMapping(existing?.publicConfig);
  const entries = syncedUsers.map((user) => {
    const existingEntry = findExistingApolloRepEntry(existingEntries, user);

    return {
      id: existingEntry?.id ?? `apollo-rep-${user.apolloUserId}`,
      sequenceOwnerName: user.sequenceOwnerName,
      apolloUserId: user.apolloUserId,
      sendFromEmail: existingEntry?.sendFromEmail ?? user.email,
      sendFromEmailAccountId: existingEntry?.sendFromEmailAccountId ?? null,
      active: existingEntry?.active ?? true
    };
  });

  const publicConfig = mergeApolloPublicConfig(existing?.publicConfig, buildApolloRepMappingConfig(entries));

  if (existing) {
    await prisma.integrationCredential.update({
      where: {
        id: existing.id
      },
      data: {
        name: "Apollo Rep Mapping",
        status: entries.some((entry) => entry.active) ? IntegrationStatus.ACTIVE : IntegrationStatus.DISABLED,
        publicConfig
      }
    });
  } else {
    await prisma.integrationCredential.create({
      data: {
        tenantId: context.tenantId,
        provider: IntegrationProvider.APOLLO,
        name: "Apollo Rep Mapping",
        status: entries.some((entry) => entry.active) ? IntegrationStatus.ACTIVE : IntegrationStatus.DISABLED,
        publicConfig
      }
    });
  }

  revalidateSettingsSurfaces();
  revalidatePath("/lead-gen/pipeline");
  revalidatePath("/lead-gen/contacts");
}

export async function saveApolloSequenceMappingAction(formData: FormData) {
  const context = await authorizeSettingsMutation();
  const existing = await prisma.integrationCredential.findFirst({
    where: {
      tenantId: context.tenantId,
      provider: IntegrationProvider.APOLLO
    },
    select: {
      id: true,
      publicConfig: true
    }
  });

  const directory = parseApolloSequenceDirectory(existing?.publicConfig);
  const mappings = readApolloSequenceMappingEntries(formData, directory);
  const publicConfig = mergeApolloPublicConfig(
    existing?.publicConfig,
    buildApolloSequenceConfig({
      directory,
      mapping: mappings
    })
  );

  if (existing) {
    await prisma.integrationCredential.update({
      where: {
        id: existing.id
      },
      data: {
        name: "Apollo Workspace Mapping",
        status: IntegrationStatus.ACTIVE,
        publicConfig
      }
    });
  } else {
    await prisma.integrationCredential.create({
      data: {
        tenantId: context.tenantId,
        provider: IntegrationProvider.APOLLO,
        name: "Apollo Workspace Mapping",
        status: IntegrationStatus.ACTIVE,
        publicConfig
      }
    });
  }

  revalidateSettingsSurfaces();
  revalidatePath("/lead-gen/contacts");
}

export async function saveSearchProfileApolloSequenceMappingAction(formData: FormData) {
  const context = await authorizeSettingsMutation();
  const profileId = readRequired(formData, "profileId");
  const profile = await prisma.tradeMiningSearchProfile.findFirst({
    where: {
      id: profileId,
      tenantId: context.tenantId
    },
    select: {
      id: true
    }
  });

  if (!profile) {
    throw new Error("The selected search profile is not available for this tenant.");
  }

  const existingApolloCredential = await prisma.integrationCredential.findFirst({
    where: {
      tenantId: context.tenantId,
      provider: IntegrationProvider.APOLLO
    },
    select: {
      publicConfig: true
    }
  });

  const directory = parseApolloSequenceDirectory(existingApolloCredential?.publicConfig);
  const mappings = readApolloSequenceMappingEntries(formData, directory);

  await prisma.tradeMiningSearchProfile.update({
    where: {
      id: profileId
    },
    data: {
      contactCadenceConfig: buildSearchProfileApolloSequenceConfig(mappings)
    }
  });

  revalidateSettingsSurfaces();
  revalidatePath("/lead-gen/search-profiles");
  revalidatePath("/lead-gen/contacts");
}

export async function copySearchProfileApolloSequenceMappingAction(formData: FormData) {
  const context = await authorizeSettingsMutation();
  const targetProfileId = readRequired(formData, "targetProfileId");
  const sourceProfileId = readRequired(formData, "sourceProfileId");

  if (targetProfileId === sourceProfileId) {
    throw new Error("Choose a different source profile to copy from.");
  }

  const [sourceProfile, targetProfile, existingApolloCredential] = await Promise.all([
    prisma.tradeMiningSearchProfile.findFirst({
      where: {
        id: sourceProfileId,
        tenantId: context.tenantId
      },
      select: {
        name: true,
        contactCadenceConfig: true
      }
    }),
    prisma.tradeMiningSearchProfile.findFirst({
      where: {
        id: targetProfileId,
        tenantId: context.tenantId
      },
      select: {
        id: true
      }
    }),
    prisma.integrationCredential.findFirst({
      where: {
        tenantId: context.tenantId,
        provider: IntegrationProvider.APOLLO
      },
      select: {
        publicConfig: true
      }
    })
  ]);

  if (!sourceProfile || !targetProfile) {
    throw new Error("The selected search profile is not available for this tenant.");
  }

  const directory = parseApolloSequenceDirectory(existingApolloCredential?.publicConfig);
  const copiedMapping = buildApolloSequenceMappingsWithDefaults({
    existingMappings: parseSearchProfileApolloSequenceMapping(sourceProfile.contactCadenceConfig),
    directory
  });

  await prisma.tradeMiningSearchProfile.update({
    where: {
      id: targetProfileId
    },
    data: {
      contactCadenceConfig: buildSearchProfileApolloSequenceConfig(copiedMapping)
    }
  });

  revalidateSettingsSurfaces();
  revalidatePath("/lead-gen/search-profiles");
  revalidatePath("/lead-gen/contacts");
}

export async function clearSearchProfileApolloSequenceMappingAction(formData: FormData) {
  const context = await authorizeSettingsMutation();
  const profileId = readRequired(formData, "profileId");
  const profile = await prisma.tradeMiningSearchProfile.findFirst({
    where: {
      id: profileId,
      tenantId: context.tenantId
    },
    select: {
      id: true
    }
  });

  if (!profile) {
    throw new Error("The selected search profile is not available for this tenant.");
  }

  await prisma.tradeMiningSearchProfile.update({
    where: {
      id: profileId
    },
    data: {
      contactCadenceConfig: Prisma.JsonNull
    }
  });

  revalidateSettingsSurfaces();
  revalidatePath("/lead-gen/search-profiles");
  revalidatePath("/lead-gen/contacts");
}

export async function syncApolloSequenceMappingAction() {
  const context = await authorizeSettingsMutation();
  const syncedSequences = await fetchApolloSequenceDirectory();

  if (syncedSequences.length === 0) {
    throw new Error("Apollo returned no cadences to sync. The existing cadence mapping was left unchanged.");
  }

  const existing = await prisma.integrationCredential.findFirst({
    where: {
      tenantId: context.tenantId,
      provider: IntegrationProvider.APOLLO
    },
    select: {
      id: true,
      publicConfig: true
    }
  });

  const directory = syncedSequences.map((sequence) => ({
    ...sequence,
    automationMode: inferApolloSequenceAutomationMode(sequence.name)
  }));
  const mapping = buildApolloSequenceMappingsWithDefaults({
    existingMappings: parseApolloSequenceMapping(existing?.publicConfig),
    directory
  });
  const publicConfig = mergeApolloPublicConfig(
    existing?.publicConfig,
    buildApolloSequenceConfig({
      directory,
      mapping
    })
  );

  if (existing) {
    await prisma.integrationCredential.update({
      where: {
        id: existing.id
      },
      data: {
        name: "Apollo Workspace Mapping",
        status: IntegrationStatus.ACTIVE,
        publicConfig
      }
    });
  } else {
    await prisma.integrationCredential.create({
      data: {
        tenantId: context.tenantId,
        provider: IntegrationProvider.APOLLO,
        name: "Apollo Workspace Mapping",
        status: IntegrationStatus.ACTIVE,
        publicConfig
      }
    });
  }

  revalidateSettingsSurfaces();
  revalidatePath("/lead-gen/contacts");
}

function findExistingApolloRepEntry(
  entries: ReturnType<typeof parseApolloRepMapping>,
  user: { apolloUserId: string; sequenceOwnerName: string }
) {
  const idMatch = entries.find((entry) => entry.apolloUserId === user.apolloUserId);
  if (idMatch) {
    return idMatch;
  }

  const nameMatches = entries.filter(
    (entry) => entry.sequenceOwnerName === user.sequenceOwnerName && !entry.apolloUserId
  );

  return nameMatches.length === 1 ? nameMatches[0] : null;
}

function revalidateSettingsSurfaces() {
  revalidatePath("/settings");
  revalidatePath("/ltl-rate-portal");
  revalidatePath("/ups-tools");
  revalidatePath("/ups-tools/rate-quote");
  revalidatePath("/ups-tools/prospect-quote");
}

function readRequired(formData: FormData, field: string) {
  const value = formData.get(field);
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Missing required field: ${field}`);
  }

  return value.trim();
}

function readOptional(formData: FormData, field: string) {
  const value = formData.get(field);
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function readRequiredInteger(formData: FormData, field: string, min: number, max: number) {
  const value = readRequired(formData, field);
  const parsed = Number.parseInt(value, 10);

  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    throw new Error(`Invalid integer for ${field}. Expected a value between ${min} and ${max}.`);
  }

  return parsed;
}

function readOptionalInteger(formData: FormData, field: string, min: number, max: number) {
  const value = readOptional(formData, field);

  if (!value) {
    return null;
  }

  const parsed = Number.parseInt(value, 10);

  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    throw new Error(`Invalid integer for ${field}. Expected a value between ${min} and ${max}.`);
  }

  return parsed;
}

function readOptionalDecimal(formData: FormData, field: string) {
  const value = readOptional(formData, field);

  if (!value) {
    return null;
  }

  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`Invalid decimal for ${field}.`);
  }

  return new Prisma.Decimal(value);
}

function readStringList(formData: FormData, field: string) {
  const value = readOptional(formData, field);

  if (!value) {
    return [];
  }

  return value
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter((item, index, array) => item.length > 0 && array.indexOf(item) === index);
}

function readCountry(value: FormDataEntryValue | null) {
  return value === "CA" ? "CA" : "US";
}

function readToolTargets(formData: FormData): QuoteToolTarget[] {
  const targets = formData
    .getAll("toolTargets")
    .filter((value): value is QuoteToolTarget => value === "SHIPMENT_RATE_QUOTE" || value === "PROSPECT_QUOTE");

  if (targets.length === 0) {
    throw new Error("Select at least one quote tool target.");
  }

  return targets;
}

function isMissingTradeMiningScoringSchemaError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && (error.code === "P2021" || error.code === "P2022");
}

function readApolloRepMappingEntries(formData: FormData) {
  const names = formData
    .getAll("apolloRepSequenceOwnerName")
    .filter((value): value is string => typeof value === "string");
  const userIds = formData
    .getAll("apolloRepUserId")
    .filter((value): value is string => typeof value === "string");
  const emails = formData
    .getAll("apolloRepSendFromEmail")
    .filter((value): value is string => typeof value === "string");
  const emailAccountIds = formData
    .getAll("apolloRepSendFromEmailAccountId")
    .filter((value): value is string => typeof value === "string");
  const actives = new Set(
    formData
      .getAll("apolloRepActiveIndex")
      .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
  );

  return names
    .map((name, index) => ({
      id: `apollo-rep-${index + 1}`,
      sequenceOwnerName: name.trim(),
      apolloUserId: userIds[index]?.trim() || null,
      sendFromEmail: emails[index]?.trim() || null,
      sendFromEmailAccountId: emailAccountIds[index]?.trim() || null,
      active: actives.has(String(index))
    }))
    .filter((entry) => entry.sequenceOwnerName.length > 0);
}

function readApolloSequenceMappingEntries(
  formData: FormData,
  directory: ReturnType<typeof parseApolloSequenceDirectory>
): ApolloSequenceMappingEntry[] {
  const tiers = formData
    .getAll("apolloSequenceTier")
    .filter((value): value is ApolloSequenceMappingEntry["tier"] => value === "TIER_1" || value === "TIER_2" || value === "TIER_3");
  const labels = formData
    .getAll("apolloSequenceLabel")
    .filter((value): value is string => typeof value === "string");
  const sequenceIds = formData
    .getAll("apolloSequenceId")
    .filter((value): value is string => typeof value === "string");
  const requiresAiDraftTiers = new Set(
    formData
      .getAll("apolloSequenceRequiresAiDraft")
      .filter(
        (value): value is ApolloSequenceMappingEntry["tier"] =>
          value === "TIER_1" || value === "TIER_2" || value === "TIER_3"
      )
  );

  const defaults = buildApolloSequenceMappingsWithDefaults({
    existingMappings: [],
    directory
  });
  const directoryById = new Map(directory.map((entry) => [entry.id, entry]));

  return tiers.map((tier, index) => {
    const defaultEntry = defaults.find((entry) => entry.tier === tier);
    const selectedSequenceId = sequenceIds[index]?.trim() || null;
    const selectedSequence = selectedSequenceId ? directoryById.get(selectedSequenceId) ?? null : null;

    if (!defaultEntry) {
      throw new Error(`Missing default Apollo sequence metadata for ${tier}.`);
    }

    return {
      ...defaultEntry,
      label: labels[index]?.trim() || defaultEntry.label,
      apolloSequenceId: selectedSequence?.id ?? null,
      apolloSequenceName: selectedSequence?.name ?? null,
      automationMode: selectedSequence?.automationMode ?? defaultEntry.automationMode,
      requiresAiDraft: requiresAiDraftTiers.has(tier)
    };
  });
}

function mergeApolloPublicConfig(existingPublicConfig: unknown, patch: Record<string, unknown>): Prisma.InputJsonValue {
  if (!existingPublicConfig || typeof existingPublicConfig !== "object") {
    return patch as Prisma.InputJsonValue;
  }

  return {
    ...(existingPublicConfig as Record<string, unknown>),
    ...patch
  } as Prisma.InputJsonValue;
}

function inferApolloSequenceAutomationMode(name: string): ApolloCadenceAutomationMode {
  const normalized = name.toLowerCase();

  if (normalized.includes("tier 1") || normalized.includes("custom")) {
    return "AI_CUSTOM";
  }

  if (normalized.includes("tier 2") || normalized.includes("personalized")) {
    return "APOLLO_AI";
  }

  return "EMAIL_ONLY";
}
