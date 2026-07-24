import { describe, expect, it } from "vitest";

import { validateTradeMiningSearchProfile } from "@/modules/lead-gen/search-profile-validation";

function validProfile() {
  return {
    name: "Canadian consignee leads",
    destinationMarkets: ["Toronto | Canada"],
    destinationPorts: ["Charleston, South Carolina"],
    lookbackWindowDays: 120,
    minShipmentCount: 1,
    minShipmentVolume: 1,
    priorityWeight: 80,
    allowedCompanyIdentityRoles: ["consignee_name" as const]
  };
}

describe("TradeMining search profile validation", () => {
  it("accepts Canadian consignee markets when a supported U.S. arrival port is selected", () => {
    expect(validateTradeMiningSearchProfile(validProfile())).toEqual([]);
  });

  it("rejects a Canadian city entered as a U.S. arrival port", () => {
    expect(
      validateTradeMiningSearchProfile({
        ...validProfile(),
        destinationPorts: ["Toronto"]
      })
    ).toContain("Unsupported TradeMining destination ports: Toronto.");
  });

  it("accepts a city-only Canadian profile without a U.S. arrival port", () => {
    expect(
      validateTradeMiningSearchProfile({
        ...validProfile(),
        destinationPorts: []
      })
    ).toEqual([]);
  });

  it("validates aggregate TEU and industry-pack modes independently", () => {
    expect(
      validateTradeMiningSearchProfile({
        ...validProfile(),
        minAggregateTeu: -1,
        industryPackIds: [],
        industryFilterMode: "HARD"
      })
    ).toEqual(
      expect.arrayContaining([
        "Minimum aggregate TEUs during the lookback must be zero or greater when provided.",
        "Select at least one industry pack for hard or exclude mode."
      ])
    );
  });
});
