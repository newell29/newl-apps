import { ReplyStatus } from "@prisma/client";
import { describe, expect, it } from "vitest";

import {
  buildHunterCompanyResearchWhere,
  rankHunterCompanyResearchCandidates
} from "@/modules/lead-gen/hunter-company-research";

describe("Hunter company research selection", () => {
  it("does not suppress a company because it has legacy leads or prior cadence history", () => {
    const where = buildHunterCompanyResearchWhere({
      tenantId: "tenant-a",
      requestedKeys: [],
      recentlyResearchedIds: []
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
