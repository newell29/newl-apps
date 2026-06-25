import { describe, expect, it } from "vitest";

import { buildAssistantSources, classifyAssistantIntent } from "@/modules/assistant/queries";

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
