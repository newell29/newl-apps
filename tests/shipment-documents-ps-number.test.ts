import { describe, expect, it } from "vitest";

import {
  comparePsNumbers,
  extractPsNumberFromText,
  formatHumanDateFromIso,
  normalizePsNumber,
  sanitizeLabelForFilename
} from "@/modules/shipment-documents/ps-number";

describe("shipment document PS helpers", () => {
  it("extracts a PS number from BOL-style and pick-ticket-style text", () => {
    expect(extractPsNumberFromText("REFERENCES: PS209606-SR810036 - SR810036")).toBe("PS209606");
    expect(extractPsNumberFromText("Pre-Shipper PS209606 Print Date 6/17/2026")).toBe("PS209606");
  });

  it("normalizes PS numbers into a stable sortable format", () => {
    expect(normalizePsNumber("ps 209606")).toBe("PS209606");
    expect(normalizePsNumber("PS-209606")).toBe("PS209606");
    expect(normalizePsNumber("not-a-ps")).toBeNull();
  });

  it("compares PS numbers by their numeric suffix", () => {
    expect(comparePsNumbers("PS100001", "PS100005")).toBeLessThan(0);
    expect(comparePsNumbers("PS100005", "PS100001")).toBeGreaterThan(0);
    expect(comparePsNumbers("PS100005", "PS100005")).toBe(0);
  });

  it("formats and sanitizes document labels for filenames", () => {
    expect(formatHumanDateFromIso("2026-06-26")).toContain("2026");
    expect(sanitizeLabelForFilename("June 26 / 2026")).toBe("June 26 2026");
  });
});
