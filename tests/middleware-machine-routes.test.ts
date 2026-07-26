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

  it("lets Rivet development jobs enforce assistant token and admin Teams identity auth", () => {
    expect(config.matcher[0]).toContain("api/assistant/openclaw/development-jobs");
    const matcher = new RegExp(`^${config.matcher[0]}$`);

    expect(matcher.test("/api/assistant/openclaw/development-jobs")).toBe(false);
    expect(matcher.test("/assistant/nemo-feedback")).toBe(true);
  });

  it("lets Hunter quality enforce assistant token and admin Teams identity auth", () => {
    expect(config.matcher[0]).toContain(
      "api/assistant/openclaw/hunter-quality"
    );
    const matcher = new RegExp(`^${config.matcher[0]}$`);

    expect(matcher.test("/api/assistant/openclaw/hunter-quality")).toBe(false);
    expect(matcher.test("/lead-gen/hunter")).toBe(true);
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

  it("lets the Hunter daily planner enforce Vercel cron authentication", () => {
    expect(config.matcher[0]).toContain("api/lead-gen/hunter/daily-plan");
    const matcher = new RegExp(`^${config.matcher[0]}$`);

    expect(matcher.test("/api/lead-gen/hunter/daily-plan")).toBe(false);
    expect(matcher.test("/lead-gen/hunter")).toBe(true);
  });

  it("lets the Hunter signal scout enforce tenant-bound ingestion authentication", () => {
    expect(config.matcher[0]).toContain("api/lead-gen/hunter/signal-scout");
    const matcher = new RegExp(`^${config.matcher[0]}$`);

    expect(matcher.test("/api/lead-gen/hunter/signal-scout/prepare")).toBe(false);
    expect(matcher.test("/api/lead-gen/hunter/signal-scout/complete")).toBe(false);
    expect(matcher.test("/api/lead-gen/hunter/signal-scout/fail")).toBe(false);
    expect(matcher.test("/lead-gen/hunter")).toBe(true);
  });

  it("lets the approved-work backlink executor enforce its dedicated token auth", () => {
    expect(config.matcher[0]).toContain("api/website-growth/backlinks/executor");
    const matcher = new RegExp(`^${config.matcher[0]}$`);

    expect(matcher.test("/api/website-growth/backlinks/executor/claim")).toBe(false);
    expect(matcher.test("/api/website-growth/backlinks/executor/report")).toBe(false);
  });

  it("lets Website Growth build workers enforce their tenant-bound token auth", () => {
    expect(config.matcher[0]).toContain("api/website-growth/build-requests");
    const matcher = new RegExp(`^${config.matcher[0]}$`);

    expect(matcher.test("/api/website-growth/build-requests/build_123/package")).toBe(false);
    expect(matcher.test("/api/website-growth/build-requests/build_123/status")).toBe(false);
    expect(matcher.test("/website-growth")).toBe(true);
  });
});
