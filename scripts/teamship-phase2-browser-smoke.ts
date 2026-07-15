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
  slowMoMs: number | null;
  errorPauseMs: number | null;
  screenshotDir: string;
  browserExecutablePath: string | null;
  fields: BrowserSmokeField[];
  items: BrowserSmokeItem[];
};

type BrowserSmokeField = {
  reviewFieldKey: string;
  label: string;
  teamshipField: string;
  currentValue: string | null;
  proposedValue: string;
  reason: string;
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
      slowMoMs: options.slowMoMs ?? undefined,
      errorPauseMs: options.errorPauseMs ?? undefined,
      fieldUpdatesEnabled: options.fields.length > 0,
      bolCleanupEnabled: false,
      screenshotRootDir: options.screenshotDir,
      allowedHosts: [new URL(options.teamshipUrl).host]
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
      plannedFieldUpdateCount: options.fields.length,
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
        plannedFieldUpdates: options.fields,
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
    slowMoMs: readNumberOption(args, "--slow-mo-ms") ?? readNumberEnv("TEAMSHIP_BROWSER_SLOW_MO_MS"),
    errorPauseMs: readNumberOption(args, "--error-pause-ms") ?? readNumberEnv("TEAMSHIP_BROWSER_ERROR_PAUSE_MS"),
    screenshotDir:
      readStringOption(args, "--screenshot-dir") ??
      process.env.TEAMSHIP_BROWSER_SCREENSHOT_DIR ??
      path.join("tmp", "teamship-browser-smoke", new Date().toISOString().replace(/[:.]/g, "-")),
    browserExecutablePath: readStringOption(args, "--browser-executable-path") ?? process.env.TEAMSHIP_BROWSER_EXECUTABLE_PATH ?? null,
    fields: readFields(args),
    items: readItems(args)
  };
}

function assertSafeOptions(options: BrowserSmokeOptions) {
  const url = new URL(options.teamshipUrl);
  const nonProductionHosts = new Set(["dev.teamshipos.com", "staging.teamshipos.com"]);

  if (url.protocol !== "https:" || !nonProductionHosts.has(url.host)) {
    throw new Error("Browser smoke tests are restricted to https://dev.teamshipos.com/ or https://staging.teamshipos.com/.");
  }

  if (!options.confirmLiveWrite) {
    throw new Error("Browser smoke test will update non-production Teamship. Pass --confirm-live-write to continue.");
  }
}

function readFields(args: string[]): BrowserSmokeField[] {
  return args.flatMap((arg, index) => (arg === "--field" ? [args[index + 1] ?? ""] : [])).filter(Boolean).map(parseField);
}

function parseField(value: string): BrowserSmokeField {
  const separatorIndex = value.indexOf("=");

  if (separatorIndex <= 0) {
    throw new Error("--field format requires teamshipField=value, for example --field edi_field_3=PPADD-CD.");
  }

  const teamshipField = value.slice(0, separatorIndex).trim();
  const proposedValue = value.slice(separatorIndex + 1).trim();

  if (!teamshipField || !proposedValue) {
    throw new Error("--field format requires a non-empty Teamship field and value.");
  }

  const metadata = readFieldMetadata(teamshipField);

  return {
    reviewFieldKey: metadata.reviewFieldKey,
    label: metadata.label,
    teamshipField,
    currentValue: null,
    proposedValue,
    reason: "Manual Teamship non-production browser smoke input."
  };
}

function readFieldMetadata(teamshipField: string) {
  const metadataByField: Record<string, { reviewFieldKey: string; label: string }> = {
    poNumber: { reviewFieldKey: "po_number", label: "PO Number" },
    edi_field_3: { reviewFieldKey: "freight_terms", label: "Freight Terms Code" },
    carrier_value: { reviewFieldKey: "carrier", label: "Carrier" },
    edi_field_4: { reviewFieldKey: "shipping_instructions", label: "Special Instructions" }
  };

  return metadataByField[teamshipField] ?? { reviewFieldKey: teamshipField, label: teamshipField };
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
