import { CandidateStatus } from "@prisma/client";
import { describe, expect, it } from "vitest";

import {
  buildTradeMiningEvidenceWhere,
  meetsSearchProfileMinimumShipmentCount,
  scoreCandidate,
  summarizeTradeMiningEvidence
} from "@/modules/lead-gen/queries";
import { DEFAULT_TRADEMINING_SCORING_SETTINGS } from "@/modules/settings/types";

describe("lead-gen candidate scoring", () => {
  it("builds an inclusive tenant-scoped evidence window", () => {
    const where = buildTradeMiningEvidenceWhere(
      { tenantId: "tenant-1" },
      120,
      new Date("2026-07-22T16:30:00.000Z")
    );

    expect(where).toEqual({
      tenantId: "tenant-1",
      OR: [
        { arrivalDate: { gte: new Date("2026-03-25T00:00:00.000Z") } },
        {
          arrivalDate: null,
          createdAt: { gte: new Date("2026-03-25T00:00:00.000Z") }
        }
      ]
    });
  });

  it("counts only the matched profile's shipments inside its own lookback window", () => {
    const now = Date.now();
    const day = 86_400_000;
    const record = (profileId: string, ageDays: number) => ({
      rawJson: { searchProfileId: profileId, teu: 1 },
      arrivalDate: new Date(now - ageDays * day),
      sourcePort: "Shanghai",
      destinationCity: "Charlotte",
      destinationState: "NC",
      originCountry: "Vietnam",
      productDescription: "retail fixtures"
    });
    const profile = {
      id: "profile-charlotte",
      name: "Charlotte Warehouse Leads",
      priorityWeight: 75,
      destinationMarkets: ["Charlotte"],
      destinationPorts: ["Charleston, South Carolina"],
      originPorts: [],
      shipFromPorts: [],
      originCountries: ["Vietnam"],
      productKeywords: ["retail fixtures"],
      hsCodes: [],
      contactCadenceConfig: null,
      lookbackWindowDays: 30,
      minShipmentCount: 2
    };
    const profiles = new Map([[profile.id, profile]]);
    const belowMinimum = summarizeTradeMiningEvidence(
      [record(profile.id, 2), record("profile-other", 3), record(profile.id, 45)],
      profiles
    );
    const meetsMinimum = summarizeTradeMiningEvidence(
      [record(profile.id, 2), record(profile.id, 10), record("profile-other", 3), record(profile.id, 45)],
      profiles
    );

    expect(belowMinimum.shipmentCount).toBe(1);
    expect(meetsSearchProfileMinimumShipmentCount(belowMinimum)).toBe(false);
    expect(meetsMinimum.shipmentCount).toBe(2);
    expect(meetsSearchProfileMinimumShipmentCount(meetsMinimum)).toBe(true);
  });

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
        arrivalDate: new Date(Date.now() - 5 * 86_400_000),
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
          hsCodes: ["9403"],
          contactCadenceConfig: null
        }
      ]
    ]);

    const evidence = summarizeTradeMiningEvidence(records, profiles);
    const scoring = scoreCandidate({
      companyPriorityScore: 82,
      candidateStatus: CandidateStatus.NEW,
      alreadyInPipeline: false,
      evidence,
      config: {
        ...DEFAULT_TRADEMINING_SCORING_SETTINGS,
        preferredOriginCountries: ["china"],
        penalizedOriginCountries: []
      }
    });

    expect(evidence.profileFit).toEqual({
      destination: 12,
      origin: 8,
      product: 10
    });
    expect(scoring.score).toBeGreaterThanOrEqual(65);
    expect(scoring.reasoning).toContain("consignee name role");
    expect(scoring.reasoning).toContain("destination fit matched profile");
    expect(scoring.reasoning).toContain("industry signals match preferred categories");
    expect(scoring.breakdown.components.map((component) => component.label)).toContain("Momentum");
    expect(scoring.breakdown.matchedSearchProfileName).toBe("Houston Import Leads");
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

  it("does not let a single recent shipment outrank repeat activity too easily", () => {
    const now = Date.now();
    const day = 86_400_000;

    const oneOffEvidence = summarizeTradeMiningEvidence(
      [
        {
          rawJson: {
            sourceRole: "consignee_name",
            destinationMarket: "Houston",
            productDescription: "furniture",
            hsCode: "9403",
            teu: 3
          },
          arrivalDate: new Date(now - 8 * day),
          sourcePort: "Genoa",
          destinationCity: "Houston",
          destinationState: "TX",
          originCountry: "Italy",
          productDescription: "furniture"
        }
      ],
      new Map()
    );

    const repeatEvidence = summarizeTradeMiningEvidence(
      [
        {
          rawJson: {
            sourceRole: "consignee_name",
            destinationMarket: "Houston",
            productDescription: "furniture",
            hsCode: "9403",
            teu: 3
          },
          arrivalDate: new Date(now - 8 * day),
          sourcePort: "Genoa",
          destinationCity: "Houston",
          destinationState: "TX",
          originCountry: "Italy",
          productDescription: "furniture"
        },
        {
          rawJson: {
            sourceRole: "consignee_name",
            destinationMarket: "Houston",
            productDescription: "furniture",
            hsCode: "9403",
            teu: 2
          },
          arrivalDate: new Date(now - 17 * day),
          sourcePort: "Genoa",
          destinationCity: "Houston",
          destinationState: "TX",
          originCountry: "Italy",
          productDescription: "furniture"
        },
        {
          rawJson: {
            sourceRole: "consignee_name",
            destinationMarket: "Houston",
            productDescription: "furniture",
            hsCode: "9403",
            teu: 1
          },
          arrivalDate: new Date(now - 42 * day),
          sourcePort: "Genoa",
          destinationCity: "Houston",
          destinationState: "TX",
          originCountry: "Italy",
          productDescription: "furniture"
        }
      ],
      new Map()
    );

    const oneOff = scoreCandidate({
      companyPriorityScore: 55,
      candidateStatus: CandidateStatus.NEW,
      alreadyInPipeline: false,
      evidence: oneOffEvidence
    });

    const repeat = scoreCandidate({
      companyPriorityScore: 55,
      candidateStatus: CandidateStatus.NEW,
      alreadyInPipeline: false,
      evidence: repeatEvidence
    });

    expect(oneOff.score).toBeLessThan(repeat.score);
    expect(oneOff.score).toBeLessThan(60);
    expect(repeat.reasoning).toContain("shipment activity rising");
  });

  it("uses preferred and deprioritized origin settings as ranking bias rather than hard filtering", () => {
    const evidence = summarizeTradeMiningEvidence(
      [
        {
          rawJson: {
            sourceRole: "consignee_name",
            destinationMarket: "Houston",
            originCountry: "Italy",
            foreignPort: "Genoa",
            productDescription: "lighting",
            hsCode: "9405",
            teu: 3
          },
          arrivalDate: new Date("2026-06-10T00:00:00.000Z"),
          sourcePort: "Genoa",
          destinationCity: "Houston",
          destinationState: "TX",
          originCountry: "Italy",
          productDescription: "lighting"
        }
      ],
      new Map()
    );

    const preferred = scoreCandidate({
      companyPriorityScore: 55,
      candidateStatus: CandidateStatus.NEW,
      alreadyInPipeline: false,
      evidence,
      config: {
        ...DEFAULT_TRADEMINING_SCORING_SETTINGS,
        preferredOriginCountries: ["italy"],
        penalizedOriginCountries: []
      }
    });

    const penalized = scoreCandidate({
      companyPriorityScore: 55,
      candidateStatus: CandidateStatus.NEW,
      alreadyInPipeline: false,
      evidence,
      config: {
        ...DEFAULT_TRADEMINING_SCORING_SETTINGS,
        preferredOriginCountries: [],
        penalizedOriginCountries: ["italy"]
      }
    });

    expect(preferred.score).toBeGreaterThan(penalized.score);
    expect(preferred.reasoning).toContain("preferred origin country");
  });
});
