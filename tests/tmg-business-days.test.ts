import { describe, expect, it } from "vitest";

import { getNextTmgPickupDate } from "@/modules/shipment-documents/tmg-business-days";

describe("TMG pickup ETA business-day calculation", () => {
  it.each([
    ["2026-08-27T16:09:28.000Z", "2026-08-28", "ordinary weekday"],
    ["2026-08-28T16:09:28.000Z", "2026-08-31", "weekend"],
    ["2026-09-04T16:09:28.000Z", "2026-09-08", "Labor Day"],
    ["2026-11-25T16:09:28.000Z", "2026-11-27", "Thanksgiving"],
    ["2026-12-31T16:09:28.000Z", "2027-01-04", "New Year and weekend"],
    ["2027-07-02T16:09:28.000Z", "2027-07-06", "observed Independence Day"]
  ])("returns %s as %s across %s", (receivedAt, expected) => {
    expect(getNextTmgPickupDate(new Date(receivedAt))).toBe(expected);
  });

  it("uses the US Eastern calendar date for a late UTC receipt", () => {
    expect(getNextTmgPickupDate(new Date("2026-08-28T02:00:00.000Z"))).toBe("2026-08-28");
  });
});
