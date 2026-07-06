import { describe, expect, it } from "vitest";

import {
  comparePsNumbers,
  extractPsNumberFromText,
  findUnresolvedShipmentPages,
  formatHumanDateFromIso,
  groupDetectedShipmentPages,
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

  it("keeps consecutive multi-page BOLs together when continuation pages have no PS number", () => {
    const grouped = groupDetectedShipmentPages("BOL", [
      { pageNumber: 1, psNumber: "PS100001", detectionMethod: "TEXT", confidence: "HIGH", notes: null },
      { pageNumber: 2, psNumber: null, detectionMethod: "AI", confidence: "LOW", notes: null },
      { pageNumber: 3, psNumber: "PS100005", detectionMethod: "TEXT", confidence: "HIGH", notes: null }
    ]);

    expect(grouped).toHaveLength(2);
    expect(grouped[0].psNumber).toBe("PS100001");
    expect(grouped[0].pages.map((page) => page.pageNumber)).toEqual([1, 2]);
    expect(grouped[0].pages[1].detectionMethod).toBe("INHERITED");
    expect(grouped[1].pages.map((page) => page.pageNumber)).toEqual([3]);
  });

  it("keeps consecutive multi-page pick tickets together when continuation pages have no PS number", () => {
    const grouped = groupDetectedShipmentPages("PICK_TICKET", [
      { pageNumber: 1, psNumber: "PS100001", detectionMethod: "TEXT", confidence: "HIGH", notes: null },
      { pageNumber: 2, psNumber: null, detectionMethod: "AI", confidence: "LOW", notes: null },
      { pageNumber: 3, psNumber: "PS100005", detectionMethod: "TEXT", confidence: "HIGH", notes: null }
    ]);

    expect(grouped).toHaveLength(2);
    expect(grouped[0].pages.map((page) => page.pageNumber)).toEqual([1, 2]);
    expect(grouped[0].pages[1].detectionMethod).toBe("INHERITED");
    expect(grouped[1].pages.map((page) => page.pageNumber)).toEqual([3]);
  });

  it("flags unresolved leading pages that still need a manual PS override", () => {
    const unresolved = findUnresolvedShipmentPages("BOL", [
      { pageNumber: 1, psNumber: null, detectionMethod: "AI", confidence: "LOW", notes: "Pen mark over the first digits." },
      { pageNumber: 2, psNumber: "PS100005", detectionMethod: "TEXT", confidence: "HIGH", notes: null }
    ]);

    expect(unresolved).toHaveLength(1);
    expect(unresolved[0].pageNumber).toBe(1);
    expect(unresolved[0].notes).toContain("Pen mark");
  });
});
