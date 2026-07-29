import {
  ApolloCompanyMatchClassification,
  CandidateStatus,
  ContactStatus,
  LeadPipelineStage,
  OutreachPlanStatus,
  OutreachQaStatus,
  ReplyStatus,
  SequenceStatus
} from "@prisma/client";
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
const requireModule = vi.fn();
const requireMutationAccess = vi.fn();
const fetchApolloContactsForCompany = vi.fn();
const apolloCompanyMatchCreate = vi.fn();
const outreachPlanUpdateMany = vi.fn();
const contactOutreachDraftUpdateMany = vi.fn();
const automationJobRunCreate = vi.fn();
const auditLogCreate = vi.fn();
const evaluateHunterOutreachEligibility = vi.fn();
const recordLeadOutcomeEvent = vi.fn();
const recordLeadScoreSnapshot = vi.fn();

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
    },
    apolloCompanyMatch: {
      create: (...args: unknown[]) => apolloCompanyMatchCreate(...args)
    },
    outreachPlan: {
      updateMany: (...args: unknown[]) => outreachPlanUpdateMany(...args)
    },
    contactOutreachDraft: {
      updateMany: (...args: unknown[]) => contactOutreachDraftUpdateMany(...args)
    },
    automationJobRun: {
      create: (...args: unknown[]) => automationJobRunCreate(...args)
    },
    auditLog: {
      create: (...args: unknown[]) => auditLogCreate(...args)
    },
    $transaction: async (callback: (tx: unknown) => Promise<unknown>) =>
      callback({
        outreachPlan: {
          updateMany: (...args: unknown[]) => outreachPlanUpdateMany(...args)
        },
        contactOutreachDraft: {
          updateMany: (...args: unknown[]) => contactOutreachDraftUpdateMany(...args)
        },
        contact: {
          updateMany: (...args: unknown[]) => contactUpdateMany(...args)
        },
        automationJobRun: {
          create: (...args: unknown[]) => automationJobRunCreate(...args)
        },
        auditLog: {
          create: (...args: unknown[]) => auditLogCreate(...args)
        }
      })
  }
}));

vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => revalidatePath(...args)
}));

vi.mock("@/server/tenant-context", () => ({
  getAuthenticatedContext: (...args: unknown[]) => getAuthenticatedContext(...args)
}));

vi.mock("@/server/auth/authorization", () => ({
  requireAdmin: (...args: unknown[]) => requireAdmin(...args),
  requireModule: (...args: unknown[]) => requireModule(...args),
  requireMutationAccess: (...args: unknown[]) => requireMutationAccess(...args)
}));

vi.mock("@/server/integrations/apollo", () => ({
  fetchApolloContactsForCompany: (...args: unknown[]) => fetchApolloContactsForCompany(...args)
}));

vi.mock("@/modules/lead-gen/score-history", () => ({
  COMPANY_SCORING_MODEL_VERSION: "company-v2.0",
  CONTACT_SCORING_MODEL_VERSION: "contact-v1.0",
  recordLeadOutcomeEvent: (...args: unknown[]) => recordLeadOutcomeEvent(...args),
  recordLeadScoreSnapshot: (...args: unknown[]) => recordLeadScoreSnapshot(...args)
}));

vi.mock("@/modules/lead-gen/hunter-outreach-eligibility", () => ({
  evaluateHunterOutreachEligibility: (...args: unknown[]) =>
    evaluateHunterOutreachEligibility(...args),
  getHunterOutreachResearchMaxAgeDays: () => 30
}));

import {
  bulkAssignLeadOwnerAction,
  bulkApproveOutreachPlansAction,
  bulkPushContactsToApolloAction,
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
      tenantName: "Newl Group",
      userId: "user-alex"
    });
    leadFindFirst.mockImplementation(async ({ where }: { where: { id: string } }) => ({
      id: where.id,
      companyId: `company-for-${where.id}`,
      contactId: null,
      stage: LeadPipelineStage.NEW,
      ownerUserId: "Zalan Riaz",
      notes: where.id === "lead-1" ? "Existing note" : null,
      company: {
        id: `company-for-${where.id}`,
        name: where.id === "lead-1" ? "Harbor Home Retail LLC" : "Carolina Outdoor Supply",
        domain: where.id === "lead-1" ? "harbor-home.com" : "carolina-outdoor.com",
        apolloOrganizationId: null,
        apolloCompanyMatches: []
      }
    }));
    leadUpdate.mockResolvedValue({});
    companyUpdate.mockResolvedValue({});
    contactFindMany.mockResolvedValue([]);
    contactCreate.mockImplementation(async ({ data }: { data: { fullName: string } }) => ({
      id: `contact-${data.fullName.toLowerCase().replace(/\s+/g, "-")}`
    }));
    outreachPlanUpdateMany.mockResolvedValue({ count: 1 });
    contactOutreachDraftUpdateMany.mockResolvedValue({ count: 1 });
    contactUpdateMany.mockResolvedValue({ count: 1 });
    automationJobRunCreate.mockResolvedValue({ id: "apollo-job-1" });
    auditLogCreate.mockResolvedValue({ id: "audit-1" });
    evaluateHunterOutreachEligibility.mockReturnValue({
      status: "ELIGIBLE",
      label: "Hunter hot opportunity",
      reason: "Hunter research passed.",
      directive: {}
    });
    contactUpdate.mockResolvedValue({});
    contactUpdateMany.mockResolvedValue({ count: 1 });
    apolloCompanyMatchCreate.mockResolvedValue({});
    recordLeadOutcomeEvent.mockResolvedValue({});
    recordLeadScoreSnapshot.mockResolvedValue({});
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
      linkedinUrl: null,
      match: {
        organizationId: "apollo-org-1",
        companyName: "Harbor Home Retail LLC",
        domain: "harbor-home.com",
        linkedinUrl: null,
        score: 100,
        classification: "DIRECT_COMPANY",
        nameMatchType: "exact",
        domainMatch: true,
        logisticsProviderMatch: false,
        branchLocationMatch: false,
        matchReason: "Exact company and domain match.",
        query: {},
        rawPayload: {}
      },
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
    expect(recordLeadOutcomeEvent).toHaveBeenCalledTimes(2);
    expect(recordLeadOutcomeEvent).toHaveBeenNthCalledWith(1, expect.objectContaining({
      tenantId: "tenant-1",
      companyId: "company-for-lead-1",
      leadId: "lead-1",
      outcomeType: "PIPELINE_STAGE_CHANGED",
      currentValue: LeadPipelineStage.QUALIFIED
    }));
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

  it("does not record a pipeline outcome when the requested stage is unchanged", async () => {
    const formData = new FormData();
    formData.set("stage", LeadPipelineStage.NEW);
    formData.append("leadId", "lead-1");

    await bulkUpdateLeadStageAction(formData);

    expect(recordLeadOutcomeEvent).not.toHaveBeenCalled();
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

  it("protects a company with an unresolved Apollo match from repeat bulk searches", async () => {
    leadFindFirst.mockResolvedValueOnce({
      id: "lead-1",
      companyId: "company-for-lead-1",
      contactId: null,
      ownerUserId: "Zalan Riaz",
      notes: "Apollo review needed",
      company: {
        id: "company-for-lead-1",
        name: "NOVALIS US, LLC",
        domain: null,
        apolloOrganizationId: "saved-apollo-organization",
        apolloCompanyMatches: [
          {
            classification: ApolloCompanyMatchClassification.MATCH_QUALITY_REVIEW
          }
        ]
      }
    });
    const formData = new FormData();
    formData.append("leadId", "lead-1");

    const summary = await bulkQueueApolloEnrichmentAction(formData);

    expect(summary).toMatchObject({
      status: "success",
      requestedCompanies: 1,
      processedCompanies: 0,
      skippedReviewCompanies: 1
    });
    expect(fetchApolloContactsForCompany).not.toHaveBeenCalled();
    expect(contactFindMany).not.toHaveBeenCalled();
    expect(leadUpdate).not.toHaveBeenCalled();
  });

  it("keeps a verified Apollo company mapped when it has zero employees", async () => {
    fetchApolloContactsForCompany.mockResolvedValueOnce({
      organizationId: "apollo-org-empty",
      companyName: "Harbor Home Retail LLC",
      domain: "harbor-home.com",
      linkedinUrl: null,
      match: {
        organizationId: "apollo-org-empty",
        companyName: "Harbor Home Retail LLC",
        domain: "harbor-home.com",
        linkedinUrl: null,
        score: 100,
        classification: ApolloCompanyMatchClassification.DIRECT_COMPANY,
        nameMatchType: "exact",
        domainMatch: true,
        logisticsProviderMatch: false,
        branchLocationMatch: false,
        matchReason: "Exact company and domain match.",
        query: {},
        rawPayload: {}
      },
      contacts: []
    });
    const formData = new FormData();
    formData.append("leadId", "lead-1");

    const summary = await bulkQueueApolloEnrichmentAction(formData);

    expect(summary).toMatchObject({
      status: "success",
      requestedCompanies: 1,
      processedCompanies: 1,
      reviewNeededCompanies: 0,
      companiesWithoutContacts: 1
    });
    expect(apolloCompanyMatchCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        classification: ApolloCompanyMatchClassification.DIRECT_COMPANY,
        matchReason: expect.stringContaining("returned zero employees")
      })
    });
    expect(contactCreate).not.toHaveBeenCalled();
    expect(leadUpdate.mock.calls.at(-1)?.[0]?.data?.notes).toContain(
      "completed with no contacts"
    );
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

    await expect(bulkUpdateContactSequenceAction(formData)).resolves.toMatchObject({
      status: "error",
      operation: "sequence",
      message:
        "One or more selected contacts already show Apollo sequence history. Confirm the override before assigning a new cadence."
    });
  });

  it("does not assign a cadence to a do-not-contact record", async () => {
    contactFindMany.mockResolvedValueOnce([
      {
        id: "contact-1",
        contactStatus: ContactStatus.DO_NOT_CONTACT,
        sequenceStatus: SequenceStatus.NOT_STARTED
      }
    ]);

    const formData = new FormData();
    formData.append("contactId", "contact-1");
    formData.set("sequenceId", "houston-import-decision-maker");

    await expect(bulkUpdateContactSequenceAction(formData)).resolves.toMatchObject({
      status: "error",
      operation: "sequence",
      message: "do not contact; blocked from scoring and outreach"
    });
    expect(contactUpdateMany).not.toHaveBeenCalled();
  });

  it("does not queue an unapproved contact for Apollo", async () => {
    contactFindMany.mockResolvedValueOnce([
      {
        id: "contact-1",
        companyId: "company-1",
        contactStatus: ContactStatus.REVIEWING,
        company: {
          candidateStatus: CandidateStatus.APPROVED_FOR_PIPELINE,
          doNotProspect: false
        }
      }
    ]);

    const formData = new FormData();
    formData.append("contactId", "contact-1");

    await expect(bulkPushContactsToApolloAction(formData)).resolves.toMatchObject({
      status: "error",
      operation: "apollo_push",
      message: "Contact must be approved before it can be pushed to an Apollo cadence."
    });
  });

  it("bulk-approves only QA-passed contacts with usable email and queues one enrollment job", async () => {
    contactFindMany.mockResolvedValueOnce([
      {
        id: "contact-approved",
        companyId: "company-1",
        fullName: "Morgan Buyer",
        email: "morgan@example.com",
        contactStatus: ContactStatus.REVIEWING,
        assignedRep: null,
        company: {
          name: "Example Importer",
          candidateStatus: CandidateStatus.APPROVED_FOR_PIPELINE,
          doNotProspect: false,
          hunterOpportunitySignals: [{}],
          hunterProspectingDecisions: [{}]
        },
        outreachPlans: [{
          id: "plan-approved",
          companyId: "company-1",
          contactId: "contact-approved",
          sequenceName: "Hunter - Email Only",
          version: 1,
          status: OutreachPlanStatus.QA_PASSED,
          qaStatus: OutreachQaStatus.PASSED,
          evidenceFingerprint: "evidence-1"
        }]
      },
      {
        id: "contact-no-email",
        companyId: "company-1",
        fullName: "Taylor Hidden",
        email: null,
        contactStatus: ContactStatus.REVIEWING,
        assignedRep: null,
        company: {
          name: "Example Importer",
          candidateStatus: CandidateStatus.APPROVED_FOR_PIPELINE,
          doNotProspect: false,
          hunterOpportunitySignals: [{}],
          hunterProspectingDecisions: [{}]
        },
        outreachPlans: [{
          id: "plan-no-email",
          companyId: "company-1",
          contactId: "contact-no-email",
          sequenceName: "Hunter - Email Only",
          version: 1,
          status: OutreachPlanStatus.QA_PASSED,
          qaStatus: OutreachQaStatus.PASSED,
          qaIssues: null,
          evidenceFingerprint: "evidence-2"
        }]
      },
      {
        id: "contact-qa-failed",
        companyId: "company-1",
        fullName: "Jordan QA",
        email: "jordan@example.com",
        contactStatus: ContactStatus.REVIEWING,
        assignedRep: null,
        company: {
          name: "Example Importer",
          candidateStatus: CandidateStatus.APPROVED_FOR_PIPELINE,
          doNotProspect: false,
          hunterOpportunitySignals: [{}],
          hunterProspectingDecisions: [{}]
        },
        outreachPlans: [{
          id: "plan-qa-failed",
          companyId: "company-1",
          contactId: "contact-qa-failed",
          sequenceName: "Hunter - Email Only",
          version: 1,
          status: OutreachPlanStatus.QA_FAILED,
          qaStatus: OutreachQaStatus.FAILED,
          qaIssues: [{
            code: "UNKNOWN_EVIDENCE",
            severity: "ERROR",
            stepNumber: 2,
            message: 'Evidence reference "tr ademining:summary" is not in the saved evidence ledger.'
          }],
          evidenceFingerprint: "evidence-3"
        }]
      }
    ]);

    const formData = new FormData();
    formData.append("contactId", "contact-approved");
    formData.append("contactId", "contact-no-email");
    formData.append("contactId", "contact-qa-failed");

    await expect(bulkApproveOutreachPlansAction(formData)).resolves.toMatchObject({
      status: "success",
      operation: "approve",
      selectedContacts: 3,
      approvedContacts: 1,
      skippedContacts: 2,
      jobRunId: "apollo-job-1",
      details: expect.arrayContaining([
        expect.objectContaining({
          contactId: "contact-no-email",
          outcome: "skipped",
          reason: "A concrete usable email address is required before approval."
        }),
        expect.objectContaining({
          contactId: "contact-qa-failed",
          outcome: "skipped",
          reason:
            'Grounded QA failed. Step 2: Evidence reference "tr ademining:summary" is not in the saved evidence ledger. Regenerate the plan before approval.'
        })
      ])
    });
    expect(outreachPlanUpdateMany).toHaveBeenCalledTimes(1);
    expect(outreachPlanUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: "plan-approved",
          tenantId: "tenant-1",
          status: OutreachPlanStatus.QA_PASSED,
          qaStatus: OutreachQaStatus.PASSED
        })
      })
    );
    expect(automationJobRunCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: "tenant-1",
        jobType: "lead-gen.apollo-push",
        status: "QUEUED",
        input: expect.objectContaining({
          contactIds: ["contact-approved"],
          selectedContacts: 1
        })
      }),
      select: { id: true }
    });
  });

  it("does not queue a contact when its company is blocked from prospecting", async () => {
    contactFindMany.mockResolvedValueOnce([
      {
        id: "contact-1",
        companyId: "company-1",
        contactStatus: ContactStatus.APPROVED,
        company: {
          candidateStatus: CandidateStatus.DISQUALIFIED,
          doNotProspect: true
        }
      }
    ]);

    const formData = new FormData();
    formData.append("contactId", "contact-1");

    await expect(bulkPushContactsToApolloAction(formData)).resolves.toMatchObject({
      status: "error",
      operation: "apollo_push",
      message: "The contact's company is blocked from prospecting."
    });
  });

  it("does not queue an unassigned contact for Apollo", async () => {
    contactFindMany.mockResolvedValueOnce([
      {
        id: "contact-1",
        companyId: "company-1",
        contactStatus: ContactStatus.APPROVED,
        assignedRep: null,
        company: {
          candidateStatus: CandidateStatus.APPROVED_FOR_PIPELINE,
          doNotProspect: false
        }
      }
    ]);

    const formData = new FormData();
    formData.append("contactId", "contact-1");

    await expect(bulkPushContactsToApolloAction(formData)).resolves.toMatchObject({
      status: "error",
      operation: "apollo_push",
      message: "Assign a sales rep before pushing this contact to Apollo."
    });
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
