"use server";

import {
  ContactOutreachDraftSource,
  CandidateStatus,
  ContactStatus,
  ContactOutreachDraftStatus,
  ContactTier,
  LeadPipelineStage,
  ModuleKey,
  Prisma,
  ReplyStatus,
  SequenceStatus
} from "@prisma/client";
import { revalidatePath } from "next/cache";
import { calculateLeadPipelineScoreForCompany } from "@/modules/lead-gen/queries";
import { summarizeTradeMiningEvidence } from "@/modules/lead-gen/queries";
import {
  assertValidTradeMiningSearchProfile,
  defaultTradeMiningCompanyIdentityRoles,
  tradeMiningCompanyIdentityRoleOptions
} from "@/modules/lead-gen/search-profile-validation";
import { buildSequenceCatalogItems } from "@/modules/lead-gen/sequence-catalog";
import {
  buildApolloSequenceMappingsWithDefaults,
  parseApolloSequenceDirectory,
  parseApolloSequenceMapping,
  parseSearchProfileApolloSequenceMapping,
  resolveApolloSequenceMappings
} from "@/modules/settings/apollo-sequence-mapping";
import { DEFAULT_TRADEMINING_SCORING_SETTINGS } from "@/modules/settings/types";
import { requireAdmin, requireModule, requireMutationAccess } from "@/server/auth/authorization";
import { prisma } from "@/server/db";
import {
  fetchApolloContactsForCompany,
  type ApolloContactRecord,
  type ApolloContactLookupResult
} from "@/server/integrations/apollo";
import {
  generateTier1SequenceDraft,
  isOpenAiDraftGenerationConfigured
} from "@/server/integrations/openai";
import { getAuthenticatedContext } from "@/server/tenant-context";

type SearchProfileMutationClient = typeof prisma & {
  tradeMiningSearchProfile?: {
    create(args: { data: Record<string, unknown> }): Promise<unknown>;
    update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<unknown>;
    delete(args: { where: { id: string } }): Promise<unknown>;
    findFirst(args: { where: Record<string, unknown>; select?: Record<string, boolean> }): Promise<{
      id: string;
      name?: string;
      enabled?: boolean;
    } | null>;
  };
  automationJobRun: {
    findFirst(args: { where: Record<string, unknown>; orderBy?: Record<string, "asc" | "desc">; select?: Record<string, boolean> }): Promise<{
      id: string;
      status?: string;
    } | null>;
    create(args: { data: Record<string, unknown> }): Promise<unknown>;
  };
  auditLog: {
    create(args: { data: Record<string, unknown> }): Promise<unknown>;
  };
  company: {
    findFirst(args: { where: Record<string, unknown>; select?: Record<string, boolean> }): Promise<{
      id: string;
    } | null>;
    update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<unknown>;
  };
  lead: {
    findFirst(args: { where: Record<string, unknown>; select?: Record<string, boolean> }): Promise<{
      id: string;
      companyId: string;
      notes?: string | null;
    } | null>;
    upsert(args: {
      where: { tenantId_companyId: { tenantId: string; companyId: string } };
      update: Record<string, unknown>;
      create: Record<string, unknown>;
    }): Promise<unknown>;
    update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<unknown>;
  };
  contact: {
    findFirst(args: { where: Record<string, unknown>; select?: Record<string, boolean> }): Promise<{
      id: string;
      companyId: string;
    } | null>;
    update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<unknown>;
    updateMany(args: { where: Record<string, unknown>; data: Record<string, unknown> }): Promise<unknown>;
  };
  contactOutreachDraft: {
    findFirst(args: { where: Record<string, unknown>; select?: Record<string, boolean> }): Promise<{
      id: string;
    } | null>;
    upsert(args: {
      where: { tenantId_contactId_sequenceName: { tenantId: string; contactId: string; sequenceName: string } };
      update: Record<string, unknown>;
      create: Record<string, unknown>;
    }): Promise<unknown>;
    update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<unknown>;
  };
};

async function authorizeLeadGenAdminMutation() {
  const context = await getAuthenticatedContext();
  requireAdmin(context);
  return context;
}

async function authorizeLeadGenMutation() {
  const context = await getAuthenticatedContext();
  await requireModule(context, ModuleKey.LEAD_GEN);
  await requireMutationAccess(context);
  return context;
}

export async function createTradeMiningSearchProfileAction(formData: FormData) {
  const context = await authorizeLeadGenAdminMutation();
  const client = prisma as SearchProfileMutationClient;

  if (!client.tradeMiningSearchProfile) {
    throw new Error("TradeMining search profile mutations are unavailable until Prisma Client is regenerated.");
  }

  const payload = readSearchProfilePayload(formData);

  await client.tradeMiningSearchProfile.create({
    data: {
      tenantId: context.tenantId,
      ...payload
    }
  });

  revalidateTradeMiningProfileSurfaces();
}

export async function updateTradeMiningSearchProfileAction(formData: FormData) {
  const context = await authorizeLeadGenAdminMutation();
  const client = prisma as SearchProfileMutationClient;

  if (!client.tradeMiningSearchProfile) {
    throw new Error("TradeMining search profile mutations are unavailable until Prisma Client is regenerated.");
  }

  const profileId = readRequired(formData, "profileId");
  const payload = readSearchProfilePayload(formData);

  await client.tradeMiningSearchProfile.update({
    where: {
      id: profileId
    },
    data: {
      tenantId: context.tenantId,
      ...payload
    }
  });

  revalidateTradeMiningProfileSurfaces();
}

export async function deleteTradeMiningSearchProfileAction(formData: FormData) {
  await authorizeLeadGenAdminMutation();
  const client = prisma as SearchProfileMutationClient;

  if (!client.tradeMiningSearchProfile) {
    throw new Error("TradeMining search profile mutations are unavailable until Prisma Client is regenerated.");
  }

  const profileId = readRequired(formData, "profileId");

  await client.tradeMiningSearchProfile.delete({
    where: {
      id: profileId
    }
  });

  revalidateTradeMiningProfileSurfaces();
}

export async function requestTradeMiningSearchProfileRunAction(formData: FormData) {
  const context = await authorizeLeadGenAdminMutation();
  const client = prisma as SearchProfileMutationClient;

  if (!client.tradeMiningSearchProfile) {
    throw new Error("TradeMining search profile mutations are unavailable until Prisma Client is regenerated.");
  }

  const profileId = readRequired(formData, "profileId");
  const profile = await client.tradeMiningSearchProfile.findFirst({
    where: {
      id: profileId,
      tenantId: context.tenantId
    },
    select: {
      id: true,
      name: true,
      enabled: true
    }
  });

  if (!profile) {
    throw new Error("Search profile not found for this tenant.");
  }

  if (!profile.enabled) {
    throw new Error("Enable this search profile before requesting an immediate run.");
  }

  const existingRequest = await client.automationJobRun.findFirst({
    where: {
      tenantId: context.tenantId,
      jobType: "trademining.run_request",
      status: {
        in: ["QUEUED", "RUNNING"]
      },
      input: {
        path: ["searchProfileId"],
        equals: profileId
      }
    },
    orderBy: {
      createdAt: "desc"
    },
    select: {
      id: true
    }
  });

  if (existingRequest) {
    revalidateTradeMiningProfileSurfaces();
    revalidatePath("/operations/logs");
    return;
  }

  await client.automationJobRun.create({
    data: {
      tenantId: context.tenantId,
      jobType: "trademining.run_request",
      status: "QUEUED",
      input: {
        source: "APP_UI",
        searchProfileId: profile.id,
        searchProfileName: profile.name ?? null,
        requestedByUserId: context.userId,
        requestedByName: context.userName ?? context.userEmail ?? "Unknown user",
        requestedAt: new Date().toISOString()
      }
    }
  });

  await client.auditLog.create({
    data: {
      tenantId: context.tenantId,
      action: "trademining.run.requested",
      entityType: "TradeMiningSearchProfile",
      entityId: profile.id,
      after: {
        searchProfileId: profile.id,
        searchProfileName: profile.name ?? null,
        requestedByUserId: context.userId,
        requestedByName: context.userName ?? context.userEmail ?? "Unknown user"
      }
    }
  });

  revalidateTradeMiningProfileSurfaces();
  revalidatePath("/operations/logs");
}

export async function updateCandidateStatusAction(formData: FormData) {
  const context = await authorizeLeadGenMutation();
  const client = prisma as SearchProfileMutationClient;
  const companyId = readRequired(formData, "companyId");
  const status = readCandidateStatus(formData.get("status"));
  await setCandidateStatusForCompany(client, context.tenantId, companyId, status);

  revalidateLeadGenSurfaces();
}

export async function bulkUpdateCandidateStatusAction(formData: FormData) {
  const context = await authorizeLeadGenMutation();
  const client = prisma as SearchProfileMutationClient;
  const status = readCandidateStatus(formData.get("status"));
  const companyIds = formData
    .getAll("companyId")
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0);

  if (companyIds.length === 0) {
    throw new Error("Select at least one company.");
  }

  for (const companyId of companyIds) {
    await setCandidateStatusForCompany(client, context.tenantId, companyId, status);
  }

  revalidateLeadGenSurfaces();
}

export async function updateLeadStageAction(formData: FormData) {
  const context = await authorizeLeadGenMutation();
  const client = prisma as SearchProfileMutationClient;
  const leadId = readRequired(formData, "leadId");
  const stage = readLeadStage(formData.get("stage"));
  await setLeadStageForTenant(client, context.tenantId, leadId, stage);

  revalidateLeadGenSurfaces();
}

export async function bulkUpdateLeadStageAction(formData: FormData) {
  const context = await authorizeLeadGenMutation();
  const client = prisma as SearchProfileMutationClient;
  const stage = readLeadStage(formData.get("stage"));
  const leadIds = readSelectedIds(formData, "leadId");

  for (const leadId of leadIds) {
    await setLeadStageForTenant(client, context.tenantId, leadId, stage);
  }

  revalidateLeadGenSurfaces();
}

export async function bulkQueueApolloEnrichmentAction(formData: FormData) {
  const context = await authorizeLeadGenMutation();
  const leadIds = readSelectedIds(formData, "leadId");
  const queuedAt = new Date().toISOString();
  const requestNote = `Apollo enrichment requested on ${queuedAt}.`;

  for (const leadId of leadIds) {
    const lead = await prisma.lead.findFirst({
      where: {
        id: leadId,
        tenantId: context.tenantId
      },
      select: {
        id: true,
        companyId: true,
        contactId: true,
        ownerUserId: true,
        notes: true,
        company: {
          select: {
            id: true,
            name: true,
            domain: true,
            linkedinUrl: true,
            apolloOrganizationId: true
          }
        }
      }
    });

    if (!lead) {
      throw new Error("Lead not found for this tenant.");
    }

    if (!lead.ownerUserId) {
      throw new Error("Assign a sales rep before queueing Apollo enrichment.");
    }

    const existingContacts = await prisma.contact.findMany({
      where: {
        tenantId: context.tenantId,
        companyId: lead.companyId
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        fullName: true,
        title: true,
        department: true,
        seniority: true,
        email: true,
        phone: true,
        linkedinUrl: true,
        source: true,
        contactStatus: true,
        apolloContactId: true,
        apolloPersonId: true,
        apolloStatus: true,
        sequenceStatus: true,
        replyStatus: true,
        recommendedSequenceName: true,
        recommendedSequenceId: true,
        selectedSequenceName: true,
        selectedSequenceId: true,
        sequenceRecommendationReason: true,
        sequenceOverrideReason: true,
        sequenceManuallyOverridden: true,
        lastTouchAt: true,
        lastReplyAt: true,
        assignedRep: true,
        rawJson: true
      }
    });

    const queuedNotes = appendLeadNote(lead.notes ?? null, requestNote);

    await prisma.lead.update({
      where: {
        id: leadId
      },
      data: {
        notes: queuedNotes
      }
    });

    const lookup = await fetchApolloContactsForCompany({
      companyName: lead.company.name,
      domain: lead.company.domain,
      apolloOrganizationId: lead.company.apolloOrganizationId
    });

    const syncedContacts = await syncApolloContactsForLead({
      tenantId: context.tenantId,
      leadId: lead.id,
      companyId: lead.companyId,
      assignedRep: lead.ownerUserId,
      existingContacts,
      lookup
    });

    await prisma.company.update({
      where: {
        id: lead.company.id
      },
      data: {
        apolloOrganizationId: lookup.organizationId ?? lead.company.apolloOrganizationId,
        domain: lookup.domain ?? lead.company.domain,
        linkedinUrl: lookup.linkedinUrl ?? lead.company.linkedinUrl
      }
    });

    if (!lead.contactId) {
      const primaryContactId = pickPrimaryApolloContactId(syncedContacts);
      if (primaryContactId) {
        await prisma.lead.update({
          where: {
            id: leadId
          },
          data: {
            contactId: primaryContactId
          }
        });
      }
    }

    const completionNote =
      syncedContacts.length > 0
        ? `Apollo enrichment completed on ${new Date().toISOString()}. Imported ${syncedContacts.length} contacts.`
        : `Apollo enrichment completed with no contacts on ${new Date().toISOString()}.`;

    await prisma.lead.update({
      where: {
        id: leadId
      },
      data: {
        notes: appendLeadNote(queuedNotes, completionNote)
      }
    });
  }

  revalidateLeadGenSurfaces();
}

export async function bulkAssignLeadOwnerAction(formData: FormData) {
  const context = await authorizeLeadGenMutation();
  const leadIds = readSelectedIds(formData, "leadId");
  const ownerUserId = readBulkOwnerValue(formData.get("ownerUserId"));

  await updateLeadOwnersForTenant(context.tenantId, leadIds, ownerUserId);
  revalidateLeadGenSurfaces();
}

export async function bulkUnassignLeadOwnerAction(formData: FormData) {
  const context = await authorizeLeadGenMutation();
  const leadIds = readSelectedIds(formData, "leadId");

  await updateLeadOwnersForTenant(context.tenantId, leadIds, null);
  revalidateLeadGenSurfaces();
}

async function updateLeadOwnersForTenant(
  tenantId: string,
  leadIds: string[],
  ownerUserId: string | null
) {
  const client = prisma as SearchProfileMutationClient;

  for (const leadId of leadIds) {
    const lead = await client.lead.findFirst({
      where: {
        id: leadId,
        tenantId
      },
      select: {
        id: true,
        companyId: true
      }
    });

    if (!lead) {
      throw new Error("Lead not found for this tenant.");
    }

    await client.lead.update({
      where: {
        id: leadId
      },
      data: {
        ownerUserId
      }
    });

    await client.contact.updateMany({
      where: {
        tenantId,
        companyId: lead.companyId
      },
      data: {
        assignedRep: ownerUserId
      }
    });
  }
}

export async function updateContactSequenceAction(formData: FormData) {
  const context = await authorizeLeadGenMutation();
  const contactId = readRequired(formData, "contactId");
  const sequenceId = readRequired(formData, "sequenceId");
  const overrideReason = readOptional(formData, "sequenceOverrideReason") ?? null;
  const confirmExistingSequenceOverride = readConfirmationBoolean(formData, "confirmExistingSequenceOverride");
  const contact = await prisma.contact.findFirst({
    where: {
      id: contactId,
      tenantId: context.tenantId
    },
    select: {
      id: true
    }
  });

  if (!contact) {
    throw new Error("Contact not found for this tenant.");
  }

  await applySequenceSelectionToContacts({
    tenantId: context.tenantId,
    contactIds: [contactId],
    sequenceId,
    overrideReason,
    confirmExistingSequenceOverride
  });

  revalidateLeadGenSurfaces();
}

export async function bulkUpdateContactSequenceAction(formData: FormData) {
  const context = await authorizeLeadGenMutation();
  const contactIds = readSelectedIds(formData, "contactId");
  const sequenceId = readRequired(formData, "sequenceId");
  const overrideReason = readOptional(formData, "sequenceOverrideReason") ?? null;
  const confirmExistingSequenceOverride = readConfirmationBoolean(formData, "confirmExistingSequenceOverride");

  await applySequenceSelectionToContacts({
    tenantId: context.tenantId,
    contactIds,
    sequenceId,
    overrideReason,
    confirmExistingSequenceOverride
  });

  revalidateLeadGenSurfaces();
}

export async function saveContactDraftAction(formData: FormData) {
  const context = await authorizeLeadGenMutation();
  const client = prisma as SearchProfileMutationClient;
  const draftId = readRequired(formData, "draftId");
  const draft = await client.contactOutreachDraft.findFirst({
    where: {
      id: draftId,
      tenantId: context.tenantId
    },
    select: {
      id: true
    }
  });

  if (!draft) {
    throw new Error("Draft not found for this tenant.");
  }

  await client.contactOutreachDraft.update({
    where: {
      id: draftId
    },
    data: {
      subject: readRequired(formData, "subject"),
      body: readRequired(formData, "body"),
      status: ContactOutreachDraftStatus.EDITED,
      editedAt: new Date()
    }
  });

  revalidateLeadGenSurfaces();
}

export async function approveContactDraftAction(formData: FormData) {
  const context = await authorizeLeadGenMutation();
  const client = prisma as SearchProfileMutationClient;
  const draftId = readRequired(formData, "draftId");
  const draft = await client.contactOutreachDraft.findFirst({
    where: {
      id: draftId,
      tenantId: context.tenantId
    },
    select: {
      id: true
    }
  });

  if (!draft) {
    throw new Error("Draft not found for this tenant.");
  }

  await client.contactOutreachDraft.update({
    where: {
      id: draftId
    },
    data: {
      subject: readRequired(formData, "subject"),
      body: readRequired(formData, "body"),
      status: ContactOutreachDraftStatus.APPROVED,
      editedAt: new Date(),
      approvedAt: new Date()
    }
  });

  revalidateLeadGenSurfaces();
}

export async function generateContactDraftAction(formData: FormData) {
  const context = await authorizeLeadGenMutation();

  if (!isOpenAiDraftGenerationConfigured()) {
    throw new Error("OPENAI_API_KEY is not configured. Add it to enable live Tier 1 draft generation.");
  }

  const contactId = readRequired(formData, "contactId");
  const contact = await prisma.contact.findFirst({
    where: {
      id: contactId,
      tenantId: context.tenantId
    },
    include: {
      company: {
        select: {
          id: true,
          name: true,
          priorityScore: true,
          importRecords: {
            orderBy: {
              arrivalDate: "desc"
            },
            take: 25,
            select: {
              rawJson: true,
              arrivalDate: true,
              sourcePort: true,
              destinationCity: true,
              destinationState: true,
              originCountry: true,
              productDescription: true
            }
          },
          leads: {
            where: {
              tenantId: context.tenantId
            },
            orderBy: {
              updatedAt: "desc"
            },
            take: 1,
            select: {
              id: true,
              score: true
            }
          }
        }
      }
    }
  });

  if (!contact) {
    throw new Error("Contact not found for this tenant.");
  }

  if (contact.contactTier === ContactTier.UNRANKED) {
    throw new Error("This contact is not ranked into a cadence tier yet.");
  }

  const apolloCredential = await prisma.integrationCredential.findFirst({
    where: {
      tenantId: context.tenantId,
      provider: "APOLLO"
    },
    select: {
      publicConfig: true
    }
  });
  const searchProfileIds = [
    ...new Set(
      contact.company.importRecords
        .map((record) => readString(asObject(record.rawJson), "searchProfileId"))
        .filter((value): value is string => Boolean(value))
    )
  ];
  const searchProfiles = searchProfileIds.length
    ? new Map(
        (
          await prisma.tradeMiningSearchProfile.findMany({
            where: {
              tenantId: context.tenantId,
              id: {
                in: searchProfileIds
              }
            },
            select: {
              id: true,
              name: true,
              priorityWeight: true,
              destinationMarkets: true,
              destinationPorts: true,
              originPorts: true,
              shipFromPorts: true,
              originCountries: true,
              productKeywords: true,
              hsCodes: true,
              contactCadenceConfig: true
            }
          })
        ).map((profile) => [
          profile.id,
          {
            id: profile.id,
            name: profile.name,
            priorityWeight: profile.priorityWeight,
            destinationMarkets: asStringArray(profile.destinationMarkets),
            destinationPorts: asStringArray(profile.destinationPorts),
            originPorts: asStringArray(profile.originPorts),
            shipFromPorts: asStringArray(profile.shipFromPorts),
            originCountries: asStringArray(profile.originCountries),
            productKeywords: asStringArray(profile.productKeywords),
            hsCodes: asStringArray(profile.hsCodes),
            contactCadenceConfig: profile.contactCadenceConfig
          }
        ])
      )
    : new Map();

  const defaultSequenceMapping = buildApolloSequenceMappingsWithDefaults({
    existingMappings: parseApolloSequenceMapping(apolloCredential?.publicConfig),
    directory: parseApolloSequenceDirectory(apolloCredential?.publicConfig)
  });
  const evidence = summarizeTradeMiningEvidence(contact.company.importRecords, searchProfiles);
  const sequenceMapping = resolveApolloSequenceMappings({
    existingMappings: evidence.searchProfile
      ? parseSearchProfileApolloSequenceMapping(evidence.searchProfile.contactCadenceConfig)
      : defaultSequenceMapping,
    directory: parseApolloSequenceDirectory(apolloCredential?.publicConfig)
  });
  const tierMapping = sequenceMapping.find((entry) => entry.tier === contact.contactTier);

  if (!tierMapping?.requiresAiDraft) {
    throw new Error("This tier does not currently require a Newl Apps AI draft.");
  }

  if (!contact.selectedSequenceName) {
    throw new Error("Select a cadence for this contact before generating the AI draft.");
  }

  if (contact.company.importRecords.length === 0) {
    throw new Error("No TradeMining shipment history is available for this company yet.");
  }

  const model = await loadTier1DraftModel(context.tenantId);
  const shipmentDraftContext = buildShipmentDraftContext(contact.company.importRecords);
  const generatedDraft = await generateTier1SequenceDraft({
    model,
    companyName: contact.company.name,
    contactFirstName: contact.firstName,
    contactFullName: contact.fullName,
    contactTitle: contact.title,
    contactDepartment: contact.department,
    contactSeniority: contact.seniority,
    selectedSequenceName: contact.selectedSequenceName,
    shipmentCount: evidence.shipmentCount,
    latestShipmentDate: evidence.latestShipmentDate?.toISOString() ?? null,
    arrivalPort: evidence.destinationPort,
    destinationCity: evidence.destinationCity,
    destinationState: evidence.destinationState,
    destinationMarket: evidence.destinationMarket,
    originCountry: evidence.originCountry,
    originPort: evidence.originPort,
    foreignPort: evidence.foreignPort,
    shipFromPort: evidence.shipFromPort,
    placeOfReceipt: evidence.placeOfReceipt,
    productDescription: evidence.productDescription,
    hsCode: evidence.hsCode,
    totalTeu: evidence.totalTeu,
    carrier: evidence.carrier,
    vessel: evidence.vessel,
    voyage: evidence.voyage,
    searchProfileName: evidence.searchProfile?.name ?? null,
    profileDestinationMarkets: evidence.searchProfile?.destinationMarkets ?? [],
    profileProductKeywords: evidence.searchProfile?.productKeywords ?? [],
    recurringOrigins: shipmentDraftContext.recurringOrigins,
    recurringDestinationPorts: shipmentDraftContext.recurringDestinationPorts,
    recurringCarriers: shipmentDraftContext.recurringCarriers,
    recurringProducts: shipmentDraftContext.recurringProducts,
    recentShipmentHighlights: shipmentDraftContext.recentShipmentHighlights
  });

  const leadId = contact.company.leads[0]?.id ?? null;
  const leadScore = contact.company.leads[0]?.score ?? null;
  const rawInputs = {
    model,
    generatedAt: new Date().toISOString(),
    companyName: contact.company.name,
    companyPriorityScore: contact.company.priorityScore,
    leadScore,
    contactTier: contact.contactTier,
    selectedSequenceName: contact.selectedSequenceName,
    selectedSequenceId: contact.selectedSequenceId,
    evidence: {
      shipmentCount: evidence.shipmentCount,
      latestShipmentDate: evidence.latestShipmentDate?.toISOString() ?? null,
      arrivalPort: evidence.destinationPort,
      destinationCity: evidence.destinationCity,
      destinationState: evidence.destinationState,
      destinationMarket: evidence.destinationMarket,
      originCountry: evidence.originCountry,
      originPort: evidence.originPort,
      foreignPort: evidence.foreignPort,
      shipFromPort: evidence.shipFromPort,
      placeOfReceipt: evidence.placeOfReceipt,
      productDescription: evidence.productDescription,
      hsCode: evidence.hsCode,
      totalTeu: evidence.totalTeu,
      sourceRole: evidence.sourceRole,
      carrier: evidence.carrier,
      vessel: evidence.vessel,
      voyage: evidence.voyage,
      searchProfileName: evidence.searchProfile?.name ?? null,
      recurringOrigins: shipmentDraftContext.recurringOrigins,
      recurringDestinationPorts: shipmentDraftContext.recurringDestinationPorts,
      recurringCarriers: shipmentDraftContext.recurringCarriers,
      recurringProducts: shipmentDraftContext.recurringProducts,
      recentShipmentHighlights: shipmentDraftContext.recentShipmentHighlights
    }
  };

  await prisma.contactOutreachDraft.upsert({
    where: {
      tenantId_contactId_sequenceName: {
        tenantId: context.tenantId,
        contactId: contact.id,
        sequenceName: contact.selectedSequenceName
      }
    },
    update: {
      companyId: contact.companyId,
      leadId,
      sequenceId: contact.selectedSequenceId,
      subject: generatedDraft.subject,
      body: generatedDraft.body,
      status: ContactOutreachDraftStatus.AVAILABLE,
      source: ContactOutreachDraftSource.MOCK_AI,
      aiGenerated: true,
      personalizationNotes: generatedDraft.personalizationNotes,
      rawInputs: toInputJsonValue(rawInputs),
      rawJson: toInputJsonValue({
        provider: "openai",
        response: generatedDraft.rawResponse
      })
    },
    create: {
      tenantId: context.tenantId,
      contactId: contact.id,
      companyId: contact.companyId,
      leadId,
      sequenceName: contact.selectedSequenceName,
      sequenceId: contact.selectedSequenceId,
      subject: generatedDraft.subject,
      body: generatedDraft.body,
      status: ContactOutreachDraftStatus.AVAILABLE,
      source: ContactOutreachDraftSource.MOCK_AI,
      aiGenerated: true,
      personalizationNotes: generatedDraft.personalizationNotes,
      rawInputs: toInputJsonValue(rawInputs),
      rawJson: toInputJsonValue({
        provider: "openai",
        response: generatedDraft.rawResponse
      })
    }
  });

  revalidateLeadGenSurfaces();
}

function revalidateTradeMiningProfileSurfaces() {
  revalidatePath("/lead-gen/search-profiles");
  revalidatePath("/lead-gen/candidates");
  revalidatePath("/dashboard");
  revalidatePath("/operations/logs");
}

function revalidateLeadGenSurfaces() {
  revalidatePath("/lead-gen/candidates");
  revalidatePath("/lead-gen/pipeline");
  revalidatePath("/lead-gen/contacts");
  revalidatePath("/dashboard");
}

async function setCandidateStatusForCompany(
  client: SearchProfileMutationClient,
  tenantId: string,
  companyId: string,
  status: CandidateStatus
) {
  const company = await client.company.findFirst({
    where: {
      id: companyId,
      tenantId
    },
    select: {
      id: true
    }
  });

  if (!company) {
    throw new Error("Company not found for this tenant.");
  }

  await client.company.update({
    where: {
      id: companyId
    },
    data: {
      candidateStatus: status,
      doNotProspect: status === CandidateStatus.DISQUALIFIED ? true : status === CandidateStatus.REJECTED ? false : false,
      candidateStatusUpdatedAt: new Date(),
      candidateStatusReason:
        status === CandidateStatus.APPROVED_FOR_PIPELINE
          ? "Approved from found company review queue."
          : status === CandidateStatus.REVIEWING
            ? "Moved into active review."
            : status === CandidateStatus.REJECTED
              ? "Rejected from review queue."
              : status === CandidateStatus.DISQUALIFIED
                ? "Disqualified from review queue."
                : "Reset to new."
    }
  });

  if (status === CandidateStatus.APPROVED_FOR_PIPELINE) {
    const score = (await calculateLeadPipelineScoreForCompany({ tenantId }, companyId)) ?? 0;

    await client.lead.upsert({
      where: {
        tenantId_companyId: {
          tenantId,
          companyId
        }
      },
      update: {
        stage: LeadPipelineStage.NEW,
        score
      },
      create: {
        tenantId,
        companyId,
        stage: LeadPipelineStage.NEW,
        score
      }
    });
  }
}

async function setLeadStageForTenant(
  client: SearchProfileMutationClient,
  tenantId: string,
  leadId: string,
  stage: LeadPipelineStage
) {
  const lead = await client.lead.findFirst({
    where: {
      id: leadId,
      tenantId
    },
    select: {
      id: true,
      companyId: true
    }
  });

  if (!lead) {
    throw new Error("Lead not found for this tenant.");
  }

  await client.lead.update({
    where: {
      id: leadId
    },
    data: {
      stage
    }
  });

  if (stage === LeadPipelineStage.DISQUALIFIED) {
    await client.company.update({
      where: {
        id: lead.companyId
      },
      data: {
        candidateStatus: CandidateStatus.DISQUALIFIED,
        doNotProspect: true,
        candidateStatusUpdatedAt: new Date(),
        candidateStatusReason: "Pipeline account was disqualified."
      }
    });
  }
}

async function applySequenceSelectionToContacts({
  tenantId,
  contactIds,
  sequenceId,
  overrideReason,
  confirmExistingSequenceOverride
}: {
  tenantId: string;
  contactIds: string[];
  sequenceId: string;
  overrideReason: string | null;
  confirmExistingSequenceOverride: boolean;
}) {
  const sequence = await resolveTenantSequenceOption(tenantId, sequenceId);

  if (!sequence) {
    throw new Error("Selected sequence is not recognized.");
  }

  const contacts = await prisma.contact.findMany({
    where: {
      tenantId,
      id: {
        in: contactIds
      }
    },
    select: {
      id: true,
      sequenceStatus: true
    }
  });

  if (contacts.length !== contactIds.length) {
    throw new Error("One or more contacts were not found for this tenant.");
  }

  const protectedContacts = contacts.filter((contact) => requiresSequenceOverrideConfirmation(contact.sequenceStatus));

  if (protectedContacts.length > 0 && !confirmExistingSequenceOverride) {
    throw new Error(
      "One or more selected contacts already show Apollo sequence history. Confirm the override before assigning a new cadence."
    );
  }

  const eligibleContactIds = contacts
    .filter((contact) => canBulkUpdateContactSequence(contact.sequenceStatus))
    .map((contact) => contact.id);
  const protectedContactIds = protectedContacts.map((contact) => contact.id);

  await prisma.contact.updateMany({
    where: {
      tenantId,
      id: {
        in: contactIds
      }
    },
    data: {
      selectedSequenceId: sequence.id,
      selectedSequenceName: sequence.name,
      sequenceOverrideReason: overrideReason,
      sequenceManuallyOverridden: true
    }
  });

  if (eligibleContactIds.length > 0) {
    await prisma.contact.updateMany({
      where: {
        tenantId,
        id: {
          in: eligibleContactIds
        }
      },
      data: {
        sequenceStatus: SequenceStatus.READY
      }
    });
  }

  if (protectedContactIds.length > 0) {
    await prisma.contact.updateMany({
      where: {
        tenantId,
        id: {
          in: protectedContactIds
        }
      },
      data: {
        sequenceOverrideReason:
          overrideReason ?? "User confirmed a new cadence selection despite existing Apollo sequence history."
      }
    });
  }
}

async function resolveTenantSequenceOption(tenantId: string, sequenceId: string) {
  const apolloCredential = await prisma.integrationCredential.findFirst({
    where: {
      tenantId,
      provider: "APOLLO"
    },
    select: {
      publicConfig: true
    }
  });

  return buildSequenceCatalogItems(parseApolloSequenceDirectory(apolloCredential?.publicConfig)).find(
    (item) => item.id === sequenceId
  ) ?? null;
}

function canBulkUpdateContactSequence(sequenceStatus: SequenceStatus) {
  return sequenceStatus === SequenceStatus.NOT_STARTED || sequenceStatus === SequenceStatus.READY;
}

function requiresSequenceOverrideConfirmation(sequenceStatus: SequenceStatus) {
  return !canBulkUpdateContactSequence(sequenceStatus);
}

function appendLeadNote(existingNotes: string | null, nextNote: string) {
  if (!existingNotes || existingNotes.trim().length === 0) {
    return nextNote;
  }

  return `${existingNotes}\n\n${nextNote}`;
}

function readSearchProfilePayload(formData: FormData) {
  const minShipmentVolumeNumber = readOptionalNumber(formData, "minShipmentVolume");
  const payload = {
    name: readRequired(formData, "name"),
    destinationMarkets: readStringList(formData, "destinationMarkets"),
    destinationPorts: readStringList(formData, "destinationPorts"),
    originPorts: readStringList(formData, "originPorts"),
    shipFromPorts: readStringList(formData, "shipFromPorts"),
    originCountries: readStringList(formData, "originCountries"),
    productKeywords: readStringList(formData, "productKeywords"),
    hsCodes: readStringList(formData, "hsCodes"),
    allowedCompanyIdentityRoles: readSelectedCompanyIdentityRoles(formData),
    excludedCompanyKeywords: readStringList(formData, "excludedCompanyKeywords"),
    lookbackWindowDays: readRequiredInteger(formData, "lookbackWindowDays", 1, 365),
    minShipmentCount: readRequiredInteger(formData, "minShipmentCount", 0, 100000),
    minShipmentVolume: minShipmentVolumeNumber,
    scheduleFrequency: readScheduleFrequency(formData.get("scheduleFrequency")),
    priorityWeight: readRequiredInteger(formData, "priorityWeight", 0, 100)
  };

  assertValidTradeMiningSearchProfile(payload);

  return {
    ...payload,
    minShipmentVolume:
      minShipmentVolumeNumber === null ? null : new Prisma.Decimal(minShipmentVolumeNumber.toString()),
    description: readOptional(formData, "description") ?? null,
    enabled: formData.get("enabled") === "true",
    scheduleTimezone: readOptional(formData, "scheduleTimezone") ?? "America/Toronto"
  };
}

function readSelectedCompanyIdentityRoles(formData: FormData) {
  const values = formData
    .getAll("allowedCompanyIdentityRole")
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0);

  if (values.length === 0) {
    return defaultTradeMiningCompanyIdentityRoles;
  }

  const allowed = new Set(tradeMiningCompanyIdentityRoleOptions.map((option) => option.value));
  return values.filter(
    (value, index, array): value is (typeof tradeMiningCompanyIdentityRoleOptions)[number]["value"] =>
      allowed.has(value as (typeof tradeMiningCompanyIdentityRoleOptions)[number]["value"]) &&
      array.indexOf(value) === index
  );
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

function readOptionalNumber(formData: FormData, field: string) {
  const value = readOptional(formData, field);
  if (!value) {
    return null;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`Invalid number for ${field}.`);
  }

  return parsed;
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

function readSelectedIds(formData: FormData, field: string) {
  const values = formData
    .getAll(field)
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0);

  if (values.length === 0) {
    throw new Error("Select at least one account.");
  }

  return values;
}

function readConfirmationBoolean(formData: FormData, field: string) {
  const value = formData.get(field);
  return value === "true" || value === "on" || value === "yes";
}

function readBulkOwnerValue(value: FormDataEntryValue | null) {
  if (value === "UNASSIGNED") {
    return null;
  }

  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error("Select a sales rep.");
  }

  return value.trim();
}

function readScheduleFrequency(value: FormDataEntryValue | null) {
  return value === "weekly" || value === "manual" ? value : "daily";
}

function readCandidateStatus(value: FormDataEntryValue | null) {
  if (
    value === CandidateStatus.NEW ||
    value === CandidateStatus.REVIEWING ||
    value === CandidateStatus.APPROVED_FOR_PIPELINE ||
    value === CandidateStatus.REJECTED ||
    value === CandidateStatus.DISQUALIFIED
  ) {
    return value;
  }

  throw new Error("Invalid candidate status.");
}

function readLeadStage(value: FormDataEntryValue | null) {
  if (typeof value === "string" && Object.values(LeadPipelineStage).includes(value as LeadPipelineStage)) {
    return value as LeadPipelineStage;
  }

  throw new Error("Invalid lead stage.");
}

async function syncApolloContactsForLead({
  tenantId,
  leadId,
  companyId,
  assignedRep,
  existingContacts,
  lookup
}: {
  tenantId: string;
  leadId: string;
  companyId: string;
  assignedRep: string;
  existingContacts: Array<{
    id: string;
    firstName: string | null;
    lastName: string | null;
    fullName: string;
    title: string | null;
    department: string | null;
    seniority: string | null;
    email: string | null;
    phone: string | null;
    linkedinUrl: string | null;
    source: unknown;
    contactStatus: ContactStatus;
    apolloContactId: string | null;
    apolloPersonId: string | null;
    apolloStatus: unknown;
    sequenceStatus: SequenceStatus;
    replyStatus: ReplyStatus;
    recommendedSequenceName: string | null;
    recommendedSequenceId: string | null;
    selectedSequenceName: string | null;
    selectedSequenceId: string | null;
    sequenceRecommendationReason: string | null;
    sequenceOverrideReason: string | null;
    sequenceManuallyOverridden: boolean;
    lastTouchAt: Date | null;
    lastReplyAt: Date | null;
    assignedRep: string | null;
    rawJson: Prisma.JsonValue | null;
  }>;
  lookup: ApolloContactLookupResult;
}) {
  const syncedContacts: Array<{ id: string } & ApolloContactRecord> = [];

  for (const incoming of lookup.contacts) {
    const existing = matchExistingApolloContact(existingContacts, incoming);
    const merged = buildApolloContactMutation({
      tenantId,
      companyId,
      leadId,
      assignedRep,
      existing,
      incoming
    });

    if (existing) {
      await prisma.contact.update({
        where: {
          id: existing.id
        },
        data: merged
      });

      syncedContacts.push({
        id: existing.id,
        ...incoming
      });
      continue;
    }

    const created = await prisma.contact.create({
      data: merged
    });

    syncedContacts.push({
      id: created.id,
      ...incoming
    });
  }

  return syncedContacts;
}

function matchExistingApolloContact(
  existingContacts: Array<{
    id: string;
    firstName: string | null;
    lastName: string | null;
    fullName: string;
    title: string | null;
    department: string | null;
    seniority: string | null;
    email: string | null;
    phone: string | null;
    linkedinUrl: string | null;
    contactStatus: ContactStatus;
    apolloContactId: string | null;
    apolloPersonId: string | null;
    sequenceStatus: SequenceStatus;
    replyStatus: ReplyStatus;
    recommendedSequenceName: string | null;
    recommendedSequenceId: string | null;
    selectedSequenceName: string | null;
    selectedSequenceId: string | null;
    sequenceRecommendationReason: string | null;
    sequenceOverrideReason: string | null;
    sequenceManuallyOverridden: boolean;
    lastTouchAt: Date | null;
    lastReplyAt: Date | null;
    assignedRep: string | null;
    rawJson: Prisma.JsonValue | null;
  }>,
  incoming: ApolloContactRecord
) {
  const normalizedEmail = incoming.email?.trim().toLowerCase() ?? null;
  const normalizedLinkedin = incoming.linkedinUrl?.trim().toLowerCase() ?? null;
  const normalizedFullName = incoming.fullName.trim().toLowerCase();
  const normalizedTitle = incoming.title?.trim().toLowerCase() ?? null;

  return (
    existingContacts.find(
      (contact) =>
        (incoming.apolloContactId && contact.apolloContactId === incoming.apolloContactId) ||
        (incoming.apolloPersonId && contact.apolloPersonId === incoming.apolloPersonId)
    ) ??
    existingContacts.find((contact) => normalizedEmail && contact.email?.trim().toLowerCase() === normalizedEmail) ??
    existingContacts.find(
      (contact) => normalizedLinkedin && contact.linkedinUrl?.trim().toLowerCase() === normalizedLinkedin
    ) ??
    existingContacts.find(
      (contact) =>
        contact.fullName.trim().toLowerCase() === normalizedFullName &&
        (contact.title?.trim().toLowerCase() ?? null) === normalizedTitle
    ) ??
    null
  );
}

function buildApolloContactMutation({
  tenantId,
  companyId,
  leadId,
  assignedRep,
  existing,
  incoming
}: {
  tenantId: string;
  companyId: string;
  leadId: string;
  assignedRep: string;
  existing:
    | {
        id: string;
        firstName: string | null;
        lastName: string | null;
        fullName: string;
        title: string | null;
        department: string | null;
        seniority: string | null;
        email: string | null;
        phone: string | null;
        linkedinUrl: string | null;
        contactStatus: ContactStatus;
        apolloContactId: string | null;
        apolloPersonId: string | null;
        sequenceStatus: SequenceStatus;
        replyStatus: ReplyStatus;
        recommendedSequenceName: string | null;
        recommendedSequenceId: string | null;
        selectedSequenceName: string | null;
        selectedSequenceId: string | null;
        sequenceRecommendationReason: string | null;
        sequenceOverrideReason: string | null;
        sequenceManuallyOverridden: boolean;
        lastTouchAt: Date | null;
        lastReplyAt: Date | null;
        assignedRep: string | null;
        rawJson: Prisma.JsonValue | null;
      }
    | null;
  incoming: ApolloContactRecord;
}) {
  const currentRawJson = isJsonObject(existing?.rawJson) ? existing.rawJson : {};

  return {
    tenantId,
    companyId,
    firstName: incoming.firstName,
    lastName: incoming.lastName,
    fullName: incoming.fullName,
    title: incoming.title,
    department: incoming.department,
    seniority: incoming.seniority,
    email: incoming.email,
    phone: incoming.phone,
    linkedinUrl: incoming.linkedinUrl,
    source: "APOLLO" as const,
    contactStatus: existing?.contactStatus ?? ContactStatus.REVIEWING,
    apolloContactId: incoming.apolloContactId,
    apolloPersonId: incoming.apolloPersonId,
    apolloStatus: "ENRICHED" as const,
    sequenceStatus: mergeSequenceStatus(existing?.sequenceStatus ?? null, incoming.sequenceStatus),
    replyStatus: mergeReplyStatus(existing?.replyStatus ?? null, incoming.replyStatus),
    recommendedSequenceName: existing?.recommendedSequenceName ?? null,
    recommendedSequenceId: existing?.recommendedSequenceId ?? null,
    selectedSequenceName: existing?.selectedSequenceName ?? incoming.sequenceName ?? null,
    selectedSequenceId: existing?.selectedSequenceId ?? incoming.sequenceId ?? null,
    sequenceRecommendationReason: existing?.sequenceRecommendationReason ?? null,
    sequenceOverrideReason: existing?.sequenceOverrideReason ?? null,
    sequenceManuallyOverridden: existing?.sequenceManuallyOverridden ?? false,
    lastTouchAt: incoming.lastTouchAt ?? existing?.lastTouchAt ?? null,
    lastReplyAt: incoming.lastReplyAt ?? existing?.lastReplyAt ?? null,
    assignedRep: existing?.assignedRep ?? assignedRep,
    rawJson: toInputJsonValue({
      ...currentRawJson,
      apollo: {
        importedAt: new Date().toISOString(),
        leadId,
        record: incoming.rawPayload
      }
    })
  };
}

function mergeSequenceStatus(existing: SequenceStatus | null, incoming: SequenceStatus) {
  if (!existing) {
    return incoming;
  }

  if (incoming === SequenceStatus.NOT_STARTED) {
    return existing;
  }

  return sequenceStatusRank(incoming) >= sequenceStatusRank(existing) ? incoming : existing;
}

function sequenceStatusRank(status: SequenceStatus) {
  switch (status) {
    case SequenceStatus.NOT_STARTED:
      return 0;
    case SequenceStatus.READY:
      return 1;
    case SequenceStatus.ENROLLED:
      return 2;
    case SequenceStatus.PAUSED:
      return 3;
    case SequenceStatus.REPLIED:
      return 4;
    case SequenceStatus.BOUNCED:
      return 5;
    case SequenceStatus.FINISHED:
      return 6;
    default:
      return 0;
  }
}

function mergeReplyStatus(existing: ReplyStatus | null, incoming: ReplyStatus) {
  if (!existing || existing === ReplyStatus.NO_REPLY) {
    return incoming;
  }

  if (incoming === ReplyStatus.NO_REPLY) {
    return existing;
  }

  return replyStatusRank(incoming) >= replyStatusRank(existing) ? incoming : existing;
}

function replyStatusRank(status: ReplyStatus) {
  switch (status) {
    case ReplyStatus.NO_REPLY:
      return 0;
    case ReplyStatus.OUT_OF_OFFICE:
      return 1;
    case ReplyStatus.REPLIED:
      return 2;
    case ReplyStatus.NEGATIVE:
      return 3;
    case ReplyStatus.POSITIVE:
      return 4;
    case ReplyStatus.MEETING_BOOKED:
      return 5;
    default:
      return 0;
  }
}

function pickPrimaryApolloContactId(contacts: Array<{ id: string } & ApolloContactRecord>) {
  return contacts
    .slice()
    .sort((left, right) => rankPrimaryApolloContact(right) - rankPrimaryApolloContact(left))[0]?.id ?? null;
}

function rankPrimaryApolloContact(contact: ApolloContactRecord) {
  let score = 0;
  if (contact.email) score += 6;
  if (contact.title) score += 3;
  if (/\b(director|head|chief|vp|vice president|president|owner|manager)\b/i.test(contact.title ?? "")) score += 4;
  if (/\b(logistics|supply|procurement|operations|import)\b/i.test(`${contact.title ?? ""} ${contact.department ?? ""}`)) score += 3;
  if (contact.sequenceStatus !== SequenceStatus.NOT_STARTED) score += 1;
  return score;
}

async function loadTier1DraftModel(tenantId: string) {
  const config = await prisma.tradeMiningScoringConfig.findUnique({
    where: {
      tenantId
    },
    select: {
      aiModel: true
    }
  });

  return config?.aiModel?.trim() || DEFAULT_TRADEMINING_SCORING_SETTINGS.aiModel || "gpt-5-mini";
}

function buildShipmentDraftContext(
  importRecords: Array<{
    rawJson: unknown;
    arrivalDate: Date | null;
    sourcePort: string | null;
    destinationCity: string | null;
    destinationState: string | null;
    originCountry: string | null;
    productDescription: string | null;
  }>
) {
  const recurringOrigins = collectTopValues(importRecords, (record) =>
    record.originCountry ?? readString(asObject(record.rawJson), "originCountry")
  );
  const recurringDestinationPorts = collectTopValues(importRecords, (record) =>
    readString(asObject(record.rawJson), "destinationPort") ?? readString(asObject(record.rawJson), "arrivalPort")
  );
  const recurringCarriers = collectTopValues(importRecords, (record) =>
    readString(asObject(record.rawJson), "carrier")
  );
  const recurringProducts = collectTopValues(importRecords, (record) =>
    record.productDescription ?? readString(asObject(record.rawJson), "productDescription")
  );
  const recentShipmentHighlights = importRecords
    .slice(0, 5)
    .map((record) => {
      const destination =
        readString(asObject(record.rawJson), "destinationMarket") ??
        formatShipmentLocation(record.destinationCity, record.destinationState);
      const arrivalPort =
        readString(asObject(record.rawJson), "destinationPort") ?? readString(asObject(record.rawJson), "arrivalPort");
      const originCountry = record.originCountry ?? readString(asObject(record.rawJson), "originCountry");
      const product = record.productDescription ?? readString(asObject(record.rawJson), "productDescription");
      const date = record.arrivalDate ? formatDraftDate(record.arrivalDate) : null;

      return [date, destination, arrivalPort, originCountry, product]
        .filter((value): value is string => Boolean(value && value.trim().length > 0))
        .join(" | ");
    })
    .filter((value) => value.length > 0);

  return {
    recurringOrigins,
    recurringDestinationPorts,
    recurringCarriers,
    recurringProducts,
    recentShipmentHighlights
  };
}

function asObject(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Prisma.JsonObject) : {};
}

function readString(record: Prisma.JsonObject, key: string) {
  const value = record[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function asStringArray(value: Prisma.JsonValue | null | undefined) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter((entry): entry is string => entry.length > 0);
}

function collectTopValues<T>(items: T[], pick: (item: T) => string | null, limit = 3) {
  const counts = new Map<string, number>();

  for (const item of items) {
    const value = pick(item)?.trim();
    if (!value) {
      continue;
    }

    counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, limit)
    .map(([value]) => value);
}

function formatShipmentLocation(city: string | null, state: string | null) {
  if (city && state) {
    return `${city}, ${state}`;
  }

  return city ?? state ?? null;
}

function formatDraftDate(value: Date) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(value);
}

function isJsonObject(value: Prisma.JsonValue | null | undefined): value is Prisma.JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function toInputJsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}
