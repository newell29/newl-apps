import { describe, expect, it } from "vitest";

import {
  attributionCompleteness,
  classifyWebsiteInboundChannel,
  normalizeWebsiteInboundAttribution
} from "@/modules/website-inbound/attribution";

describe("website inbound attribution", () => {
  it("normalizes the exact top-level contract and classifies Google CPC", () => {
    const result = normalizeWebsiteInboundAttribution(
      {
        formType: "assessment",
        fields: { City: "Toronto", Province: "Ontario" },
        utmSource: " Google ",
        utmMedium: "cpc",
        utmCampaign: "warehouse-search",
        utmTerm: "toronto warehouse",
        utmContent: "responsive-ad-a",
        gclid: "click-1",
        gaClientId: "ga-1",
        campaignId: "campaign-1",
        adGroupId: "group-1",
        creativeId: "creative-1",
        matchType: "exact",
        network: "search",
        device: "mobile",
        landingPage: "https://www.newlgroup.com/services/warehousing?utm_source=google",
        firstReferrer: "https://google.com/search?q=warehouse",
        sessionStartedAt: "2026-09-21T10:00:00Z",
        submittedAt: "2026-09-21T10:05:00Z",
        trafficSourceGuess: "paid search",
        attributionConfidence: "high"
      },
      { City: "Toronto", Province: "Ontario" },
      new Date("2026-09-21T11:00:00Z")
    );

    expect(result).toMatchObject({
      utmSource: "Google",
      attributionChannel: "PAID_SEARCH",
      landingPath: "/services/warehousing",
      firstReferrerDomain: "google.com",
      attributionLocation: "Toronto, Ontario",
      isTest: false
    });
    expect(result.submittedAt.toISOString()).toBe("2026-09-21T10:05:00.000Z");
    expect(attributionCompleteness(result)).toBe("COMPLETE");
  });

  it("reads legacy labelled fields without requiring a website cutover", () => {
    const result = normalizeWebsiteInboundAttribution(
      { formType: "contact", fields: {} },
      {
        "Attribution - UTM Source": "google",
        "Attribution - UTM Medium": "cpc",
        "Attribution - GCLID": "legacy-click",
        "Attribution - Landing Page": "https://www.newlgroup.com/contact"
      }
    );
    expect(result).toMatchObject({
      utmSource: "google",
      gclid: "legacy-click",
      attributionChannel: "PAID_SEARCH"
    });
    expect(attributionCompleteness(result)).toBe("PARTIAL");
  });

  it("keeps organic, AI referral, direct and local channels separate", () => {
    expect(classifyWebsiteInboundChannel({ utmMedium: "organic" })).toBe("ORGANIC_SEARCH");
    expect(classifyWebsiteInboundChannel({ firstReferrerDomain: "chatgpt.com" })).toBe("AI_REFERRAL");
    expect(classifyWebsiteInboundChannel({ trafficSourceGuess: "direct" })).toBe("DIRECT");
    expect(classifyWebsiteInboundChannel({ utmMedium: "local_listing" })).toBe("LOCAL");
    expect(classifyWebsiteInboundChannel({})).toBe("UNKNOWN");
  });

  it("marks explicit and diagnostic checks for durable marketing exclusion", () => {
    expect(normalizeWebsiteInboundAttribution(
      { formType: "assessment", pageUrl: "/contact?codex_weekly_diagnostic=1", fields: {} },
      {}
    )).toMatchObject({ isTest: true, marketingExcludedReason: "CODEX_DIAGNOSTIC" });
    expect(normalizeWebsiteInboundAttribution(
      { formType: "assessment", fields: {}, isTest: "true" },
      {}
    )).toMatchObject({ isTest: true, marketingExcludedReason: "EXPLICIT_TEST" });
    expect(normalizeWebsiteInboundAttribution(
      { formType: "synthetic_check", fields: {} },
      {}
    )).toMatchObject({ isTest: true, marketingExcludedReason: "AUTOMATED_FORM_CHECK" });
    expect(normalizeWebsiteInboundAttribution(
      { formType: "assessment", source: "employee", fields: {} },
      {}
    )).toMatchObject({ isTest: true, marketingExcludedReason: "INTERNAL_SUBMISSION" });
  });
});
