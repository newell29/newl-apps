import { JobStatus } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

type TenantRow = {
  id: string;
  slug: string;
  name: string;
};

type SearchProfileRow = {
  id: string;
  tenantId: string;
  name: string;
  description: string | null;
  enabled: boolean;
  destinationMarkets: string[];
  destinationPorts: string[];
  originPorts: string[];
  shipFromPorts: string[];
  originCountries: string[];
  productKeywords: string[];
  hsCodes: string[];
  lookbackWindowDays: number;
  minShipmentCount: number;
  minShipmentVolume: { toString: () => string } | null;
  scheduleFrequency: string;
  scheduleTimezone: string;
  scheduleMetadata: Record<string, unknown> | null;
  priorityWeight: number;
};

type CompanyRow = {
  id: string;
  tenantId: string;
  name: string;
  normalizedName: string;
  source: string;
  priorityScore: number;
};

type ImportRecordRow = {
  id: string;
  tenantId: string;
  companyId: string;
  rawRecordKey: string;
  sourcePort: string | null;
  arrivalDate: Date | null;
  importerName: string | null;
  consigneeName: string | null;
  shipperName: string | null;
  destinationCity: string | null;
  destinationState: string | null;
  originCountry: string | null;
  productDescription: string | null;
  rawJson: Record<string, unknown>;
};

type JobRunRow = {
  id: string;
  tenantId: string;
  jobType: string;
  status: JobStatus;
  startedAt?: Date;
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
  errorMessage?: string | null;
  finishedAt?: Date | null;
};

const mockDb = vi.hoisted(() => {
  const state = {
    tenants: new Map<string, TenantRow>(),
    searchProfiles: new Map<string, SearchProfileRow>(),
    companies: new Map<string, CompanyRow>(),
    importRecords: new Map<string, ImportRecordRow>(),
    jobRuns: new Map<string, JobRunRow>(),
    auditLogs: [] as Array<Record<string, unknown>>,
    nextCompanyId: 1,
    nextImportRecordId: 1,
    nextJobRunId: 1
  };

  const tenantScopedKey = (tenantId: string, value: string) => `${tenantId}:${value}`;

  const prisma = {
    tenant: {
      findUnique: vi.fn(async ({ where }: { where: { slug: string } }) => {
        return state.tenants.get(where.slug) ?? null;
      })
    },
    tradeMiningSearchProfile: {
      findMany: vi.fn(async ({ where, orderBy }: { where: { tenantId: string; enabled?: boolean }; orderBy?: unknown }) => {
        const profiles = [...state.searchProfiles.values()].filter((profile) => {
          return profile.tenantId === where.tenantId && (where.enabled === undefined || profile.enabled === where.enabled);
        });

        if (orderBy) {
          profiles.sort((left, right) => right.priorityWeight - left.priorityWeight || left.name.localeCompare(right.name));
        }

        return profiles;
      }),
      findFirst: vi.fn(async ({ where }: { where: { id: string; tenantId: string } }) => {
        const profile = state.searchProfiles.get(where.id);
        return profile && profile.tenantId === where.tenantId ? { id: profile.id } : null;
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<SearchProfileRow> }) => {
        const profile = state.searchProfiles.get(where.id);

        if (!profile) {
          throw new Error("Search profile not found");
        }

        const updated = { ...profile, ...data };
        state.searchProfiles.set(where.id, updated);
        return updated;
      })
    },
    automationJobRun: {
      create: vi.fn(async ({ data }: { data: Omit<JobRunRow, "id"> }) => {
        const jobRun = { id: `job-${state.nextJobRunId++}`, startedAt: new Date("2026-06-16T12:00:00.000Z"), ...data };
        state.jobRuns.set(jobRun.id, jobRun);
        return jobRun;
      }),
      findFirst: vi.fn(async ({ where }: { where: { id: string; tenantId: string } }) => {
        const jobRun = state.jobRuns.get(where.id);
        return jobRun && jobRun.tenantId === where.tenantId ? { ...jobRun } : null;
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string; tenantId: string }; data: Partial<JobRunRow> }) => {
        const jobRun = state.jobRuns.get(where.id);

        if (!jobRun || jobRun.tenantId !== where.tenantId) {
          throw new Error("Job run not found");
        }

        const updated = { ...jobRun, ...data };
        state.jobRuns.set(where.id, updated);
        return updated;
      })
    },
    company: {
      findUnique: vi.fn(async ({ where, select }: { where: { tenantId_normalizedName: { tenantId: string; normalizedName: string } }; select?: { id?: boolean; priorityScore?: boolean } }) => {
        const company = state.companies.get(tenantScopedKey(where.tenantId_normalizedName.tenantId, where.tenantId_normalizedName.normalizedName));

        if (!company) {
          return null;
        }

        if (select) {
          return {
            ...(select.id ? { id: company.id } : {}),
            ...(select.priorityScore ? { priorityScore: company.priorityScore } : {})
          };
        }

        return company;
      }),
      upsert: vi.fn(async ({ where, update, create }: { where: { tenantId_normalizedName: { tenantId: string; normalizedName: string } }; update: Partial<CompanyRow>; create: CompanyRow }) => {
        const key = tenantScopedKey(where.tenantId_normalizedName.tenantId, where.tenantId_normalizedName.normalizedName);
        const existing = state.companies.get(key);

        if (existing) {
          const updated = { ...existing, ...update };
          state.companies.set(key, updated);
          return updated;
        }

        const company = { ...create, id: create.id ?? `company-${state.nextCompanyId++}` };
        state.companies.set(key, company);
        return company;
      })
    },
    tradeMiningImportRecord: {
      findUnique: vi.fn(async ({ where }: { where: { tenantId_rawRecordKey: { tenantId: string; rawRecordKey: string } } }) => {
        const record = state.importRecords.get(tenantScopedKey(where.tenantId_rawRecordKey.tenantId, where.tenantId_rawRecordKey.rawRecordKey));
        return record ? { id: record.id } : null;
      }),
      upsert: vi.fn(async ({ where, update, create }: { where: { tenantId_rawRecordKey: { tenantId: string; rawRecordKey: string } }; update: Partial<ImportRecordRow>; create: ImportRecordRow }) => {
        const key = tenantScopedKey(where.tenantId_rawRecordKey.tenantId, where.tenantId_rawRecordKey.rawRecordKey);
        const existing = state.importRecords.get(key);

        if (existing) {
          const updated = { ...existing, ...update };
          state.importRecords.set(key, updated);
          return updated;
        }

        const record = { ...create, id: create.id ?? `import-record-${state.nextImportRecordId++}` };
        state.importRecords.set(key, record);
        return record;
      }),
      findMany: vi.fn(async ({ where }: { where: { tenantId: string } }) => {
        return [...state.importRecords.values()]
          .filter((record) => record.tenantId === where.tenantId)
          .map((record) => {
            const company = [...state.companies.values()].find(
              (candidate) => candidate.id === record.companyId && candidate.tenantId === record.tenantId
            );

            return {
              ...record,
              company: company
                ? {
                    id: company.id,
                    name: company.name,
                    normalizedName: company.normalizedName
                  }
                : null
            };
          });
      })
    },
    auditLog: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        state.auditLogs.push(data);
        return data;
      })
    }
  };

  return { state, prisma };
});

vi.mock("@/server/db", () => ({
  prisma: mockDb.prisma
}));

import {
  IngestionValidationError,
  createTradeMiningJobRun,
  getTradeMiningJobRunReadback,
  getActiveTradeMiningProfilesForWorker,
  ingestTradeMiningBatch,
  updateTradeMiningJobRunStatus
} from "@/modules/trademining/ingestion";
import { authenticateIngestionRequest, IngestionAuthError } from "@/server/ingestion-auth";
import type { TenantContext } from "@/server/tenant-context";

const tenant: TenantContext = {
  tenantId: "tenant-a",
  tenantSlug: "tenant-a",
  tenantName: "Tenant A"
};

describe("TradeMining ingestion", () => {
  beforeEach(() => {
    mockDb.state.tenants.clear();
    mockDb.state.searchProfiles.clear();
    mockDb.state.companies.clear();
    mockDb.state.importRecords.clear();
    mockDb.state.jobRuns.clear();
    mockDb.state.auditLogs.length = 0;
    mockDb.state.nextCompanyId = 1;
    mockDb.state.nextImportRecordId = 1;
    mockDb.state.nextJobRunId = 1;
    vi.clearAllMocks();
    delete process.env.INGESTION_API_TOKEN;
    delete process.env.INGESTION_TENANT_SLUG;
    delete process.env.DEFAULT_TENANT_SLUG;
  });

  it("authenticates ingestion requests to the configured tenant, not a caller-supplied tenant", async () => {
    process.env.INGESTION_API_TOKEN = "secret-token";
    process.env.INGESTION_TENANT_SLUG = "tenant-a";
    mockDb.state.tenants.set("tenant-a", { id: "tenant-a", slug: "tenant-a", name: "Tenant A" });

    const request = new Request("https://newl.test/api", {
      headers: {
        authorization: "Bearer secret-token",
        "x-ignored-tenant-id": "tenant-b"
      }
    });

    await expect(authenticateIngestionRequest(request)).resolves.toEqual(tenant);
  });

  it("rejects invalid ingestion credentials", async () => {
    process.env.INGESTION_API_TOKEN = "secret-token";
    process.env.INGESTION_TENANT_SLUG = "tenant-a";

    const request = new Request("https://newl.test/api", {
      headers: {
        authorization: "Bearer wrong-token"
      }
    });

    await expect(authenticateIngestionRequest(request)).rejects.toBeInstanceOf(IngestionAuthError);
  });

  it("returns enabled search profiles for the authenticated tenant only", async () => {
    mockDb.state.searchProfiles.set("profile-a", searchProfile({ id: "profile-a", tenantId: "tenant-a", enabled: true, priorityWeight: 80 }));
    mockDb.state.searchProfiles.set("profile-disabled", searchProfile({ id: "profile-disabled", tenantId: "tenant-a", enabled: false, priorityWeight: 100 }));
    mockDb.state.searchProfiles.set("profile-b", searchProfile({ id: "profile-b", tenantId: "tenant-b", enabled: true, priorityWeight: 90 }));

    const result = await getActiveTradeMiningProfilesForWorker(tenant);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: "profile-a",
      name: "Houston Leads",
      destinationMarkets: ["Houston"],
      priorityWeight: 80
    });
  });

  it("ingests batches idempotently by tenant and raw BOL key", async () => {
    mockDb.state.searchProfiles.set("profile-a", searchProfile({ id: "profile-a", tenantId: "tenant-a" }));

    const payload = {
      source: "OPENCLAW",
      searchProfileId: "profile-a",
      records: [
        {
          importerName: "ABC Imports Inc.",
          bolNumber: "BOL-123",
          shipmentDate: "2026-06-10",
          originCountry: "China",
          originPort: "Shanghai",
          destinationPort: "Houston, Texas",
          destinationMarket: "Houston",
          productDescription: "furniture",
          hsCode: "9403",
          containerCount: 2,
          weight: 18000
        }
      ]
    };

    await expect(ingestTradeMiningBatch(tenant, payload)).resolves.toMatchObject({
      recordsProcessed: 1,
      recordsCreated: 1,
      recordsUpdated: 0,
      companiesCreated: 1,
      companiesUpdated: 0
    });

    await expect(ingestTradeMiningBatch(tenant, payload)).resolves.toMatchObject({
      recordsProcessed: 1,
      recordsCreated: 0,
      recordsUpdated: 1,
      companiesCreated: 0,
      companiesUpdated: 1
    });

    expect(mockDb.state.companies.size).toBe(1);
    expect(mockDb.state.importRecords.size).toBe(1);
    expect([...mockDb.state.companies.values()][0]).toMatchObject({
      tenantId: "tenant-a",
      normalizedName: "abc-imports-inc",
      priorityScore: 78
    });
  });

  it("accepts canonical snake_case TradeMining fields and preserves richer BOL details", async () => {
    mockDb.state.searchProfiles.set("profile-a", searchProfile({ id: "profile-a", tenantId: "tenant-a" }));

    await expect(
      ingestTradeMiningBatch(tenant, {
        source: "OPENCLAW",
        searchProfileId: "profile-a",
        records: [
          {
            consignee_name: "Southeast Retail Group LLC",
            notify_party: "Southeast Retail Group LLC",
            house_bol_number: "HBOL-22",
            master_bol_number: "MBOL-99",
            container_number: "MSCU1234567",
            arrival_date: "2026-06-14",
            arrival_port: "Houston, Texas",
            foreign_port: "Yantian",
            place_of_receipt: "Shenzhen",
            destination_city: "Charlotte",
            destination_state: "NC",
            destination_zip: "28202",
            origin_country: "China",
            product_description: "outdoor furniture cushions",
            hs_code: "9403.20",
            container_count: 3,
            teu: 4,
            weight: 24500,
            quantity: 1180,
            carrier: "MSC",
            vessel: "MSC Aurora",
            voyage: "A12"
          }
        ]
      })
    ).resolves.toMatchObject({
      recordsProcessed: 1,
      recordsCreated: 1,
      companiesCreated: 1
    });

    const company = [...mockDb.state.companies.values()][0];
    const record = [...mockDb.state.importRecords.values()][0];

    expect(company).toMatchObject({
      normalizedName: "southeast-retail-group-llc"
    });
    expect(record).toMatchObject({
      consigneeName: "Southeast Retail Group LLC",
      shipperName: null,
      destinationCity: "Charlotte",
      destinationState: "NC",
      originCountry: "China",
      productDescription: "outdoor furniture cushions"
    });
    expect(record.rawJson).toMatchObject({
      sourceRole: "consignee_name",
      arrivalPort: "Houston, Texas",
      foreignPort: "Yantian",
      placeOfReceipt: "Shenzhen",
      destinationZip: "28202",
      hsCode: "9403.20",
      teu: 4,
      carrier: "MSC",
      vessel: "MSC Aurora",
      voyage: "A12"
    });
  });

  it("rejects profile and job run IDs that do not belong to the authenticated tenant", async () => {
    mockDb.state.searchProfiles.set("profile-b", searchProfile({ id: "profile-b", tenantId: "tenant-b" }));
    mockDb.state.jobRuns.set("job-b", {
      id: "job-b",
      tenantId: "tenant-b",
      jobType: "trademining.ingestion",
      status: JobStatus.RUNNING
    });

    await expect(
      ingestTradeMiningBatch(tenant, {
        source: "OPENCLAW",
        searchProfileId: "profile-b",
        records: [{ importerName: "ABC Imports" }]
      })
    ).rejects.toBeInstanceOf(IngestionValidationError);

    await expect(
      ingestTradeMiningBatch(tenant, {
        source: "OPENCLAW",
        jobRunId: "job-b",
        records: [{ importerName: "ABC Imports" }]
      })
    ).rejects.toBeInstanceOf(IngestionValidationError);
  });

  it("maps external job status to internal job status and audits the update", async () => {
    mockDb.state.searchProfiles.set("profile-a", searchProfile({ id: "profile-a", tenantId: "tenant-a" }));

    const started = await createTradeMiningJobRun(tenant, {
      source: "OPENCLAW",
      searchProfileId: "profile-a",
      metadata: { worker: "openclaw" }
    });

    await expect(
      updateTradeMiningJobRunStatus(tenant, started.jobRunId, {
        status: "PARTIAL",
        recordsProcessed: 10,
        recordsCreated: 8,
        recordsUpdated: 2
      })
    ).resolves.toEqual({
      jobRunId: started.jobRunId,
      status: JobStatus.SUCCESS,
      externalStatus: "PARTIAL"
    });

    const jobRun = mockDb.state.jobRuns.get(started.jobRunId);
    expect(jobRun).toMatchObject({
      status: JobStatus.SUCCESS,
      output: {
        externalStatus: "PARTIAL",
        recordsProcessed: 10,
        recordsCreated: 8,
        recordsUpdated: 2
      }
    });
    expect(mockDb.state.auditLogs.at(-1)).toMatchObject({
      action: "trademining.job.completed",
      entityType: "AutomationJobRun",
      entityId: started.jobRunId
    });
  });

  it("returns a narrow readback of stored rows for one job run", async () => {
    mockDb.state.searchProfiles.set("profile-a", searchProfile({ id: "profile-a", tenantId: "tenant-a" }));

    const started = await createTradeMiningJobRun(tenant, {
      source: "OPENCLAW",
      searchProfileId: "profile-a"
    });

    await ingestTradeMiningBatch(tenant, {
      source: "OPENCLAW",
      jobRunId: started.jobRunId,
      searchProfileId: "profile-a",
      records: [
        {
          consignee_name: "Harbor Home Retail LLC",
          arrival_date: "2026-06-14",
          arrival_port: "Houston, Texas",
          foreign_port: "Shanghai",
          product_description: "furniture and fixtures",
          hs_code: "9403"
        }
      ]
    });

    const result = await getTradeMiningJobRunReadback(tenant, started.jobRunId);

    expect(result.jobRun).toMatchObject({
      id: started.jobRunId,
      jobType: "trademining.ingestion",
      status: JobStatus.RUNNING
    });
    expect(result.records).toHaveLength(1);
    expect(result.records[0]).toMatchObject({
      consigneeName: "Harbor Home Retail LLC",
      company: {
        name: "Harbor Home Retail LLC"
      },
      rawPayload: {
        jobRunId: started.jobRunId,
        sourceRole: "consignee_name",
        arrivalPort: "Houston, Texas",
        foreignPort: "Shanghai",
        hsCode: "9403"
      }
    });
  });
});

function searchProfile(overrides: Partial<SearchProfileRow> = {}): SearchProfileRow {
  return {
    id: "profile-a",
    tenantId: "tenant-a",
    name: "Houston Leads",
    description: null,
    enabled: true,
    destinationMarkets: ["Houston"],
    destinationPorts: ["Houston, Texas"],
    originPorts: ["Shanghai"],
    shipFromPorts: ["Shanghai"],
    originCountries: ["China"],
    productKeywords: ["furniture"],
    hsCodes: ["9403"],
    lookbackWindowDays: 90,
    minShipmentCount: 3,
    minShipmentVolume: { toString: () => "25" },
    scheduleFrequency: "daily",
    scheduleTimezone: "America/Toronto",
    scheduleMetadata: { preferredRunHourLocal: 7 },
    priorityWeight: 80,
    ...overrides
  };
}
