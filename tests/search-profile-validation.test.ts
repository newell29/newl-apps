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

  it("requires a U.S. arrival port even when a consignee market is configured", () => {
    expect(
      validateTradeMiningSearchProfile({
        ...validProfile(),
        destinationPorts: []
      })
    ).toContain("Select at least one supported U.S. destination port.");
  });
});
