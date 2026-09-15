import { beforeEach, describe, expect, it, vi } from "vitest";

import type { TeamshipPhase2DryRunPlan } from "@/modules/shipment-documents/teamship-phase2-dry-run";
import {
  describeTeamshipBrowserPreflightFailure,
  preflightTeamshipBolCleanupBrowser
} from "@/modules/shipment-documents/teamship-browser-update-execution";
import {
  executeTeamshipApiAfterBrowserPreflight,
  requiresTeamshipBolCleanupBrowserPreflight
} from "@/modules/shipment-documents/teamship-worker-browser-preflight";

const launchBrowser = vi.hoisted(() => vi.fn());

vi.mock("playwright-core", () => ({
  chromium: {
    launch: launchBrowser
  }
}));

function buildPlan({ cleanup = true }: { cleanup?: boolean } = {}) {
  return {
    orders: [
      {
        status: "READY",
        psNumber: "PS123456",
        srNumber: "SR812345",
        teamshipOrderId: "12345",
        plannedBolCleanup: cleanup ? { removeCustomerOrderWeights: true } : null
      }
    ]
  } as unknown as TeamshipPhase2DryRunPlan;
}

describe("Teamship worker browser preflight", () => {
  beforeEach(() => {
    launchBrowser.mockReset();
  });

  it("requires preflight only when an eligible order has planned BOL cleanup", () => {
    expect(requiresTeamshipBolCleanupBrowserPreflight({ plan: buildPlan(), enabled: true })).toBe(true);
    expect(requiresTeamshipBolCleanupBrowserPreflight({ plan: buildPlan(), enabled: false })).toBe(false);
    expect(requiresTeamshipBolCleanupBrowserPreflight({ plan: buildPlan({ cleanup: false }), enabled: true })).toBe(false);
  });

  it("launches and closes Chrome without navigating to Teamship", async () => {
    const closePage = vi.fn().mockResolvedValue(undefined);
    const closeBrowser = vi.fn().mockResolvedValue(undefined);
    const newPage = vi.fn().mockResolvedValue({ close: closePage });
    launchBrowser.mockResolvedValue({ newPage, close: closeBrowser });

    await expect(
      preflightTeamshipBolCleanupBrowser({
        browserExecutablePath: "/usr/bin/google-chrome",
        headed: true,
        slowMoMs: 0
      })
    ).resolves.toBeUndefined();

    expect(launchBrowser).toHaveBeenCalledWith(
      expect.objectContaining({ executablePath: "/usr/bin/google-chrome", headless: false })
    );
    expect(newPage).toHaveBeenCalledTimes(1);
    expect(closePage).toHaveBeenCalledTimes(1);
    expect(closeBrowser).toHaveBeenCalledTimes(1);
  });

  it("reports a stale or missing display without returning raw Playwright logs", () => {
    const rawError = new Error(
      "Invalid MIT-MAGIC-COOKIE-1 key Missing X server or $DISPLAY browser logs containing internal launch details"
    );

    expect(describeTeamshipBrowserPreflightFailure(rawError)).toBe(
      "BROWSER_DISPLAY_UNAVAILABLE: Chrome could not connect to the worker's private virtual display. No Teamship API updates were attempted."
    );
    expect(describeTeamshipBrowserPreflightFailure(rawError)).not.toContain("MIT-MAGIC");
  });

  it("does not execute the Teamship API when browser startup fails", async () => {
    const executeApi = vi.fn().mockResolvedValue({ updated: true });

    await expect(
      executeTeamshipApiAfterBrowserPreflight({
        required: true,
        preflightBrowser: vi.fn().mockRejectedValue(new Error("BROWSER_DISPLAY_UNAVAILABLE")),
        executeApi
      })
    ).rejects.toMatchObject({
      failureStage: "WORKER_PREFLIGHT",
      message: "BROWSER_DISPLAY_UNAVAILABLE"
    });

    expect(executeApi).not.toHaveBeenCalled();
  });

  it("classifies an API failure after a successful preflight separately", async () => {
    await expect(
      executeTeamshipApiAfterBrowserPreflight({
        required: true,
        preflightBrowser: vi.fn().mockResolvedValue(undefined),
        executeApi: vi.fn().mockRejectedValue(new Error("synthetic Teamship API failure"))
      })
    ).rejects.toMatchObject({
      failureStage: "TEAMSHIP_API",
      message: "synthetic Teamship API failure"
    });
  });
});
