import path from "node:path";

import { executeTeamshipPhase2BolCleanupJob } from "@/modules/shipment-documents/teamship-browser-update-execution";
import type { TeamshipPhase2DryRunPlan } from "@/modules/shipment-documents/teamship-phase2-dry-run";

type BrowserSmokeOptions = {
  teamshipUrl: string;
  srNumber: string;
  email: string;
  password: string;
  confirmLiveWrite: boolean;
  headed: boolean;
  slowMoMs: number | null;
  errorPauseMs: number | null;
  screenshotDir: string;
  browserExecutablePath: string | null;
};

async function main() {
  const options = readOptions(process.argv.slice(2));
  assertSafeOptions(options);

  const result = await executeTeamshipPhase2BolCleanupJob({
    job: {
      id: `bol-cleanup-smoke-${Date.now()}`
    },
    plan: buildManualPlan(options),
    credentials: {
      email: options.email,
      password: options.password,
      apiBaseUrl: null,
      appBaseUrl: new URL(options.teamshipUrl).origin
    },
    eligibleSrNumbers: [normalizeIdentifier(options.srNumber)],
    options: {
      browserExecutablePath: options.browserExecutablePath,
      headed: options.headed,
      slowMoMs: options.slowMoMs ?? undefined,
      errorPauseMs: options.errorPauseMs ?? undefined,
      screenshotRootDir: options.screenshotDir,
      allowedHosts: [new URL(options.teamshipUrl).host]
    }
  });

  console.log(JSON.stringify(result, null, 2));
}

function buildManualPlan(options: BrowserSmokeOptions): TeamshipPhase2DryRunPlan {
  return {
    mode: "DRY_RUN",
    dryRun: true,
    wouldUpdateTeamship: false,
    generatedAt: new Date().toISOString(),
    summary: {
      orderCount: 1,
      readyCount: 1,
      blockedCount: 0,
      skippedCount: 0,
      plannedFieldUpdateCount: 0,
      plannedPalletRowCount: 0,
      plannedBolCleanupCount: 1
    },
    orders: [
      {
        psNumber: "",
        srNumber: options.srNumber,
        teamshipOrderId: readTeamshipOrderId(options.teamshipUrl),
        teamshipUrl: options.teamshipUrl,
        status: "READY",
        sourceReviewStatus: "FAIL",
        plannedFieldUpdates: [],
        plannedPalletRows: [],
        plannedBolCleanup: {
          removeCustomerOrderWeights: true,
          compactSpecialInstructions: false,
          reason: "Browser smoke tests only the post-API editable BOL customer-order weight cleanup."
        },
        validationIssues: []
      }
    ]
  };
}

function readOptions(args: string[]): BrowserSmokeOptions {
  const teamshipUrl = readStringOption(args, "--teamship-url") ?? process.env.TEAMSHIP_TEST_ORDER_URL;
  const email = readStringOption(args, "--email") ?? process.env.TEAMSHIP_EMAIL;
  const password = readStringOption(args, "--password") ?? process.env.TEAMSHIP_PASSWORD;
  const srNumber = readStringOption(args, "--sr") ?? process.env.TEAMSHIP_TEST_SR_NUMBER;

  if (!teamshipUrl) {
    throw new Error("Provide --teamship-url or TEAMSHIP_TEST_ORDER_URL.");
  }

  if (!email || !password) {
    throw new Error("Provide TEAMSHIP_EMAIL and TEAMSHIP_PASSWORD, or pass --email and --password.");
  }

  if (!srNumber) {
    throw new Error("Provide --sr or TEAMSHIP_TEST_SR_NUMBER.");
  }

  return {
    teamshipUrl,
    srNumber,
    email,
    password,
    confirmLiveWrite: args.includes("--confirm-live-write"),
    headed: args.includes("--headed") || process.env.TEAMSHIP_BROWSER_HEADED === "true",
    slowMoMs: readNumberOption(args, "--slow-mo-ms") ?? readNumberEnv("TEAMSHIP_BROWSER_SLOW_MO_MS"),
    errorPauseMs: readNumberOption(args, "--error-pause-ms") ?? readNumberEnv("TEAMSHIP_BROWSER_ERROR_PAUSE_MS"),
    screenshotDir:
      readStringOption(args, "--screenshot-dir") ??
      process.env.TEAMSHIP_BROWSER_SCREENSHOT_DIR ??
      path.join("tmp", "teamship-bol-cleanup-smoke", new Date().toISOString().replace(/[:.]/g, "-")),
    browserExecutablePath: readStringOption(args, "--browser-executable-path") ?? process.env.TEAMSHIP_BROWSER_EXECUTABLE_PATH ?? null
  };
}

function assertSafeOptions(options: BrowserSmokeOptions) {
  const url = new URL(options.teamshipUrl);
  const nonProductionHosts = new Set(["dev.teamshipos.com", "staging.teamshipos.com"]);

  if (url.protocol !== "https:" || !nonProductionHosts.has(url.host)) {
    throw new Error("BOL cleanup browser smoke tests are restricted to https://dev.teamshipos.com/ or https://staging.teamshipos.com/.");
  }

  if (!options.confirmLiveWrite) {
    throw new Error("BOL cleanup browser smoke test will update non-production Teamship. Pass --confirm-live-write to continue.");
  }
}

function readTeamshipOrderId(teamshipUrl: string) {
  const match = teamshipUrl.match(/\/ship-inventories\/([^/?#]+)/);

  if (!match?.[1]) {
    throw new Error("Could not read Teamship order ID from --teamship-url.");
  }

  return decodeURIComponent(match[1]);
}

function readStringOption(args: string[], name: string) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1]?.trim() || null : null;
}

function readNumberOption(args: string[], name: string) {
  const value = readStringOption(args, name);
  return readOptionalNumber(value);
}

function readNumberEnv(name: string) {
  return readOptionalNumber(process.env[name]);
}

function readOptionalNumber(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const parsed = Number(value);

  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function normalizeIdentifier(value: string | null | undefined) {
  return value?.trim().toUpperCase() ?? "";
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
