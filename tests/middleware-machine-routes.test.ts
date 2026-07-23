import { describe, expect, it } from "vitest";

import { config } from "@/middleware";

describe("middleware machine route exemptions", () => {
  it("lets the OpenClaw Teamship endpoint enforce its dedicated token auth", () => {
    expect(config.matcher[0]).toContain("api/assistant/teamship/read");
  });

  it("lets the OpenClaw Garland endpoints enforce token and Teams identity auth", () => {
    expect(config.matcher[0]).toContain("api/assistant/garland");
  });

  it("lets unresolved-turn capture enforce assistant token and Teams identity auth", () => {
    expect(config.matcher[0]).toContain("api/assistant/openclaw/unresolved-turns");
  });

  it("lets the Mac Mini browser worker endpoints enforce their dedicated token auth", () => {
    expect(config.matcher[0]).toContain("api/assistant/teamship/browser-jobs");
  });

  it("lets the printing endpoints enforce their OpenClaw and worker token auth", () => {
    expect(config.matcher[0]).toContain("api/assistant/printing");
  });

  it("lets Website Growth Scout and weekly cron routes enforce their dedicated token auth", () => {
    expect(config.matcher[0]).toContain("api/website-growth/scout");
    expect(config.matcher[0]).toContain("api/website-growth/weekly-plan");
  });

  it("lets Website Growth build workers enforce their tenant-bound token auth", () => {
    expect(config.matcher[0]).toContain("api/website-growth/build-requests");
    const matcher = new RegExp(`^${config.matcher[0]}$`);

    expect(matcher.test("/api/website-growth/build-requests/build_123/package")).toBe(false);
    expect(matcher.test("/api/website-growth/build-requests/build_123/status")).toBe(false);
    expect(matcher.test("/website-growth")).toBe(true);
  });
});
