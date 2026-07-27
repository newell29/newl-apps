import {
  WebsiteGrowthBacklinkCategory,
  WebsiteGrowthBacklinkStatus
} from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const backlinkGroupBy = vi.fn();
const backlinkFindMany = vi.fn();
const jobFindFirst = vi.fn();
const jobCreate = vi.fn();
const jobUpdateMany = vi.fn();

vi.mock("@/server/db", () => ({
  prisma: {
    websiteGrowthBacklinkOpportunity: {
      groupBy: (...args: unknown[]) => backlinkGroupBy(...args),
      findMany: (...args: unknown[]) => backlinkFindMany(...args)
    },
    automationJobRun: {
      findFirst: (...args: unknown[]) => jobFindFirst(...args),
      create: (...args: unknown[]) => jobCreate(...args),
      updateMany: (...args: unknown[]) => jobUpdateMany(...args)
    }
  }
}));

import {
  buildWebsiteGrowthOutreachTeamsSummary
} from "@/modules/website-growth/backlink-outreach";

describe("Website Growth backlink execution summary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    backlinkGroupBy.mockResolvedValue([
      {
        status: WebsiteGrowthBacklinkStatus.APPROVED,
        _count: { _all: 6 }
      },
      {
        status: WebsiteGrowthBacklinkStatus.BLOCKED,
        _count: { _all: 5 }
      }
    ]);
    backlinkFindMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: "blocked-1",
          title: "Directory profile",
          category: WebsiteGrowthBacklinkCategory.DIRECTORY_CITATION,
          notes: "The form requires CAPTCHA and phone verification.",
          submittedAt: null,
          contactedAt: null,
          directoryLoginUrl: null
        }
      ]);
    jobFindFirst.mockResolvedValue(null);
    jobCreate.mockResolvedValue({ id: "run-1" });
  });

  it("separates current-run blocks from the unresolved lifetime total", async () => {
    const result = await buildWebsiteGrowthOutreachTeamsSummary({
      tenantId: "tenant-1",
      baseUrl: "https://apps.newlgroup.com",
      runStartedAt: new Date("2026-07-27T14:00:00.000Z"),
      now: new Date("2026-07-27T14:10:00.000Z")
    });

    expect(result.blockedThisRun).toBe(1);
    expect(result.blockedTotal).toBe(5);
    expect(result.message).toContain(
      "1 blocked this run; 5 blocked total"
    );
    expect(result.message).toContain("(Manual setup)");
    expect(result.message).toContain("Next:");
    expect(result.message).toContain("Retry:");
    expect(jobCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: "tenant-1",
        output: expect.objectContaining({
          summary: expect.objectContaining({
            blockedThisRun: 1,
            blockedTotal: 5
          })
        })
      })
    });
  });
});
