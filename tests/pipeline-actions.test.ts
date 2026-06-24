import { CandidateStatus, ContactStatus, LeadPipelineStage, ReplyStatus, SequenceStatus } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const leadFindFirst = vi.fn();
const leadUpdate = vi.fn();
const companyUpdate = vi.fn();
const contactFindMany = vi.fn();
const contactCreate = vi.fn();
const contactUpdate = vi.fn();
const contactUpdateMany = vi.fn();
const integrationCredentialFindFirst = vi.fn();
const revalidatePath = vi.fn();
const getAuthenticatedContext = vi.fn();
const requireAdmin = vi.fn();
const fetchApolloContactsForCompany = vi.fn();

vi.mock("@/server/db", () => ({
  prisma: {
    lead: {
      findFirst: (...args: unknown[]) => leadFindFirst(...args),
      update: (...args: unknown[]) => leadUpdate(...args)
    },
    contact: {
      findMany: (...args: unknown[]) => contactFindMany(...args),
      create: (...args: unknown[]) => contactCreate(...args),
      update: (...args: unknown[]) => contactUpdate(...args),
      updateMany: (...args: unknown[]) => contactUpdateMany(...args)
    },
    company: {
      update: (...args: unknown[]) => companyUpdate(...args)
    },
    integrationCredential: {
      findFirst: (...args: unknown[]) => integrationCredentialFindFirst(...args)
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

vi.mock("@/server/integrations/apollo", () => ({
  fetchApolloContactsForCompany: (...args: unknown[]) => fetchApolloContactsForCompany(...args)
}));

import {
  bulkAssignLeadOwnerAction,
  bulkQueueApolloEnrichmentAction,
  bulkUnassignLeadOwnerAction,
  bulkUpdateContactSequenceAction,
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
      contactId: null,
      ownerUserId: "Zalan Riaz",
      notes: where.id === "lead-1" ? "Existing note" : null,
      company: {
        id: `company-for-${where.id}`,
        name: where.id === "lead-1" ? "Harbor Home Retail LLC" : "Carolina Outdoor Supply",
        domain: where.id === "lead-1" ? "harbor-home.com" : "carolina-outdoor.com",
        apolloOrganizationId: null
      }
    }));
    leadUpdate.mockResolvedValue({});
    companyUpdate.mockResolvedValue({});
    contactFindMany.mockResolvedValue([]);
    contactCreate.mockImplementation(async ({ data }: { data: { fullName: string } }) => ({
      id: `contact-${data.fullName.toLowerCase().replace(/\s+/g, "-")}`
    }));
    contactUpdate.mockResolvedValue({});
    contactUpdateMany.mockResolvedValue({ count: 1 });
    integrationCredentialFindFirst.mockResolvedValue({
      publicConfig: {
        apolloSequenceDirectory: [
          {
            id: "houston-import-decision-maker",
            name: "Houston Import Decision Maker",
            status: "ACTIVE"
          }
        ]
      }
    });
    fetchApolloContactsForCompany.mockResolvedValue({
      organizationId: "apollo-org-1",
      companyName: "Harbor Home Retail LLC",
      domain: "harbor-home.com",
      contacts: [
        {
          apolloContactId: "apollo-contact-1",
          apolloPersonId: "apollo-person-1",
          firstName: "Jordan",
          lastName: "Demo",
          fullName: "Jordan Demo",
          title: "Director of Supply Chain",
          department: "Logistics",
          seniority: "director",
          email: "jordan@harbor-home.com",
          phone: null,
          linkedinUrl: "https://linkedin.test/jordan-demo",
          city: "Houston",
          state: "TX",
          country: "United States",
          sequenceStatus: SequenceStatus.ENROLLED,
          replyStatus: ReplyStatus.NO_REPLY,
          sequenceId: "sequence-1",
          sequenceName: "Houston Import Decision Maker",
          sequenceOwnerName: "Zalan Riaz",
          sequenceOwnerUserId: "apollo-user-1",
          lastTouchAt: null,
          lastReplyAt: null,
          rawPayload: { id: "apollo-contact-1" }
        }
      ]
    });
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
    expect(companyUpdate.mock.calls[0][0].data.doNotProspect).toBe(true);
    expect(companyUpdate.mock.calls[1][0].where).toEqual({ id: "company-for-lead-2" });
  });

  it("imports Apollo contacts, preserves rep assignment, and notes completion", async () => {
    const formData = new FormData();
    formData.append("leadId", "lead-1");
    formData.append("leadId", "lead-2");

    await bulkQueueApolloEnrichmentAction(formData);

    expect(fetchApolloContactsForCompany).toHaveBeenCalledTimes(2);
    expect(contactCreate).toHaveBeenCalledTimes(2);
    expect(companyUpdate).toHaveBeenCalledTimes(2);
    expect(leadUpdate).toHaveBeenCalledTimes(6);
    expect(contactCreate.mock.calls[0][0].data.contactStatus).toBe(ContactStatus.REVIEWING);
    expect(contactCreate.mock.calls[0][0].data.assignedRep).toBe("Zalan Riaz");
    expect(leadUpdate.mock.calls[0][0].data.notes).toContain("Apollo enrichment requested on");
    expect(leadUpdate.mock.calls[1][0].data.contactId).toBe("contact-jordan-demo");
    expect(leadUpdate.mock.calls[2][0].data.notes).toContain("Imported 1 contacts");
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

  it("requires confirmation before overriding contacts with existing Apollo sequence history", async () => {
    contactFindMany.mockResolvedValueOnce([
      {
        id: "contact-1",
        sequenceStatus: SequenceStatus.ENROLLED
      }
    ]);

    const formData = new FormData();
    formData.append("contactId", "contact-1");
    formData.set("sequenceId", "houston-import-decision-maker");

    await expect(bulkUpdateContactSequenceAction(formData)).rejects.toThrow(
      "One or more selected contacts already show Apollo sequence history. Confirm the override before assigning a new cadence."
    );
  });

  it("preserves sequence status when a confirmed override is applied", async () => {
    contactFindMany.mockResolvedValueOnce([
      {
        id: "contact-1",
        sequenceStatus: SequenceStatus.ENROLLED
      }
    ]);

    const formData = new FormData();
    formData.append("contactId", "contact-1");
    formData.set("sequenceId", "houston-import-decision-maker");
    formData.set("confirmExistingSequenceOverride", "true");

    await bulkUpdateContactSequenceAction(formData);

    expect(contactUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          selectedSequenceName: expect.any(String),
          sequenceManuallyOverridden: true
        })
      })
    );
    expect(contactUpdateMany).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          sequenceStatus: SequenceStatus.READY
        })
      })
    );
  });
});
