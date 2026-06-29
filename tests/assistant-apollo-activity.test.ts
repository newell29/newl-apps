import { describe, expect, it } from "vitest";

import { parseApolloActivityPrompt } from "@/modules/assistant/apollo-activity";

describe("parseApolloActivityPrompt", () => {
  it("parses today call-count prompts", () => {
    const request = parseApolloActivityPrompt("How many calls did Zalan make today?", new Date("2026-06-26T12:00:00-04:00"));

    expect(request).toMatchObject({
      metric: "calls",
      repName: "Zalan"
    });
    expect(request?.window.kind).toBe("day");
    expect(request?.window.label).toBe("today");
    expect(request?.window.exactDateLabel).toBe("June 26, 2026");
  });

  it("parses rolling-window prompts", () => {
    const request = parseApolloActivityPrompt("How many calls did Zalan Riaz make in the last 30 days?", new Date("2026-06-26T12:00:00-04:00"));

    expect(request).toMatchObject({
      metric: "calls",
      repName: "Zalan Riaz"
    });
    expect(request?.window.kind).toBe("rolling");
    expect(request?.window.label).toBe("last 30 days");
  });

  it("ignores non-call prompts", () => {
    expect(parseApolloActivityPrompt("What do you know about Newl?")).toBeNull();
  });

  it("parses connected call prompts", () => {
    const request = parseApolloActivityPrompt("How many connected calls did Zalan make yesterday?", new Date("2026-06-26T12:00:00-04:00"));

    expect(request).toMatchObject({
      metric: "connected_calls",
      repName: "Zalan"
    });
    expect(request?.window.label).toBe("yesterday");
  });

  it("parses email and reply prompts", () => {
    const emailRequest = parseApolloActivityPrompt("How many emails did Zalan send today?", new Date("2026-06-26T12:00:00-04:00"));
    const replyRequest = parseApolloActivityPrompt("How many replies did Zalan get today?", new Date("2026-06-26T12:00:00-04:00"));

    expect(emailRequest?.metric).toBe("emails");
    expect(replyRequest?.metric).toBe("replies");
  });
});
