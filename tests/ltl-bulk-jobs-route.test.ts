import { beforeEach, describe, expect, it, vi } from "vitest";
import { PlatformRole } from "@prisma/client";
import type { AuthenticatedContext } from "@/server/tenant-context";
import type { LtlBulkQuoteJobDetail, LtlBulkQuoteJobSummary, SevenLAccountConfig } from "@/modules/ltl-rate-portal/types";

const getAuthenticatedContext = vi.fn();
const requireModule = vi.fn();
const requireMutationAccess = vi.fn();
const getLtlRatePortalShell = vi.fn();
const createLtlBulkQuoteJob = vi.fn();
const deleteLtlBulkQuoteJob = vi.fn();
const getLtlBulkQuoteJobSummaryForTenant = vi.fn();
const getLtlBulkQuoteJobDetail = vi.fn();
const runLtlBulkQuoteJob = vi.fn();
const exportLtlBulkQuoteJobCsv = vi.fn();

vi.mock("@/server/tenant-context", () => ({
  getAuthenticatedContext: () => getAuthenticatedContext()
}));

vi.mock("@/server/auth/authorization", () => ({
  requireModule: (...args: unknown[]) => requireModule(...args),
  requireMutationAccess: (...args: unknown[]) => requireMutationAccess(...args)
}));

vi.mock("@/modules/ltl-rate-portal/queries", () => ({
  getLtlRatePortalShell: (...args: unknown[]) => getLtlRatePortalShell(...args)
}));

vi.mock("@/modules/ltl-rate-portal/bulk-jobs", () => ({
  LTL_BULK_CHUNK_SIZE: 25,
  LTL_BULK_LANE_CONCURRENCY: 4,
  createLtlBulkQuoteJob: (...args: unknown[]) => createLtlBulkQuoteJob(...args),
  deleteLtlBulkQuoteJob: (...args: unknown[]) => deleteLtlBulkQuoteJob(...args),
  getLtlBulkQuoteJobSummaryForTenant: (...args: unknown[]) => getLtlBulkQuoteJobSummaryForTenant(...args),
  getLtlBulkQuoteJobDetail: (...args: unknown[]) => getLtlBulkQuoteJobDetail(...args),
  runLtlBulkQuoteJob: (...args: unknown[]) => runLtlBulkQuoteJob(...args),
  exportLtlBulkQuoteJobCsv: (...args: unknown[]) => exportLtlBulkQuoteJobCsv(...args)
}));

import { DELETE as deleteBulkJob, GET as getBulkJob, POST as postBulkJob } from "@/app/api/ltl-rate-portal/bulk-jobs/route";
import { GET as exportBulkJobCsv } from "@/app/api/ltl-rate-portal/bulk-jobs/[jobId]/results/route";

const context: AuthenticatedContext = {
  userId: "user-1",
  userEmail: "user@example.com",
  userName: "User",
  role: PlatformRole.OPERATIONS,
  tenantId: "tenant-1",
  tenantSlug: "tenant-one",
  tenantName: "Tenant One"
};

const account: SevenLAccountConfig = {
  id: "account-1",
  name: "7L Preferred LTL",
  status: "ACTIVE",
  baseUrl: "https://restapi.my7l.com",
  defaultUom: "US",
  strictResult: false,
  harmonizedCharges: true,
  dryRun: false,
  carrierMode: "TENANT_SELECTED",
  secretConfigured: true,
  carriers: [
    {
      carrierHash: "carrier-1",
      name: "Estes",
      code: "EST",
      scac: "EXLA",
      defaulted: true,
      enabled: true
    }
  ]
};

const job: LtlBulkQuoteJobSummary = {
  id: "job-1",
  status: "QUEUED",
  name: "June RFQ - Southeast",
  accountId: account.id,
  accountName: account.name,
  selectedCarrierCount: 1,
  totalLanes: 250,
  processedLanes: 0,
  quotedLanes: 0,
  issueLanes: 0,
  quoteCount: 0,
  errorCount: 0,
  startedAt: "2026-06-16T12:00:00.000Z",
  finishedAt: null,
  errorMessage: null
};

const jobDetail: LtlBulkQuoteJobDetail = {
  job: {
    ...job,
    status: "SUCCESS",
    processedLanes: 1,
    quotedLanes: 1,
    quoteCount: 1
  },
  lanes: [
    {
      laneIndex: 0,
      customerReference: "RFQ-1",
      request: {
        customerReference: "RFQ-1",
        originCity: "CHARLOTTE",
        originState: "NC",
        originZipcode: "28273",
        originCountry: "US",
        destinationCity: "HOUSTON",
        destinationState: "TX",
        destinationZipcode: "77001",
        destinationCountry: "US",
        pickupDate: "2026-06-20",
        uom: "US",
        accessorialCodes: [],
        pieces: [
          {
            qty: 1,
            weight: 500,
            weightType: "each",
            length: 0,
            width: 0,
            height: 0,
            dimType: "PLT",
            freightClass: "125",
            hazmat: false,
            stack: false
          }
        ]
      },
      quotes: [],
      errors: [],
      quoteCount: 1,
      errorCount: 0
    }
  ]
};

describe("LTL bulk quote routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAuthenticatedContext.mockResolvedValue(context);
    requireModule.mockResolvedValue(undefined);
    requireMutationAccess.mockReturnValue(undefined);
    getLtlRatePortalShell.mockResolvedValue({
      accounts: [account]
    });
    createLtlBulkQuoteJob.mockResolvedValue(job);
    deleteLtlBulkQuoteJob.mockResolvedValue({ id: job.id });
    getLtlBulkQuoteJobSummaryForTenant.mockResolvedValue(job);
    getLtlBulkQuoteJobDetail.mockResolvedValue(jobDetail);
    exportLtlBulkQuoteJobCsv.mockResolvedValue("customerReference,cheapestCarrier\nRFQ-1,Estes");
  });

  it("rejects missing carrier selection", async () => {
    const request = new Request("https://newl.test/api/ltl-rate-portal/bulk-jobs", {
      method: "POST",
      body: JSON.stringify({
        accountId: account.id,
        carrierHashes: [],
        rows: [{}]
      })
    });

    const response = await postBulkJob(request);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Select at least one carrier for this pull."
    });
  });

  it("creates a job with sanitized carrier hashes and returns processing metadata", async () => {
    const request = new Request("https://newl.test/api/ltl-rate-portal/bulk-jobs", {
      method: "POST",
      body: JSON.stringify({
        name: "  June RFQ - Southeast  ",
        accountId: account.id,
        carrierHashes: ["carrier-1", "", null],
        rows: [{ customerReference: "RFQ-1" }]
      })
    });

    const response = await postBulkJob(request);

    expect(response.status).toBe(201);
    expect(createLtlBulkQuoteJob).toHaveBeenCalledWith(
      context,
      account,
      expect.objectContaining({ name: "June RFQ - Southeast", carrierHashes: ["carrier-1"] })
    );
    expect(runLtlBulkQuoteJob).toHaveBeenCalledWith(
      { tenantId: context.tenantId, userId: context.userId },
      job.id,
      account,
      expect.objectContaining({ name: "June RFQ - Southeast", carrierHashes: ["carrier-1"] })
    );
    await expect(response.json()).resolves.toEqual({
      job,
      processing: {
        chunkSize: 25,
        laneConcurrency: 4
      }
    });
  });

  it("rejects missing jobId on summary lookup", async () => {
    const response = await getBulkJob(new Request("https://newl.test/api/ltl-rate-portal/bulk-jobs"));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "jobId is required."
    });
  });

  it("returns detailed lane data when includeLanes=1", async () => {
    const response = await getBulkJob(
      new Request("https://newl.test/api/ltl-rate-portal/bulk-jobs?jobId=job-1&includeLanes=1")
    );

    expect(response.status).toBe(200);
    expect(getLtlBulkQuoteJobDetail).toHaveBeenCalledWith(context, "job-1");
    await expect(response.json()).resolves.toEqual(jobDetail);
  });

  it("deletes a saved bulk quote job", async () => {
    const response = await deleteBulkJob(
      new Request("https://newl.test/api/ltl-rate-portal/bulk-jobs?jobId=job-1", {
        method: "DELETE"
      })
    );

    expect(response.status).toBe(200);
    expect(deleteLtlBulkQuoteJob).toHaveBeenCalledWith(
      { tenantId: context.tenantId, userId: context.userId },
      "job-1"
    );
    await expect(response.json()).resolves.toEqual({
      deleted: { id: "job-1" }
    });
  });

  it("returns CSV export with attachment headers", async () => {
    const response = await exportBulkJobCsv(new Request("https://newl.test/export"), {
      params: Promise.resolve({ jobId: "job-1" })
    });

    expect(response.status).toBe(200);
    expect(exportLtlBulkQuoteJobCsv).toHaveBeenCalledWith(context, "job-1");
    expect(response.headers.get("Content-Type")).toContain("text/csv");
    expect(response.headers.get("Content-Disposition")).toContain('ltl_bulk_quote_job-1.csv');
  });
});
