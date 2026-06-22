"use server";

import { IntegrationProvider, IntegrationStatus, Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { prisma } from "@/server/db";
import { requireAdmin } from "@/server/auth/authorization";
import { getAuthenticatedContext } from "@/server/tenant-context";
import {
  buildQuoteSourceDirectoryConfig,
  parseIntegrationStatus,
  parseQuoteSourceDirectory,
  QUOTE_SOURCE_DIRECTORY_NAME
} from "@/modules/settings/quote-sources";
import type { QuoteToolTarget } from "@/modules/settings/types";
import { fetchSevenLAvailableCarriers } from "@/server/integrations/seven-l";
import { getLtlRatePortalShell } from "@/modules/ltl-rate-portal/queries";

type TradeMiningScoringConfigMutationClient = typeof prisma & {
  tradeMiningScoringConfig?: {
    upsert(args: {
      where: { tenantId: string };
      update: Record<string, unknown>;
      create: Record<string, unknown>;
    }): Promise<unknown>;
  };
};

async function authorizeSettingsMutation() {
  const context = await getAuthenticatedContext();
  requireAdmin(context);
  return context;
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

  await tradeMiningScoringClient.tradeMiningScoringConfig.upsert({
    where: {
      tenantId: context.tenantId
    },
    update: {
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
      aiClassificationEnabled: formData.get("aiClassificationEnabled") === "true",
      aiModel: readOptional(formData, "aiModel") ?? null
    },
    create: {
      tenantId: context.tenantId,
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
      aiClassificationEnabled: formData.get("aiClassificationEnabled") === "true",
      aiModel: readOptional(formData, "aiModel") ?? null
    }
  });

  revalidateSettingsSurfaces();
  revalidatePath("/lead-gen/candidates");
  revalidatePath("/dashboard");
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
