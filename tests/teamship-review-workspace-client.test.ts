import { describe, expect, it } from "vitest";

import {
  getWorkspaceWorkflowStatus,
  rowMatchesWorkspaceFilters
} from "@/modules/shipment-documents/components/garland-teamship-review-client";
import type {
  GarlandPdfShippingOrder,
  GarlandTeamshipOrderReview
} from "@/modules/shipment-documents/teamship-review-types";

type WorkspaceRow = Parameters<typeof getWorkspaceWorkflowStatus>[0];

describe("Garland Teamship review workspace client helpers", () => {
  it("searches visible rows by shipment, recipient, SKU, serial, and dimension text", () => {
    const row = sampleWorkspaceRow();

    expect(rowMatchesWorkspaceFilters({ row, search: "2604816191908", filter: "ALL", workflowStatus: "NEEDS_SETUP" })).toBe(true);
    expect(rowMatchesWorkspaceFilters({ row, search: "jr mahoney", filter: "ALL", workflowStatus: "NEEDS_SETUP" })).toBe(true);
    expect(rowMatchesWorkspaceFilters({ row, search: "E1SGHMV6XHU3US", filter: "ALL", workflowStatus: "NEEDS_SETUP" })).toBe(true);
    expect(rowMatchesWorkspaceFilters({ row, search: "CSR-entered", filter: "ALL", workflowStatus: "NEEDS_SETUP" })).toBe(true);
    expect(rowMatchesWorkspaceFilters({ row, search: "no-such-order", filter: "ALL", workflowStatus: "NEEDS_SETUP" })).toBe(false);
  });

  it("filters rows by review and workflow status", () => {
    const failedRow = sampleWorkspaceRow({ status: "FAIL", issueCount: 2 });
    const passedRow = sampleWorkspaceRow({ status: "PASS", issueCount: 0 });
    const noPdfRow = sampleWorkspaceRow({ status: "NO_PDF", pdfOrder: null });

    expect(rowMatchesWorkspaceFilters({ row: failedRow, search: "", filter: "ISSUES", workflowStatus: "NEEDS_REVIEW" })).toBe(true);
    expect(rowMatchesWorkspaceFilters({ row: passedRow, search: "", filter: "APPROVED", workflowStatus: "NEEDS_SETUP" })).toBe(true);
    expect(rowMatchesWorkspaceFilters({ row: noPdfRow, search: "", filter: "NO_PDF", workflowStatus: "NO_PDF" })).toBe(true);
    expect(rowMatchesWorkspaceFilters({ row: passedRow, search: "", filter: "ISSUES", workflowStatus: "NEEDS_SETUP" })).toBe(false);
    expect(rowMatchesWorkspaceFilters({ row: passedRow, search: "", filter: "READY_TO_PRINT", workflowStatus: "READY_TO_PRINT" })).toBe(true);
    expect(rowMatchesWorkspaceFilters({ row: passedRow, search: "", filter: "BOL_PRINTED", workflowStatus: "BOL_PRINTED" })).toBe(true);
  });

  it("derives workflow status from update job order state", () => {
    const passedRow = sampleWorkspaceRow({ status: "PASS", issueCount: 0 });
    const failedRow = sampleWorkspaceRow({ status: "FAIL", issueCount: 1 });

    expect(getWorkspaceWorkflowStatus(passedRow, [])).toBe("NEEDS_SETUP");
    expect(getWorkspaceWorkflowStatus(failedRow, [])).toBe("NEEDS_REVIEW");
    expect(
      getWorkspaceWorkflowStatus(passedRow, [
        {
          id: "job-1",
          tenantId: "tenant-1",
          shipmentDate: "2026-07-12T00:00:00.000Z",
          documentLabel: "July 12, 2026",
          dryRun: true,
          agentMode: "DRY_RUN",
          status: "SUCCESS",
          selectedSrNumbers: ["SR808478"],
          summary: {
            orderCount: 1,
            readyCount: 1,
            blockedCount: 0,
            skippedCount: 0,
            plannedFieldUpdateCount: 0,
            plannedPalletRowCount: 1
          },
          orders: [
            {
              id: "order-1",
              srNumber: "SR808478",
              psNumber: "PS210206",
              teamshipOrderId: "30202",
              teamshipUrl: "https://app.teamshipos.com/ship-inventories/30202",
              status: "SUCCESS",
              sourceReviewStatus: "PASS",
              plannedFieldUpdateCount: 0,
              plannedPalletRowCount: 1,
              validationIssues: [],
              errorMessage: null,
              agentEvidence: null
            }
          ],
          createdAt: "2026-07-12T12:00:00.000Z",
          approvedAt: null,
          cancelledAt: null,
          agentStartedAt: null,
          agentFinishedAt: null
        }
      ])
    ).toBe("READY_TO_PRINT");
  });

  it("treats Teamship-completed shipments as BOL printed in the workspace", () => {
    const completedRow = sampleWorkspaceRow({
      status: "PASS",
      issueCount: 0,
      teamshipOrder: {
        id: "30202",
        shipment_id: "SR808478",
        shipment_status: "Complete"
      }
    });

    expect(getWorkspaceWorkflowStatus(completedRow, [])).toBe("BOL_PRINTED");
  });
});

function sampleWorkspaceRow(overrides: Partial<WorkspaceRow> = {}): WorkspaceRow {
  return {
    ...baseWorkspaceRow(),
    ...overrides
  };
}

function baseWorkspaceRow(): WorkspaceRow {
  const pdfOrder: GarlandPdfShippingOrder = {
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
    rawText: "NEWLS 2604816191908",
    items: [
      {
        lineNumber: 1,
        sku: "E1SGHMV6XHU3US",
        description: "E1S 208/240/60/1-15 AMP",
        quantity: 1,
        dueShipDate: null,
        serialNumbers: ["2604816191908"]
      }
    ]
  };
  const review: GarlandTeamshipOrderReview = {
    psNumber: "PS210206",
    srNumber: "SR808478",
    pageNumbers: [1],
    status: "PASS",
    teamshipOrderId: "30202",
    teamshipUrl: "https://app.teamshipos.com/ship-inventories/30202",
    issueCount: 0,
    alert: null,
    fields: [
      {
        key: "freight_terms",
        label: "Freight terms",
        status: "MATCH",
        pdfValue: "PPADD-CD",
        teamshipValue: "PPADD-CD",
        message: "Values match."
      }
    ],
    pdfItems: [
      {
        sku: "E1SGHMV6XHU3US",
        quantity: "1",
        serialNumbers: ["2604816191908"]
      }
    ],
    teamshipItems: [
      {
        sku: "E1SGHMV6XHU3US",
        quantity: "1",
        serialNumbers: ["2604816191908"]
      }
    ],
    productDimensions: [
      {
        sku: "E1SGHMV6XHU3US",
        source: "CSR_OVERRIDE",
        productType: null,
        quantity: 1,
        lengthIn: 48,
        widthIn: 40,
        heightIn: 50,
        weightLb: 500,
        weightUnit: "lbs",
        confidence: "HIGH",
        note: "CSR-entered Newl Apps override."
      }
    ]
  };

  return {
    id: "review-SR808478",
    status: review.status,
    psNumber: "PS210206",
    srNumber: "SR808478",
    pdfPages: [1],
    carrier: "MIDLAND",
    shipToName: "J.R. MAHONEY LTD.",
    cityState: "SYDNEY, NS",
    teamshipOrderId: "30202",
    teamshipUrl: "https://app.teamshipos.com/ship-inventories/30202",
    issueCount: review.issueCount,
    review,
    pdfOrder,
    teamshipOrder: null
  };
}
