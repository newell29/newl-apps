import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  importFindMany: vi.fn(),
  importCreate: vi.fn(),
  metricFindMany: vi.fn()
}));

vi.mock("@/server/db", () => ({
  prisma: {
    websiteGrowthDataImport: {
      findMany: (...args: unknown[]) => mocks.importFindMany(...args),
      create: (...args: unknown[]) => mocks.importCreate(...args)
    },
    websiteGrowthMetric: {
      findMany: (...args: unknown[]) => mocks.metricFindMany(...args)
    }
  }
}));

import {
  parseSemrushScheduledReportText,
  safeSyncWebsiteGrowthSemrushScheduledReports,
  syncWebsiteGrowthSemrushScheduledReports
} from "@/modules/website-growth/semrush-mail-reports";
import { loadWebsiteGrowthSemrushCache } from "@/modules/website-growth/scout-run";

describe("SEMrush scheduled report parsing", () => {
  it("classifies a Position Tracking report and extracts bounded metrics", () => {
    const report = parseSemrushScheduledReportText({
      subject: "Scout - Weekly Newl Position Tracking",
      fileName: "position-tracking.pdf",
      observedAt: "2026-08-03T13:00:00.000Z",
      text: `Position Tracking
Domain newlgroup.com
Visibility 8.7%
Top 3 4
Top 10 12
Top 20 25
Top 100 102
Improved 11
Declined 5`
    });

    expect(report.reportType).toBe("POSITION_TRACKING");
    expect(report.metrics).toMatchObject({
      visibility: 8.7,
      top3: 4,
      top10: 12,
      top20: 25,
      top100: 102,
      improved: 11,
      declined: 5
    });
    expect(report.snapshot).toMatchObject({
      domain: "newlgroup.com",
      visibility: 8.7,
      top100: 102,
      trackedKeywords: []
    });
  });

  it.each([
    ["Weekly Site Audit", "Site Health 91% Errors 4 Warnings 18 Crawled pages 225", "SITE_AUDIT", { siteHealth: 91, errors: 4 }],
    ["Weekly Backlink Comparison", "Authority Score 22 Referring Domains 1.2K Backlinks 4.5K", "BACKLINKS", { authorityScore: 22, referringDomains: 1_200 }],
    ["Organic Search Positions", "Organic Keywords 2.4K Organic Traffic 640", "ORGANIC_POSITIONS", { organicKeywords: 2_400, organicTraffic: 640 }]
  ])("classifies %s", (subject, text, reportType, metrics) => {
    expect(parseSemrushScheduledReportText({
      subject,
      fileName: "report.pdf",
      observedAt: "2026-08-03T13:00:00.000Z",
      text
    })).toMatchObject({ reportType, metrics });
  });
});

describe("SEMrush scheduled mailbox sync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.importFindMany.mockResolvedValue([]);
    mocks.importCreate.mockResolvedValue({ id: "import-1" });
    mocks.metricFindMany.mockResolvedValue([]);
  });

  it("accepts only the approved sender and stores sanitized, tenant-scoped evidence", async () => {
    const pdf = Buffer.from("%PDF-synthetic-report");
    const result = await syncWebsiteGrowthSemrushScheduledReports({
      tenantId: "tenant-1",
      now: new Date("2026-08-04T13:00:00.000Z"),
      dependencies: {
        accessTokenProvider: async () => "token",
        messageFetcher: async () => [
          {
            id: "approved-message-id",
            subject: "Scout - Weekly Newl Position Tracking",
            receivedDateTime: "2026-08-03T13:00:00.000Z",
            hasAttachments: true,
            from: { emailAddress: { address: "mail@semrush.com" } }
          },
          {
            id: "unapproved-message-id",
            subject: "Impersonated report",
            receivedDateTime: "2026-08-03T13:00:00.000Z",
            hasAttachments: true,
            from: { emailAddress: { address: "reports@example.com" } }
          }
        ],
        attachmentFetcher: async (_token, _mailbox, messageId) => {
          expect(messageId).toBe("approved-message-id");
          return [{
            id: "attachment-secret-id",
            name: "position-tracking.pdf",
            contentType: "application/pdf",
            size: pdf.length,
            isInline: false
          }];
        },
        contentFetcher: async () => ({ contentBytes: pdf.toString("base64") }),
        pdfExtractor: async () => ({
          pageCount: 1,
          pages: [{
            pageNumber: 1,
            text: "Position Tracking Domain newlgroup.com Visibility 9.2% Top 100 102 contact analyst@example.com https://example.com/path?token=secret"
          }]
        })
      }
    });

    expect(result).toMatchObject({
      status: "SUCCESS",
      messagesSeen: 2,
      eligibleMessages: 1,
      imported: 1,
      failed: 0
    });
    expect(mocks.importCreate).toHaveBeenCalledTimes(1);
    const createInput = mocks.importCreate.mock.calls[0]?.[0];
    expect(createInput).toMatchObject({
      data: {
        tenantId: "tenant-1",
        fileName: "position-tracking.pdf",
        summary: expect.objectContaining({
          runType: "semrush_scheduled_email_report",
          sender: "mail@semrush.com",
          mailboxFolder: "Inbox/Semrush",
          reportType: "POSITION_TRACKING",
          rawEmailStored: false,
          attachmentStored: false
        })
      }
    });
    const serialized = JSON.stringify(createInput);
    expect(serialized).not.toContain("approved-message-id");
    expect(serialized).not.toContain("attachment-secret-id");
    expect(serialized).not.toContain("analyst@example.com");
    expect(serialized).not.toContain("token=secret");
  });

  it("deduplicates a PDF by content hash", async () => {
    const pdf = Buffer.from("%PDF-already-seen");
    const { createHash } = await import("node:crypto");
    mocks.importFindMany.mockResolvedValue([{ summary: {
      contentHash: createHash("sha256").update(pdf).digest("hex")
    } }]);

    const result = await syncWebsiteGrowthSemrushScheduledReports({
      tenantId: "tenant-1",
      dependencies: {
        accessTokenProvider: async () => "token",
        messageFetcher: async () => [{
          id: "message-1",
          hasAttachments: true,
          from: { emailAddress: { address: "mail@semrush.com" } }
        }],
        attachmentFetcher: async () => [{
          id: "attachment-1",
          name: "report.pdf",
          contentType: "application/pdf",
          size: pdf.length,
          isInline: false
        }],
        contentFetcher: async () => ({ contentBytes: pdf.toString("base64") }),
        pdfExtractor: async () => {
          throw new Error("Duplicate PDFs must not be parsed.");
        }
      }
    });

    expect(result.duplicates).toBe(1);
    expect(result.imported).toBe(0);
    expect(mocks.importCreate).not.toHaveBeenCalled();
  });

  it("continues importing after one attachment is malformed", async () => {
    const validPdf = Buffer.from("%PDF-valid-report");
    const result = await syncWebsiteGrowthSemrushScheduledReports({
      tenantId: "tenant-1",
      dependencies: {
        accessTokenProvider: async () => "token",
        messageFetcher: async () => [{
          id: "message-1",
          subject: "Weekly Site Audit",
          receivedDateTime: "2026-08-03T13:00:00.000Z",
          hasAttachments: true,
          from: { emailAddress: { address: "mail@semrush.com" } }
        }],
        attachmentFetcher: async () => [
          { id: "bad", name: "bad.pdf", contentType: "application/pdf", size: 8, isInline: false },
          { id: "good", name: "good.pdf", contentType: "application/pdf", size: validPdf.length, isInline: false }
        ],
        contentFetcher: async (_token, _mailbox, _messageId, attachmentId) => ({
          contentBytes: (attachmentId === "bad" ? Buffer.from("not-pdf") : validPdf).toString("base64")
        }),
        pdfExtractor: async () => ({
          pageCount: 1,
          pages: [{ pageNumber: 1, text: "Site Audit Site Health 92% Errors 3" }]
        })
      }
    });

    expect(result).toMatchObject({ imported: 1, failed: 1 });
    expect(mocks.importCreate).toHaveBeenCalledTimes(2);
    expect(mocks.importCreate.mock.calls.map((call) => call[0].data.status)).toEqual([
      "ERROR",
      "SUCCESS"
    ]);
  });

  it("does not stop Scout when mailbox access fails", async () => {
    const result = await safeSyncWebsiteGrowthSemrushScheduledReports({
      tenantId: "tenant-1",
      dependencies: {
        accessTokenProvider: async () => {
          throw new Error("Mailbox permission denied for partnerships@example.com");
        }
      }
    });

    expect(result).toMatchObject({ status: "ERROR", failed: 1 });
    expect(mocks.importCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        tenantId: "tenant-1",
        status: "ERROR",
        summary: expect.objectContaining({ rawEmailStored: false })
      })
    }));
  });

  it("uses fresh emailed metrics without discarding the prior tracked-keyword list", async () => {
    const fullSnapshot = {
      projectId: "project-1",
      campaignId: "campaign-1",
      domain: "newlgroup.com",
      database: "ca",
      device: "desktop",
      visibility: 7.5,
      previousVisibility: 7.1,
      top3: 3,
      top10: 10,
      top20: 20,
      top100: 100,
      improved: 8,
      declined: 4,
      entered: 2,
      lost: 1,
      trackedKeywords: [{
        keyword: "3pl fulfillment",
        tags: ["approved"],
        position: 12,
        previousPosition: 15,
        landingPage: "/services/fulfillment-services",
        searchVolume: 320
      }]
    };
    mocks.importFindMany.mockResolvedValue([
      {
        completedAt: new Date("2026-08-03T13:05:00.000Z"),
        createdAt: new Date("2026-08-03T13:05:00.000Z"),
        summary: {
          runType: "semrush_scheduled_email_report",
          reportType: "POSITION_TRACKING",
          subject: "Scout - Weekly Newl Position Tracking",
          observedAt: "2026-08-03T13:00:00.000Z",
          metrics: { visibility: 9.2, top10: 14 },
          excerpt: "Position Tracking visibility 9.2%",
          snapshot: { ...fullSnapshot, visibility: 9.2, top10: 14, trackedKeywords: [] }
        }
      },
      {
        completedAt: new Date("2026-07-27T13:05:00.000Z"),
        createdAt: new Date("2026-07-27T13:05:00.000Z"),
        summary: {
          runType: "semrush_keyword_tracking_report",
          observedAt: "2026-07-27T13:00:00.000Z",
          snapshot: fullSnapshot
        }
      }
    ]);

    const cache = await loadWebsiteGrowthSemrushCache(
      "tenant-1",
      new Date("2026-08-04T13:00:00.000Z")
    );

    expect(cache).toMatchObject({
      available: true,
      fresh: true,
      observedAt: "2026-08-03T13:00:00.000Z",
      tracking: {
        visibility: 9.2,
        top10: 14,
        trackedKeywords: [{ keyword: "3pl fulfillment" }]
      },
      reports: [{ reportType: "POSITION_TRACKING" }]
    });
  });
});
