import { ReplyStatus } from "@prisma/client";
import { describe, expect, it } from "vitest";

import {
  buildHunterCompanyResearchWhere,
  resolveHunterCompanyResearchSelection,
  rankHunterCompanyResearchCandidates
} from "@/modules/lead-gen/hunter-company-research";

describe("Hunter company research selection", () => {
  it("does not suppress a company because it has legacy leads or prior cadence history", () => {
    const where = buildHunterCompanyResearchWhere({
      tenantId: "tenant-a",
      requestedKeys: [],
      suppressedCompanyIds: []
    });

    expect(where).not.toHaveProperty("leads");
    expect(where).not.toHaveProperty(
      "contacts.none.sequenceStatus"
    );
    expect(where).toMatchObject({
      tenantId: "tenant-a",
      contacts: {
        none: {
          replyStatus: {
            in: [
              ReplyStatus.REPLIED,
              ReplyStatus.POSITIVE,
              ReplyStatus.MEETING_BOOKED
            ]
          }
        }
      }
    });
  });

  it("suppresses recent research and active Hunter outreach while allowing genuinely new triggers", () => {
    const selection = resolveHunterCompanyResearchSelection({
      now: new Date("2026-08-04T12:00:00.000Z"),
      researchHistory: [
        history("company-a", "domain:a.example", "2026-07-28T12:00:00.000Z"),
        history("company-b", "domain:b.example", "2026-07-28T12:00:00.000Z"),
        history("company-c", "domain:c.example", "2026-04-01T12:00:00.000Z"),
        history("company-d", "domain:d.example", "2026-07-20T12:00:00.000Z")
      ],
      materialSignals: [
        history("company-b", "domain:b.example", "2026-08-02T12:00:00.000Z"),
        history("company-d", "domain:d.example", "2026-08-03T12:00:00.000Z")
      ],
      activeOutreachCompanies: [
        { companyId: "company-d", identityKey: "domain:d.example" },
        { companyId: "company-e", identityKey: "domain:e.example" }
      ]
    });

    expect(selection.suppressedCompanyIds).toEqual(
      expect.arrayContaining(["company-a", "company-d", "company-e"])
    );
    expect(selection.suppressedCompanyIds).not.toContain("company-b");
    expect(selection.suppressedCompanyIds).not.toContain("company-c");
    expect(selection.suppressedIdentityKeys).toEqual(
      expect.arrayContaining(["domain:a.example", "domain:d.example", "domain:e.example"])
    );
    expect(selection.materialRefreshIdentityKeys).toEqual(["domain:b.example"]);
    expect(selection.recentResearchSuppressedCount).toBe(1);
    expect(selection.activeOutreachSuppressedCount).toBe(2);
  });

  it("suppresses a duplicate alias when Apollo, domain, or normalized-name identities overlap", () => {
    const selection = resolveHunterCompanyResearchSelection({
      now: new Date("2026-08-04T12:00:00.000Z"),
      researchHistory: [{
        ...history("mapped-company", "apollo:org-1", "2026-07-28T12:00:00.000Z"),
        identityKeys: ["apollo:org-1", "domain:example.com", "name:example-company"]
      }],
      materialSignals: [],
      activeOutreachCompanies: []
    });

    expect(selection.suppressedIdentityKeys).toEqual(
      expect.arrayContaining(["apollo:org-1", "domain:example.com", "name:example-company"])
    );
  });

  it("reserves daily research capacity for strong external-news companies without requiring TradeMining", () => {
    const companies = [
      company("trade-1", 99),
      company("trade-2", 98),
      company("trade-3", 97),
      company("trade-4", 96),
      company("news-1", 70, 88),
      company("news-2", 68, 82)
    ];

    const ranked = rankHunterCompanyResearchCandidates(companies, 3);

    expect(ranked.map((company) => company.id)).toEqual([
      "news-1",
      "trade-1",
      "trade-2"
    ]);
  });

  it("does not mistake an unrelated manual signal for Brave discovery", () => {
    const manual = company("manual", 10);
    manual.hunterOpportunitySignals = [
      {
        confidence: 100,
        sourceName: "Manual evidence",
        evidence: {
          discovery: {
            provider: "MANUAL"
          }
        }
      }
    ];
    const ranked = rankHunterCompanyResearchCandidates(
      [company("trade-1", 99), company("trade-2", 98), manual],
      2
    );

    expect(ranked.map((company) => company.id)).toEqual(["trade-1", "trade-2"]);
  });
});

function company(id: string, priorityScore: number, externalConfidence?: number) {
  return {
    id,
    source: "TRADEMINING",
    priorityScore,
    updatedAt: new Date("2026-07-28T12:00:00.000Z"),
    hunterOpportunitySignals: externalConfidence
      ? [
          {
            confidence: externalConfidence,
            sourceName: "Example News",
            evidence: {
              discovery: {
                provider: "BRAVE_WEB"
              }
            }
          }
        ]
      : []
  };
}

function history(companyId: string, identityKey: string, observedAt: string) {
  return {
    companyId,
    identityKey,
    observedAt: new Date(observedAt)
  };
}
