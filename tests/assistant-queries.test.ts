import { describe, expect, it } from "vitest";

import { buildAssistantManagerSummary, buildAssistantSources, classifyAssistantIntent } from "@/modules/assistant/queries";

describe("classifyAssistantIntent", () => {
  it("routes rate and quote questions to the rate request flow", () => {
    expect(classifyAssistantIntent("Need a rate from Toronto to Dallas")).toBe("RATE_REQUEST");
    expect(classifyAssistantIntent("Can 7L quote this LTL lane?")).toBe("RATE_REQUEST");
  });

  it("routes company and customer questions to customer context", () => {
    expect(classifyAssistantIntent("What do we know about this customer?")).toBe("CUSTOMER_CONTEXT");
    expect(classifyAssistantIntent("Show company details")).toBe("CUSTOMER_CONTEXT");
  });

  it("routes sales questions to opportunity review", () => {
    expect(classifyAssistantIntent("Find new sales opportunities")).toBe("SALES_OPPORTUNITY");
    expect(classifyAssistantIntent("Which pipeline leads should we call?")).toBe("SALES_OPPORTUNITY");
  });

  it("routes risk language to operational risk", () => {
    expect(classifyAssistantIntent("What problems should managers watch?")).toBe("OPERATIONAL_RISK");
    expect(classifyAssistantIntent("Any customer complaints or delays?")).toBe("OPERATIONAL_RISK");
  });

  it("routes email language to email drafting", () => {
    expect(classifyAssistantIntent("Draft a follow up email")).toBe("EMAIL_DRAFT");
    expect(classifyAssistantIntent("Help me reply to this account")).toBe("EMAIL_DRAFT");
  });

  it("uses general insight as the default", () => {
    expect(classifyAssistantIntent()).toBe("GENERAL_INSIGHT");
    expect(classifyAssistantIntent("What should I look at?")).toBe("GENERAL_INSIGHT");
  });
});

describe("buildAssistantSources", () => {
  it("turns workspace companies, leads, and rate jobs into auditable source records", () => {
    const sources = buildAssistantSources({
      recentMemories: [
        {
          id: "memory-1",
          kind: "CUSTOMER_PROFILE",
          subjectType: "Company",
          subjectId: "company-1",
          title: "Acme Imports",
          summary: "Industry Furniture, priority 87, status NEW.",
          confidence: 70,
          lastObservedAt: new Date("2026-06-25T10:00:00Z"),
          sourceDocument: {
            sourceKind: "COMPANY",
            sourceId: "company-1",
            title: "Acme Imports"
          }
        }
      ],
      topCompanies: [
        {
          id: "company-1",
          name: "Acme Imports",
          normalizedName: "acme imports",
          primaryIndustry: "Furniture",
          priorityScore: 87,
          candidateStatus: "NEW",
          contactCount: 2,
          leadCount: 1,
          importRecordCount: 14,
          updatedAt: new Date("2026-06-25T10:00:00Z")
        }
      ],
      openLeads: [
        {
          id: "lead-1",
          stage: "QUALIFIED",
          score: 92,
          notes: null,
          updatedAt: new Date("2026-06-25T10:00:00Z"),
          company: {
            id: "company-1",
            name: "Acme Imports",
            primaryIndustry: "Furniture",
            priorityScore: 87
          },
          contact: {
            fullName: "Taylor Smith",
            title: "Logistics Manager",
            email: "taylor@example.com"
          }
        }
      ],
      recentRateJobs: [
        {
          id: "job-1",
          jobType: "ups-tools.bulk-rate-quote",
          status: "SUCCESS",
          startedAt: new Date("2026-06-25T10:00:00Z"),
          finishedAt: new Date("2026-06-25T10:01:00Z"),
          errorMessage: null
        }
      ]
    } as Parameters<typeof buildAssistantSources>[0]);

    expect(sources).toMatchObject([
      {
        sourceKind: "COMPANY",
        sourceId: "company-1",
        title: "Acme Imports",
        excerpt: "Industry Furniture, priority 87, status NEW."
      },
      {
        sourceKind: "COMPANY",
        sourceId: "company-1",
        title: "Acme Imports"
      },
      {
        sourceKind: "LEAD",
        sourceId: "lead-1",
        title: "Acme Imports lead"
      },
      {
        sourceKind: "RATE_TOOL",
        sourceId: "job-1",
        title: "ups-tools.bulk-rate-quote"
      }
    ]);
  });
});

describe("buildAssistantManagerSummary", () => {
  it("groups recent memories into compact manager-facing signal buckets", () => {
    const summary = buildAssistantManagerSummary(
      [
        {
          id: "risk-1",
          kind: "OPERATIONAL_RISK",
          subjectType: "MicrosoftGraphIssue",
          subjectId: "issue-1",
          title: "Dallas service issue",
          summary: "Customer reported a delay on a Dallas shipment.",
          confidence: 74,
          lastObservedAt: new Date("2026-06-25T10:00:00Z")
        },
        {
          id: "opp-1",
          kind: "SALES_OPPORTUNITY",
          subjectType: "MicrosoftGraphOpportunity",
          subjectId: "opportunity-1",
          title: "Acme quote request",
          summary: "Customer asked for new LTL pricing.",
          confidence: 76,
          lastObservedAt: new Date("2026-06-25T11:00:00Z")
        },
        {
          id: "customer-1",
          kind: "CUSTOMER_PROFILE",
          subjectType: "Company",
          subjectId: "company-1",
          title: "Acme company memory",
          summary: "company Acme, domains acme.com, services ltl, warehousing",
          confidence: 82,
          lastObservedAt: new Date("2026-06-25T09:00:00Z")
        }
      ],
      [
        { kind: "OPERATIONAL_RISK", _count: { _all: 3 } },
        { kind: "SALES_OPPORTUNITY", _count: { _all: 2 } },
        { kind: "CUSTOMER_PROFILE", _count: { _all: 5 } },
        { kind: "SERVICE_CAPABILITY", _count: { _all: 1 } }
      ]
    );

    expect(summary.counts).toMatchObject({
      risks: 3,
      opportunities: 2,
      customers: 5,
      services: 1
    });
    expect(summary.topRisks[0]?.title).toBe("Dallas service issue");
    expect(summary.topOpportunities[0]?.title).toBe("Acme quote request");
    expect(summary.topCustomers[0]?.title).toBe("Acme company memory");
  });
});
