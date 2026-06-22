import { JobStatus, type Prisma } from "@prisma/client";

import { normalizeSearchProfileValueForWorker } from "@/modules/lead-gen/search-profile-suggestions";
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
  consigneeName?: string | null;
  masterConsigneeName?: string | null;
  notifyParty?: string | null;
  shipperName?: string | null;
  masterShipperName?: string | null;
  bolNumber?: string | null;
  houseBolNumber?: string | null;
  masterBolNumber?: string | null;
  containerNumber?: string | null;
  billType?: string | null;
  shipmentDate?: string | null;
  originCountry?: string | null;
  originPort?: string | null;
  foreignPort?: string | null;
  shipFromPort?: string | null;
  placeOfReceipt?: string | null;
  arrivalPort?: string | null;
  destinationPort?: string | null;
  destinationMarket?: string | null;
  destinationCity?: string | null;
  destinationState?: string | null;
  destinationZip?: string | null;
  productDescription?: string | null;
  hsCode?: string | null;
  containerCount?: number | null;
  teu?: number | null;
  weight?: number | null;
  quantity?: number | null;
  volume?: number | null;
  carrier?: string | null;
  vessel?: string | null;
  voyage?: string | null;
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
      destinationMarkets: normalizeSearchProfileListForWorker(
        "destinationMarkets",
        asStringArray(profile.destinationMarkets)
      ),
      destinationPorts: normalizeSearchProfileListForWorker("destinationPorts", asStringArray(profile.destinationPorts)),
      originPorts: normalizeSearchProfileListForWorker("originPorts", asStringArray(profile.originPorts)),
      shipFromPorts: normalizeSearchProfileListForWorker("shipFromPorts", asStringArray(profile.shipFromPorts)),
      originCountries: normalizeSearchProfileListForWorker("originCountries", asStringArray(profile.originCountries)),
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

function normalizeSearchProfileListForWorker(
  field: "destinationMarkets" | "destinationPorts" | "originPorts" | "shipFromPorts" | "originCountries",
  values: string[]
) {
  return values
    .map((value) => normalizeSearchProfileValueForWorker(field, value))
    .filter((value, index, array) => value.length > 0 && array.indexOf(value) === index);
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

  if (input.searchProfileId) {
    await prisma.tradeMiningSearchProfile.update({
      where: {
        id: input.searchProfileId
      },
      data: {
        lastRunAt: jobRun.startedAt,
        lastRunStatus: "Running"
      }
    });
  }

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
    const companyName = getCompanyIdentity(record).name;
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
        shipperName: record.shipperName ?? null,
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
        shipperName: record.shipperName ?? null,
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
  const existingJobRun = await prisma.automationJobRun.findFirst({
    where: {
      id: jobRunId,
      tenantId: tenant.tenantId
    },
    select: {
      input: true
    }
  });
  const searchProfileId = readSearchProfileIdFromJobInput(existingJobRun?.input);

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

  if (searchProfileId) {
    await prisma.tradeMiningSearchProfile.update({
      where: {
        id: searchProfileId
      },
      data: {
        lastRunAt: jobRun.finishedAt ?? new Date(),
        lastRunStatus: input.status
      }
    });
  }

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

export async function getTradeMiningJobRunReadback(tenant: TenantContext, jobRunId: string) {
  const jobRun = await prisma.automationJobRun.findFirst({
    where: {
      id: jobRunId,
      tenantId: tenant.tenantId
    },
    select: {
      id: true,
      jobType: true,
      status: true,
      startedAt: true,
      finishedAt: true,
      input: true,
      output: true,
      errorMessage: true
    }
  });

  if (!jobRun) {
    throw new IngestionValidationError(["jobRunId was not found for the authenticated tenant."], 404);
  }

  const recentRecords = await prisma.tradeMiningImportRecord.findMany({
    where: {
      tenantId: tenant.tenantId
    },
    include: {
      company: {
        select: {
          id: true,
          name: true,
          normalizedName: true
        }
      }
    },
    orderBy: [
      { createdAt: "desc" },
      { arrivalDate: "desc" }
    ],
    take: 200
  });

  const records = recentRecords
    .filter((record) => readJsonString(record.rawJson, "jobRunId") === jobRunId)
    .map((record) => ({
      id: record.id,
      rawRecordKey: record.rawRecordKey,
      arrivalDate: record.arrivalDate?.toISOString() ?? null,
      importerName: record.importerName,
      consigneeName: record.consigneeName,
      shipperName: record.shipperName,
      destinationCity: record.destinationCity,
      destinationState: record.destinationState,
      originCountry: record.originCountry,
      productDescription: record.productDescription,
      company: record.company
        ? {
            id: record.company.id,
            name: record.company.name,
            normalizedName: record.company.normalizedName
          }
        : null,
      rawPayload: record.rawJson
    }));

  return {
    jobRun: {
      id: jobRun.id,
      jobType: jobRun.jobType,
      status: jobRun.status,
      startedAt: jobRun.startedAt.toISOString(),
      finishedAt: jobRun.finishedAt?.toISOString() ?? null,
      input: jobRun.input,
      output: jobRun.output,
      errorMessage: jobRun.errorMessage
    },
    records
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
  const importerName = readOptionalAliasedString(body, ["importerName", "importer_name"], errors);
  const consigneeName = readOptionalAliasedString(body, ["consigneeName", "consignee_name"], errors);
  const masterConsigneeName = readOptionalAliasedString(
    body,
    ["masterConsigneeName", "master_consignee_name"],
    errors
  );
  const notifyParty = readOptionalAliasedString(body, ["notifyParty", "notify_party"], errors);
  const shipperName = readOptionalAliasedString(
    body,
    ["shipperName", "shipper_name", "supplierName", "supplier_name"],
    errors
  );
  const masterShipperName = readOptionalAliasedString(body, ["masterShipperName", "master_shipper_name"], errors);
  const shipmentDate = readOptionalAliasedString(
    body,
    ["shipmentDate", "shipment_date", "arrivalDate", "arrival_date"],
    errors
  );

  if (!importerName && !consigneeName && !masterConsigneeName && !notifyParty && !shipperName && !masterShipperName) {
    errors.push(
      `records[${index}] must include at least one company identity field such as importerName, consigneeName, notifyParty, or shipperName.`
    );
  }

  if (shipmentDate && Number.isNaN(Date.parse(shipmentDate))) {
    errors.push(`records[${index}].shipmentDate must be a valid date string.`);
  }

  return {
    importerName,
    consigneeName,
    masterConsigneeName,
    notifyParty,
    shipperName,
    masterShipperName,
    bolNumber: readOptionalAliasedString(body, ["bolNumber", "bol_number"], errors),
    houseBolNumber: readOptionalAliasedString(body, ["houseBolNumber", "house_bol_number"], errors),
    masterBolNumber: readOptionalAliasedString(body, ["masterBolNumber", "master_bol_number"], errors),
    containerNumber: readOptionalAliasedString(body, ["containerNumber", "container_number"], errors),
    billType: readOptionalAliasedString(body, ["billType", "bill_type"], errors),
    shipmentDate,
    originCountry: readOptionalAliasedString(body, ["originCountry", "origin_country"], errors),
    originPort: readOptionalAliasedString(body, ["originPort", "origin_port"], errors),
    foreignPort: readOptionalAliasedString(body, ["foreignPort", "foreign_port"], errors),
    shipFromPort: readOptionalAliasedString(body, ["shipFromPort", "ship_from_port"], errors),
    placeOfReceipt: readOptionalAliasedString(body, ["placeOfReceipt", "place_of_receipt"], errors),
    arrivalPort: readOptionalAliasedString(body, ["arrivalPort", "arrival_port"], errors),
    destinationPort: readOptionalAliasedString(body, ["destinationPort", "destination_port"], errors),
    destinationMarket: readOptionalAliasedString(body, ["destinationMarket", "destination_market"], errors),
    destinationCity: readOptionalAliasedString(body, ["destinationCity", "destination_city"], errors),
    destinationState: readOptionalAliasedString(body, ["destinationState", "destination_state"], errors),
    destinationZip: readOptionalAliasedString(body, ["destinationZip", "destination_zip"], errors),
    productDescription: readOptionalAliasedString(body, ["productDescription", "product_description"], errors),
    hsCode: readOptionalAliasedString(body, ["hsCode", "hs_code"], errors),
    containerCount: readOptionalAliasedNumber(body, ["containerCount", "container_count"], errors),
    teu: readOptionalAliasedNumber(body, ["teu"], errors),
    weight: readOptionalAliasedNumber(body, ["weight"], errors),
    quantity: readOptionalAliasedNumber(body, ["quantity"], errors),
    volume: readOptionalAliasedNumber(body, ["volume"], errors),
    carrier: readOptionalAliasedString(body, ["carrier"], errors),
    vessel: readOptionalAliasedString(body, ["vessel"], errors),
    voyage: readOptionalAliasedString(body, ["voyage"], errors),
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

function getCompanyIdentity(record: TradeMiningRecordInput) {
  const candidates = [
    ["importer_name", record.importerName],
    ["consignee_name", record.consigneeName],
    ["master_consignee_name", record.masterConsigneeName],
    ["notify_party", record.notifyParty],
    ["shipper_name", record.shipperName],
    ["master_shipper_name", record.masterShipperName]
  ] as const;

  for (const [sourceRole, name] of candidates) {
    if (name) {
      return {
        name,
        sourceRole
      };
    }
  }

  return {
    name: "Unknown importer",
    sourceRole: "unknown"
  };
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
  const bolKey = record.houseBolNumber ?? record.masterBolNumber ?? record.bolNumber;
  const containerKey = record.containerNumber;
  const originKey = record.foreignPort ?? record.originPort ?? record.shipFromPort ?? record.placeOfReceipt;
  const destinationKey = record.arrivalPort ?? record.destinationPort ?? record.destinationMarket;

  if (bolKey) {
    return [
      "bol",
      bolKey.trim().toLowerCase(),
      containerKey?.trim().toLowerCase() ?? "no-container",
      normalizedName
    ].join(":");
  }

  const composite = [
    batch.source.toLowerCase(),
    batch.searchProfileId ?? "no-profile",
    record.shipmentDate ?? "no-date",
    normalizedName,
    originKey ?? "no-origin",
    destinationKey ?? "no-destination",
    record.hsCode ?? "no-hs",
    record.productDescription ?? "no-product",
    containerKey ?? "no-container"
  ]
    .map((value) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""))
    .join(":");

  return composite.includes("no-date") && composite.includes("no-origin") && composite.includes("no-destination")
    ? `${composite}:${index}`
    : composite;
}

function calculateCandidateScore(record: TradeMiningRecordInput) {
  const containerScore = Math.min(25, Math.max(0, record.containerCount ?? 0) * 5);
  const volumeScore = Math.min(
    20,
    Math.floor(Math.max(0, record.weight ?? 0) / 5000) + Math.floor(Math.max(0, record.teu ?? 0) * 4)
  );
  const productScore = record.productDescription || record.hsCode ? 15 : 0;
  const laneScore = record.destinationMarket || record.destinationPort || record.arrivalPort ? 20 : 0;
  const recencyScore = record.shipmentDate ? 10 : 0;

  return Math.min(100, 20 + containerScore + volumeScore + productScore + laneScore + recencyScore);
}

function buildRawJson(batch: BatchPayload, record: TradeMiningRecordInput): Prisma.InputJsonObject {
  const companyIdentity = getCompanyIdentity(record);

  return {
    source: batch.source,
    jobRunId: batch.jobRunId ?? null,
    searchProfileId: batch.searchProfileId ?? null,
    sourceRole: companyIdentity.sourceRole,
    companyMatchName: companyIdentity.name,
    record: {
      importerName: record.importerName ?? null,
      consigneeName: record.consigneeName ?? null,
      masterConsigneeName: record.masterConsigneeName ?? null,
      notifyParty: record.notifyParty ?? null,
      shipperName: record.shipperName ?? null,
      masterShipperName: record.masterShipperName ?? null,
      bolNumber: record.bolNumber ?? null,
      houseBolNumber: record.houseBolNumber ?? null,
      masterBolNumber: record.masterBolNumber ?? null,
      containerNumber: record.containerNumber ?? null,
      billType: record.billType ?? null,
      shipmentDate: record.shipmentDate ?? null,
      originCountry: record.originCountry ?? null,
      originPort: record.originPort ?? null,
      foreignPort: record.foreignPort ?? null,
      shipFromPort: record.shipFromPort ?? null,
      placeOfReceipt: record.placeOfReceipt ?? null,
      arrivalPort: record.arrivalPort ?? null,
      destinationPort: record.destinationPort ?? null,
      destinationMarket: record.destinationMarket ?? null,
      destinationCity: record.destinationCity ?? null,
      destinationState: record.destinationState ?? null,
      destinationZip: record.destinationZip ?? null,
      productDescription: record.productDescription ?? null,
      hsCode: record.hsCode ?? null,
      containerCount: record.containerCount ?? null,
      teu: record.teu ?? null,
      weight: record.weight ?? null,
      quantity: record.quantity ?? null,
      volume: record.volume ?? null,
      carrier: record.carrier ?? null,
      vessel: record.vessel ?? null,
      voyage: record.voyage ?? null
    },
    importerName: record.importerName ?? null,
    consigneeName: record.consigneeName ?? null,
    masterConsigneeName: record.masterConsigneeName ?? null,
    notifyParty: record.notifyParty ?? null,
    shipperName: record.shipperName ?? null,
    masterShipperName: record.masterShipperName ?? null,
    bolNumber: record.bolNumber ?? null,
    houseBolNumber: record.houseBolNumber ?? null,
    masterBolNumber: record.masterBolNumber ?? null,
    containerNumber: record.containerNumber ?? null,
    billType: record.billType ?? null,
    shipmentDate: record.shipmentDate ?? null,
    arrivalDate: record.shipmentDate ?? null,
    arrivalPort: record.arrivalPort ?? record.destinationPort ?? null,
    destinationPort: record.destinationPort ?? null,
    destinationMarket: record.destinationMarket ?? null,
    destinationCity: record.destinationCity ?? null,
    destinationState: record.destinationState ?? null,
    destinationZip: record.destinationZip ?? null,
    originPort: record.originPort ?? null,
    foreignPort: record.foreignPort ?? null,
    shipFromPort: record.shipFromPort ?? null,
    placeOfReceipt: record.placeOfReceipt ?? null,
    originCountry: record.originCountry ?? null,
    productDescription: record.productDescription ?? null,
    hsCode: record.hsCode ?? null,
    containerCount: record.containerCount ?? null,
    teu: record.teu ?? null,
    weight: record.weight ?? null,
    quantity: record.quantity ?? null,
    volume: record.volume ?? null,
    carrier: record.carrier ?? null,
    vessel: record.vessel ?? null,
    voyage: record.voyage ?? null,
    scoreReasoning: buildScoreReasoning(record),
    rawData: record.rawData ?? {}
  };
}

function buildScoreReasoning(record: TradeMiningRecordInput): Prisma.InputJsonObject {
  return {
    baseScore: 20,
    containerScore: Math.min(25, Math.max(0, record.containerCount ?? 0) * 5),
    volumeScore: Math.min(
      20,
      Math.floor(Math.max(0, record.weight ?? 0) / 5000) + Math.floor(Math.max(0, record.teu ?? 0) * 4)
    ),
    productScore: record.productDescription || record.hsCode ? 15 : 0,
    laneScore: record.destinationMarket || record.destinationPort || record.arrivalPort ? 20 : 0,
    recencyScore: record.shipmentDate ? 10 : 0,
    note: "Temporary deterministic score for Candidate Feed readiness until ranked scoring milestone."
  };
}

function parseDate(value: string | null | undefined) {
  return value ? new Date(value) : null;
}

function readSearchProfileIdFromJobInput(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const field = (value as Record<string, unknown>).searchProfileId;
  return typeof field === "string" && field.trim() ? field : null;
}

function readJsonString(value: unknown, key: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const field = (value as Record<string, unknown>)[key];
  return typeof field === "string" && field.trim() ? field : null;
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

function readOptionalAliasedString(body: Record<string, unknown>, fields: string[], errors: string[]) {
  for (const field of fields) {
    const value = readOptionalString(body, field, errors);
    if (value !== undefined) {
      return value;
    }
  }

  return undefined;
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

function readOptionalAliasedNumber(body: Record<string, unknown>, fields: string[], errors: string[]) {
  for (const field of fields) {
    const value = readOptionalNumber(body, field, errors);
    if (value !== undefined) {
      return value;
    }
  }

  return undefined;
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
