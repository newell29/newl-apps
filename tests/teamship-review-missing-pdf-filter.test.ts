import { describe, expect, it } from "vitest";

import { rowMatchesWorkspaceFilters } from "@/modules/shipment-documents/components/garland-teamship-review-client";

describe("Garland Teamship missing PDF workspace filter", () => {
  it("includes Teamship-pulled shipments that do not have a matched Garland PDF", () => {
    const pulledTeamshipRow = {
      id: "teamship-SR808478",
      status: "TEAMSHIP_PULLED",
      psNumber: "PS210206",
      srNumber: "SR808478",
      pdfPages: [],
      carrier: "MIDLAND",
      shipToName: "J.R. MAHONEY LTD.",
      cityState: "SYDNEY, NS",
      teamshipOrderId: "30202",
      teamshipUrl: "https://app.teamshipos.com/ship-inventories/30202",
      issueCount: 0,
      review: null,
      pdfOrder: null,
      teamshipOrder: {}
    };

    expect(
      rowMatchesWorkspaceFilters({ row: pulledTeamshipRow as never, search: "", filter: "NO_PDF", workflowStatus: "NEEDS_REVIEW" })
    ).toBe(true);
  });

  it("excludes matched Garland PDF shipments from the missing PDF filter", () => {
    const matchedPdfRow = {
      id: "review-SR808478",
      status: "PASS",
      psNumber: "PS210206",
      srNumber: "SR808478",
      pdfPages: [1],
      carrier: "MIDLAND",
      shipToName: "J.R. MAHONEY LTD.",
      cityState: "SYDNEY, NS",
      teamshipOrderId: "30202",
      teamshipUrl: "https://app.teamshipos.com/ship-inventories/30202",
      issueCount: 0,
      review: {},
      pdfOrder: {},
      teamshipOrder: {}
    };

    expect(
      rowMatchesWorkspaceFilters({ row: matchedPdfRow as never, search: "", filter: "NO_PDF", workflowStatus: "NEEDS_SETUP" })
    ).toBe(false);
  });
});
