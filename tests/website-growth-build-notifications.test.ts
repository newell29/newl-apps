import { JobStatus } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  tenantFindUnique: vi.fn(),
  jobFindMany: vi.fn(),
  jobFindFirst: vi.fn(),
  jobUpdate: vi.fn(),
  auditCreate: vi.fn()
}));

vi.mock("@/server/db", () => ({
  prisma: {
    tenant: {
      findUnique: (...args: unknown[]) => mocks.tenantFindUnique(...args)
    },
    automationJobRun: {
      findMany: (...args: unknown[]) => mocks.jobFindMany(...args),
      findFirst: (...args: unknown[]) => mocks.jobFindFirst(...args),
      update: (...args: unknown[]) => mocks.jobUpdate(...args)
    },
    $transaction: async (callback: (tx: unknown) => Promise<unknown>) => callback({
      automationJobRun: {
        update: (...args: unknown[]) => mocks.jobUpdate(...args)
      },
      auditLog: {
        create: (...args: unknown[]) => mocks.auditCreate(...args)
      }
    })
  }
}));

import {
  acknowledgeWebsiteGrowthBuildNotification,
  claimWebsiteGrowthBuildNotification
} from "@/modules/website-growth/build-notifications";

describe("Website Growth build Teams notifications", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.tenantFindUnique.mockResolvedValue({ id: "tenant-1" });
    mocks.jobUpdate.mockResolvedValue({ id: "build-1" });
    mocks.auditCreate.mockResolvedValue({ id: "audit-1" });
  });

  it("claims a deterministic build-start message for a newly dispatched approved brief", async () => {
    mocks.jobFindMany.mockResolvedValue([buildJob({
      output: {
        phase: "DISPATCHED",
        notificationVersion: 1,
        teamsNotifications: {},
        dispatchedAt: "2026-08-03T13:15:00.000Z"
      }
    })]);

    const claim = await claimWebsiteGrowthBuildNotification({
      tenantSlug: "newl-group",
      reviewBaseUrl: "https://newl-apps.example.com",
      workerId: "test-worker",
      now: new Date("2026-08-03T13:16:00.000Z")
    });

    expect(claim).toEqual(expect.objectContaining({
      requestId: "build-1",
      event: "DISPATCHED",
      message: expect.stringContaining("Website Growth build started for /services/fulfillment-services")
    }));
    expect(claim?.message).toContain("/website-growth/drafts/draft-1");
    expect(mocks.jobUpdate).toHaveBeenCalledWith({
      where: { id: "build-1" },
      data: {
        output: expect.objectContaining({
          teamsNotifications: expect.objectContaining({
            DISPATCHED: expect.objectContaining({
              claimedBy: "test-worker",
              claimToken: expect.any(String)
            })
          })
        })
      }
    });
  });

  it("claims a preview-ready message with the Vercel preview and draft PR", async () => {
    mocks.jobFindMany.mockResolvedValue([buildJob({
      output: {
        phase: "PREVIEW_READY",
        notificationVersion: 1,
        teamsNotifications: {
          DISPATCHED: { sentAt: "2026-08-03T13:16:00.000Z" }
        },
        dispatchedAt: "2026-08-03T13:15:00.000Z",
        previewUrl: "https://newl-website-preview.vercel.app/services/fulfillment-services",
        pullRequestUrl: "https://github.com/newell29/newl_website/pull/12"
      }
    })]);

    const claim = await claimWebsiteGrowthBuildNotification({
      tenantSlug: "newl-group",
      reviewBaseUrl: "https://newl-apps.example.com",
      workerId: "test-worker",
      now: new Date("2026-08-03T13:30:00.000Z")
    });

    expect(claim?.event).toBe("PREVIEW_READY");
    expect(claim?.message).toContain("Preview: https://newl-website-preview.vercel.app/services/fulfillment-services");
    expect(claim?.message).toContain("Draft PR: https://github.com/newell29/newl_website/pull/12");
    expect(claim?.message).toContain("Nothing is live until you merge");
  });

  it("sends the current preview state instead of a stale start event", async () => {
    mocks.jobFindMany.mockResolvedValue([buildJob({
      output: {
        phase: "PREVIEW_READY",
        notificationVersion: 1,
        teamsNotifications: {},
        dispatchedAt: "2026-08-03T13:15:00.000Z",
        previewUrl: "https://newl-website-preview.vercel.app/services/fulfillment-services"
      }
    })]);

    const claim = await claimWebsiteGrowthBuildNotification({
      tenantSlug: "newl-group",
      reviewBaseUrl: "https://newl-apps.example.com",
      workerId: "test-worker",
      now: new Date("2026-08-03T13:30:00.000Z")
    });

    expect(claim?.event).toBe("PREVIEW_READY");
  });

  it("does not reclaim an active notification lease", async () => {
    mocks.jobFindMany.mockResolvedValue([buildJob({
      output: {
        phase: "DISPATCHED",
        notificationVersion: 1,
        dispatchedAt: "2026-08-03T13:15:00.000Z",
        teamsNotifications: {
          DISPATCHED: { claimedAt: "2026-08-03T13:20:00.000Z", claimToken: "active-claim" }
        }
      }
    })]);

    await expect(claimWebsiteGrowthBuildNotification({
      tenantSlug: "newl-group",
      reviewBaseUrl: "https://newl-apps.example.com",
      workerId: "test-worker",
      now: new Date("2026-08-03T13:25:00.000Z")
    })).resolves.toBeNull();
  });

  it("reports a failed build directly instead of sending a stale build-start message", async () => {
    mocks.jobFindMany.mockResolvedValue([buildJob({
      output: {
        phase: "FAILED",
        notificationVersion: 1,
        dispatchedAt: "2026-08-03T13:15:00.000Z",
        errorCode: "WEBSITE_BUILD_FAILED",
        teamsNotifications: {}
      }
    })]);

    const claim = await claimWebsiteGrowthBuildNotification({
      tenantSlug: "newl-group",
      reviewBaseUrl: "https://newl-apps.example.com",
      workerId: "test-worker",
      now: new Date("2026-08-03T13:25:00.000Z")
    });

    expect(claim?.event).toBe("FAILED");
    expect(claim?.message).toContain("Website Growth build failed");
    expect(claim?.message).not.toContain("Synthetic build failure");
  });

  it("acknowledges the exact claim and audits the Teams delivery", async () => {
    mocks.jobFindFirst.mockResolvedValue(buildJob({
      output: {
        phase: "DISPATCHED",
        notificationVersion: 1,
        teamsNotifications: {
          DISPATCHED: {
            claimedAt: "2026-08-03T13:16:00.000Z",
            claimToken: "claim-token-1"
          }
        },
        dispatchedAt: "2026-08-03T13:15:00.000Z"
      }
    }));

    await expect(acknowledgeWebsiteGrowthBuildNotification({
      tenantSlug: "newl-group",
      requestId: "build-1",
      event: "DISPATCHED",
      claimToken: "claim-token-1",
      now: new Date("2026-08-03T13:17:00.000Z")
    })).resolves.toBe(true);

    expect(mocks.jobUpdate).toHaveBeenCalledWith({
      where: { id: "build-1" },
      data: {
        output: expect.objectContaining({
          teamsNotifications: expect.objectContaining({
            DISPATCHED: expect.objectContaining({
              sentAt: "2026-08-03T13:17:00.000Z"
            })
          })
        })
      }
    });
    expect(mocks.auditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: "tenant-1",
        action: "website-growth.build.teams-notified",
        entityId: "build-1",
        after: {
          event: "DISPATCHED",
          sentAt: "2026-08-03T13:17:00.000Z"
        }
      })
    });
  });
});

function buildJob({ output }: { output: Record<string, unknown> }) {
  return {
    id: "build-1",
    tenantId: "tenant-1",
    jobType: "WEBSITE_GROWTH_DEVELOPER_BUILD",
    status: output.phase === "FAILED" ? JobStatus.ERROR : JobStatus.RUNNING,
    startedAt: new Date("2026-08-03T13:15:00.000Z"),
    finishedAt: null,
    errorMessage: output.phase === "FAILED" ? "Synthetic build failure." : null,
    output,
    input: {
      version: 1,
      briefVersion: 1,
      contentDraftId: "draft-1",
      opportunityId: "opportunity-1",
      approvedByUserId: "owner-1",
      targetRepository: "newell29/newl_website",
      targetBaseBranch: "main",
      model: "gpt-5.6-sol",
      reasoningEffort: "high",
      brief: { routePath: "/services/fulfillment-services" }
    }
  };
}
