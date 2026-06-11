import { JobStatus, type Prisma } from "@prisma/client";

import { prisma } from "@/server/db";
import type { TenantContext } from "@/server/tenant-context";

const ingestionSources = new Set(["OPENCLAW", "N8N", "DIRECT_CONNECTOR"]);
const completionStatuses = new Set(["COMPLETED", "FAILED", "PARTIAL", "RUNNING", "CANCELLED"]);

export class IngestionValidationError extends Error {
  status: number;
  details: string[];

  constructor(details: string[], status = 400) {
    super(details.join(" "));
    this.name = "IngestionValidationError";
    this.status = status;
    this.details = details;
  }
}

type SearchProfileSummary = {
  id: string;
  name: string;
  description: string | null;
  destinationMarkets: string[];
  destinationPorts: string[];
  originPorts: string[];
  shipFromPorts: string[];
  originCountries: string[];
  productKeywords: string[];
  hsCodes: string[];
  lookbackDays: number;
  minShipmentCount: number;
  minShipmentVolume: string | null;
  schedule: {
    frequency: string;
    timezone: string;
    metadata: Prisma.JsonValue | null;
  };
  priorityWeight: number;
};

type TradeMiningRecordInput = {
  importerName?: string | null;
  supplierName?: string | null;
  consigneeName?: string | null;
  bolNumber?: string | null;
  shipmentDate?: string | null;
  originCountry?: string | null;
  originPort?: string | null;
  shipFromPort?: string | null;
  destinationPort?: string | null;
  destinationMarket?: string | null;
  destinationCity?: string | null;
  destinationState?: string | null;
  productDescription?: string | null;
  hsCode?: string | null;
  containerCount?: number | null;
  weight?: number | null;
  volume?: number | null;
  rawData?: Prisma.JsonValue | null;
};

type BatchPayload = {
  jobRunId?: string;
  searchProfileId?: string;
  source: string;
  records: TradeMiningRecordInput[];
};

export async function getActiveTradeMiningProfilesForWorker(tenant: TenantContext) {
  const profiles = await prisma.tradeMiningSearchProfile.findMany({
    where: {
      tenantId: tenant.tenantId,
      enabled: true
    },
    orderBy: [
      { priorityWeight: "desc" },
      { name: "asc" }
    ]
  });

  return profiles.map(
    (profile): SearchProfileSummary => ({
      id: profile.id,
      name: profile.name,
      description: profile.description,
      destinationMarkets: asStringArray(profile.destinationMarkets),
      destinationPorts: asStringArray(profile.destinationPorts),
      originPorts: asStringArray(profile.originPorts),
      shipFromPorts: asStringArray(profile.shipFromPorts),
      originCountries: asStringArray(profile.originCountries),
      productKeywords: asStringArray(profile.productKeywords),
      hsCodes: asStringArray(profile.hsCodes),
      lookbackDays: profile.lookbackWindowDays,
      minShipmentCount: profile.minShipmentCount,
      minShipmentVolume: profile.minShipmentVolume?.toString() ?? null,
      schedule: {
        frequency: profile.scheduleFrequency,
        timezone: profile.scheduleTimezone,
        metadata: profile.scheduleMetadata
      },
      priorityWeight: profile.priorityWeight
    })
  );
}

export async function createTradeMiningJobRun(tenant: TenantContext, payload: unknown) {
  const input = validateJobRunPayload(payload);

  if (input.searchProfileId) {
    await assertSearchProfileBelongsToTenant(tenant, input.searchProfileId);
  }

  const jobRun = await prisma.automationJobRun.create({
    data: {
      tenantId: tenant.tenantId,
      jobType: "trademining.ingestion",
      status: JobStatus.RUNNING,
      input: {
        source: input.source,
        searchProfileId: input.searchProfileId ?? null,
        metadata: input.metadata ?? {}
      }
    }
  });

  await prisma.auditLog.create({
    data: {
      tenantId: tenant.tenantId,
      action: "trademining.job.started",
      entityType: "AutomationJobRun",
      entityId: jobRun.id,
      after: {
        source: input.source,
        searchProfileId: input.searchProfileId ?? null
      }
    }
  });

  return {
    jobRunId: jobRun.id,
    status: "RUNNING"
  };
}

export async function ingestTradeMiningBatch(tenant: TenantContext, payload: unknown) {
  const batch = validateBatchPayload(payload);

  if (batch.searchProfileId) {
    await assertSearchProfileBelongsToTenant(tenant, batch.searchProfileId);
  }

  if (batch.jobRunId) {
    await assertJobRunBelongsToTenant(tenant, batch.jobRunId);
  }

  let recordsCreated = 0;
  let recordsUpdated = 0;
  let companiesCreated = 0;
  let companiesUpdated = 0;

  for (const [index, record] of batch.records.entries()) {
    const companyName = getCompanyName(record);
    const normalizedName = normalizeCompanyName(companyName);
    const rawRecordKey = getRawRecordKey(batch, record, normalizedName, index);
    const priorityScore = calculateCandidateScore(record);

    const existingCompany = await prisma.company.findUnique({
      where: {
        tenantId_normalizedName: {
          tenantId: tenant.tenantId,
          normalizedName
        }
      },
      select: {
        id: true,
        priorityScore: true
      }
    });

    const company = await prisma.company.upsert({
      where: {
        tenantId_normalizedName: {
          tenantId: tenant.tenantId,
          normalizedName
        }
      },
      update: {
        name: companyName,
        source: "trademining",
        priorityScore: Math.max(existingCompany?.priorityScore ?? 0, priorityScore)
      },
      create: {
        tenantId: tenant.tenantId,
        name: companyName,
        normalizedName,
        source: "trademining",
        priorityScore
      }
    });

    if (existingCompany) {
      companiesUpdated += 1;
    } else {
      companiesCreated += 1;
    }

    const existingRecord = await prisma.tradeMiningImportRecord.findUnique({
      where: {
        tenantId_rawRecordKey: {
          tenantId: tenant.tenantId,
          rawRecordKey
        }
      },
      select: {
        id: true
      }
    });

    await prisma.tradeMiningImportRecord.upsert({
      where: {
        tenantId_rawRecordKey: {
          tenantId: tenant.tenantId,
          rawRecordKey
        }
      },
      update: {
        companyId: company.id,
        sourcePort: record.originPort ?? record.shipFromPort ?? null,
        arrivalDate: parseDate(record.shipmentDate),
        importerName: record.importerName ?? null,
        consigneeName: record.consigneeName ?? null,
        shipperName: record.supplierName ?? null,
        destinationCity: record.destinationCity ?? null,
        destinationState: record.destinationState ?? null,
        originCountry: record.originCountry ?? null,
        productDescription: record.productDescription ?? null,
        rawJson: buildRawJson(batch, record)
      },
      create: {
        tenantId: tenant.tenantId,
        companyId: company.id,
        rawRecordKey,
        sourcePort: record.originPort ?? record.shipFromPort ?? null,
        arrivalDate: parseDate(record.shipmentDate),
        importerName: record.importerName ?? null,
        consigneeName: record.consigneeName ?? null,
        shipperName: record.supplierName ?? null,
        destinationCity: record.destinationCity ?? null,
        destinationState: record.destinationState ?? null,
        originCountry: record.originCountry ?? null,
        productDescription: record.productDescription ?? null,
        rawJson: buildRawJson(batch, record)
      }
    });

    if (existingRecord) {
      recordsUpdated += 1;
    } else {
      recordsCreated += 1;
    }
  }

  const summary = {
    source: batch.source,
    jobRunId: batch.jobRunId ?? null,
    searchProfileId: batch.searchProfileId ?? null,
    recordsProcessed: batch.records.length,
    recordsCreated,
    recordsUpdated,
    companiesCreated,
    companiesUpdated
  };

  if (batch.jobRunId) {
    await prisma.automationJobRun.update({
      where: {
        id: batch.jobRunId,
        tenantId: tenant.tenantId
      },
      data: {
        output: {
          lastBatch: summary
        }
      }
    });
  }

  await prisma.auditLog.create({
    data: {
      tenantId: tenant.tenantId,
      action: "trademining.batch.ingested",
      entityType: "TradeMiningImportRecord",
      entityId: batch.jobRunId ?? null,
      after: summary
    }
  });

  return summary;
}

export async function updateTradeMiningJobRunStatus(tenant: TenantContext, jobRunId: string, payload: unknown) {
  const input = validateJobStatusPayload(payload);
  await assertJobRunBelongsToTenant(tenant, jobRunId);

  const mappedStatus = mapExternalJobStatus(input.status);
  const isFinished = mappedStatus === JobStatus.SUCCESS || mappedStatus === JobStatus.ERROR || mappedStatus === JobStatus.CANCELLED;

  const jobRun = await prisma.automationJobRun.update({
    where: {
      id: jobRunId,
      tenantId: tenant.tenantId
    },
    data: {
      status: mappedStatus,
      finishedAt: isFinished ? new Date() : undefined,
      errorMessage: input.errorMessage ?? null,
      output: {
        externalStatus: input.status,
        recordsProcessed: input.recordsProcessed ?? null,
        recordsCreated: input.recordsCreated ?? null,
        recordsUpdated: input.recordsUpdated ?? null,
        metadata: input.metadata ?? {},
        completedAt: input.completedAt ?? new Date().toISOString()
      }
    }
  });

  await prisma.auditLog.create({
    data: {
      tenantId: tenant.tenantId,
      action: input.status === "FAILED" ? "trademining.job.failed" : "trademining.job.completed",
      entityType: "AutomationJobRun",
      entityId: jobRun.id,
      after: {
        status: input.status,
        mappedStatus,
        recordsProcessed: input.recordsProcessed ?? null,
        recordsCreated: input.recordsCreated ?? null,
        recordsUpdated: input.recordsUpdated ?? null,
        errorMessage: input.errorMessage ?? null
      }
    }
  });

  return {
    jobRunId: jobRun.id,
    status: mappedStatus,
    externalStatus: input.status
  };
}

function validateJobRunPayload(payload: unknown) {
  const errors: string[] = [];
  const body = asObject(payload, "Request body", errors);
  const source = readString(body, "source", errors);
  const searchProfileId = readOptionalString(body, "searchProfileId", errors);
  const metadata = readOptionalJsonObject(body, "metadata", errors);

  if (source && !ingestionSources.has(source)) {
    errors.push("source must be OPENCLAW, N8N, or DIRECT_CONNECTOR.");
  }

  throwIfErrors(errors);

  return {
    source,
    searchProfileId,
    metadata
  };
}

function validateBatchPayload(payload: unknown): BatchPayload {
  const errors: string[] = [];
  const body = asObject(payload, "Request body", errors);
  const source = readString(body, "source", errors);
  const jobRunId = readOptionalString(body, "jobRunId", errors);
  const searchProfileId = readOptionalString(body, "searchProfileId", errors);
  const recordsValue = body.records;

  if (source && !ingestionSources.has(source)) {
    errors.push("source must be OPENCLAW, N8N, or DIRECT_CONNECTOR.");
  }

  if (!Array.isArray(recordsValue) || recordsValue.length === 0) {
    errors.push("records must be a non-empty array.");
  }

  if (Array.isArray(recordsValue) && recordsValue.length > 500) {
    errors.push("records cannot contain more than 500 records in one batch.");
  }

  const records = Array.isArray(recordsValue)
    ? recordsValue.map((record, index) => validateTradeMiningRecord(record, index, errors))
    : [];

  throwIfErrors(errors);

  return {
    source,
    jobRunId,
    searchProfileId,
    records
  };
}

function validateTradeMiningRecord(record: unknown, index: number, errors: string[]): TradeMiningRecordInput {
  const body = asObject(record, `records[${index}]`, errors);
  const importerName = readOptionalString(body, "importerName", errors);
  const supplierName = readOptionalString(body, "supplierName", errors);
  const consigneeName = readOptionalString(body, "consigneeName", errors);
  const shipmentDate = readOptionalString(body, "shipmentDate", errors);

  if (!importerName && !consigneeName && !supplierName) {
    errors.push(`records[${index}] must include importerName, consigneeName, or supplierName.`);
  }

  if (shipmentDate && Number.isNaN(Date.parse(shipmentDate))) {
    errors.push(`records[${index}].shipmentDate must be a valid date string.`);
  }

  return {
    importerName,
    supplierName,
    consigneeName,
    bolNumber: readOptionalString(body, "bolNumber", errors),
    shipmentDate,
    originCountry: readOptionalString(body, "originCountry", errors),
    originPort: readOptionalString(body, "originPort", errors),
    shipFromPort: readOptionalString(body, "shipFromPort", errors),
    destinationPort: readOptionalString(body, "destinationPort", errors),
    destinationMarket: readOptionalString(body, "destinationMarket", errors),
    destinationCity: readOptionalString(body, "destinationCity", errors),
    destinationState: readOptionalString(body, "destinationState", errors),
    productDescription: readOptionalString(body, "productDescription", errors),
    hsCode: readOptionalString(body, "hsCode", errors),
    containerCount: readOptionalNumber(body, "containerCount", errors),
    weight: readOptionalNumber(body, "weight", errors),
    volume: readOptionalNumber(body, "volume", errors),
    rawData: isJsonLike(body.rawData) ? body.rawData : null
  };
}

function validateJobStatusPayload(payload: unknown) {
  const errors: string[] = [];
  const body = asObject(payload, "Request body", errors);
  const status = readString(body, "status", errors);

  if (status && !completionStatuses.has(status)) {
    errors.push("status must be COMPLETED, FAILED, PARTIAL, RUNNING, or CANCELLED.");
  }

  const completedAt = readOptionalString(body, "completedAt", errors);

  if (completedAt && Number.isNaN(Date.parse(completedAt))) {
    errors.push("completedAt must be a valid date string.");
  }

  const metadata = readOptionalJsonObject(body, "metadata", errors);
  const recordsProcessed = readOptionalNumber(body, "recordsProcessed", errors);
  const recordsCreated = readOptionalNumber(body, "recordsCreated", errors);
  const recordsUpdated = readOptionalNumber(body, "recordsUpdated", errors);
  const errorMessage = readOptionalString(body, "errorMessage", errors);

  throwIfErrors(errors);

  return {
    status,
    completedAt,
    recordsProcessed,
    recordsCreated,
    recordsUpdated,
    errorMessage,
    metadata
  };
}

async function assertSearchProfileBelongsToTenant(tenant: TenantContext, searchProfileId: string) {
  const profile = await prisma.tradeMiningSearchProfile.findFirst({
    where: {
      id: searchProfileId,
      tenantId: tenant.tenantId
    },
    select: { id: true }
  });

  if (!profile) {
    throw new IngestionValidationError(["searchProfileId was not found for the authenticated tenant."], 404);
  }
}

async function assertJobRunBelongsToTenant(tenant: TenantContext, jobRunId: string) {
  const jobRun = await prisma.automationJobRun.findFirst({
    where: {
      id: jobRunId,
      tenantId: tenant.tenantId
    },
    select: { id: true }
  });

  if (!jobRun) {
    throw new IngestionValidationError(["jobRunId was not found for the authenticated tenant."], 404);
  }
}

function getCompanyName(record: TradeMiningRecordInput) {
  return record.importerName ?? record.consigneeName ?? record.supplierName ?? "Unknown importer";
}

function normalizeCompanyName(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function getRawRecordKey(batch: BatchPayload, record: TradeMiningRecordInput, normalizedName: string, index: number) {
  if (record.bolNumber) {
    return `bol:${record.bolNumber.trim().toLowerCase()}`;
  }

  return [
    batch.source.toLowerCase(),
    batch.searchProfileId ?? "no-profile",
    record.shipmentDate ?? "no-date",
    normalizedName,
    record.originPort ?? record.shipFromPort ?? "no-origin",
    record.destinationPort ?? record.destinationMarket ?? "no-destination",
    record.hsCode ?? "no-hs",
    index
  ].join(":");
}

function calculateCandidateScore(record: TradeMiningRecordInput) {
  const containerScore = Math.min(25, Math.max(0, record.containerCount ?? 0) * 5);
  const weightScore = Math.min(20, Math.floor(Math.max(0, record.weight ?? 0) / 5000));
  const productScore = record.productDescription || record.hsCode ? 15 : 0;
  const laneScore = record.destinationMarket || record.destinationPort ? 20 : 0;
  const recencyScore = record.shipmentDate ? 10 : 0;

  return Math.min(100, 20 + containerScore + weightScore + productScore + laneScore + recencyScore);
}

function buildRawJson(batch: BatchPayload, record: TradeMiningRecordInput): Prisma.InputJsonObject {
  return {
    source: batch.source,
    jobRunId: batch.jobRunId ?? null,
    searchProfileId: batch.searchProfileId ?? null,
    destinationPort: record.destinationPort ?? null,
    destinationMarket: record.destinationMarket ?? null,
    originPort: record.originPort ?? null,
    shipFromPort: record.shipFromPort ?? null,
    hsCode: record.hsCode ?? null,
    containerCount: record.containerCount ?? null,
    weight: record.weight ?? null,
    volume: record.volume ?? null,
    rawData: record.rawData ?? {}
  };
}

function parseDate(value: string | null | undefined) {
  return value ? new Date(value) : null;
}

function mapExternalJobStatus(status: string) {
  if (status === "FAILED") {
    return JobStatus.ERROR;
  }

  if (status === "RUNNING") {
    return JobStatus.RUNNING;
  }

  if (status === "CANCELLED") {
    return JobStatus.CANCELLED;
  }

  return JobStatus.SUCCESS;
}

function asObject(value: unknown, label: string, errors: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    errors.push(`${label} must be an object.`);
    return {};
  }

  return value as Record<string, unknown>;
}

function readString(body: Record<string, unknown>, field: string, errors: string[]) {
  const value = body[field];

  if (typeof value !== "string" || value.trim().length === 0) {
    errors.push(`${field} is required.`);
    return "";
  }

  return value.trim();
}

function readOptionalString(body: Record<string, unknown>, field: string, errors: string[]) {
  const value = body[field];

  if (value == null) {
    return undefined;
  }

  if (typeof value !== "string") {
    errors.push(`${field} must be a string when provided.`);
    return undefined;
  }

  return value.trim() || undefined;
}

function readOptionalNumber(body: Record<string, unknown>, field: string, errors: string[]) {
  const value = body[field];

  if (value == null) {
    return undefined;
  }

  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    errors.push(`${field} must be a non-negative number when provided.`);
    return undefined;
  }

  return value;
}

function readOptionalJsonObject(body: Record<string, unknown>, field: string, errors: string[]) {
  const value = body[field];

  if (value == null) {
    return undefined;
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    errors.push(`${field} must be an object when provided.`);
    return undefined;
  }

  return value as Prisma.InputJsonObject;
}

function isJsonLike(value: unknown): value is Prisma.JsonValue {
  return value == null || typeof value === "string" || typeof value === "number" || typeof value === "boolean" || typeof value === "object";
}

function asStringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function throwIfErrors(errors: string[]) {
  if (errors.length > 0) {
    throw new IngestionValidationError(errors);
  }
}
