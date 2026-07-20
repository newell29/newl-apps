import { describe, expect, it } from "vitest";

import { extractQuoteNumberFromText, resolveCustomerNameForTms, resolveTeamshipCustomerNameForTms } from "../src/modules/tms-bridge/actions";

describe("TMS customer resolution", () => {
  it("uses website evidence instead of a cleaned sender domain", async () => {
    const customer = await resolveCustomerNameForTms(
      "Dormeo",
      async (domain) => {
        expect(domain).toBe("dormeo-na.com");
        return '<html><head><meta property="og:site_name" content="Dormeo North America LLC"></head></html>';
      },
      "dormeo-na.com"
    );

    expect(customer).toBe("Dormeo North America, LLC");
    expect(customer).not.toBe("dormeo-na");
    expect(customer).not.toBe("Dormeo");
    expect(customer).not.toBe("Dormeo NA");
    expect(customer).not.toBe("dormeo-na.com");
  });

  it("matches slash-separated Gemini customer values against the exact Teamship customer name", () => {
    const match = resolveTeamshipCustomerNameForTms(
      "Clary Business Machines / OneScreen",
      ["OneScreen", "OneScreen Storage"],
      "onescreensolutions.com"
    );

    expect(match).toMatchObject({
      customerName: "OneScreen"
    });
    expect(match?.score).toBeGreaterThanOrEqual(0.88);
  });

  it("uses original sender domain as evidence only for existing Teamship names", () => {
    const match = resolveTeamshipCustomerNameForTms(
      "Clary Business Machines",
      ["OneScreen", "OneScreen Storage"],
      "onescreensolutions.com"
    );

    expect(match).toMatchObject({
      customerName: "OneScreen"
    });
    expect(match?.customerName).not.toBe("onescreensolutions.com");
    expect(match?.customerName).not.toBe("Onescreen Solutions");
  });

  it("prioritizes the exact Teamship customer name over a generic Gemini suffix", () => {
    const match = resolveTeamshipCustomerNameForTms(
      "OneScreen Solutions",
      ["OneScreen", "OneScreen Storage"],
      "onescreensolutions.com"
    );

    expect(match).toMatchObject({
      customerName: "OneScreen"
    });
    expect(match?.score).toBeGreaterThanOrEqual(0.88);
  });

  it("does not treat the word Quote as a created quote number", () => {
    expect(extractQuoteNumberFromText("Quote Number")).toBeNull();
    expect(extractQuoteNumberFromText("Quote No: Q3384N2")).toBe("Q3384N2");
  });
});
