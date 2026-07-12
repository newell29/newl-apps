import { describe, expect, it } from "vitest";

import { buildTeamshipPhase2DryRunPlan } from "@/modules/shipment-documents/teamship-phase2-dry-run";
import type { GarlandTeamshipReviewResponse } from "@/modules/shipment-documents/teamship-review-types";

describe("Teamship Phase 2 dry-run planner", () => {
  it("builds a no-mutation dry-run payload with field and pallet updates", () => {
    const plan = buildTeamshipPhase2DryRunPlan(sampleReview());

    expect(plan).toMatchObject({
      mode: "DRY_RUN",
      dryRun: true,
      wouldUpdateTeamship: false,
      summary: {
        orderCount: 1,
        readyCount: 1,
        blockedCount: 0,
        plannedFieldUpdateCount: 1,
        plannedPalletRowCount: 2
      }
    });
    expect(plan.orders[0]?.plannedFieldUpdates).toEqual([
      expect.objectContaining({
        reviewFieldKey: "freight_terms",
        teamshipField: "edi_field_3",
        proposedValue: "PPADD-CD"
      })
    ]);
    expect(plan.orders[0]?.plannedPalletRows).toEqual([
      expect.objectContaining({
        rowNumber: 1,
        sku: "E1SGHMV6XHU3US",
        commodity: "SKU: E1SGHMV6XHU3US SN: 2604816191908",
        lengthIn: 48,
        widthIn: 40,
        heightIn: 50,
        weightLb: 500,
        teamshipFields: expect.objectContaining({
          pallets_count: 1,
          pallet_1: 1,
          pallet_1_length: 48,
          pallet_1_width: 40,
          pallet_1_height: 50,
          pallet_1_weight: 500,
          pallet_1_weight_unit: "lbs",
          pallet_1_commodity: "SKU: E1SGHMV6XHU3US SN: 2604816191908"
        })
      }),
      expect.objectContaining({
        rowNumber: 2,
        sku: "8030445",
        commodity: "SKU: 8030445 QTY: 4",
        teamshipFields: expect.objectContaining({
          pallets_count: 2,
          pallet_2: 4,
          pallet_2_commodity: "SKU: 8030445 QTY: 4"
        })
      })
    ]);
  });

  it("still prepares commodity text when a SKU has no usable dimensions", () => {
    const review = sampleReview();
    review.reviews[0]!.productDimensions = review.reviews[0]!.productDimensions.filter(
      (dimension) => dimension.sku !== "8030445"
    );

    const plan = buildTeamshipPhase2DryRunPlan(review);

    expect(plan.summary).toMatchObject({
      readyCount: 0,
      blockedCount: 1
    });
    expect(plan.orders[0]?.validationIssues).toContain("No usable dimension/weight recommendation found for SKU 8030445.");
    expect(plan.orders[0]?.plannedPalletRows[1]).toMatchObject({
      rowNumber: 2,
      sku: "8030445",
      commodity: "SKU: 8030445 QTY: 4",
      hasUsableDimensions: false,
      dimensionSource: "MISSING",
      lengthIn: null,
      widthIn: null,
      heightIn: null,
      weightLb: null,
      teamshipFields: {
        pallets_count: 2,
        pallet_2: 4,
        pallet_2_commodity: "SKU: 8030445 QTY: 4"
      }
    });
  });

  it("formats multiple serials as separate commodity lines", () => {
    const review = sampleReview();
    review.pdfOrders[0]!.items[0]!.serialNumbers = ["2604816191908", "2604816191909"];

    const plan = buildTeamshipPhase2DryRunPlan(review);

    expect(plan.orders[0]?.plannedPalletRows[0]).toMatchObject({
      commodity: "SKU: E1SGHMV6XHU3US SN: 2604816191908\nSKU: E1SGHMV6XHU3US SN: 2604816191909",
      teamshipFields: expect.objectContaining({
        pallet_1_commodity: "SKU: E1SGHMV6XHU3US SN: 2604816191908\nSKU: E1SGHMV6XHU3US SN: 2604816191909"
      })
    });
  });

  it("skips missing Teamship orders instead of preparing updates", () => {
    const review = sampleReview();
    review.reviews[0]!.status = "MISSING_TEAMSHIP";
    review.reviews[0]!.teamshipOrderId = null;

    const plan = buildTeamshipPhase2DryRunPlan(review);

    expect(plan.orders[0]).toMatchObject({
      status: "SKIPPED",
      plannedFieldUpdates: [],
      plannedPalletRows: []
    });
  });
});

function sampleReview(): GarlandTeamshipReviewResponse {
  return {
    summary: {
      pdfOrderCount: 1,
      teamshipMatchedCount: 1,
      passedCount: 0,
      failedCount: 1,
      missingTeamshipCount: 0,
      pendingTeamshipCount: 0,
      noPdfCount: 0,
      skippedAlreadyReviewedCount: 0
    },
    fetchedAt: "2026-07-12T00:00:00.000Z",
    teamshipAlerts: [],
    pdfOrders: [
      {
        pageNumbers: [1],
        psNumber: "PS210206",
        srNumber: "SR808478",
        shipToCode: null,
        shipToName: "J.R. MAHONEY LTD.",
        shipToAddress1: "1810 KINGS ROAD",
        shipToCity: "SYDNEY",
        shipToState: "NS",
        shipToPostalCode: "B1L 1C5",
        shipToCountry: "Canada",
        shipToPo: "0000037656",
        freightTerms: "PPADD-CD",
        orderDate: null,
        shipVia: "MIDLAND",
        instructions: "MIDLAND THIRD PARTY ACCOUNT",
        rawText: "",
        items: [
          {
            lineNumber: 1,
            sku: "E1SGHMV6XHU3US",
            description: "",
            quantity: 1,
            dueShipDate: null,
            serialNumbers: ["2604816191908"]
          },
          {
            lineNumber: 2,
            sku: "8030445",
            description: "",
            quantity: 4,
            dueShipDate: null,
            serialNumbers: []
          }
        ]
      }
    ],
    reviews: [
      {
        psNumber: "PS210206",
        srNumber: "SR808478",
        pageNumbers: [1],
        status: "FAIL",
        teamshipOrderId: "30202",
        teamshipUrl: "https://members.fulfillit.io/ship-inventories/30202",
        issueCount: 1,
        alert: null,
        fields: [
          {
            key: "freight_terms",
            label: "Freight terms",
            status: "MISSING",
            pdfValue: "PPADD-CD",
            teamshipValue: null,
            message: "PDF has a value, but Teamship does not."
          }
        ],
        productDimensions: [
          {
            sku: "E1SGHMV6XHU3US",
            source: "TEAMSHIP_LEARNED",
            productType: null,
            quantity: null,
            lengthIn: 48,
            widthIn: 40,
            heightIn: 50,
            weightLb: 500,
            weightUnit: "lbs",
            confidence: "HIGH",
            note: "Learned from Teamship."
          },
          {
            sku: "8030445",
            source: "GARLAND_REFERENCE",
            productType: null,
            quantity: null,
            lengthIn: 10,
            widthIn: 10,
            heightIn: 10,
            weightLb: 25,
            weightUnit: "lbs",
            confidence: "MEDIUM",
            note: "Garland reference."
          }
        ]
      }
    ]
  };
}
