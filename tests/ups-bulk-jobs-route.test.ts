import { beforeEach, describe, expect, it, vi } from "vitest";
import { PlatformRole } from "@prisma/client";
import type { AuthenticatedContext } from "@/server/tenant-context";
import type { UpsAccountConfig, UpsBulkQuoteJobDetail, UpsBulkQuoteJobSummary } from "@/modules/ups-tools/types";

const getAuthenticatedContext = vi.fn();
const requireModule = vi.fn();
const requireMutationAccess = vi.fn();
const getUpsToolsShell = vi.fn();
const createUpsBulkQuoteJob = vi.fn();
const deleteUpsBulkQuoteJob = vi.fn();
const getUpsBulkQuoteJobSummaryForTenant = vi.fn();
const getUpsBulkQuoteJobDetail = vi.fn();
const runUpsBulkQuoteJob = vi.fn();

vi.mock("@/server/tenant-context", () => ({
  getAuthenticatedContext: () => getAuthenticatedContext()
}));

vi.mock("@/server/auth/authorization", () => ({
  requireModule: (...args: unknown[]) => requireModule(...args),
  requireMutationAccess: (...args: unknown[]) => requireMutationAccess(...args)
}));

vi.mock("@/modules/ups-tools/queries", () => ({
  getUpsToolsShell: (...args: unknown[]) => getUpsToolsShell(...args)
}));

vi.mock("@/modules/ups-tools/bulk-jobs", () => ({
  createUpsBulkQuoteJob: (...args: unknown[]) => createUpsBulkQuoteJob(...args),
  deleteUpsBulkQuoteJob: (...args: unknown[]) => deleteUpsBulkQuoteJob(...args),
  getRecentUpsBulkQuoteJobs: vi.fn(),
  getUpsBulkQuoteJobSummaryForTenant: (...args: unknown[]) => getUpsBulkQuoteJobSummaryForTenant(...args),
  getUpsBulkQuoteJobDetail: (...args: unknown[]) => getUpsBulkQuoteJobDetail(...args),
  runUpsBulkQuoteJob: (...args: unknown[]) => runUpsBulkQuoteJob(...args)
}));

vi.mock("@/server/integrations/ups", () => ({
  getUpsQuote: vi.fn()
}));

import { DELETE as deleteBulkJob, GET as getBulkJob, POST as postBulkJob } from "@/app/api/ups/bulk-jobs/route";

const context: AuthenticatedContext = {
  userId: "user-1",
  userEmail: "user@example.com",
  userName: "User",
  role: PlatformRole.OPERATIONS,
  tenantId: "tenant-1",
  tenantSlug: "tenant-one",
  tenantName: "Tenant One"
};

const account: UpsAccountConfig = {
  id: "ups-account-1",
  name: "Charlotte UPS",
  status: "ACTIVE",
  countryCode: "US",
  shipperNumber: "G460D6",
  originPostalCode: "28273",
  originLabel: "Charlotte, NC",
  originStateProvince: "NC",
  dryRun: false,
  secretConfigured: true,
  toolTargets: ["SHIPMENT_RATE_QUOTE"]
};

const job: UpsBulkQuoteJobSummary = {
  id: "job-1",
  status: "QUEUED",
  name: "June UPS pull",
  accountIds: [account.id],
  accountNames: [account.name],
  services: ["Ground"],
  rowCount: 2,
  accountCount: 1,
  serviceCount: 1,
  totalRequestCount: 2,
  processedRequestCount: 0,
  quoteCount: 0,
  issueCount: 0,
  chunkSize: 25,
  chunkCount: 1,
  requestConcurrency: 4,
  startedAt: "2026-06-22T12:00:00.000Z",
  finishedAt: null,
  errorMessage: null
};

const jobDetail: UpsBulkQuoteJobDetail = {
  job: {
    ...job,
    status: "SUCCESS",
    processedRequestCount: 2,
    quoteCount: 2
  },
  rows: [
    {
      CustomerOrderNumber: "SO-1001",
      OriginZIP: "28273",
      DestinationZIP: "10001",
      Weight: "10"
    }
  ],
  results: [],
  issues: [],
  isResidential: false
};

describe("UPS bulk quote routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAuthenticatedContext.mockResolvedValue(context);
    requireModule.mockResolvedValue(undefined);
    requireMutationAccess.mockReturnValue(undefined);
    getUpsToolsShell.mockResolvedValue({
      accounts: [account]
    });
    createUpsBulkQuoteJob.mockResolvedValue(job);
    deleteUpsBulkQuoteJob.mockResolvedValue(undefined);
    getUpsBulkQuoteJobSummaryForTenant.mockResolvedValue(job);
    getUpsBulkQuoteJobDetail.mockResolvedValue(jobDetail);
    runUpsBulkQuoteJob.mockResolvedValue(undefined);
  });

  it("rejects uploads without a valid shipment row", async () => {
    const request = new Request("https://newl.test/api/ups/bulk-jobs", {
      method: "POST",
      body: JSON.stringify({
        accountIds: [account.id],
        services: ["Ground"],
        rows: [{ OriginZIP: "28273", Weight: "10" }]
      })
    });

    const response = await postBulkJob(request);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "No valid shipment rows were found in the upload."
    });
  });

  it("creates a queued job and starts the background run", async () => {
    const request = new Request("https://newl.test/api/ups/bulk-jobs", {
      method: "POST",
      body: JSON.stringify({
        name: "  June UPS pull  ",
        accountIds: [account.id],
        services: ["Ground"],
        isResidential: true,
        rows: [
          {
            CustomerOrderNumber: "SO-1001",
            OriginZIP: "28273",
            DestinationZIP: "10001",
            Weight: "10"
          }
        ]
      })
    });

    const response = await postBulkJob(request);
    await Promise.resolve();

    expect(response.status).toBe(201);
    expect(createUpsBulkQuoteJob).toHaveBeenCalledWith(
      context,
      expect.objectContaining({
        name: "  June UPS pull  ",
        accounts: [account],
        services: ["Ground"],
        isResidential: true,
        rowCount: 1,
        processedRequestCount: 0
      })
    );
    expect(runUpsBulkQuoteJob).toHaveBeenCalledWith(
      { tenantId: context.tenantId, userId: context.userId },
      job.id,
      expect.objectContaining({
        accounts: [account],
        services: ["Ground"],
        isResidential: true
      }),
      expect.any(Function)
    );
    await expect(response.json()).resolves.toEqual({ job });
  });

  it("returns the saved job summary", async () => {
    const response = await getBulkJob(
      new Request("https://newl.test/api/ups/bulk-jobs?jobId=job-1")
    );

    expect(response.status).toBe(200);
    expect(getUpsBulkQuoteJobSummaryForTenant).toHaveBeenCalledWith(context, "job-1");
    await expect(response.json()).resolves.toEqual({ job });
  });

  it("returns detailed saved job results when requested", async () => {
    const response = await getBulkJob(
      new Request("https://newl.test/api/ups/bulk-jobs?jobId=job-1&includeResults=1")
    );

    expect(response.status).toBe(200);
    expect(getUpsBulkQuoteJobDetail).toHaveBeenCalledWith(context, "job-1");
    await expect(response.json()).resolves.toEqual(jobDetail);
  });

  it("deletes a saved UPS bulk run", async () => {
    const response = await deleteBulkJob(
      new Request("https://newl.test/api/ups/bulk-jobs?jobId=job-1", {
        method: "DELETE"
      })
    );

    expect(response.status).toBe(200);
    expect(deleteUpsBulkQuoteJob).toHaveBeenCalledWith(
      { tenantId: context.tenantId, userId: context.userId },
      "job-1"
    );
    await expect(response.json()).resolves.toEqual({ ok: true });
  });
});
