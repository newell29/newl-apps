import { beforeEach, describe, expect, it, vi } from "vitest";

const prisma = vi.hoisted(() => {
  const tx = {
    company: {
      findMany: vi.fn(),
      create: vi.fn()
    },
    hunterOpportunitySignal: {
      findUnique: vi.fn(),
      upsert: vi.fn()
    },
    automationJobRun: {
      update: vi.fn()
    },
    auditLog: {
      create: vi.fn()
    }
  };
  return {
    hunterAutomationPolicy: {
      findUnique: vi.fn()
    },
    automationJobRun: {
      findFirst: vi.fn()
    },
    $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) =>
      callback(tx)
    ),
    tx
  };
});

vi.mock("@/server/db", () => ({ prisma }));

import { completeHunterSignalScoutRun } from "@/modules/lead-gen/hunter-signal-scout";

describe("Hunter external signal scout persistence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prisma.automationJobRun.findFirst.mockResolvedValue({ id: "run-1" });
    prisma.hunterAutomationPolicy.findUnique.mockResolvedValue({
      minimumSignalConfidence: 50
    });
    prisma.tx.company.findMany.mockResolvedValue([]);
    prisma.tx.company.create.mockResolvedValue({ id: "company-news-1" });
    prisma.tx.hunterOpportunitySignal.findUnique.mockResolvedValue(null);
    prisma.tx.hunterOpportunitySignal.upsert.mockResolvedValue({ id: "signal-1" });
    prisma.tx.automationJobRun.update.mockResolvedValue({});
    prisma.tx.auditLog.create.mockResolvedValue({});
  });

  it("creates a tenant-scoped provisional company for accepted news without TradeMining", async () => {
    const result = await completeHunterSignalScoutRun({
      tenantId: "tenant-a",
      runId: "run-1",
      completion: completion()
    });

    expect(prisma.tx.company.create).toHaveBeenCalledWith({
      data: {
        tenantId: "tenant-a",
        name: "Example Retailer",
        normalizedName: "example-retailer",
        source: "HUNTER_EXTERNAL_SIGNAL_SCOUT",
        priorityScore: 84,
        candidateStatus: "NEW"
      },
      select: { id: true }
    });
    expect(prisma.tx.hunterOpportunitySignal.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          tenantId: "tenant-a",
          companyId: "company-news-1",
          sourceUrl: "https://example.com/news"
        })
      })
    );
    expect(result).toMatchObject({
      acceptedCount: 1,
      promotedCompanyCount: 1,
      existingCompanyCount: 0,
      duplicateEventCount: 0
    });
  });

  it("groups repeat event coverage and preserves its earlier primary source", async () => {
    prisma.tx.company.findMany.mockResolvedValue([
      {
        id: "company-existing",
        name: "Example Retailer, Inc.",
        normalizedName: "example-retailer-inc"
      }
    ]);
    prisma.tx.hunterOpportunitySignal.findUnique.mockResolvedValue({
      sourceUrl: "https://example.com/original",
      evidence: {
        sources: [
          {
            url: "https://example.com/original",
            articleTitle: "Original coverage"
          }
        ]
      }
    });

    const result = await completeHunterSignalScoutRun({
      tenantId: "tenant-a",
      runId: "run-1",
      completion: completion()
    });

    expect(prisma.tx.company.create).not.toHaveBeenCalled();
    expect(prisma.tx.hunterOpportunitySignal.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          companyId: "company-existing",
          sourceUrl: "https://example.com/original",
          evidence: expect.objectContaining({
            sources: expect.arrayContaining([
              expect.objectContaining({ url: "https://example.com/original" }),
              expect.objectContaining({ url: "https://example.com/news" })
            ])
          })
        })
      })
    );
    expect(result).toMatchObject({
      promotedCompanyCount: 0,
      existingCompanyCount: 1,
      duplicateEventCount: 1
    });
  });
});

function completion() {
  return {
    model: {
      provider: "OLLAMA",
      name: "qwen3:30b-instruct",
      promptVersion: "hunter-signal-classifier-v2",
      structuredOutput: true
    },
    discovery: {
      provider: "BRAVE_WEB",
      lookbackHours: 744,
      fetchedAt: "2026-07-28T12:00:00.000Z",
      rawResultCount: 2,
      duplicateUrlCount: 1,
      filteredNonEventCount: 0,
      selectedArticleCount: 1,
      queries: [
        {
          id: "retail-rollout-carolinas-georgia",
          provider: "BRAVE_WEB",
          resultCount: 2,
          error: null
        }
      ]
    },
    candidates: [
      {
        sourceIndex: 0,
        sourceUrl: "https://example.com/news",
        sourceName: "Example News",
        sourcePublishedAt: "2026-07-28T10:00:00.000Z",
        articleTitle: "Example Retailer will open 20 North Carolina stores",
        queryId: "retail-rollout-carolinas-georgia",
        relevant: true,
        companyName: "Example Retailer",
        signalType: "RETAIL_ROLLOUT",
        serviceLine: "WAREHOUSING",
        opportunityTitle: "North Carolina store rollout",
        summary: "The retailer announced 20 North Carolina store openings.",
        geography: "North Carolina",
        confidence: 84,
        rationale: "The rollout can create replenishment and warehouse demand.",
        evidence: ["20 North Carolina stores"]
      }
    ]
  };
}
