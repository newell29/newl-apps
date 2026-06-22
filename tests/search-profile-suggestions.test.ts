import { describe, expect, it } from "vitest";

import {
  filterSuggestionOptions,
  normalizeSearchProfileValueForWorker,
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
      "Houston, TX"
    );
    expect(normalizeSearchProfileValueForWorker("destinationPorts", "Savannah, GA | United States")).toBe(
      "Savannah, GA"
    );
    expect(normalizeSearchProfileValueForWorker("originCountries", "Germany (DE)")).toBe("Germany");
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
