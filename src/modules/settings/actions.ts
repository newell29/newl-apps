"use server";

import { IntegrationProvider, IntegrationStatus } from "@prisma/client";
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
