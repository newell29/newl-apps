import { CandidateStatus } from "@prisma/client";
import { describe, expect, it } from "vitest";

import { scoreCandidate, summarizeTradeMiningEvidence } from "@/modules/lead-gen/queries";
import { DEFAULT_TRADEMINING_SCORING_SETTINGS } from "@/modules/settings/types";

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
    expect(scoring.reasoning).toContain("industry signals match preferred categories");
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

  it("penalizes oversize importers while favoring growing mid-market companies", () => {
    const now = Date.now();
    const day = 86_400_000;
    const records = [
      {
        rawJson: {
          sourceRole: "consignee_name",
          productDescription: "furniture",
          hsCode: "9403",
          teu: 4
        },
        arrivalDate: new Date(now - 10 * day),
        sourcePort: "Shanghai",
        destinationCity: "Houston",
        destinationState: "TX",
        originCountry: "China",
        productDescription: "furniture"
      },
      {
        rawJson: {
          sourceRole: "consignee_name",
          productDescription: "furniture",
          hsCode: "9403",
          teu: 4
        },
        arrivalDate: new Date(now - 14 * day),
        sourcePort: "Shanghai",
        destinationCity: "Houston",
        destinationState: "TX",
        originCountry: "China",
        productDescription: "furniture"
      },
      {
        rawJson: {
          sourceRole: "consignee_name",
          productDescription: "furniture",
          hsCode: "9403",
          teu: 1
        },
        arrivalDate: new Date(now - 45 * day),
        sourcePort: "Shanghai",
        destinationCity: "Houston",
        destinationState: "TX",
        originCountry: "China",
        productDescription: "furniture"
      }
    ];

    const evidence = summarizeTradeMiningEvidence(records, new Map());
    const scoring = scoreCandidate({
      companyPriorityScore: 50,
      candidateStatus: CandidateStatus.NEW,
      alreadyInPipeline: false,
      evidence,
      config: {
        ...DEFAULT_TRADEMINING_SCORING_SETTINGS,
        midMarketTeuMin: "2",
        midMarketTeuMax: "10",
        midMarketBoost: 8,
        oversizeTeuThreshold: "20",
        oversizeShipmentCount30dThreshold: 10
      }
    });

    expect(scoring.score).toBeGreaterThan(40);
    expect(scoring.reasoning).toContain("shipment activity rising");
    expect(scoring.reasoning).toContain("mid-market importer profile");
  });

  it("does not require hs code or master fields for a strong score when core lane signals are present", () => {
    const now = Date.now();
    const day = 86_400_000;
    const records = [
      {
        rawJson: {
          sourceRole: "consignee_name",
          destinationPort: "Houston",
          arrivalPort: "Houston",
          originCountry: "China",
          productDescription: "stone countertops",
          containerCount: 3,
          weight: 24000
        },
        arrivalDate: new Date(now - 8 * day),
        sourcePort: "Ningbo",
        destinationCity: null,
        destinationState: null,
        originCountry: "China",
        productDescription: "stone countertops"
      }
    ];

    const evidence = summarizeTradeMiningEvidence(records, new Map());
    const scoring = scoreCandidate({
      companyPriorityScore: 55,
      candidateStatus: CandidateStatus.NEW,
      alreadyInPipeline: false,
      evidence
    });

    expect(scoring.score).toBeGreaterThanOrEqual(45);
    expect(scoring.reasoning).toContain("product description available; HS data optional");
  });

  it("rewards richer optional fields without making them mandatory", () => {
    const now = Date.now();
    const sparseEvidence = summarizeTradeMiningEvidence(
      [
        {
          rawJson: {
            sourceRole: "consignee_name",
            destinationMarket: "Charleston",
            originCountry: "Vietnam",
            productDescription: "lighting fixtures",
            containerCount: 2
          },
          arrivalDate: new Date(now - 12 * 86_400_000),
          sourcePort: "Hai Phong",
          destinationCity: "Charleston",
          destinationState: "SC",
          originCountry: "Vietnam",
          productDescription: "lighting fixtures"
        }
      ],
      new Map()
    );

    const richEvidence = summarizeTradeMiningEvidence(
      [
        {
          rawJson: {
            sourceRole: "consignee_name",
            destinationMarket: "Charleston",
            destinationPort: "Charleston",
            destinationCity: "Charleston",
            destinationState: "SC",
            destinationZip: "29401",
            originCountry: "Vietnam",
            productDescription: "lighting fixtures",
            hsCode: "9405",
            containerCount: 2,
            notifyParty: "Import Ops",
            masterConsigneeName: "Bright Home Distribution",
            vessel: "Ever Summit"
          },
          arrivalDate: new Date(now - 12 * 86_400_000),
          sourcePort: "Hai Phong",
          destinationCity: "Charleston",
          destinationState: "SC",
          originCountry: "Vietnam",
          productDescription: "lighting fixtures"
        }
      ],
      new Map()
    );

    const sparseScore = scoreCandidate({
      companyPriorityScore: 55,
      candidateStatus: CandidateStatus.NEW,
      alreadyInPipeline: false,
      evidence: sparseEvidence
    });
    const richScore = scoreCandidate({
      companyPriorityScore: 55,
      candidateStatus: CandidateStatus.NEW,
      alreadyInPipeline: false,
      evidence: richEvidence
    });

    expect(richScore.score).toBeGreaterThan(sparseScore.score);
  });
});
