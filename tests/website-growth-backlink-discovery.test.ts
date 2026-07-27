import { describe, expect, it } from "vitest";

import {
  BACKLINK_DISCOVERY_DOMAIN_LIMIT,
  BACKLINK_DISCOVERY_QUERY_LIMIT,
  BACKLINK_DISCOVERY_RESULT_LIMIT,
  buildWebsiteGrowthBacklinkDiscoveryQueries,
  buildWebsiteGrowthDiscoveryUrlHash,
  canonicalizeWebsiteGrowthDiscoveryUrl,
  selectNewWebsiteGrowthDiscoveryCandidates
} from "@/modules/website-growth/backlink-discovery";

describe("Website Growth bounded backlink discovery", () => {
  it("rotates twelve bounded queries instead of repeating the same weekly plan", () => {
    const first = buildWebsiteGrowthBacklinkDiscoveryQueries(
      new Date("2026-07-27T12:00:00.000Z")
    );
    const second = buildWebsiteGrowthBacklinkDiscoveryQueries(
      new Date("2026-08-03T12:00:00.000Z")
    );

    expect(first.queries).toHaveLength(BACKLINK_DISCOVERY_QUERY_LIMIT);
    expect(second.queries).toHaveLength(BACKLINK_DISCOVERY_QUERY_LIMIT);
    expect(second.rotation).not.toBe(first.rotation);
    expect(second.queries).not.toEqual(first.queries);
  });

  it("canonicalizes tracking variants into the same persistent URL identity", () => {
    const left = canonicalizeWebsiteGrowthDiscoveryUrl(
      "https://www.Example.org/resources/?utm_source=scout&b=2&a=1#details"
    );
    const right = canonicalizeWebsiteGrowthDiscoveryUrl(
      "https://example.org/resources?a=1&b=2"
    );

    expect(left).toBe(right);
    expect(left && buildWebsiteGrowthDiscoveryUrlHash(left)).toBe(
      right && buildWebsiteGrowthDiscoveryUrlHash(right)
    );
  });

  it("never returns a historically seen canonical URL for another page fetch", () => {
    const canonical = canonicalizeWebsiteGrowthDiscoveryUrl(
      "https://example.org/contribute"
    );
    expect(canonical).toBeTruthy();
    const historicalHashes = new Set([
      buildWebsiteGrowthDiscoveryUrlHash(canonical!)
    ]);
    const selection = selectNewWebsiteGrowthDiscoveryCandidates({
      historicalHashes,
      results: [
        result("https://www.example.org/contribute/?utm_campaign=weekly"),
        result("https://publisher.example/editorial")
      ]
    });

    expect(selection.ledger).toHaveLength(2);
    expect(selection.candidates.map((item) => item.sourceDomain)).toEqual([
      "publisher.example"
    ]);
    expect(selection.duplicatesSkipped).toBe(1);
  });

  it("deduplicates across queries and enforces the unique-domain ceiling", () => {
    const results = Array.from(
      { length: BACKLINK_DISCOVERY_DOMAIN_LIMIT + 5 },
      (_, index) => result(`https://publisher-${index}.example/contribute`)
    );
    results.push(result("https://publisher-0.example/contribute?utm_source=other-query"));
    const selection = selectNewWebsiteGrowthDiscoveryCandidates({
      historicalHashes: new Set(),
      results
    });

    expect(selection.candidates).toHaveLength(BACKLINK_DISCOVERY_DOMAIN_LIMIT);
    expect(selection.uniqueDomainCount).toBe(BACKLINK_DISCOVERY_DOMAIN_LIMIT);
    expect(selection.domainLimitSkipped).toBe(5);
    expect(selection.duplicatesSkipped).toBe(1);
  });

  it("rejects an unbounded search response", () => {
    expect(() =>
      selectNewWebsiteGrowthDiscoveryCandidates({
        historicalHashes: new Set(),
        results: Array.from(
          { length: BACKLINK_DISCOVERY_RESULT_LIMIT + 1 },
          (_, index) => result(`https://publisher-${index}.example/path`)
        )
      })
    ).toThrow("at most");
  });
});

function result(url: string) {
  return {
    queryLane: "EDITORIAL",
    queryText: "\"supply chain\" \"write for us\"",
    url,
    title: "Contributor information",
    snippet: "A public page describing editorial contribution options.",
    publishedAt: null
  };
}
