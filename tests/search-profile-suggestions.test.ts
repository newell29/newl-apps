import { describe, expect, it } from "vitest";

import {
  canonicalizeTradeMiningDestinationPort,
  filterSuggestionOptions,
  isCanadianDestination,
  isTradeMiningCanadianProvinceDestination,
  normalizeSearchProfileValueForWorker,
  tradeMiningCanadianProvinceOptions,
  toTenantSuggestionOptions
} from "@/modules/lead-gen/search-profile-suggestions";

describe("search profile suggestion helpers", () => {
  it("prioritizes starts-with canonical matches and preserves labels", () => {
    const results = filterSuggestionOptions(
      [
        {
          value: "Houston, TX | United States",
          label: "Houston, TX | United States",
          searchText: "Houston TX United States US"
        },
        {
          value: "South Houston, TX | United States",
          label: "South Houston, TX | United States",
          searchText: "South Houston TX United States US"
        },
        {
          value: "Rotterdam | Netherlands",
          label: "Rotterdam | Netherlands",
          searchText: "Rotterdam Netherlands NL"
        }
      ],
      "hou"
    );

    expect(results.map((result) => result.label)).toEqual([
      "Houston, TX | United States",
      "South Houston, TX | United States"
    ]);
  });

  it("normalizes decorated values before sending them to the worker", () => {
    expect(normalizeSearchProfileValueForWorker("destinationMarkets", "Houston, TX | United States")).toBe(
      "Houston, TX | United States"
    );
    expect(normalizeSearchProfileValueForWorker("destinationPorts", "Savannah, GA | United States")).toBe(
      "Savannah, Georgia"
    );
    expect(normalizeSearchProfileValueForWorker("originCountries", "Germany (DE)")).toBe("Germany");
  });

  it("canonicalizes common U.S. port aliases and rejects Canadian cities as arrival ports", () => {
    expect(canonicalizeTradeMiningDestinationPort("Charleston")).toBe("Charleston, South Carolina");
    expect(canonicalizeTradeMiningDestinationPort("Wilmington, NC | United States")).toBe(
      "Wilmington, North Carolina"
    );
    expect(canonicalizeTradeMiningDestinationPort("Toronto | Canada")).toBeNull();
  });

  it("offers canonical Canadian province destinations", () => {
    expect(filterSuggestionOptions(tradeMiningCanadianProvinceOptions, "onta")).toEqual([
      {
        value: "Ontario | Canada",
        label: "Ontario | Canada (province)"
      }
    ]);
  });

  it("distinguishes Canadian provinces from legacy Canadian city values", () => {
    expect(isCanadianDestination("Toronto | Canada")).toBe(true);
    expect(isTradeMiningCanadianProvinceDestination("Ontario | Canada")).toBe(true);
    expect(isTradeMiningCanadianProvinceDestination("Toronto | Canada")).toBe(false);
  });

  it("decorates plain tenant city-state values for display", () => {
    expect(toTenantSuggestionOptions(["Houston, TX"])).toEqual([
      {
        value: "Houston, TX",
        label: "Houston, TX | United States",
        searchText: "Houston, TX United States US"
      }
    ]);
  });
});
