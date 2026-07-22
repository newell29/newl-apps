import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runScheduledApolloStatusSync = vi.hoisted(() => vi.fn());

vi.mock("@/modules/lead-gen/apollo-status-sync", () => ({ runScheduledApolloStatusSync }));

import { GET } from "@/app/api/lead-gen/apollo/status-sync/route";

describe("Apollo status sync cron route", () => {
  beforeEach(() => {
    vi.stubEnv("APOLLO_STATUS_SYNC_SECRET", "apollo-sync-test-secret");
    vi.stubEnv("APOLLO_MASTER_API", "apollo-master-key");
    runScheduledApolloStatusSync.mockResolvedValue([
      {
        tenantId: "tenant-a",
        jobRunId: "job-1",
        status: "success",
        selectedContacts: 3,
        syncedContacts: 3,
        changedContacts: 1,
        failedContacts: 0,
        deferredContacts: 0,
        retryCount: 1,
        rateLimited: false,
        message: "Complete"
      }
    ]);
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  it("rejects requests without the dedicated scheduler secret", async () => {
    const response = await GET(new Request("https://newl.test/api/lead-gen/apollo/status-sync"));
    expect(response.status).toBe(401);
    expect(runScheduledApolloStatusSync).not.toHaveBeenCalled();
  });

  it("does not fall back to the shared cron secret", async () => {
    vi.stubEnv("APOLLO_STATUS_SYNC_SECRET", "");
    vi.stubEnv("CRON_SECRET", "shared-cron-secret");

    const response = await GET(
      new Request("https://newl.test/api/lead-gen/apollo/status-sync", {
        headers: { authorization: "Bearer shared-cron-secret" }
      })
    );

    expect(response.status).toBe(503);
    expect(runScheduledApolloStatusSync).not.toHaveBeenCalled();
  });

  it("runs the tenant-scoped sync and returns aggregate counts", async () => {
    const response = await GET(
      new Request("https://newl.test/api/lead-gen/apollo/status-sync", {
        headers: { authorization: "Bearer apollo-sync-test-secret" }
      })
    );

    expect(response.status).toBe(200);
    expect(runScheduledApolloStatusSync).toHaveBeenCalledTimes(1);
    await expect(response.json()).resolves.toMatchObject({
      tenantCount: 1,
      totals: {
        selectedContacts: 3,
        syncedContacts: 3,
        changedContacts: 1,
        failedContacts: 0,
        retryCount: 1
      }
    });
  });
});
