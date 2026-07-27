import {
  JobStatus,
  WebsiteGrowthContentDraftStatus,
  WebsiteGrowthOpportunityStatus
} from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  tenantFindUnique: vi.fn(),
  jobFindFirst: vi.fn(),
  jobUpdate: vi.fn(),
  draftUpdateMany: vi.fn(),
  opportunityUpdateMany: vi.fn(),
  auditCreate: vi.fn()
}));

vi.mock("@/server/db", () => ({
  prisma: {
    tenant: {
      findUnique: (...args: unknown[]) => mocks.tenantFindUnique(...args)
    },
    automationJobRun: {
      findFirst: (...args: unknown[]) => mocks.jobFindFirst(...args)
    },
    $transaction: async (callback: (tx: unknown) => Promise<unknown>) =>
      callback({
        automationJobRun: {
          update: (...args: unknown[]) => mocks.jobUpdate(...args)
        },
        websiteGrowthContentDraft: {
          updateMany: (...args: unknown[]) => mocks.draftUpdateMany(...args)
        },
        websiteGrowthOpportunity: {
          updateMany: (...args: unknown[]) => mocks.opportunityUpdateMany(...args)
        },
        auditLog: {
          create: (...args: unknown[]) => mocks.auditCreate(...args)
        }
      })
  }
}));

import { updateWebsiteGrowthBuildRequestFromWorker } from "@/modules/website-growth/build-requests";

describe("Website Growth production completion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.tenantFindUnique.mockResolvedValue({ id: "tenant-1" });
    mocks.jobUpdate.mockResolvedValue({ id: "build-1" });
    mocks.draftUpdateMany.mockResolvedValue({ count: 1 });
    mocks.opportunityUpdateMany.mockResolvedValue({ count: 1 });
    mocks.auditCreate.mockResolvedValue({ id: "audit-1" });
  });

  it("moves a preview-ready brief and opportunity to published after production succeeds", async () => {
    mocks.jobFindFirst.mockResolvedValue(buildJob({
      status: JobStatus.SUCCESS,
      phase: "PREVIEW_READY"
    }));

    const updated = await updateWebsiteGrowthBuildRequestFromWorker({
      requestId: "build-request-1",
      tenantSlug: "newl-group",
      update: {
        status: "PUBLISHED",
        previewUrl: "https://www.newlgroup.com/services/fulfillment-services",
        commitSha: "a".repeat(40)
      }
    });

    expect(updated).toBe(true);
    expect(mocks.jobUpdate).toHaveBeenCalledWith({
      where: { id: "build-1" },
      data: expect.objectContaining({
        status: JobStatus.SUCCESS,
        output: expect.objectContaining({
          phase: "PUBLISHED",
          previewUrl: "https://www.newlgroup.com/services/fulfillment-services"
        }),
        errorMessage: null,
        finishedAt: expect.any(Date)
      })
    });
    expect(mocks.draftUpdateMany).toHaveBeenCalledWith({
      where: {
        id: "draft-1",
        tenantId: "tenant-1",
        status: {
          in: [
            WebsiteGrowthContentDraftStatus.APPROVED,
            WebsiteGrowthContentDraftStatus.BUILT,
            WebsiteGrowthContentDraftStatus.PUBLISHED
          ]
        }
      },
      data: {
        status: WebsiteGrowthContentDraftStatus.PUBLISHED,
        builtUrl: "https://www.newlgroup.com/services/fulfillment-services",
        publishedAt: expect.any(Date)
      }
    });
    expect(mocks.opportunityUpdateMany).toHaveBeenCalledWith({
      where: {
        id: "opportunity-1",
        tenantId: "tenant-1",
        status: {
          in: [
            WebsiteGrowthOpportunityStatus.APPROVED,
            WebsiteGrowthOpportunityStatus.IN_PROGRESS,
            WebsiteGrowthOpportunityStatus.PUBLISHED
          ]
        }
      },
      data: {
        status: WebsiteGrowthOpportunityStatus.PUBLISHED,
        publishedAt: expect.any(Date)
      }
    });
    expect(mocks.auditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: "tenant-1",
        action: "website-growth.build.published",
        entityId: "build-1"
      })
    });
  });

  it("can recover a failed callback record when the generated PR later deploys to production", async () => {
    mocks.jobFindFirst.mockResolvedValue(buildJob({
      status: JobStatus.ERROR,
      phase: "FAILED"
    }));

    await expect(updateWebsiteGrowthBuildRequestFromWorker({
      requestId: "build-request-1",
      tenantSlug: "newl-group",
      update: {
        status: "PUBLISHED",
        previewUrl: "https://www.newlgroup.com/services/fulfillment-services"
      }
    })).resolves.toBe(true);

    expect(mocks.jobUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: JobStatus.SUCCESS,
        errorMessage: null
      })
    }));
  });

  it("can recover when earlier PR and Preview callbacks never reached Newl Apps", async () => {
    mocks.jobFindFirst.mockResolvedValue(buildJob({
      status: JobStatus.RUNNING,
      phase: "RUNNING"
    }));

    await expect(updateWebsiteGrowthBuildRequestFromWorker({
      requestId: "build-request-1",
      tenantSlug: "newl-group",
      update: {
        status: "PUBLISHED",
        previewUrl: "https://www.newlgroup.com/services/fulfillment-services"
      }
    })).resolves.toBe(true);

    expect(mocks.jobUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: JobStatus.SUCCESS,
        errorMessage: null
      })
    }));
  });

  it("accepts a repeated production callback without changing scope", async () => {
    mocks.jobFindFirst.mockResolvedValue(buildJob({
      status: JobStatus.SUCCESS,
      phase: "PUBLISHED"
    }));

    await expect(updateWebsiteGrowthBuildRequestFromWorker({
      requestId: "build-request-1",
      tenantSlug: "newl-group",
      update: {
        status: "PUBLISHED",
        previewUrl: "https://www.newlgroup.com/services/fulfillment-services"
      }
    })).resolves.toBe(true);

    expect(mocks.draftUpdateMany).toHaveBeenCalledTimes(1);
    expect(mocks.opportunityUpdateMany).toHaveBeenCalledTimes(1);
  });

  it("refuses to publish without a valid HTTPS production URL", async () => {
    mocks.jobFindFirst.mockResolvedValue(buildJob({
      status: JobStatus.SUCCESS,
      phase: "PREVIEW_READY"
    }));

    await expect(updateWebsiteGrowthBuildRequestFromWorker({
      requestId: "build-request-1",
      tenantSlug: "newl-group",
      update: {
        status: "PUBLISHED",
        previewUrl: "http://www.newlgroup.com/services/fulfillment-services"
      }
    })).rejects.toThrow("valid HTTPS production URL");

    expect(mocks.jobUpdate).not.toHaveBeenCalled();
    expect(mocks.draftUpdateMany).not.toHaveBeenCalled();
    expect(mocks.opportunityUpdateMany).not.toHaveBeenCalled();
  });
});

function buildJob({
  status,
  phase
}: {
  status: JobStatus;
  phase: string;
}) {
  return {
    id: "build-1",
    tenantId: "tenant-1",
    status,
    output: {
      phase,
      pullRequestUrl: "https://github.com/newell29/newl_website/pull/10"
    },
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
      brief: {
        routePath: "/services/fulfillment-services"
      }
    }
  };
}
