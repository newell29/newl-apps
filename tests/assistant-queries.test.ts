import { describe, expect, it } from "vitest";

import { classifyAssistantIntent } from "@/modules/assistant/queries";

describe("classifyAssistantIntent", () => {
  it("routes rate and quote questions to the rate request flow", () => {
    expect(classifyAssistantIntent("Need a rate from Toronto to Dallas")).toBe("RATE_REQUEST");
    expect(classifyAssistantIntent("Can 7L quote this LTL lane?")).toBe("RATE_REQUEST");
  });

  it("routes company and customer questions to customer context", () => {
    expect(classifyAssistantIntent("What do we know about this customer?")).toBe("CUSTOMER_CONTEXT");
    expect(classifyAssistantIntent("Show company details")).toBe("CUSTOMER_CONTEXT");
  });

  it("routes sales questions to opportunity review", () => {
    expect(classifyAssistantIntent("Find new sales opportunities")).toBe("SALES_OPPORTUNITY");
    expect(classifyAssistantIntent("Which pipeline leads should we call?")).toBe("SALES_OPPORTUNITY");
  });

  it("routes risk language to operational risk", () => {
    expect(classifyAssistantIntent("What problems should managers watch?")).toBe("OPERATIONAL_RISK");
    expect(classifyAssistantIntent("Any customer complaints or delays?")).toBe("OPERATIONAL_RISK");
  });

  it("routes email language to email drafting", () => {
    expect(classifyAssistantIntent("Draft a follow up email")).toBe("EMAIL_DRAFT");
    expect(classifyAssistantIntent("Help me reply to this account")).toBe("EMAIL_DRAFT");
  });

  it("uses general insight as the default", () => {
    expect(classifyAssistantIntent()).toBe("GENERAL_INSIGHT");
    expect(classifyAssistantIntent("What should I look at?")).toBe("GENERAL_INSIGHT");
  });
});
