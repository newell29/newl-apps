import { generateKeyPairSync } from "node:crypto";

import { WebsiteGrowthAction } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { parseDelimitedRows, readNumber, readString } from "@/modules/website-growth/csv";
import {
  fetchSearchConsoleRows,
  getWebsiteGrowthIntegrationStatus,
  normalizeSearchConsoleSiteUrl
} from "@/modules/website-growth/integrations";
import {
  buildOpportunityCandidate,
  qualifyOpportunityCandidates,
  weeklyContentRecommendations
} from "@/modules/website-growth/opportunities";

describe("website growth CSV parsing", () => {
  it("normalizes Search Console export rows", () => {
    const rows = parseDelimitedRows(`Top queries\tClicks\tImpressions\tCTR\tPosition
"warehouse logistics"\t10\t1,200\t2.5%\t8.4`);

    expect(rows).toHaveLength(1);
    expect(readString(rows[0], ["top queries"])).toBe("warehouse logistics");
    expect(readNumber(rows[0], ["clicks"])).toBe(10);
    expect(readNumber(rows[0], ["impressions"])).toBe(1200);
    expect(readNumber(rows[0], ["ctr"])).toBe(2.5);
    expect(readNumber(rows[0], ["position"])).toBe(8.4);
  });
});

describe("website growth opportunity scoring", () => {
  it("prioritizes improving existing lead-producing pages", () => {
    const candidate = buildOpportunityCandidate({
      topic: "GTA local trucking",
      targetPage: "https://www.newlgroup.com/freight/gta-local-trucking",
      leadCount: 2,
      impressions: 50,
      clicks: 5,
      position: 6
    });

    expect(candidate.action).toBe(WebsiteGrowthAction.IMPROVE_EXISTING_PAGE);
    expect(candidate.score).toBeGreaterThanOrEqual(45);
    expect(candidate.recommendation).toContain("Improve");
  });

  it("routes informational logistics topics to resource articles", () => {
    const candidate = buildOpportunityCandidate({
      topic: "what is demurrage",
      impressions: 300,
      clicks: 0,
      position: 18
    });

    expect(candidate.action).toBe(WebsiteGrowthAction.CREATE_RESOURCE_ARTICLE);
    expect(candidate.recommendation).toContain("resource article");
  });

  it("filters weak Search Console rows out of the qualified queue", () => {
    const result = qualifyOpportunityCandidates([
      buildOpportunityCandidate({
        topic: "random tracking number",
        impressions: 3,
        clicks: 0,
        position: 71,
        source: "google_search_console_api"
      })
    ]);

    expect(result.rawCount).toBe(1);
    expect(result.qualified).toHaveLength(0);
    expect(result.skippedCount).toBe(1);
  });

  it("clusters related Search Console rows into one qualified opportunity", () => {
    const result = qualifyOpportunityCandidates([
      buildOpportunityCandidate({
        topic: "gta local trucking",
        primaryKeyword: "gta local trucking",
        targetPage: "https://www.newlgroup.com/freight/gta-local-trucking",
        impressions: 90,
        clicks: 2,
        position: 14,
        source: "google_search_console_api"
      }),
      buildOpportunityCandidate({
        topic: "local trucking gta",
        primaryKeyword: "local trucking gta",
        targetPage: "https://www.newlgroup.com/freight/gta-local-trucking",
        impressions: 70,
        clicks: 1,
        position: 18,
        source: "google_search_console_api"
      })
    ]);

    expect(result.rawCount).toBe(2);
    expect(result.qualified).toHaveLength(1);
    expect(result.qualified[0]?.evidence.impressions).toBe(160);
    expect(result.qualified[0]?.supportingKeywords).toEqual(["gta local trucking", "local trucking gta"]);
  });
});

describe("website growth weekly planning lanes", () => {
  it("offers a balanced weekly approval slate across the three content types", () => {
    expect(weeklyContentRecommendations).toHaveLength(3);
    expect(weeklyContentRecommendations.map((lane) => lane.lane)).toEqual([
      "CORE_PAGE",
      "SUPPORTING_CONTENT",
      "QUICK_OPTIMIZATION"
    ]);
    expect(weeklyContentRecommendations.map((lane) => lane.publishLimit)).toEqual([2, 4, 6]);
  });

  it("routes each Website Growth action into no more than one weekly lane", () => {
    const actionCounts = new Map<WebsiteGrowthAction, number>();

    for (const lane of weeklyContentRecommendations) {
      for (const action of lane.actions) {
        actionCounts.set(action, (actionCounts.get(action) ?? 0) + 1);
      }
    }

    for (const count of actionCounts.values()) {
      expect(count).toBe(1);
    }
  });
});

describe("website growth integrations", () => {
  it("detects missing Search Console and GA4 configuration", () => {
    const status = getWebsiteGrowthIntegrationStatus({});

    expect(status.googleSearchConsole.configured).toBe(false);
    expect(status.googleSearchConsole.mode).toBe("not_configured");
    expect(status.ga4.configured).toBe(false);
  });

  it("detects Search Console OAuth credentials", () => {
    const status = getWebsiteGrowthIntegrationStatus({
      GOOGLE_SEARCH_CONSOLE_CLIENT_ID: "client",
      GOOGLE_SEARCH_CONSOLE_CLIENT_SECRET: "secret",
      GOOGLE_SEARCH_CONSOLE_REFRESH_TOKEN: "refresh",
      GOOGLE_SEARCH_CONSOLE_SITE_URL: "sc-domain:newlgroup.com"
    });

    expect(status.googleSearchConsole.configured).toBe(true);
    expect(status.googleSearchConsole.mode).toBe("oauth");
  });

  it("normalizes bare Search Console domains to domain properties", () => {
    expect(normalizeSearchConsoleSiteUrl("newlgroup.com")).toBe("sc-domain:newlgroup.com");
    expect(normalizeSearchConsoleSiteUrl("www.newlgroup.com")).toBe("sc-domain:newlgroup.com");
    expect(normalizeSearchConsoleSiteUrl("sc-domain:newlgroup.com")).toBe("sc-domain:newlgroup.com");
    expect(normalizeSearchConsoleSiteUrl("https://www.newlgroup.com/")).toBe("https://www.newlgroup.com/");
  });

  it("prefers Search Console service-account credentials when both credential sets exist", () => {
    const status = getWebsiteGrowthIntegrationStatus({
      GOOGLE_SEARCH_CONSOLE_CLIENT_ID: "client",
      GOOGLE_SEARCH_CONSOLE_CLIENT_SECRET: "secret",
      GOOGLE_SEARCH_CONSOLE_REFRESH_TOKEN: "refresh",
      GOOGLE_SEARCH_CONSOLE_SERVICE_ACCOUNT_EMAIL: "service-account@example.iam.gserviceaccount.com",
      GOOGLE_SEARCH_CONSOLE_PRIVATE_KEY: "private-key",
      GOOGLE_SEARCH_CONSOLE_SITE_URL: "newlgroup.com"
    });

    expect(status.googleSearchConsole.configured).toBe(true);
    expect(status.googleSearchConsole.mode).toBe("service_account");
    expect(status.googleSearchConsole.siteUrl).toBe("sc-domain:newlgroup.com");
  });

  it("reports only missing service-account fields once service-account setup has started", () => {
    const status = getWebsiteGrowthIntegrationStatus({
      GOOGLE_SEARCH_CONSOLE_SITE_URL: "sc-domain:newlgroup.com",
      GOOGLE_SEARCH_CONSOLE_SERVICE_ACCOUNT_EMAIL: "service-account@example.iam.gserviceaccount.com"
    });

    expect(status.googleSearchConsole.configured).toBe(false);
    expect(status.googleSearchConsole.mode).toBe("not_configured");
    expect(status.googleSearchConsole.missing).toEqual(["GOOGLE_SEARCH_CONSOLE_PRIVATE_KEY"]);
  });

  it("reports only missing OAuth fields once OAuth setup has started", () => {
    const status = getWebsiteGrowthIntegrationStatus({
      GOOGLE_SEARCH_CONSOLE_SITE_URL: "sc-domain:newlgroup.com",
      GOOGLE_SEARCH_CONSOLE_CLIENT_ID: "client"
    });

    expect(status.googleSearchConsole.configured).toBe(false);
    expect(status.googleSearchConsole.mode).toBe("not_configured");
    expect(status.googleSearchConsole.missing).toEqual([
      "GOOGLE_SEARCH_CONSOLE_CLIENT_SECRET",
      "GOOGLE_SEARCH_CONSOLE_REFRESH_TOKEN"
    ]);
  });

  it("fetches Search Console rows with service-account credentials", async () => {
    const { privateKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      privateKeyEncoding: {
        format: "pem",
        type: "pkcs8"
      },
      publicKeyEncoding: {
        format: "pem",
        type: "spki"
      }
    });
    const fetcher = vi.fn(async (url: string | URL | Request) => {
      const target = String(url);

      if (target.includes("oauth2.googleapis.com/token")) {
        return new Response(JSON.stringify({ access_token: "access-token" }), { status: 200 });
      }

      return new Response(
        JSON.stringify({
          rows: [
            {
              keys: ["warehouse logistics", "https://www.newlgroup.com/services/warehousing-services"],
              clicks: 4,
              impressions: 400,
              ctr: 0.01,
              position: 9.1
            }
          ]
        }),
        { status: 200 }
      );
    });

    const rows = await fetchSearchConsoleRows({
      env: {
        GOOGLE_SEARCH_CONSOLE_SERVICE_ACCOUNT_EMAIL: "service-account@example.iam.gserviceaccount.com",
        GOOGLE_SEARCH_CONSOLE_PRIVATE_KEY: privateKey,
        GOOGLE_SEARCH_CONSOLE_SITE_URL: "sc-domain:newlgroup.com"
      },
      fetcher: fetcher as unknown as typeof fetch,
      startDate: "2026-07-01",
      endDate: "2026-07-09",
      dimensions: ["query", "page"]
    });

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(String(fetcher.mock.calls[1]?.[0])).toContain("sc-domain%3Anewlgroup.com");
    expect(rows[0]?.keys?.[0]).toBe("warehouse logistics");
  });

  it("fetches Search Console rows with a bare domain value", async () => {
    const { privateKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      privateKeyEncoding: {
        format: "pem",
        type: "pkcs8"
      },
      publicKeyEncoding: {
        format: "pem",
        type: "spki"
      }
    });
    const fetcher = vi.fn(async (url: string | URL | Request) => {
      const target = String(url);

      if (target.includes("oauth2.googleapis.com/token")) {
        return new Response(JSON.stringify({ access_token: "access-token" }), { status: 200 });
      }

      return new Response(JSON.stringify({ rows: [] }), { status: 200 });
    });

    await fetchSearchConsoleRows({
      env: {
        GOOGLE_SEARCH_CONSOLE_SERVICE_ACCOUNT_EMAIL: "service-account@example.iam.gserviceaccount.com",
        GOOGLE_SEARCH_CONSOLE_PRIVATE_KEY: privateKey,
        GOOGLE_SEARCH_CONSOLE_SITE_URL: "newlgroup.com"
      },
      fetcher: fetcher as unknown as typeof fetch,
      startDate: "2026-07-01",
      endDate: "2026-07-09",
      dimensions: ["query", "page"]
    });

    expect(String(fetcher.mock.calls[1]?.[0])).toContain("sc-domain%3Anewlgroup.com");
  });
});
