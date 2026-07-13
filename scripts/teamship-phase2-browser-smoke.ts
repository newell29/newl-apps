import path from "node:path";

import { executeTeamshipPhase2BrowserJob } from "@/modules/shipment-documents/teamship-browser-update-execution";
import type { TeamshipPhase2DryRunPlan } from "@/modules/shipment-documents/teamship-phase2-dry-run";

type BrowserSmokeOptions = {
  teamshipUrl: string;
  srNumber: string;
  email: string;
  password: string;
  confirmLiveWrite: boolean;
  headed: boolean;
  screenshotDir: string;
  browserExecutablePath: string | null;
  items: BrowserSmokeItem[];
};

type BrowserSmokeItem = {
  sku: string;
  serialNumber: string | null;
  quantity: number;
  lengthIn: number;
  widthIn: number;
  heightIn: number;
  weightLb: number;
};

async function main() {
  const options = readOptions(process.argv.slice(2));
  assertSafeOptions(options);

  const result = await executeTeamshipPhase2BrowserJob({
    job: {
      id: `browser-smoke-${Date.now()}`,
      agentMode: "LIVE_API",
      dryRun: false
    },
    plan: buildManualPlan(options),
    credentials: {
      email: options.email,
      password: options.password,
      apiBaseUrl: null,
      appBaseUrl: new URL(options.teamshipUrl).origin
    },
    options: {
      agentId: "manual-teamship-browser-smoke",
      allowLiveUpdates: true,
      liveAllowlistSrNumbers: [options.srNumber],
      browserExecutablePath: options.browserExecutablePath,
      headed: options.headed,
      screenshotRootDir: options.screenshotDir,
      allowedHosts: ["staging.teamshipos.com"]
    }
  });

  console.log(JSON.stringify(result, null, 2));
}

function buildManualPlan(options: BrowserSmokeOptions): TeamshipPhase2DryRunPlan {
  const plannedPalletRows = options.items.map((item, index) => ({
    rowNumber: index + 1,
    sku: item.sku,
    quantity: item.quantity,
    lengthIn: item.lengthIn,
    widthIn: item.widthIn,
    heightIn: item.heightIn,
    weightLb: item.weightLb,
    weightUnit: "lbs",
    commodity: buildCommodity(item),
    hasUsableDimensions: true,
    dimensionSource: "TEAMSHIP_PALLET" as const,
    dimensionConfidence: "HIGH" as const,
    sourceNote: "Manual staging browser smoke input.",
    teamshipFields: {
      [`pallet_${index + 1}`]: item.quantity,
      [`pallet_${index + 1}_length`]: item.lengthIn,
      [`pallet_${index + 1}_width`]: item.widthIn,
      [`pallet_${index + 1}_height`]: item.heightIn,
      [`pallet_${index + 1}_weight`]: item.weightLb,
      [`pallet_${index + 1}_weight_unit`]: "lbs",
      [`pallet_${index + 1}_commodity`]: buildCommodity(item)
    }
  }));

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
      plannedPalletRowCount: plannedPalletRows.length
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
        plannedPalletRows,
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
    screenshotDir:
      readStringOption(args, "--screenshot-dir") ??
      process.env.TEAMSHIP_BROWSER_SCREENSHOT_DIR ??
      path.join("tmp", "teamship-browser-smoke", new Date().toISOString().replace(/[:.]/g, "-")),
    browserExecutablePath: readStringOption(args, "--browser-executable-path") ?? process.env.TEAMSHIP_BROWSER_EXECUTABLE_PATH ?? null,
    items: readItems(args)
  };
}

function assertSafeOptions(options: BrowserSmokeOptions) {
  if (!options.teamshipUrl.startsWith("https://staging.teamshipos.com/")) {
    throw new Error("Browser smoke tests are restricted to https://staging.teamshipos.com/.");
  }

  if (!options.confirmLiveWrite) {
    throw new Error("Browser smoke test will update staging Teamship. Pass --confirm-live-write to continue.");
  }
}

function readItems(args: string[]) {
  const itemArgs = args.flatMap((arg, index) => (arg === "--item" ? [args[index + 1] ?? ""] : [])).filter(Boolean);

  if (itemArgs.length === 0) {
    throw new Error("Provide at least one --item sku,serial,quantity,length,width,height,weight.");
  }

  return itemArgs.map(parseItem);
}

function parseItem(value: string): BrowserSmokeItem {
  const [sku, serialNumber, quantity, lengthIn, widthIn, heightIn, weightLb] = value.split(",").map((part) => part.trim());

  if (!sku) {
    throw new Error("--item format requires sku,serial,quantity,length,width,height,weight.");
  }

  return {
    sku,
    serialNumber: readNullableString(serialNumber),
    quantity: readPositiveNumber(quantity, 1),
    lengthIn: readPositiveNumber(lengthIn, 1),
    widthIn: readPositiveNumber(widthIn, 1),
    heightIn: readPositiveNumber(heightIn, 1),
    weightLb: readPositiveNumber(weightLb, 1)
  };
}

function readTeamshipOrderId(teamshipUrl: string) {
  const match = teamshipUrl.match(/\/ship-inventories\/([^/?#]+)/);

  if (!match?.[1]) {
    throw new Error("Could not read Teamship order ID from --teamship-url.");
  }

  return decodeURIComponent(match[1]);
}

function buildCommodity(item: BrowserSmokeItem) {
  return item.serialNumber ? `SKU: ${item.sku} SN: ${item.serialNumber}` : `SKU: ${item.sku} QTY: ${item.quantity}`;
}

function readStringOption(args: string[], name: string) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1]?.trim() || null : null;
}

function readNullableString(value: string | null | undefined) {
  const normalizedValue = value?.trim();

  if (!normalizedValue || normalizedValue.toUpperCase() === "N/A" || normalizedValue.toUpperCase() === "NA") {
    return null;
  }

  return normalizedValue;
}

function readPositiveNumber(value: string | null | undefined, fallback: number) {
  const parsed = value ? Number(value) : fallback;

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
