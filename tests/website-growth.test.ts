import { generateKeyPairSync } from "node:crypto";

import { WebsiteGrowthAction } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { parseDelimitedRows, readNumber, readString } from "@/modules/website-growth/csv";
import { fetchSearchConsoleRows, getWebsiteGrowthIntegrationStatus } from "@/modules/website-growth/integrations";
import { buildOpportunityCandidate } from "@/modules/website-growth/opportunities";

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
    expect(rows[0]?.keys?.[0]).toBe("warehouse logistics");
  });
});
