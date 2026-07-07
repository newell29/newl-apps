import { OceanRateStatus } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { getComputedOceanRateStatus } from "@/modules/ocean-freight-pricing/queries";

describe("ocean freight pricing status", () => {
  const today = new Date("2026-07-07T12:00:00.000Z");

  it("treats active rates with past validity end as expired at query time", () => {
    expect(getComputedOceanRateStatus({ status: OceanRateStatus.ACTIVE, validityStartDate: null, validityEndDate: new Date("2026-07-06T00:00:00.000Z") }, today)).toBe(OceanRateStatus.EXPIRED);
  });

  it("keeps inactive rates inactive regardless of validity", () => {
    expect(getComputedOceanRateStatus({ status: OceanRateStatus.INACTIVE, validityStartDate: null, validityEndDate: new Date("2026-07-30T00:00:00.000Z") }, today)).toBe(OceanRateStatus.INACTIVE);
  });

  it("labels missing validity as needing validity", () => {
    expect(getComputedOceanRateStatus({ status: OceanRateStatus.ACTIVE, validityStartDate: null, validityEndDate: null }, today)).toBe("NEEDS_VALIDITY");
  });
});
