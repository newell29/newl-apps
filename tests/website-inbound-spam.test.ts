import { describe, expect, it } from "vitest";

import { isLikelySpamWebsiteInboundSubmission } from "@/modules/website-inbound/spam";

describe("website inbound spam filtering", () => {
  it("accepts account setup with one https://www website and attribution URLs", () => {
    expect(
      isLikelySpamWebsiteInboundSubmission({
        legalCompanyName: "Codex Weekly Diagnostic account setup",
        website: "https://www.newlgroup.com",
        primaryContactEmail: "codex.diagnostic+account-setup@newl.ca",
        "Attribution - Landing Page": "https://www.newlgroup.com/account-setup",
        "Attribution - Current Page":
          "https://www.newlgroup.com/account-setup?codex_weekly_diagnostic=1"
      })
    ).toBe(false);
  });

  it("still filters submissions containing two distinct user-provided URLs", () => {
    expect(
      isLikelySpamWebsiteInboundSubmission({
        Message: "See https://example.com and https://example.org"
      })
    ).toBe(true);
  });
});
