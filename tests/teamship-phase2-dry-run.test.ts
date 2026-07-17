import { describe, expect, it } from "vitest";

import {
  addPalletDraftLineToReviewState,
  removePalletDraftLineFromReviewState,
  updatePalletBotActionEnabledInReviewState,
  updatePalletCommodityOverrideInReviewState,
  updateReviewFieldBotActionEnabledInReviewState,
  updateReviewFieldProposedValueInReviewState
} from "@/modules/shipment-documents/garland-teamship-review-client-state";
import { prepareReviewForAutomatedTeamshipUpdates } from "@/modules/shipment-documents/garland-email-agent-automation";
import { buildTeamshipPhase2DryRunPlan } from "@/modules/shipment-documents/teamship-phase2-dry-run";
import type { GarlandTeamshipReviewResponse } from "@/modules/shipment-documents/teamship-review-types";

describe("Teamship Phase 2 dry-run planner", () => {
  it("builds a no-mutation dry-run payload with pallet updates only by default", () => {
    const plan = buildTeamshipPhase2DryRunPlan(sampleReview());

    expect(plan).toMatchObject({
      mode: "DRY_RUN",
      dryRun: true,
      wouldUpdateTeamship: false,
      summary: {
        orderCount: 1,
        readyCount: 1,
        blockedCount: 0,
        plannedFieldUpdateCount: 0,
        plannedPalletRowCount: 2,
        plannedBolCleanupCount: 1
      }
    });
    expect(plan.orders[0]?.plannedBolCleanup).toMatchObject({
      removeCustomerOrderWeights: true,
      compactSpecialInstructions: false
    });
    expect(plan.orders[0]?.plannedFieldUpdates).toEqual([]);
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

  it("uses Teamship placeholder dimensions when a SKU has no usable dimensions", () => {
    const review = sampleReview();
    review.reviews[0]!.productDimensions = review.reviews[0]!.productDimensions.filter(
      (dimension) => dimension.sku !== "8030445"
    );

    const plan = buildTeamshipPhase2DryRunPlan(review);

    expect(plan.summary).toMatchObject({
      readyCount: 1,
      blockedCount: 0
    });
    expect(plan.orders[0]?.validationIssues).not.toContain("No usable dimension/weight recommendation found for SKU 8030445.");
    expect(plan.orders[0]?.plannedPalletRows[1]).toMatchObject({
      rowNumber: 2,
      sku: "8030445",
      commodity: "SKU: 8030445 QTY: 4",
      hasUsableDimensions: false,
      dimensionSource: "MISSING",
      lengthIn: 1,
      widthIn: 1,
      heightIn: 1,
      weightLb: 1,
      teamshipFields: {
        pallets_count: 2,
        pallet_2: 4,
        pallet_2_length: 1,
        pallet_2_width: 1,
        pallet_2_height: 1,
        pallet_2_weight: 1,
        pallet_2_weight_unit: "lbs",
        pallet_2_commodity: "SKU: 8030445 QTY: 4"
      }
    });
  });

  it("formats multiple serials under one SKU in the commodity line", () => {
    const review = sampleReview();
    review.pdfOrders[0]!.items[0]!.serialNumbers = ["2604816191908", "2604816191909"];

    const plan = buildTeamshipPhase2DryRunPlan(review);

    expect(plan.orders[0]?.plannedPalletRows[0]).toMatchObject({
      commodity: "SKU: E1SGHMV6XHU3US SN: 2604816191908, 2604816191909",
      teamshipFields: expect.objectContaining({
        pallet_1_commodity: "SKU: E1SGHMV6XHU3US SN: 2604816191908, 2604816191909"
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
      plannedPalletRows: [],
      plannedBolCleanup: null
    });
  });

  it("includes CSR-added pallet/SKU draft lines in the dry-run payload", () => {
    const review = sampleReview();
    const nextState = addPalletDraftLineToReviewState({
      orders: review.pdfOrders,
      review,
      srNumber: "SR808478",
      line: {
        sku: "C-CARE-P",
        serialNumbers: ["CSR-SERIAL-1"]
      }
    });

    const plan = buildTeamshipPhase2DryRunPlan(nextState.review!);

    expect(nextState.orders[0]?.items).toHaveLength(3);
    expect(nextState.review?.pdfOrders[0]?.items).toHaveLength(3);
    expect(nextState.review?.reviews[0]?.pdfItems[2]).toEqual({
      sku: "C-CARE-P",
      quantity: "1",
      serialNumbers: ["CSR-SERIAL-1"]
    });
    expect(plan.summary.plannedPalletRowCount).toBe(3);
    expect(plan.orders[0]?.validationIssues).not.toContain("No usable dimension/weight recommendation found for SKU C-CARE-P.");
    expect(plan.orders[0]?.plannedPalletRows[2]).toMatchObject({
      rowNumber: 3,
      sku: "C-CARE-P",
      commodity: "SKU: C-CARE-P SN: CSR-SERIAL-1",
      hasUsableDimensions: false,
      dimensionSource: "MISSING",
      teamshipFields: {
        pallets_count: 3,
        pallet_3: 1,
        pallet_3_length: 1,
        pallet_3_width: 1,
        pallet_3_height: 1,
        pallet_3_weight: 1,
        pallet_3_weight_unit: "lbs",
        pallet_3_commodity: "SKU: C-CARE-P SN: CSR-SERIAL-1"
      }
    });
  });

  it("removes CSR-excluded pallet/SKU lines from the dry-run payload", () => {
    const review = sampleReview();
    const nextState = removePalletDraftLineFromReviewState({
      orders: review.pdfOrders,
      review,
      srNumber: "SR808478",
      itemIndex: 0
    });

    const plan = buildTeamshipPhase2DryRunPlan(nextState.review!);

    expect(nextState.orders[0]?.items).toHaveLength(1);
    expect(nextState.review?.pdfOrders[0]?.items).toHaveLength(1);
    expect(nextState.review?.reviews[0]?.pdfItems).toEqual([
      {
        sku: "8030445",
        quantity: "4",
        serialNumbers: []
      }
    ]);
    expect(plan.summary.plannedPalletRowCount).toBe(1);
    expect(plan.orders[0]?.plannedPalletRows).toEqual([
      expect.objectContaining({
        rowNumber: 1,
        sku: "8030445",
        commodity: "SKU: 8030445 QTY: 4",
        teamshipFields: expect.objectContaining({
          pallets_count: 1,
          pallet_1: 4,
          pallet_1_commodity: "SKU: 8030445 QTY: 4"
        })
      })
    ]);
  });

  it("uses CSR-edited proposed shipment field values in the dry-run payload", () => {
    const review = sampleReview();
    const reviewWithValue = updateReviewFieldProposedValueInReviewState({
      review,
      srNumber: "SR808478",
      fieldKey: "freight_terms",
      value: "COLLECT"
    });
    const nextReview = updateReviewFieldBotActionEnabledInReviewState({
      review: reviewWithValue,
      srNumber: "SR808478",
      fieldKey: "freight_terms",
      enabled: true
    });

    const plan = buildTeamshipPhase2DryRunPlan(nextReview!);

    expect(nextReview?.reviews[0]?.fields[0]?.pdfValue).toBe("PPADD-CD");
    expect(nextReview?.reviews[0]?.fields[0]?.proposedValue).toBe("COLLECT");
    expect(plan.orders[0]?.plannedFieldUpdates).toEqual([
      expect.objectContaining({
        reviewFieldKey: "freight_terms",
        teamshipField: "edi_field_3",
        proposedValue: "COLLECT"
      })
    ]);
  });

  it("plans approved ship-to address fixes through the Teamship ship_address API field", () => {
    const review = sampleReview();
    review.reviews[0]!.fields = [
      {
        key: "ship_to_address_1",
        label: "Ship-to address",
        status: "DISCREPANCY",
        pdfValue: "C-883 JANE STREET, JANE PARK PLAZA",
        teamshipValue: "JANE PARK PLAZA",
        message: "PDF and Teamship values do not match.",
        botActionEnabled: true
      }
    ];

    const plan = buildTeamshipPhase2DryRunPlan(review);

    expect(plan.orders[0]?.plannedFieldUpdates).toEqual([
      expect.objectContaining({
        reviewFieldKey: "ship_to_address_1",
        teamshipField: "ship_address",
        currentValue: "JANE PARK PLAZA",
        proposedValue: "C-883 JANE STREET, JANE PARK PLAZA"
      })
    ]);
  });

  it("auto-enables email-agent ship-to address updates before creating an approved job", () => {
    const review = sampleReview();
    review.reviews[0]!.fields = [
      {
        key: "ship_to_address_1",
        label: "Ship-to address",
        status: "DISCREPANCY",
        pdfValue: "C-883 JANE STREET, JANE PARK PLAZA",
        teamshipValue: "JANE PARK PLAZA",
        message: "PDF and Teamship values do not match."
      }
    ];

    const preparedReview = prepareReviewForAutomatedTeamshipUpdates(review);
    const plan = buildTeamshipPhase2DryRunPlan(preparedReview);

    expect(preparedReview.reviews[0]?.fields[0]?.botActionEnabled).toBe(true);
    expect(plan.orders[0]?.plannedFieldUpdates).toEqual([
      expect.objectContaining({
        reviewFieldKey: "ship_to_address_1",
        teamshipField: "ship_address",
        proposedValue: "C-883 JANE STREET, JANE PARK PLAZA"
      })
    ]);
  });

  it("creates a field update for a matching Teamship field when CSR enters a bot action", () => {
    const review = sampleReview();
    review.reviews[0]!.status = "PASS";
    review.reviews[0]!.issueCount = 0;
    review.reviews[0]!.fields[0] = {
      key: "freight_terms",
      label: "Freight terms",
      status: "MATCH",
      pdfValue: "PPADD-CD",
      teamshipValue: "PPADD-CD",
      message: "Values match."
    };

    expect(buildTeamshipPhase2DryRunPlan(review).orders[0]?.plannedFieldUpdates).toEqual([]);

    const reviewWithValue = updateReviewFieldProposedValueInReviewState({
      review,
      srNumber: "SR808478",
      fieldKey: "freight_terms",
      value: "PREPAID"
    });
    const nextReview = updateReviewFieldBotActionEnabledInReviewState({
      review: reviewWithValue,
      srNumber: "SR808478",
      fieldKey: "freight_terms",
      enabled: true
    });
    const plan = buildTeamshipPhase2DryRunPlan(nextReview!);

    expect(plan.orders[0]?.plannedFieldUpdates).toEqual([
      expect.objectContaining({
        reviewFieldKey: "freight_terms",
        teamshipField: "edi_field_3",
        currentValue: "PPADD-CD",
        proposedValue: "PREPAID",
        reason: expect.stringContaining("CSR override")
      })
    ]);
  });

  it("uses CSR-edited pallet commodity text in the dry-run payload", () => {
    const review = sampleReview();
    const nextState = updatePalletCommodityOverrideInReviewState({
      orders: review.pdfOrders,
      review,
      srNumber: "SR808478",
      itemIndex: 0,
      value: "SKU: E1SGHMV6XHU3US SN: 2604816191908\nCSR NOTE: USE FRONT DOCK"
    });

    const plan = buildTeamshipPhase2DryRunPlan(nextState.review!);

    expect(nextState.orders[0]?.items[0]?.commodityOverride).toContain("CSR NOTE");
    expect(nextState.review?.pdfOrders[0]?.items[0]?.commodityOverride).toContain("CSR NOTE");
    expect(plan.orders[0]?.plannedPalletRows[0]).toMatchObject({
      commodity: "SKU: E1SGHMV6XHU3US SN: 2604816191908\nCSR NOTE: USE FRONT DOCK",
      teamshipFields: expect.objectContaining({
        pallet_1_commodity: "SKU: E1SGHMV6XHU3US SN: 2604816191908\nCSR NOTE: USE FRONT DOCK"
      })
    });
  });

  it("excludes unchecked shipment field bot actions from the dry-run payload", () => {
    const review = sampleReview();
    const nextReview = updateReviewFieldBotActionEnabledInReviewState({
      review,
      srNumber: "SR808478",
      fieldKey: "freight_terms",
      enabled: false
    });

    const plan = buildTeamshipPhase2DryRunPlan(nextReview!);

    expect(nextReview?.reviews[0]?.fields[0]?.botActionEnabled).toBe(false);
    expect(plan.summary.plannedFieldUpdateCount).toBe(0);
    expect(plan.orders[0]?.plannedFieldUpdates).toEqual([]);
  });

  it("excludes unchecked pallet rows from the dry-run payload and renumbers included rows", () => {
    const review = sampleReview();
    const nextState = updatePalletBotActionEnabledInReviewState({
      orders: review.pdfOrders,
      review,
      srNumber: "SR808478",
      itemIndex: 0,
      enabled: false
    });

    const plan = buildTeamshipPhase2DryRunPlan(nextState.review!);

    expect(nextState.orders[0]?.items[0]?.botActionEnabled).toBe(false);
    expect(plan.summary.plannedPalletRowCount).toBe(1);
    expect(plan.orders[0]?.plannedPalletRows).toEqual([
      expect.objectContaining({
        rowNumber: 1,
        sku: "8030445",
        commodity: "SKU: 8030445 QTY: 4",
        teamshipFields: expect.objectContaining({
          pallets_count: 1,
          pallet_1: 4,
          pallet_1_commodity: "SKU: 8030445 QTY: 4"
        })
      })
    ]);
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
        pdfItems: [
          {
            sku: "E1SGHMV6XHU3US",
            quantity: "1",
            serialNumbers: ["2604816191908"]
          },
          {
            sku: "8030445",
            quantity: "4",
            serialNumbers: []
          }
        ],
        teamshipItems: [
          {
            sku: "E1SGHMV6XHU3US",
            quantity: "1",
            serialNumbers: ["2604816191908"]
          },
          {
            sku: "8030445",
            quantity: "4",
            serialNumbers: []
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
