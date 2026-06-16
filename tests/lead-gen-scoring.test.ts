import { CandidateStatus } from "@prisma/client";
import { describe, expect, it } from "vitest";

import { scoreCandidate, summarizeTradeMiningEvidence } from "@/modules/lead-gen/queries";

describe("lead-gen candidate scoring", () => {
  it("rewards profile-aligned destination, origin, product, and role signals", () => {
    const records = [
      {
        rawJson: {
          searchProfileId: "profile-houston",
          sourceRole: "consignee_name",
          destinationMarket: "Houston",
          destinationPort: "Houston, Texas",
          destinationCity: "Houston",
          destinationState: "TX",
          originCountry: "China",
          foreignPort: "Shanghai",
          productDescription: "furniture and fixtures",
          hsCode: "9403",
          containerCount: 4,
          teu: 5,
          weight: 28000
        },
        arrivalDate: new Date("2026-06-12T00:00:00.000Z"),
        sourcePort: "Shanghai",
        destinationCity: "Houston",
        destinationState: "TX",
        originCountry: "China",
        productDescription: "furniture and fixtures"
      }
    ];

    const profiles = new Map([
      [
        "profile-houston",
        {
          id: "profile-houston",
          name: "Houston Import Leads",
          priorityWeight: 85,
          destinationMarkets: ["Houston"],
          destinationPorts: ["Houston, Texas"],
          originPorts: ["Shanghai"],
          shipFromPorts: ["Shanghai"],
          originCountries: ["China"],
          productKeywords: ["furniture"],
          hsCodes: ["9403"]
        }
      ]
    ]);

    const evidence = summarizeTradeMiningEvidence(records, profiles);
    const scoring = scoreCandidate({
      companyPriorityScore: 82,
      candidateStatus: CandidateStatus.NEW,
      alreadyInPipeline: false,
      evidence
    });

    expect(evidence.profileFit).toEqual({
      destination: 12,
      origin: 8,
      product: 10
    });
    expect(scoring.score).toBeGreaterThanOrEqual(70);
    expect(scoring.reasoning).toContain("consignee name role");
    expect(scoring.reasoning).toContain("destination fit matched profile");
    expect(scoring.reasoning).toContain("product/HS fit matched profile");
  });

  it("heavily deprioritizes rejected or disqualified companies", () => {
    const evidence = summarizeTradeMiningEvidence(
      [
        {
          rawJson: {
            shipmentDate: "2026-06-01",
            containerCount: 1
          },
          arrivalDate: new Date("2026-06-01T00:00:00.000Z"),
          sourcePort: null,
          destinationCity: null,
          destinationState: null,
          originCountry: null,
          productDescription: null
        }
      ],
      new Map()
    );

    const scoring = scoreCandidate({
      companyPriorityScore: 60,
      candidateStatus: CandidateStatus.DISQUALIFIED,
      alreadyInPipeline: false,
      evidence
    });

    expect(scoring.score).toBe(0);
  });
});
