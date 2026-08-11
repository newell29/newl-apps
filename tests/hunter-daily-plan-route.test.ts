import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runDueHunterDryPlans = vi.hoisted(() => vi.fn());

vi.mock("@/modules/lead-gen/hunter-planner", () => ({ runDueHunterDryPlans }));

import { GET } from "@/app/api/lead-gen/hunter/daily-plan/route";

describe("Hunter daily plan cron route", () => {
  beforeEach(() => {
    vi.stubEnv("CRON_SECRET", "hunter-cron-test-secret");
    runDueHunterDryPlans.mockResolvedValue([
      { tenantId: "tenant-a", state: "completed", runId: "run-1", selectedCount: 20 }
    ]);
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  it("fails closed when the existing cron secret is unavailable", async () => {
    vi.stubEnv("CRON_SECRET", "");
    const response = await GET(new Request("https://newl.test/api/lead-gen/hunter/daily-plan"));

    expect(response.status).toBe(503);
    expect(runDueHunterDryPlans).not.toHaveBeenCalled();
  });

  it("rejects an invalid bearer token", async () => {
    const response = await GET(
      new Request("https://newl.test/api/lead-gen/hunter/daily-plan", {
        headers: { authorization: "Bearer wrong-secret" }
      })
    );

    expect(response.status).toBe(401);
    expect(runDueHunterDryPlans).not.toHaveBeenCalled();
  });

  it("returns the tenant dry-run summary without external write fields", async () => {
    const response = await GET(
      new Request("https://newl.test/api/lead-gen/hunter/daily-plan", {
        headers: { authorization: "Bearer hunter-cron-test-secret" }
      })
    );

    expect(response.status).toBe(200);
    expect(runDueHunterDryPlans).toHaveBeenCalledTimes(1);
    await expect(response.json()).resolves.toMatchObject({
      tenantCount: 1,
      completedCount: 1,
      failedCount: 0,
      note: expect.stringContaining("No Apollo")
    });
  });

  it("returns a failing status when a tenant plan fails", async () => {
    runDueHunterDryPlans.mockResolvedValueOnce([
      { tenantId: "tenant-a", state: "failed", error: "Database unavailable" }
    ]);
    const response = await GET(
      new Request("https://newl.test/api/lead-gen/hunter/daily-plan", {
        headers: { authorization: "Bearer hunter-cron-test-secret" }
      })
    );

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({ failedCount: 1 });
  });
});
