import {
  WebsiteGrowthBacklinkStatus
} from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const backlinkFindFirst = vi.fn();
const backlinkUpdateMany = vi.fn();
const auditCreate = vi.fn();
const revalidatePath = vi.fn();
const redirect = vi.fn();
const getAuthenticatedContext = vi.fn();
const requireModule = vi.fn();
const requireMutationAccess = vi.fn();
const requireRole = vi.fn();

vi.mock("@/server/db", () => ({
  prisma: {
    websiteGrowthBacklinkOpportunity: {
      findFirst: (...args: unknown[]) => backlinkFindFirst(...args),
      updateMany: (...args: unknown[]) => backlinkUpdateMany(...args)
    },
    auditLog: {
      create: (...args: unknown[]) => auditCreate(...args)
    }
  }
}));

vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => revalidatePath(...args)
}));

vi.mock("next/navigation", () => ({
  redirect: (...args: unknown[]) => redirect(...args)
}));

vi.mock("@/server/tenant-context", () => ({
  getAuthenticatedContext: (...args: unknown[]) => getAuthenticatedContext(...args)
}));

vi.mock("@/server/auth/authorization", () => ({
  requireModule: (...args: unknown[]) => requireModule(...args),
  requireMutationAccess: (...args: unknown[]) => requireMutationAccess(...args),
  requireRole: (...args: unknown[]) => requireRole(...args)
}));

import {
  returnWebsiteGrowthBacklinkToReviewAction,
  reviewWebsiteGrowthBacklinkAction
} from "@/modules/website-growth/backlink-actions";

describe("Website Growth backlink review actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAuthenticatedContext.mockResolvedValue({
      tenantId: "tenant-1",
      tenantSlug: "newl-group",
      tenantName: "Newl Group",
      userId: "user-1",
      role: "ADMIN"
    });
    backlinkUpdateMany.mockResolvedValue({ count: 1 });
    auditCreate.mockResolvedValue({ id: "audit-1" });
  });

  it("approves the exact opportunity ID and confirms its database title", async () => {
    backlinkFindFirst.mockResolvedValue({
      id: "supply-chain-dive-id",
      title: "Supply Chain Dive editorial source opportunity"
    });
    const formData = new FormData();
    formData.set("backlinkId", "supply-chain-dive-id");
    formData.set("decision", WebsiteGrowthBacklinkStatus.APPROVED);

    await reviewWebsiteGrowthBacklinkAction(formData);

    expect(backlinkFindFirst).toHaveBeenCalledWith({
      where: {
        id: "supply-chain-dive-id",
        tenantId: "tenant-1",
        status: WebsiteGrowthBacklinkStatus.NEEDS_REVIEW
      },
      select: { id: true, title: true }
    });
    expect(backlinkUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: "supply-chain-dive-id" }),
      data: expect.objectContaining({
        status: WebsiteGrowthBacklinkStatus.APPROVED,
        approvedByUserId: "user-1"
      })
    }));
    expect(revalidatePath).toHaveBeenCalledWith("/website-growth/backlinks");
    expect(redirect).toHaveBeenCalledWith(expect.stringContaining(
      "opportunity=Supply+Chain+Dive+editorial+source+opportunity"
    ));
  });

  it("returns only an unclaimed approved opportunity to review", async () => {
    backlinkFindFirst.mockResolvedValue({
      id: "inbound-logistics-id",
      title: "Inbound Logistics editorial coverage"
    });
    const formData = new FormData();
    formData.set("backlinkId", "inbound-logistics-id");

    await returnWebsiteGrowthBacklinkToReviewAction(formData);

    expect(backlinkFindFirst).toHaveBeenCalledWith({
      where: {
        id: "inbound-logistics-id",
        tenantId: "tenant-1",
        status: WebsiteGrowthBacklinkStatus.APPROVED
      },
      select: { id: true, title: true }
    });
    expect(backlinkUpdateMany).toHaveBeenCalledWith({
      where: {
        id: "inbound-logistics-id",
        tenantId: "tenant-1",
        status: WebsiteGrowthBacklinkStatus.APPROVED
      },
      data: {
        status: WebsiteGrowthBacklinkStatus.NEEDS_REVIEW,
        approvedByUserId: null,
        approvedAt: null
      }
    });
    expect(auditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "website-growth.backlink.approval-reversed",
        entityId: "inbound-logistics-id"
      })
    });
    expect(redirect).toHaveBeenCalledWith(expect.stringContaining("reviewResult=returned"));
  });

  it("refuses to reverse work after Scout has claimed it", async () => {
    backlinkFindFirst.mockResolvedValue(null);
    const formData = new FormData();
    formData.set("backlinkId", "already-in-progress-id");

    await expect(
      returnWebsiteGrowthBacklinkToReviewAction(formData)
    ).rejects.toThrow("has not started");

    expect(backlinkUpdateMany).not.toHaveBeenCalled();
    expect(auditCreate).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
  });
});
