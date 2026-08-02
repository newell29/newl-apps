import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    automationJobRun: { findMany: vi.fn() },
    assistantAutomationRun: { findMany: vi.fn() },
    assistantAutomation: { findMany: vi.fn() },
    garlandEmailSyncRun: { findMany: vi.fn() },
    teamshipDailySyncRun: { findMany: vi.fn() },
    teamshipBrowserReadJob: { findMany: vi.fn() }
  }
}));

vi.mock("@/server/db", () => ({ prisma: prismaMock }));

import {
  AGENT_RUN_PAGE_SIZE,
  normalizeRunHistoryFilters,
  sanitizeOperationalText
} from "@/modules/agent-operations/presentation";
import { getAgentOperationsDashboard, getAgentRunHistory } from "@/modules/agent-operations/queries";

const tenant = {
  tenantId: "tenant-1",
  tenantSlug: "tenant-one",
  tenantName: "Tenant One"
};

describe("agent operations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.automationJobRun.findMany.mockResolvedValue([]);
    prismaMock.assistantAutomationRun.findMany.mockResolvedValue([]);
    prismaMock.assistantAutomation.findMany.mockResolvedValue([]);
    prismaMock.garlandEmailSyncRun.findMany.mockResolvedValue([]);
    prismaMock.teamshipDailySyncRun.findMany.mockResolvedValue([]);
    prismaMock.teamshipBrowserReadJob.findMany.mockResolvedValue([]);
  });

  it("shows only the 15 most recent matching runs until the result set is expanded", async () => {
    prismaMock.automationJobRun.findMany.mockResolvedValue(
      Array.from({ length: 20 }, (_, index) => ({
        id: `hunter-${index}`,
        jobType: "HUNTER_COMPANY_DEEP_RESEARCH",
        status: "SUCCESS",
        startedAt: new Date(Date.UTC(2026, 7, 2, 18, 0, 0) - index * 60_000),
        finishedAt: new Date(Date.UTC(2026, 7, 2, 18, 0, 20) - index * 60_000),
        input: { trigger: "SCHEDULED" },
        output: { processedCount: 5 },
        errorMessage: null
      }))
    );

    const initial = await getAgentRunHistory(
      tenant,
      normalizeRunHistoryFilters({ range: "7" }),
      new Date("2026-08-02T18:30:00.000Z")
    );
    const expanded = await getAgentRunHistory(
      tenant,
      normalizeRunHistoryFilters({ range: "7", limit: "30" }),
      new Date("2026-08-02T18:30:00.000Z")
    );

    expect(AGENT_RUN_PAGE_SIZE).toBe(15);
    expect(initial.runs).toHaveLength(15);
    expect(initial.totalMatching).toBe(20);
    expect(initial.hasMore).toBe(true);
    expect(expanded.runs).toHaveLength(20);
    expect(expanded.hasMore).toBe(false);
  });

  it("applies search before expansion and surfaces a redacted failure reason", async () => {
    prismaMock.automationJobRun.findMany.mockResolvedValue([
      {
        id: "hunter-failure",
        jobType: "HUNTER_COMPANY_DEEP_RESEARCH",
        status: "ERROR",
        startedAt: new Date("2026-08-02T17:30:00.000Z"),
        finishedAt: new Date("2026-08-02T17:34:00.000Z"),
        input: { trigger: "SCHEDULED" },
        output: { processedCount: 3 },
        errorMessage: "Search provider rate limit reached; token=private-value"
      },
      {
        id: "website-success",
        jobType: "WEBSITE_GROWTH_SCOUT_WEEKLY",
        status: "SUCCESS",
        startedAt: new Date("2026-08-02T16:00:00.000Z"),
        finishedAt: new Date("2026-08-02T16:05:00.000Z"),
        input: {},
        output: {},
        errorMessage: null
      }
    ]);

    const history = await getAgentRunHistory(
      tenant,
      normalizeRunHistoryFilters({ q: "rate limit" }),
      new Date("2026-08-02T18:30:00.000Z")
    );

    expect(history.totalMatching).toBe(1);
    expect(history.runs[0]).toMatchObject({ status: "FAILED", agentName: "Hunter" });
    expect(history.runs[0].reason).toContain("rate limit");
    expect(history.runs[0].reason).not.toContain("private-value");
  });

  it("creates a missed run when a database-backed Nemo schedule passes without a recorded start", async () => {
    prismaMock.assistantAutomation.findMany.mockResolvedValue([
      {
        id: "automation-1",
        name: "Daily feedback digest",
        scheduleType: "DAILY",
        scheduleTime: "10:00",
        scheduleTimezone: "America/Toronto",
        lastRunAt: new Date("2026-08-01T14:00:00.000Z"),
        nextRunAt: new Date("2026-08-02T14:00:00.000Z"),
        lastResultSummary: "Completed"
      }
    ]);

    const history = await getAgentRunHistory(
      tenant,
      normalizeRunHistoryFilters({ status: "MISSED" }),
      new Date("2026-08-02T14:10:00.000Z")
    );

    expect(history.runs).toHaveLength(1);
    expect(history.runs[0]).toMatchObject({
      status: "MISSED",
      agentName: "Nemo",
      assignment: "Daily feedback digest"
    });
    expect(history.runs[0].reason).toContain("scheduled time passed");
  });

  it("carries tenantId through every shared run source", async () => {
    await getAgentRunHistory(
      tenant,
      normalizeRunHistoryFilters({}),
      new Date("2026-08-02T18:30:00.000Z")
    );

    for (const findMany of [
      prismaMock.automationJobRun.findMany,
      prismaMock.assistantAutomationRun.findMany,
      prismaMock.assistantAutomation.findMany,
      prismaMock.garlandEmailSyncRun.findMany,
      prismaMock.teamshipDailySyncRun.findMany,
      prismaMock.teamshipBrowserReadJob.findMany
    ]) {
      expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ tenantId: "tenant-1" }) }));
    }
  });

  it("shows the current Website Scout research, outreach, and notification schedules", async () => {
    const dashboard = await getAgentOperationsDashboard(
      tenant,
      new Date("2026-08-02T18:30:00.000Z")
    );

    expect(
      dashboard.schedules
        .filter((schedule) => schedule.agentKey === "website-scout")
        .map((schedule) => ({ assignment: schedule.assignment, cadence: schedule.cadence }))
    ).toEqual([
      {
        assignment: "Check website-build notifications",
        cadence: "Every 2 minutes"
      },
      {
        assignment: "Refresh website growth evidence",
        cadence: "Mon/Wed deep research · Tue/Thu/Fri evidence check-in at 09:15"
      },
      {
        assignment: "Process approved backlink outreach",
        cadence: "Weekdays at 11:00"
      }
    ]);
  });

  it("redacts common secret and identity patterns from operational text", () => {
    expect(
      sanitizeOperationalText(
        "Bearer abc.def token=secret user@example.com https://example.com/path?q=private",
        "fallback"
      )
    ).toBe("[redacted] [redacted] [redacted] [redacted]");
  });
});
