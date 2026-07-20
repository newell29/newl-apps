import { generateKeyPairSync } from "node:crypto";

import { WebsiteGrowthAction, type Prisma, type WebsiteGrowthOpportunity } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import {
  buildWebsiteGrowthBuildPackage,
  mergeBuildPackageIntoDraftJson,
  readWebsiteGrowthBuildPackage
} from "@/modules/website-growth/build-package";
import { parseDelimitedRows, readNumber, readString } from "@/modules/website-growth/csv";
import { buildTemplateWebsiteGrowthContentDraft } from "@/modules/website-growth/content-drafts";
import {
  createWebsiteGrowthPullRequestPackage,
  getWebsiteGrowthGitHubPrStatus
} from "@/modules/website-growth/github-pr";
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
import { selectWeeklyWebsiteGrowthCandidates } from "@/modules/website-growth/weekly-plan";

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

  it("classifies legacy redirected 3PL URLs as draft-first page rebuilds", () => {
    const candidate = buildOpportunityCandidate({
      topic: "nationwide 3pl companies",
      primaryKeyword: "nationwide 3pl companies",
      targetPage: "https://www.newlgroup.com/top-3pl-companies-in-usa/",
      sourcePage: "https://www.newlgroup.com/top-3pl-companies-in-usa/",
      impressions: 100,
      clicks: 0,
      position: 12,
      source: "google_search_console_api"
    });

    expect(candidate.action).toBe(WebsiteGrowthAction.CREATE_PAGE);
    expect(candidate.targetPage).toBe("https://www.newlgroup.com/top-3pl-companies-in-usa");
    expect(candidate.evidence.legacyRebuild).toBe(true);
    expect(candidate.recommendation).toContain("dedicated draft page");
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

  it("selects only one prepared item per target page and weekly lane", () => {
    const candidates = [
      weeklyCandidate({
        id: "nationwide",
        action: WebsiteGrowthAction.CREATE_PAGE,
        topic: "nationwide 3pl companies",
        targetPage: "https://www.newlgroup.com/top-3pl-companies-in-usa/",
        score: 42
      }),
      weeklyCandidate({
        id: "top-provider",
        action: WebsiteGrowthAction.CREATE_PAGE,
        topic: "top 3pl provider",
        targetPage: "https://www.newlgroup.com/top-3pl-companies-in-usa/",
        score: 42
      }),
      weeklyCandidate({
        id: "resource",
        action: WebsiteGrowthAction.CREATE_RESOURCE_ARTICLE,
        topic: "what is demurrage",
        targetPage: null,
        score: 60
      })
    ];

    const result = selectWeeklyWebsiteGrowthCandidates(candidates);

    expect(result.selected.map((candidate) => candidate.id)).toEqual(["nationwide", "resource"]);
    expect(result.laneCounts.CORE_PAGE).toBe(1);
  });
});

function weeklyCandidate({
  id,
  action,
  topic,
  targetPage,
  score
}: {
  id: string;
  action: WebsiteGrowthAction;
  topic: string;
  targetPage: string | null;
  score: number;
}) {
  return {
    id,
    action,
    topic,
    targetPage,
    sourcePage: targetPage,
    score,
    updatedAt: new Date("2026-07-15T12:00:00Z")
  } as WebsiteGrowthOpportunity;
}

describe("website growth content draft packages", () => {
  it("builds a resource article proposal for informational opportunities", () => {
    const draft = buildTemplateWebsiteGrowthContentDraft({
      action: WebsiteGrowthAction.CREATE_RESOURCE_ARTICLE,
      topic: "what is demurrage",
      primaryKeyword: "what is demurrage",
      targetPage: null,
      sourcePage: null,
      score: 65,
      confidence: "Medium",
      reason: "300 impressions, 0 clicks, average position 18.0",
      recommendation: "Create a resource article or glossary page for what is demurrage and link it to commercial pages.",
      supportingKeywords: ["demurrage meaning", "demurrage charges"],
      evidence: {
        impressions: 300,
        clicks: 0,
        position: 18
      }
    });

    expect(draft.contentType).toBe("Resource article");
    expect(draft.proposedPath).toBe("/resources/what-is-demurrage");
    expect(draft.sections.length).toBeGreaterThanOrEqual(3);
    expect(draft.reviewChecklist).toContain("Does the title match the search intent?");
  });

  it("keeps existing page improvement proposals attached to the current URL", () => {
    const draft = buildTemplateWebsiteGrowthContentDraft({
      action: WebsiteGrowthAction.IMPROVE_EXISTING_PAGE,
      topic: "gta local trucking",
      primaryKeyword: "gta local trucking",
      targetPage: "https://www.newlgroup.com/freight/gta-local-trucking",
      sourcePage: "https://www.newlgroup.com/freight/gta-local-trucking",
      score: 70,
      confidence: "High",
      reason: "90 impressions, 2 clicks, 1 related leads, mapped to https://www.newlgroup.com/freight/gta-local-trucking",
      recommendation: "Improve the existing page with stronger copy, FAQs, internal links, and clearer conversion path.",
      supportingKeywords: [],
      evidence: {
        leadCount: 1
      }
    });

    expect(draft.contentType).toBe("Existing page improvement");
    expect(draft.proposedPath).toBe("/freight/gta-local-trucking");
    expect(draft.implementationNotes[0]).toContain("/freight/gta-local-trucking");
  });

  it("keeps legacy rebuild draft packages on the proposed legacy URL", () => {
    const draft = buildTemplateWebsiteGrowthContentDraft({
      action: WebsiteGrowthAction.CREATE_PAGE,
      topic: "top 3PL companies in the USA",
      primaryKeyword: "top 3pl companies in usa",
      targetPage: "https://www.newlgroup.com/top-3pl-companies-in-usa",
      sourcePage: "https://www.newlgroup.com/locations/charlotte-warehousing",
      score: 70,
      confidence: "Medium",
      reason: "100 impressions, 0 clicks, average position 12.0, legacy URL /top-3pl-companies-in-usa currently redirects to /locations/charlotte-warehousing",
      recommendation: "Build a dedicated draft page for top 3PL companies in the USA at /top-3pl-companies-in-usa.",
      supportingKeywords: ["top 3pl companies in usa", "nationwide 3pl companies"],
      evidence: {
        legacyRebuild: true,
        legacyRebuildKey: "top-3pl-companies-in-usa"
      }
    });

    expect(draft.contentType).toBe("New commercial page");
    expect(draft.proposedPath).toBe("/top-3pl-companies-in-usa");
    expect(draft.implementationNotes.some((note) => note.includes("currently redirects"))).toBe(true);
  });

  it("turns an approved legacy rebuild draft into a PR-ready build package", () => {
    const draft = buildTemplateWebsiteGrowthContentDraft({
      action: WebsiteGrowthAction.CREATE_PAGE,
      topic: "top 3PL companies in the USA",
      primaryKeyword: "top 3pl companies in usa",
      targetPage: "https://www.newlgroup.com/top-3pl-companies-in-usa",
      sourcePage: "https://www.newlgroup.com/locations/charlotte-warehousing",
      score: 70,
      confidence: "Medium",
      reason:
        "100 impressions, 0 clicks, average position 12.0, legacy URL /top-3pl-companies-in-usa currently redirects to /locations/charlotte-warehousing",
      recommendation: "Build a dedicated draft page for top 3PL companies in the USA at /top-3pl-companies-in-usa.",
      supportingKeywords: ["top 3pl companies in usa", "nationwide 3pl companies"],
      evidence: {
        legacyRebuild: true,
        legacyRebuildKey: "top-3pl-companies-in-usa"
      }
    });

    const buildPackage = buildWebsiteGrowthBuildPackage({
      id: "draft_1",
      opportunityId: "opportunity_1",
      title: draft.title,
      contentType: draft.contentType,
      proposedPath: draft.proposedPath,
      targetPage: "https://www.newlgroup.com/top-3pl-companies-in-usa",
      draftJson: draft as unknown as Prisma.JsonValue,
      opportunity: {
        action: WebsiteGrowthAction.CREATE_PAGE,
        topic: "top 3PL companies in the USA",
        targetPage: "https://www.newlgroup.com/top-3pl-companies-in-usa",
        sourcePage: "https://www.newlgroup.com/locations/charlotte-warehousing"
      }
    });
    const merged = mergeBuildPackageIntoDraftJson(draft as unknown as Prisma.JsonValue, buildPackage);
    const savedPackage = readWebsiteGrowthBuildPackage(merged);

    expect(buildPackage.status).toBe("READY_FOR_PR");
    expect(buildPackage.mode).toBe("CREATE_NEW_PAGE");
    expect(buildPackage.routePath).toBe("/top-3pl-companies-in-usa");
    expect(buildPackage.branchName).toBe("website-growth/top-3pl-companies-in-usa");
    expect(buildPackage.approvalFlow).toContain("A GitHub pull request is opened for review.");
    expect(savedPackage?.routePath).toBe("/top-3pl-companies-in-usa");
  });
});

describe("website growth GitHub pull request packages", () => {
  it("reports missing GitHub pull request configuration", () => {
    const status = getWebsiteGrowthGitHubPrStatus({});

    expect(status.configured).toBe(false);
    expect(status.missing).toEqual(["WEBSITE_GROWTH_GITHUB_TOKEN", "NEWL_WEBSITE_GITHUB_REPO"]);
  });

  it("creates a review package branch, files, and pull request", async () => {
    const buildPackage = buildWebsiteGrowthBuildPackage({
      id: "draft_1",
      opportunityId: "opportunity_1",
      title: "Nationwide 3pl Companies",
      contentType: "New commercial page",
      proposedPath: "/top-3pl-companies-in-usa",
      targetPage: "https://www.newlgroup.com/top-3pl-companies-in-usa",
      draftJson: buildTemplateWebsiteGrowthContentDraft({
        action: WebsiteGrowthAction.CREATE_PAGE,
        topic: "nationwide 3pl companies",
        primaryKeyword: "nationwide 3pl companies",
        targetPage: "https://www.newlgroup.com/top-3pl-companies-in-usa",
        sourcePage: "https://www.newlgroup.com/locations/charlotte-warehousing",
        score: 70,
        confidence: "Medium",
        reason: "100 impressions, 0 clicks, average position 12.0",
        recommendation: "Build a dedicated draft page for nationwide 3PL companies.",
        supportingKeywords: ["top 3pl companies in usa"],
        evidence: {
          legacyRebuild: true
        }
      }) as unknown as Prisma.JsonValue,
      opportunity: {
        action: WebsiteGrowthAction.CREATE_PAGE,
        topic: "nationwide 3pl companies",
        targetPage: "https://www.newlgroup.com/top-3pl-companies-in-usa",
        sourcePage: "https://www.newlgroup.com/locations/charlotte-warehousing"
      }
    });
    const calls: Array<{ init?: RequestInit; url: string }> = [];
    const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const target = String(url);
      calls.push({ init, url: target });

      if (target.includes("/git/ref/heads/main")) {
        return new Response(JSON.stringify({ object: { sha: "base_sha" } }), { status: 200 });
      }

      if (target.endsWith("/git/refs")) {
        return new Response(JSON.stringify({ ref: `refs/heads/${buildPackage.branchName}` }), { status: 201 });
      }

      if (target.includes("/contents/") && (!init?.method || init.method === "GET")) {
        return new Response(JSON.stringify({ message: "Not Found" }), { status: 404 });
      }

      if (target.includes("/contents/") && init?.method === "PUT") {
        return new Response(JSON.stringify({ content: { path: "package" } }), { status: 200 });
      }

      if (target.includes("/pulls?")) {
        return new Response(JSON.stringify([]), { status: 200 });
      }

      if (target.endsWith("/pulls") && init?.method === "POST") {
        return new Response(
          JSON.stringify({
            html_url: "https://github.com/newell29/Newl-website/pull/123",
            number: 123
          }),
          { status: 201 }
        );
      }

      return new Response(JSON.stringify({ message: "Unexpected test URL" }), { status: 500 });
    });

    const result = await createWebsiteGrowthPullRequestPackage({
      buildPackage,
      env: {
        NEWL_WEBSITE_BASE_BRANCH: "main",
        NEWL_WEBSITE_GITHUB_REPO: "newell29/Newl-website",
        WEBSITE_GROWTH_GITHUB_TOKEN: "token"
      },
      fetcher: fetcher as unknown as typeof fetch
    });

    expect(result.status).toBe("PR_OPENED");
    expect(result.pullRequestUrl).toBe("https://github.com/newell29/Newl-website/pull/123");
    expect(result.files).toEqual([
      ".website-growth/build-packages/top-3pl-companies-in-usa.json",
      ".website-growth/build-packages/top-3pl-companies-in-usa.md"
    ]);
    expect(calls.some((call) => call.url.endsWith("/git/refs"))).toBe(true);
    expect(calls.filter((call) => call.url.includes("/contents/") && call.init?.method === "PUT")).toHaveLength(2);
    expect(calls.some((call) => call.url.endsWith("/pulls") && call.init?.method === "POST")).toBe(true);
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
