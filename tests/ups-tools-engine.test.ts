import { describe, expect, it } from "vitest";
import { estimateQuote, inferCountryFromPostalCode, inferProvinceFromPostalCode } from "@/modules/ups-tools/engine";
import type { UpsAccountConfig } from "@/modules/ups-tools/types";

const charlotteAccount: UpsAccountConfig = {
  id: "ups-us-1",
  name: "Charlotte Dry Run Account",
  status: "ACTIVE",
  countryCode: "US",
  shipperNumber: "G460D6",
  originPostalCode: "28273",
  originLabel: "Charlotte, NC",
  dryRun: true,
  secretConfigured: false,
  toolTargets: []
};

describe("UPS tools dry-run engine", () => {
  it("infers country and province from postal formats", () => {
    expect(inferCountryFromPostalCode("10001")).toBe("US");
    expect(inferCountryFromPostalCode("M5H2N2")).toBe("CA");
    expect(inferProvinceFromPostalCode("M5H2N2")).toBe("ON");
  });

  it("returns negotiated and taxed totals for Canadian destinations", () => {
    const quote = estimateQuote(charlotteAccount, {
      originPostalCode: "28273",
      originCountryCode: "US",
      destinationPostalCode: "M5H2N2",
      destinationCountryCode: "CA",
      weight: 10,
      length: 12,
      width: 8,
      height: 4,
      service: "Ground",
      isResidential: false
    });

    expect(quote.negotiatedRate).toBeLessThan(quote.standardRate);
    expect(quote.taxAmount).toBeGreaterThan(0);
    expect(quote.totalWithTax).toBeCloseTo(quote.negotiatedRate + quote.taxAmount, 2);
    expect(quote.destinationProvince).toBe("ON");
    expect(quote.mode).toBe("dry-run");
  });

  it("applies dimensional weight and faster transit to express services", () => {
    const ground = estimateQuote(charlotteAccount, {
      originPostalCode: "28273",
      originCountryCode: "US",
      destinationPostalCode: "90001",
      destinationCountryCode: "US",
      weight: 8,
      length: 24,
      width: 20,
      height: 18,
      service: "Ground",
      isResidential: true
    });

    const nextDay = estimateQuote(charlotteAccount, {
      ...ground,
      service: "Next Day Air"
    });

    expect(ground.billableWeight).toBeGreaterThan(ground.weight);
    expect(nextDay.transitDays).toBeLessThanOrEqual(ground.transitDays);
    expect(nextDay.standardRate).toBeGreaterThan(ground.standardRate);
  });
});
