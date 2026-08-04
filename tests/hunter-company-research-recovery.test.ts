import { beforeEach, describe, expect, it, vi } from "vitest";

const prisma = vi.hoisted(() => ({
  hunterAutomationPolicy: { findUnique: vi.fn() },
  automationJobRun: { findFirst: vi.fn(), create: vi.fn() },
  company: { findMany: vi.fn() },
  hunterOpportunitySignal: { findMany: vi.fn() },
  hunterOutreachSuppression: { findMany: vi.fn() }
}));

vi.mock("@/server/db", () => ({ prisma }));

import { prepareHunterCompanyResearchRun } from "@/modules/lead-gen/hunter-company-research";

describe("Hunter company research exact-cohort recovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prisma.hunterAutomationPolicy.findUnique.mockResolvedValue(null);
    prisma.automationJobRun.create.mockResolvedValue({ id: "recovery-run-2" });
    prisma.company.findMany.mockResolvedValue([
      {
        id: "company-1",
        name: "Example Company",
        normalizedName: "example-company",
        source: "TRADEMINING",
        priorityScore: 80,
        updatedAt: new Date("2026-08-04T11:00:00.000Z"),
        primaryIndustry: "Consumer goods",
        domain: "example.com",
        apolloOrganizationId: null,
        importRecords: [],
        hunterOpportunitySignals: []
      }
    ]);
  });

  it("reuses only the authenticated tenant's same-day failed cohort", async () => {
    prisma.automationJobRun.findFirst
      .mockResolvedValueOnce({
        id: "failed-run-1",
        startedAt: new Date("2026-08-04T12:00:00.000Z"),
        input: {
          recoveryAttempt: 1,
          candidateCompanyKeys: ["example-company"]
        }
      })
      .mockResolvedValueOnce(null);

    const result = await prepareHunterCompanyResearchRun({
      tenantId: "tenant-a",
      recoveryOfRunId: "failed-run-1",
      now: new Date("2026-08-04T13:00:00.000Z")
    });

    expect(prisma.automationJobRun.findFirst).toHaveBeenNthCalledWith(1, expect.objectContaining({
      where: expect.objectContaining({
        id: "failed-run-1",
        tenantId: "tenant-a",
        status: "ERROR"
      })
    }));
    expect(prisma.company.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        tenantId: "tenant-a",
        normalizedName: { in: ["example-company"] }
      })
    }));
    expect(prisma.automationJobRun.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: "tenant-a",
        input: expect.objectContaining({
          recoveryOfRunId: "failed-run-1",
          recoveryAttempt: 2,
          candidateCompanyKeys: ["example-company"]
        })
      })
    });
    expect(result).toMatchObject({
      state: "ready",
      runId: "recovery-run-2",
      recovery: { recoveryOfRunId: "failed-run-1", attempt: 2 }
    });
  });

  it("rejects a recovery reference unavailable to the authenticated tenant", async () => {
    prisma.automationJobRun.findFirst.mockResolvedValueOnce(null);

    await expect(prepareHunterCompanyResearchRun({
      tenantId: "tenant-a",
      recoveryOfRunId: "another-tenant-run",
      now: new Date("2026-08-04T13:00:00.000Z")
    })).rejects.toThrow("recovery run is unavailable");
    expect(prisma.company.findMany).not.toHaveBeenCalled();
  });
});
