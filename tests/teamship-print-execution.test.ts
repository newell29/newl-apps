import { describe, expect, it } from "vitest";

import {
  resolveExactPrinterOption,
  resolveTeamshipPrintAppBaseUrl
} from "@/modules/teamship/print-execution";

describe("Teamship print execution safeguards", () => {
  it("opens the documented shipping-order detail host when no override is configured", () => {
    expect(resolveTeamshipPrintAppBaseUrl(undefined).origin).toBe("https://members.fulfillit.io");
    expect(resolveTeamshipPrintAppBaseUrl("  https://app.teamshipos.com  ").origin)
      .toBe("https://app.teamshipos.com");
  });

  it("selects only the corrected exact BIXOLON printer and returns its current page value", () => {
    expect(resolveExactPrinterOption([[
      { label: "BIXOLON SRP-770III - BPL-Z", value: "old-printer-id" },
      { label: "BIXOLON SRP-770III", value: "current-printer-id" }
    ]], "BIXOLON SRP-770III")).toEqual({
      selectIndex: 0,
      value: "current-printer-id"
    });
  });

  it("fails closed when the exact printer is absent or duplicated", () => {
    expect(() => resolveExactPrinterOption([[
      { label: "BIXOLON SRP-770III - BPL-Z", value: "wrong" }
    ]], "BIXOLON SRP-770III")).toThrow(/not available/i);
    expect(() => resolveExactPrinterOption([
      [{ label: "BIXOLON SRP-770III", value: "one" }],
      [{ label: "BIXOLON SRP-770III", value: "two" }]
    ], "BIXOLON SRP-770III")).toThrow(/more than one visible control/i);
  });
});
