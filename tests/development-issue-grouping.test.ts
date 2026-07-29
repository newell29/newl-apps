import { describe, expect, it } from "vitest";

import {
  getDevelopmentContextPaths,
  groupDevelopmentFeedback,
  isNonActionableDevelopmentFeedback,
  type DevelopmentFeedbackCandidate
} from "@/modules/assistant/development-issue-grouping";

const base = {
  moduleKey: "SHIPMENT_DOCUMENTS",
  workflowKey: "GARLAND_TEAMSHIP_REVIEW",
  classification: "CHECK_RESULT",
  subjectType: "GARLAND_CHECK",
  expectedOutcome: "PASS",
  observedOutcome: "FAIL"
};

describe("development issue grouping", () => {
  it("merges repeated Garland Lot/Serial reports while separating different root-cause themes", () => {
    const candidates: DevelopmentFeedbackCandidate[] = [
      {
        ...base,
        id: "serial-1",
        subjectId: "PS210491",
        reporterStatement: "The Commodity field is missing the Lot/Serial Ref for SKU UCFD36AHC-2-23."
      },
      {
        ...base,
        id: "serial-2",
        subjectId: "PS210492",
        reporterStatement: "Commodity should show SN instead of Qty because the serial reference exists."
      },
      {
        ...base,
        id: "instructions-1",
        subjectId: "PS210491",
        reporterStatement: "The Special Instructions section is incomplete and omitted the CHEMTREC number."
      },
      {
        ...base,
        id: "email-1",
        subjectId: "PS210478",
        reporterStatement: "You missed running this order and I did not receive the email notification."
      }
    ];

    const groups = groupDevelopmentFeedback(candidates);

    expect(groups).toHaveLength(3);
    expect(groups.find((group) => group.issueKey === "GARLAND_LOT_SERIAL_COMMODITY")?.items.map((item) => item.id))
      .toEqual(["serial-1", "serial-2"]);
    expect(groups.find((group) => group.issueKey === "GARLAND_SPECIAL_INSTRUCTIONS")?.items.map((item) => item.id))
      .toEqual(["instructions-1"]);
    expect(groups.find((group) => group.issueKey === "GARLAND_EMAIL_ORDER_PROCESSING")?.items.map((item) => item.id))
      .toEqual(["email-1"]);
  });

  it("normalizes Garland order references before generic similarity grouping", () => {
    const groups = groupDevelopmentFeedback([
      {
        ...base,
        id: "query-1",
        subjectId: "PS210478",
        reporterStatement: "What is the order status of PS210478?"
      },
      {
        ...base,
        id: "query-2",
        subjectId: "PS210491",
        reporterStatement: "What is the order status of PS210491?"
      }
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0].issueKey).toBe("GARLAND_ORDER_STATUS_RESPONSE");
    expect(groups[0].items).toHaveLength(2);
  });

  it("assigns stable Garland issue families to ship-to and comparison regressions", () => {
    const groups = groupDevelopmentFeedback([
      {
        ...base,
        id: "ship-name",
        reporterStatement: "The Ship to name should use the complete First Name value."
      },
      {
        ...base,
        id: "ship-location",
        reporterStatement: "The Ship to city, province, and postal code are missing."
      },
      {
        ...base,
        id: "false-mismatch",
        reporterStatement: "The Commodity field currently displays: SKU: EXAMPLE QTY: 1 It should display: SKU: EXAMPLE QTY: 1",
        observedOutcome: "MISSING",
        expectedOutcome: "PASS"
      }
    ]);

    expect(groups.map((group) => group.issueKey)).toEqual([
      "GARLAND_SHIP_TO_NAME",
      "GARLAND_SHIP_TO_LOCATION",
      "GARLAND_COMPARISON_FALSE_MISMATCH"
    ]);
  });

  it("keeps specific Garland field failures out of the generic false-mismatch family", () => {
    const groups = groupDevelopmentFeedback([
      {
        ...base,
        id: "serial-specific",
        reporterStatement:
          "The Commodity field currently displays: SKU: EXAMPLE QTY: 1 It should display: SKU: EXAMPLE SN: SERIAL123",
        observedOutcome: "MISSING",
        expectedOutcome: "PASS"
      },
      {
        ...base,
        id: "location-specific",
        reporterStatement:
          "The Ship-to city and province currently display: MISSISSAUGA ON It should display: SOURCE CITY QC",
        observedOutcome: "MISSING",
        expectedOutcome: "PASS"
      }
    ]);

    expect(groups.map((group) => group.issueKey)).toEqual([
      "GARLAND_LOT_SERIAL_COMMODITY",
      "GARLAND_SHIP_TO_LOCATION"
    ]);
  });

  it("screens an exact no-change report only when its observed and expected outcomes also match", () => {
    const statement = "The Commodity field currently displays: SKU: EXAMPLE QTY: 1 It should display: SKU: EXAMPLE QTY: 1";

    expect(isNonActionableDevelopmentFeedback({
      ...base,
      id: "no-change",
      reporterStatement: statement,
      observedOutcome: "PASS",
      expectedOutcome: "PASS"
    })).toBe(true);
    expect(isNonActionableDevelopmentFeedback({
      ...base,
      id: "false-mismatch",
      reporterStatement: statement,
      observedOutcome: "MISSING",
      expectedOutcome: "PASS"
    })).toBe(false);
  });

  it("requires the full Garland workflow context before Codex development", () => {
    const paths = getDevelopmentContextPaths("GARLAND_TEAMSHIP_REVIEW");

    expect(paths).toContain("AGENTS.md");
    expect(paths).toContain("docs/customers/garland/overview.md");
    expect(paths).toContain("docs/customers/garland/email-ingestion.md");
    expect(paths).toContain("docs/customers/garland/parsing-rules.md");
    expect(paths).toContain("docs/customers/garland/teamship-workflow.md");
    expect(paths).toContain("docs/modules/shipment-documents/business-rules.md");
  });
});
