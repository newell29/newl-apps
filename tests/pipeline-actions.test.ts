import { CandidateStatus, LeadPipelineStage } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const leadFindFirst = vi.fn();
const leadUpdate = vi.fn();
const companyUpdate = vi.fn();
const contactUpdateMany = vi.fn();
const revalidatePath = vi.fn();
const getAuthenticatedContext = vi.fn();
const requireAdmin = vi.fn();

vi.mock("@/server/db", () => ({
  prisma: {
    lead: {
      findFirst: (...args: unknown[]) => leadFindFirst(...args),
      update: (...args: unknown[]) => leadUpdate(...args)
    },
    contact: {
      updateMany: (...args: unknown[]) => contactUpdateMany(...args)
    },
    company: {
      update: (...args: unknown[]) => companyUpdate(...args)
    }
  }
}));

vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => revalidatePath(...args)
}));

vi.mock("@/server/tenant-context", () => ({
  getAuthenticatedContext: (...args: unknown[]) => getAuthenticatedContext(...args)
}));

vi.mock("@/server/auth/authorization", () => ({
  requireAdmin: (...args: unknown[]) => requireAdmin(...args)
}));

import {
  bulkAssignLeadOwnerAction,
  bulkQueueApolloEnrichmentAction,
  bulkUnassignLeadOwnerAction,
  bulkUpdateLeadStageAction
} from "@/modules/lead-gen/actions";

describe("pipeline bulk actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAuthenticatedContext.mockResolvedValue({
      tenantId: "tenant-1",
      tenantSlug: "newl-group",
      tenantName: "Newl Group"
    });
    leadFindFirst.mockImplementation(async ({ where }: { where: { id: string } }) => ({
      id: where.id,
      companyId: `company-for-${where.id}`,
      notes: where.id === "lead-1" ? "Existing note" : null
    }));
    leadUpdate.mockResolvedValue({});
    companyUpdate.mockResolvedValue({});
    contactUpdateMany.mockResolvedValue({ count: 1 });
  });

  it("bulk moves selected leads to a new stage", async () => {
    const formData = new FormData();
    formData.set("stage", LeadPipelineStage.QUALIFIED);
    formData.append("leadId", "lead-1");
    formData.append("leadId", "lead-2");

    await bulkUpdateLeadStageAction(formData);

    expect(leadUpdate).toHaveBeenCalledTimes(2);
    expect(leadUpdate).toHaveBeenNthCalledWith(1, {
      where: { id: "lead-1" },
      data: { stage: LeadPipelineStage.QUALIFIED }
    });
    expect(leadUpdate).toHaveBeenNthCalledWith(2, {
      where: { id: "lead-2" },
      data: { stage: LeadPipelineStage.QUALIFIED }
    });
    expect(companyUpdate).not.toHaveBeenCalled();
    expect(revalidatePath).toHaveBeenCalledWith("/lead-gen/pipeline");
  });

  it("bulk disqualify also updates candidate status on the related companies", async () => {
    const formData = new FormData();
    formData.set("stage", LeadPipelineStage.DISQUALIFIED);
    formData.append("leadId", "lead-1");
    formData.append("leadId", "lead-2");

    await bulkUpdateLeadStageAction(formData);

    expect(companyUpdate).toHaveBeenCalledTimes(2);
    expect(companyUpdate.mock.calls[0][0].data.candidateStatus).toBe(CandidateStatus.DISQUALIFIED);
    expect(companyUpdate.mock.calls[1][0].where).toEqual({ id: "company-for-lead-2" });
  });

  it("queues Apollo enrichment notes for selected leads", async () => {
    const formData = new FormData();
    formData.append("leadId", "lead-1");
    formData.append("leadId", "lead-2");

    await bulkQueueApolloEnrichmentAction(formData);

    expect(leadUpdate).toHaveBeenCalledTimes(2);
    expect(leadUpdate.mock.calls[0][0].data.notes).toContain("Existing note");
    expect(leadUpdate.mock.calls[0][0].data.notes).toContain("Apollo enrichment requested on");
    expect(leadUpdate.mock.calls[1][0].data.notes).toContain("Apollo enrichment requested on");
  });

  it("bulk assigns selected leads and contact ownership to a rep", async () => {
    const formData = new FormData();
    formData.set("ownerUserId", "Zalan Riaz");
    formData.append("leadId", "lead-1");
    formData.append("leadId", "lead-2");

    await bulkAssignLeadOwnerAction(formData);

    expect(leadUpdate).toHaveBeenNthCalledWith(1, {
      where: { id: "lead-1" },
      data: { ownerUserId: "Zalan Riaz" }
    });
    expect(contactUpdateMany).toHaveBeenNthCalledWith(1, {
      where: { tenantId: "tenant-1", companyId: "company-for-lead-1" },
      data: { assignedRep: "Zalan Riaz" }
    });
  });

  it("bulk unassigns selected leads and clears contact ownership", async () => {
    const formData = new FormData();
    formData.append("leadId", "lead-1");
    formData.append("leadId", "lead-2");

    await bulkUnassignLeadOwnerAction(formData);

    expect(leadUpdate).toHaveBeenNthCalledWith(1, {
      where: { id: "lead-1" },
      data: { ownerUserId: null }
    });
    expect(contactUpdateMany).toHaveBeenNthCalledWith(1, {
      where: { tenantId: "tenant-1", companyId: "company-for-lead-1" },
      data: { assignedRep: null }
    });
  });
});
