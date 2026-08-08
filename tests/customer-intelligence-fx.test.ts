import { CustomerFxRateStatus } from "@prisma/client";
import { describe, expect, it } from "vitest";

import {
  CAD_CONSOLIDATION_DISCLOSURE,
  CAD_CURRENCY,
  FX_SOURCE_BANK_OF_CANADA,
  currentMonthKey,
  fxSourceForMonthKey,
  fxStatusForMonthKey,
  isClosedMonth,
  monthKeyOf,
  roundCurrencyAmount,
  toCadAmount,
  validateMonthKey
} from "@/modules/customer-intelligence/fx";

const FINAL = CustomerFxRateStatus.FINAL;
const PROVISIONAL = CustomerFxRateStatus.PROVISIONAL;

/** A reference "now" pinned to 2026-07-15 UTC so month classification is stable. */
const NOW = new Date(Date.UTC(2026, 6, 15, 12, 0, 0));

describe("monthKeyOf", () => {
  it("formats the deterministic YYYY-MM key in UTC", () => {
    expect(monthKeyOf(new Date(Date.UTC(2026, 0, 5)))).toBe("2026-01");
    expect(monthKeyOf(new Date(Date.UTC(2026, 11, 31)))).toBe("2026-12");
    expect(monthKeyOf(new Date(Date.UTC(2026, 6, 15, 23, 59, 59)))).toBe("2026-07");
  });

  it("uses UTC fields so month boundaries never shift with the runtime timezone", () => {
    // UTC 2026-06-01T00:00 is May 31 in UTC-4/-5; the key must still be 2026-06.
    expect(monthKeyOf(new Date(Date.UTC(2026, 5, 1, 0, 0, 0)))).toBe("2026-06");
  });

  it("derives the current month key from a reference date", () => {
    expect(currentMonthKey(NOW)).toBe("2026-07");
  });
});

describe("validateMonthKey", () => {
  it("accepts YYYY-MM and rejects other shapes", () => {
    expect(validateMonthKey("2026-07")).toBe(true);
    expect(validateMonthKey("2026-1")).toBe(false);
    expect(validateMonthKey("26-07")).toBe(false);
    expect(validateMonthKey("2026/07")).toBe(false);
    expect(validateMonthKey("")).toBe(false);
  });
});

describe("fxStatusForMonthKey (closed months FINAL, current month PROVISIONAL)", () => {
  it("marks every closed month FINAL", () => {
    expect(fxStatusForMonthKey("2026-06", NOW)).toBe(FINAL);
    expect(fxStatusForMonthKey("2025-07", NOW)).toBe(FINAL);
    expect(fxStatusForMonthKey("2024-01", NOW)).toBe(FINAL);
  });

  it("marks the current month PROVISIONAL", () => {
    expect(fxStatusForMonthKey("2026-07", NOW)).toBe(PROVISIONAL);
  });

  it("marks a future month PROVISIONAL (no finalized rate exists for it yet)", () => {
    expect(fxStatusForMonthKey("2026-08", NOW)).toBe(PROVISIONAL);
  });

  it("rejects a malformed month key", () => {
    expect(() => fxStatusForMonthKey("2026-7", NOW)).toThrow(/YYYY-MM/);
    expect(() => fxStatusForMonthKey("", NOW)).toThrow(/YYYY-MM/);
  });
});

describe("fxSourceForMonthKey", () => {
  it("embeds the FINAL/PROVISIONAL classification in the Bank of Canada source label", () => {
    expect(fxSourceForMonthKey("2026-06", NOW)).toBe(`${FX_SOURCE_BANK_OF_CANADA}_FINAL`);
    expect(fxSourceForMonthKey("2026-07", NOW)).toBe(
      `${FX_SOURCE_BANK_OF_CANADA}_PROVISIONAL`
    );
  });
});

describe("isClosedMonth", () => {
  it("is true only for months strictly before the current month", () => {
    expect(isClosedMonth("2026-06", NOW)).toBe(true);
    expect(isClosedMonth("2026-07", NOW)).toBe(false);
    expect(isClosedMonth("2026-08", NOW)).toBe(false);
  });
});

describe("toCadAmount", () => {
  it("converts at the rate and rounds to two decimal places", () => {
    expect(toCadAmount(100, 1.3512)).toBe(135.12);
    expect(toCadAmount(100, 1.3517)).toBe(135.17);
    expect(toCadAmount(0, 1.5)).toBe(0);
    expect(toCadAmount(123.45, 1)).toBe(123.45);
  });

  it("applies standard half-up rounding at the cent", () => {
    expect(toCadAmount(1, 1.005)).toBe(1.01);
    expect(toCadAmount(1, 1.004)).toBe(1.0);
  });

  it("handles negative amounts", () => {
    expect(toCadAmount(-50, 1.5)).toBe(-75);
    expect(toCadAmount(-1, 1.005)).toBe(-1.01);
    expect(toCadAmount(-1, 1.0049)).toBe(-1);
    expect(toCadAmount(-1, 1.0051)).toBe(-1.01);
  });

  it("uses the same symmetric half-up rule for monthly currency rounding", () => {
    expect(roundCurrencyAmount(-1.005)).toBe(-1.01);
    expect(roundCurrencyAmount(-1.0049)).toBe(-1);
    expect(roundCurrencyAmount(-1.0051)).toBe(-1.01);
    expect(roundCurrencyAmount(1.005)).toBe(1.01);
  });
});

describe("CAD consolidation disclosure", () => {
  it("labels CAD consolidation as directional management reporting", () => {
    expect(CAD_CONSOLIDATION_DISCLOSURE).toContain("Directional management reporting");
    expect(CAD_CONSOLIDATION_DISCLOSURE).toContain("not a statutory accounting entry");
    expect(CAD_CURRENCY).toBe("CAD");
  });
});
