import { generateKeyPairSync } from "node:crypto";

import {
  JobStatus,
  WebsiteGrowthAction,
  WebsiteGrowthContentDraftStatus,
  WebsiteGrowthOpportunityStatus,
  type Prisma,
  type WebsiteGrowthOpportunity
} from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import {
  buildWebsiteGrowthBuildPackage,
  mergeBuildPackageIntoDraftJson,
  readWebsiteGrowthBuildPackage
} from "@/modules/website-growth/build-package";
import { parseDelimitedRows, readNumber, readString } from "@/modules/website-growth/csv";
import { buildTemplateWebsiteGrowthContentDraft } from "@/modules/website-growth/content-drafts";
import { reviewWebsiteGrowthClaims } from "@/modules/website-growth/claims-policy";
import {
  dispatchWebsiteGrowthDeveloperBuild,
  getWebsiteGrowthDeveloperDispatchStatus
} from "@/modules/website-growth/developer-dispatch";
import {
  getWebsiteGrowthBuildRetryState,
  WEBSITE_GROWTH_STALE_DISPATCH_MS,
  WEBSITE_GROWTH_STALE_RUNNING_MS
} from "@/modules/website-growth/build-requests";
import {
  createWebsiteGrowthPullRequestPackage,
  getWebsiteGrowthGitHubPrStatus
} from "@/modules/website-growth/github-pr";
import {
  fetchSearchConsoleRows,
  fetchGa4LandingPageRows,
  getWebsiteGrowthIntegrationStatus,
  normalizeGa4PropertyId,
  normalizeSearchConsoleSiteUrl
} from "@/modules/website-growth/integrations";
import {
  buildOpportunityCandidate,
  qualifyOpportunityCandidates,
  weeklyContentRecommendations
} from "@/modules/website-growth/opportunities";
import {
  buildWebsiteGrowthKeywordAdditions,
  buildWebsiteGrowthKeywordImportReport,
  buildWebsiteGrowthPerformanceReport
} from "@/modules/website-growth/keyword-tracking";
import { selectWeeklyWebsiteGrowthCandidates } from "@/modules/website-growth/weekly-plan";
import {
  buildWebsiteGrowthScoutTeamsMessage,
  parseWebsiteGrowthScoutCompletion
} from "@/modules/website-growth/scout-run";
import {
  deduplicateScoutDrafts,
  getWebsiteGrowthChangeType,
  getWebsiteGrowthPrimaryChange,
  getWebsiteGrowthRoute,
  getWebsiteGrowthWorkflowStage,
  readScoutRunSummary
} from "@/modules/website-growth/workspace";
import { authenticateWebsiteGrowthBuildWorkerRequest } from "@/server/website-growth-build-worker-auth";
import { authenticateWebsiteGrowthScoutRequest } from "@/server/website-growth-scout-auth";

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

describe("website growth Scout workspace", () => {
  const existingPageDraft = {
    status: WebsiteGrowthContentDraftStatus.DRAFT,
    builtUrl: null,
    pullRequestUrl: null,
    proposedPath: "/services/fulfillment-services",
    targetPage: "https://www.newlgroup.com/services/fulfillment-services",
    draftJson: {
      scout: {
        runId: "scout-run-1",
        recommendationSummary: "Add a dedicated kitting section and four kitting FAQs."
      },
      pageChangePreview: {
        approvalSummary: "Improve the existing fulfillment page with a dedicated kitting section."
      }
    },
    opportunity: {
      action: WebsiteGrowthAction.IMPROVE_EXISTING_PAGE,
      status: WebsiteGrowthOpportunityStatus.REVIEWING,
      targetPage: "https://www.newlgroup.com/services/fulfillment-services",
      sourcePage: "https://www.newlgroup.com/services/fulfillment-services",
      recommendation: "Improve the existing page."
    }
  };

  it("makes an existing-page improvement explicit", () => {
    expect(getWebsiteGrowthChangeType(existingPageDraft.opportunity.action).label).toBe(
      "Update existing page"
    );
    expect(getWebsiteGrowthRoute(existingPageDraft)).toBe(
      "/services/fulfillment-services"
    );
    expect(getWebsiteGrowthPrimaryChange(existingPageDraft)).toContain(
      "existing fulfillment page"
    );
    expect(getWebsiteGrowthWorkflowStage(existingPageDraft)).toBe("NEEDS_REVIEW");
  });

  it("distinguishes a new page from an existing-page update", () => {
    expect(getWebsiteGrowthChangeType(WebsiteGrowthAction.CREATE_PAGE).label).toBe(
      "New page"
    );
    expect(
      getWebsiteGrowthRoute({
        ...existingPageDraft,
        proposedPath: "/services/new-service",
        draftJson: {
          buildPackage: {
            routePath: "/services/new-service"
          }
        },
        opportunity: {
          ...existingPageDraft.opportunity,
          action: WebsiteGrowthAction.CREATE_PAGE
        }
      })
    ).toBe("/services/new-service");
  });

  it("moves approved work from building to preview ready", () => {
    expect(
      getWebsiteGrowthWorkflowStage({
        ...existingPageDraft,
        status: WebsiteGrowthContentDraftStatus.APPROVED,
        opportunity: {
          ...existingPageDraft.opportunity,
          status: WebsiteGrowthOpportunityStatus.IN_PROGRESS
        }
      })
    ).toBe("BUILDING");

    expect(
      getWebsiteGrowthWorkflowStage({
        ...existingPageDraft,
        status: WebsiteGrowthContentDraftStatus.BUILT,
        builtUrl: "https://preview.example.com/services/fulfillment-services"
      })
    ).toBe("PREVIEW_READY");
  });

  it("reads the latest Scout batch without treating raw signals as ideas", () => {
    expect(
      readScoutRunSummary({
        phase: "AWAITING_HUMAN_REVIEW",
        draftIds: ["draft-1", "draft-2"],
        semrushRowCount: 24
      })
    ).toEqual({
      phase: "AWAITING_HUMAN_REVIEW",
      draftIds: ["draft-1", "draft-2"],
      semrushRowCount: 24,
      completedAt: null
    });
  });

  it("shows only the newest Scout brief for the same opportunity", () => {
    expect(
      deduplicateScoutDrafts([
        { id: "new-draft", opportunityId: "opportunity-1" },
        { id: "old-draft", opportunityId: "opportunity-1" },
        { id: "other-draft", opportunityId: "opportunity-2" }
      ])
    ).toEqual([
      { id: "new-draft", opportunityId: "opportunity-1" },
      { id: "other-draft", opportunityId: "opportunity-2" }
    ]);
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

describe("website growth Codex Scout completion", () => {
  it("accepts official SEMrush MCP evidence and a schema-complete draft", () => {
    const draft = buildTemplateWebsiteGrowthContentDraft({
      action: WebsiteGrowthAction.IMPROVE_EXISTING_PAGE,
      topic: "gta local trucking",
      primaryKeyword: "gta local trucking",
      targetPage: "https://www.newlgroup.com/freight/gta-local-trucking",
      sourcePage: "https://www.newlgroup.com/freight/gta-local-trucking",
      score: 70,
      confidence: "High",
      reason: "Search Console and first-party form evidence",
      recommendation: "Improve the existing page.",
      supportingKeywords: [],
      evidence: {}
    });

    const completion = parseWebsiteGrowthScoutCompletion({
      runSummary: "Prepared one evidence-backed page improvement.",
      semrush: {
        queried: true,
        summary: "The existing page ranks for a relevant commercial keyword.",
        tracking: semrushTrackingSnapshot(),
        rows: [{
          opportunityId: "opportunity_1",
          keyword: "gta local trucking",
          page: "https://www.newlgroup.com/freight/gta-local-trucking",
          position: 14,
          searchVolume: 90,
          keywordDifficulty: 31,
          intent: "commercial",
          competitorDomain: null,
          opportunityType: "weak",
          note: "The existing route should be improved rather than duplicated."
        }]
      },
      backlinks: {
        queried: true,
        summary: "One backlink prospect passed review.",
        rawProspectsReviewed: 20,
        duplicatesRejected: 8,
        qualityRejected: 11,
        prospects: [{
          sourceDomain: "example.org",
          sourceUrl: "https://example.org/resources",
          contactPage: "https://example.org/contact",
          targetPage: "/freight/gta-local-trucking",
          category: "RESOURCE_PAGE",
          title: "Canadian freight resource",
          rationale: "The page links to relevant freight providers.",
          outreachAngle: "Offer the improved Newl route as an additional resource.",
          authorityScore: 50,
          relevanceScore: 80,
          qualityScore: 75,
          spamRisk: "LOW",
          estimatedCostAmount: null,
          currency: null,
          requiresContent: false,
          evidence: ["Relevant competitors are linked."]
        }]
      },
      drafts: [{
        opportunityId: "opportunity_1",
        recommendationSummary: "Improve the current freight page.",
        draft
      }]
    });

    expect(completion.semrush.queried).toBe(true);
    expect(completion.semrush.rows[0]?.searchVolume).toBe(90);
    expect(completion.drafts[0]?.draft.proposedPath).toBe("/freight/gta-local-trucking");
  });

  it("rejects a Scout result that silently skips SEMrush", () => {
    expect(() => parseWebsiteGrowthScoutCompletion({
      runSummary: "Skipped SEMrush.",
      semrush: { queried: false, summary: "Unavailable", rows: [], tracking: semrushTrackingSnapshot() },
      backlinks: {
        queried: true,
        summary: "No backlink prospects qualified.",
        rawProspectsReviewed: 0,
        duplicatesRejected: 0,
        qualityRejected: 0,
        prospects: []
      },
      drafts: []
    })).toThrow("required response structure");
  });

  it("builds a deterministic Teams approval message with direct review links", () => {
    const message = buildWebsiteGrowthScoutTeamsMessage({
      drafts: [{ id: "draft_1", title: "GTA local trucking", summary: "Improve the current commercial page." }],
      semrushQueried: true,
      semrushSummary: "Found one weak commercial keyword.",
      weeklyPlan: { reviewedCount: 500, selectedCount: 12 },
      candidateCount: 6,
      researchSignalCount: 6505,
      researchInventory: { MONITORING: 6105 },
      keywordAdditionCount: 2,
      tracking: semrushTrackingSnapshot(),
      reviewBaseUrl: "https://newl-apps.example.com/"
    });

    expect(message).toContain("Search Console, GA4, first-party website forms, and SEMrush MCP");
    expect(message).toContain("https://newl-apps.example.com/website-growth/drafts/draft_1");
    expect(message).toContain("Approval starts the developer build automatically");
    expect(message).toContain("6505 stored signals");
    expect(message).toContain("6 sent to Codex; 1 promoted");
  });

  it("sends a useful weekly Teams message when no new idea is promoted", () => {
    const message = buildWebsiteGrowthScoutTeamsMessage({
      drafts: [],
      semrushQueried: true,
      semrushSummary: "Position Tracking refreshed.",
      weeklyPlan: { reviewedCount: 0, selectedCount: 0 },
      candidateCount: 0,
      researchSignalCount: 6505,
      researchInventory: { MONITORING: 6105 },
      keywordAdditionCount: 0,
      tracking: semrushTrackingSnapshot(),
      reviewBaseUrl: "https://newl-apps.example.com"
    });

    expect(message).toContain("0 ideas promoted");
    expect(message).toContain("No new page brief needs your approval");
    expect(message).toContain("performance workbook is attached");
  });
});

describe("website growth SEMrush keyword tracking", () => {
  it("selects approved-page keywords and removes live SEMrush duplicates", () => {
    const additions = buildWebsiteGrowthKeywordAdditions({
      drafts: [{
        id: "draft_1",
        status: WebsiteGrowthContentDraftStatus.APPROVED,
        proposedPath: "/services/fulfillment-services",
        targetPage: "https://www.newlgroup.com/services/fulfillment-services",
        draftJson: { targetKeyword: "Kitting and Fulfillment Services" },
        opportunity: {
          action: WebsiteGrowthAction.IMPROVE_EXISTING_PAGE,
          primaryKeyword: "fulfillment services",
          supportingKeywords: [
            "kitting services",
            "Fulfillment Services",
            "promotional kitting"
          ],
          targetPage: "https://www.newlgroup.com/services/fulfillment-services",
          sourcePage: "https://www.newlgroup.com/services/fulfillment-services"
        }
      }],
      trackedKeywords: [{
        keyword: "fulfillment services",
        tags: [],
        position: 18,
        previousPosition: 19,
        landingPage: "/services/fulfillment-services",
        searchVolume: 1000
      }]
    });

    expect(additions.map((row) => row.keyword)).toEqual([
      "Kitting and Fulfillment Services",
      "kitting services",
      "promotional kitting"
    ]);
    expect(additions[0]?.tags).toContain("page-update");
  });

  it("builds a two-column SEMrush import and a weekly performance workbook payload", () => {
    const generatedAt = new Date("2026-07-23T12:00:00Z");
    const keywordReport = buildWebsiteGrowthKeywordImportReport([{
      keyword: "kitting services",
      tags: "website-growth,scout,page-update",
      route: "/services/fulfillment-services",
      draftId: "draft_1",
      draftStatus: WebsiteGrowthContentDraftStatus.APPROVED
    }], generatedAt);
    const performanceReport = buildWebsiteGrowthPerformanceReport(
      semrushTrackingSnapshot(),
      generatedAt
    );

    expect(keywordReport.columns.map((column) => column.header)).toEqual(["Keyword", "Tags"]);
    expect(keywordReport.rows).toEqual([{
      keyword: "kitting services",
      tags: "website-growth,scout,page-update"
    }]);
    expect(performanceReport.rows.some((row) => row.item === "Visibility")).toBe(true);
    expect(performanceReport.rows.some((row) => row.item === "fulfillment services")).toBe(true);
  });
});

function semrushTrackingSnapshot() {
  return {
    projectId: "12911828",
    campaignId: "12911828_1198016",
    domain: "newlgroup.com",
    database: "us",
    device: "desktop",
    visibility: 6.42,
    previousVisibility: 5.71,
    top3: 6,
    top10: 8,
    top20: 12,
    top100: 26,
    improved: 8,
    declined: 12,
    entered: 4,
    lost: 0,
    trackedKeywords: [{
      keyword: "fulfillment services",
      tags: ["website-growth"],
      position: 18,
      previousPosition: 19,
      landingPage: "/services/fulfillment-services",
      searchVolume: 1000
    }]
  };
}

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

    expect(draft.contentType).toBe("Legacy redirect rebuild");
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
    expect(buildPackage.branchName).toBe("codex/website-growth-draft_1");
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

describe("website growth claim policy", () => {
  it("allows capability copy without restricted claims", () => {
    const review = reviewWebsiteGrowthClaims({
      title: "Warehouse inventory visibility",
      sections: [{ draftCopy: "Newl coordinates receiving, storage, fulfillment, and reporting through one operating workflow." }]
    });

    expect(review.status).toBe("CLEAR");
    expect(review.findings).toEqual([]);
  });

  it("requires owner evidence for performance and certification claims", () => {
    const review = reviewWebsiteGrowthClaims({
      pagePreview: {
        proofCards: [
          { value: "99.24%", body: "inventory accuracy" },
          { value: "IATA certified", body: "air freight support" }
        ]
      }
    });

    expect(review.status).toBe("OWNER_CONFIRMATION_REQUIRED");
    expect(review.findings.map((finding) => finding.category)).toEqual(["PERFORMANCE", "CERTIFICATION"]);
  });

  it("blocks absolute guarantees even when a human could otherwise approve", () => {
    const review = reviewWebsiteGrowthClaims({ metaDescription: "Guaranteed zero errors on every order." });

    expect(review.status).toBe("BLOCKED");
    expect(review.findings[0]?.disposition).toBe("BLOCKED");
  });
});

describe("website growth developer dispatch", () => {
  it("reports the scoped configuration needed for Codex builds", () => {
    const status = getWebsiteGrowthDeveloperDispatchStatus({});

    expect(status.configured).toBe(false);
    expect(status.missing).toEqual(["WEBSITE_GROWTH_GITHUB_TOKEN", "NEWL_WEBSITE_GITHUB_REPO"]);
    expect(status.model).toBe("gpt-5.6-sol");
    expect(status.reasoningEffort).toBe("high");
  });

  it("dispatches only a request ID and tenant scope to the website workflow", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response(null, { status: 204 }));
    const result = await dispatchWebsiteGrowthDeveloperBuild({
      buildRequestId: "build_request_123",
      tenantSlug: "newl-group",
      env: {
        WEBSITE_GROWTH_GITHUB_TOKEN: "test-token",
        NEWL_WEBSITE_GITHUB_REPO: "newell29/newl_website",
        NEWL_WEBSITE_BASE_BRANCH: "main"
      },
      fetcher: fetcher as unknown as typeof fetch
    });

    const request = fetcher.mock.calls[0];
    const body = JSON.parse(String(request?.[1]?.body));
    expect(result.status).toBe("DISPATCHED");
    expect(body.inputs).toEqual({
      build_request_id: "build_request_123",
      tenant_slug: "newl-group",
      model: "gpt-5.6-sol",
      reasoning_effort: "high"
    });
    expect(JSON.stringify(body)).not.toContain("test-token");
  });

  it("allows a dispatched build to be retried after its callback window expires", () => {
    const now = new Date("2026-07-23T18:00:00.000Z");
    const fresh = getWebsiteGrowthBuildRetryState({
      status: JobStatus.QUEUED,
      output: { phase: "DISPATCHED" },
      startedAt: new Date(now.getTime() - WEBSITE_GROWTH_STALE_DISPATCH_MS + 1)
    }, now);
    const stale = getWebsiteGrowthBuildRetryState({
      status: JobStatus.QUEUED,
      output: { phase: "DISPATCHED" },
      startedAt: new Date(now.getTime() - WEBSITE_GROWTH_STALE_DISPATCH_MS)
    }, now);

    expect(fresh).toEqual({ canRetry: false, reason: null });
    expect(stale).toEqual({ canRetry: true, reason: "STALE_DISPATCH" });
  });

  it("does not treat a build with an open pull request as a stale dispatch", () => {
    const retry = getWebsiteGrowthBuildRetryState({
      status: JobStatus.RUNNING,
      output: { phase: "PR_OPEN" },
      startedAt: new Date("2026-07-23T12:00:00.000Z")
    }, new Date("2026-07-23T18:00:00.000Z"));

    expect(retry).toEqual({ canRetry: false, reason: null });
  });

  it("uses the latest worker callback instead of the original start time", () => {
    const now = new Date("2026-07-23T18:00:00.000Z");
    const retry = getWebsiteGrowthBuildRetryState({
      status: JobStatus.RUNNING,
      output: {
        phase: "RUNNING",
        updatedAt: new Date(now.getTime() - 5 * 60 * 1000).toISOString()
      },
      startedAt: new Date("2026-07-23T12:00:00.000Z")
    }, now);

    expect(retry).toEqual({ canRetry: false, reason: null });
  });

  it("allows a running build to be retried only after its longer callback window expires", () => {
    const now = new Date("2026-07-23T18:00:00.000Z");
    const retry = getWebsiteGrowthBuildRetryState({
      status: JobStatus.RUNNING,
      output: {
        phase: "RUNNING",
        updatedAt: new Date(now.getTime() - WEBSITE_GROWTH_STALE_RUNNING_MS).toISOString()
      },
      startedAt: new Date("2026-07-23T12:00:00.000Z")
    }, now);

    expect(retry).toEqual({ canRetry: true, reason: "STALE_DISPATCH" });
  });

  it("requires both a bearer token and the configured tenant scope for callbacks", () => {
    const previousToken = process.env.WEBSITE_GROWTH_BUILD_WORKER_TOKEN;
    const previousTenant = process.env.WEBSITE_GROWTH_BUILD_WORKER_TENANT_SLUG;
    process.env.WEBSITE_GROWTH_BUILD_WORKER_TOKEN = "worker-token";
    process.env.WEBSITE_GROWTH_BUILD_WORKER_TENANT_SLUG = "newl-group";

    try {
      const result = authenticateWebsiteGrowthBuildWorkerRequest(new Request("https://apps.example.test/api", {
        headers: {
          authorization: "Bearer worker-token",
          "x-newl-website-growth-tenant": "newl-group"
        }
      }));
      expect(result).toEqual({ tenantSlug: "newl-group" });
      expect(() => authenticateWebsiteGrowthBuildWorkerRequest(new Request("https://apps.example.test/api", {
        headers: {
          authorization: "Bearer worker-token",
          "x-newl-website-growth-tenant": "another-tenant"
        }
      }))).toThrow("tenant scope does not match");
    } finally {
      restoreEnv("WEBSITE_GROWTH_BUILD_WORKER_TOKEN", previousToken);
      restoreEnv("WEBSITE_GROWTH_BUILD_WORKER_TENANT_SLUG", previousTenant);
    }
  });

  it("keeps Scout on a separate tenant-scoped OpenClaw credential", () => {
    const previousToken = process.env.OPENCLAW_WEBSITE_GROWTH_TOKEN;
    const previousTenant = process.env.OPENCLAW_WEBSITE_GROWTH_TENANT_SLUG;
    process.env.OPENCLAW_WEBSITE_GROWTH_TOKEN = "scout-token";
    process.env.OPENCLAW_WEBSITE_GROWTH_TENANT_SLUG = "newl-group";
    try {
      expect(authenticateWebsiteGrowthScoutRequest(new Request("https://apps.example.test/api", {
        headers: { authorization: "Bearer scout-token" }
      }))).toEqual({ tenantSlug: "newl-group" });
      expect(() => authenticateWebsiteGrowthScoutRequest(new Request("https://apps.example.test/api", {
        headers: { authorization: "Bearer worker-token" }
      }))).toThrow("Invalid Website Growth Scout credentials");
    } finally {
      restoreEnv("OPENCLAW_WEBSITE_GROWTH_TOKEN", previousToken);
      restoreEnv("OPENCLAW_WEBSITE_GROWTH_TENANT_SLUG", previousTenant);
    }
  });
});

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

describe("website growth integrations", () => {
  it("detects missing Search Console and GA4 configuration", () => {
    const status = getWebsiteGrowthIntegrationStatus({});

    expect(status.googleSearchConsole.configured).toBe(false);
    expect(status.googleSearchConsole.mode).toBe("not_configured");
    expect(status.ga4.configured).toBe(false);
    expect(status.ga4.mode).toBe("not_configured");
  });

  it("normalizes GA4 property resource names", () => {
    expect(normalizeGa4PropertyId("123456789")).toBe("123456789");
    expect(normalizeGa4PropertyId("properties/123456789")).toBe("123456789");
  });

  it("fetches GA4 landing-page performance with service-account credentials", async () => {
    const { privateKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      privateKeyEncoding: { format: "pem", type: "pkcs8" },
      publicKeyEncoding: { format: "pem", type: "spki" }
    });
    const fetcher = vi.fn(async (url: string | URL | Request) => {
      if (String(url).includes("oauth2.googleapis.com/token")) {
        return new Response(JSON.stringify({ access_token: "access-token" }), { status: 200 });
      }
      return new Response(JSON.stringify({
        rows: [{
          dimensionValues: [{ value: "/services/warehousing-services" }],
          metricValues: [{ value: "120" }, { value: "84" }, { value: "0.7" }, { value: "950" }]
        }]
      }), { status: 200 });
    });

    const rows = await fetchGa4LandingPageRows({
      env: {
        GA4_PROPERTY_ID: "properties/123456789",
        GA4_CLIENT_EMAIL: "service-account@example.iam.gserviceaccount.com",
        GA4_PRIVATE_KEY: privateKey
      },
      fetcher: fetcher as unknown as typeof fetch,
      startDate: "2026-07-01",
      endDate: "2026-07-21"
    });

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(String(fetcher.mock.calls[1]?.[0])).toContain("properties/123456789:runReport");
    expect(rows[0]).toMatchObject({
      page: "/services/warehousing-services",
      sessions: 120,
      engagedSessions: 84,
      engagementRate: 0.7,
      eventCount: 950
    });
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
