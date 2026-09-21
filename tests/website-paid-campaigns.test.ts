import { WebsiteInboundStatus } from "@prisma/client";
import { describe, expect, it } from "vitest";

import {
  buildPaidCampaignWhere,
  calculatePaidFunnel,
  groupPaidRows,
  parsePaidCampaignFilters
} from "@/modules/website-growth/paid-campaigns";

describe("paid campaign reporting", () => {
  it("uses cumulative workflow milestones for funnel rates", () => {
    const rows = ["NEW", "QUALIFIED", "QUOTE_SENT", "WON", "LOST"].map((status) => ({
      status: status as WebsiteInboundStatus
    }));
    expect(calculatePaidFunnel(rows)).toEqual({
      formSubmissions: 5,
      qualifiedLeads: 3,
      quotesSent: 2,
      won: 1,
      lost: 1,
      leadToQualifiedRate: 0.6,
      leadToQuoteRate: 0.4,
      leadToWinRate: 0.2
    });
  });

  it("groups campaign evidence without inventing missing attribution", () => {
    const rows = [
      { status: WebsiteInboundStatus.QUALIFIED, campaign: "Campaign A" },
      { status: WebsiteInboundStatus.WON, campaign: "Campaign A" },
      { status: WebsiteInboundStatus.NEW, campaign: "" }
    ];
    expect(groupPaidRows(rows, (row) => row.campaign)).toMatchObject([
      { label: "Campaign A", formSubmissions: 2, qualifiedLeads: 2, won: 1 },
      { label: "Unavailable", formSubmissions: 1 }
    ]);
  });

  it("keeps test and internal records out of every paid report query", () => {
    const filters = parsePaidCampaignFilters(
      { from: "2026-09-01", to: "2026-09-21", campaign: "synthetic" },
      new Date("2026-09-21T12:00:00Z")
    );
    expect(buildPaidCampaignWhere("tenant-a", filters)).toMatchObject({
      tenantId: "tenant-a",
      entryMethod: "WEBSITE_FORM",
      attributionChannel: "PAID_SEARCH",
      status: { not: "TEST" },
      isTest: false,
      marketingExcludedReason: null
    });
  });
});
