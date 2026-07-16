import {
  executeTeamshipPhase2Job,
  type TeamshipPhase2AgentMode
} from "@/modules/shipment-documents/teamship-phase2-agent-execution";
import type { TeamshipPhase2DryRunPlan, TeamshipPhase2PalletRowPlan } from "@/modules/shipment-documents/teamship-phase2-dry-run";

type ManualSmokeOptions = {
  teamshipUrl: string;
  teamshipOrderId: string;
  appBaseUrl: string;
  apiBaseUrl: string;
  srNumber: string;
  psNumber: string;
  mode: TeamshipPhase2AgentMode;
  email: string;
  password: string;
  allowLiveUpdates: boolean;
  confirmLiveWrite: boolean;
  liveAllowlistSrNumbers: string[];
  items: ManualSmokeItem[];
};

type ManualSmokeItem = {
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
  assertSafeLiveOptions(options);
  const plan = buildManualPlan(options);

  const result = await executeTeamshipPhase2Job({
    job: {
      id: `manual-smoke-${Date.now()}`,
      agentMode: options.mode,
      dryRun: options.mode === "DRY_RUN"
    },
    plan,
    credentials: {
      email: options.email,
      password: options.password,
      apiBaseUrl: options.apiBaseUrl,
      appBaseUrl: options.appBaseUrl
    },
    options: {
      agentId: "manual-teamship-smoke-test",
      allowLiveUpdates: options.allowLiveUpdates,
      liveAllowlistSrNumbers: options.liveAllowlistSrNumbers
    }
  });

  console.log(
    JSON.stringify(
      {
        mode: result.mode,
        dryRun: result.dryRun,
        wouldUpdateTeamship: result.wouldUpdateTeamship,
        hasFailures: result.hasFailures,
        notes: result.notes,
        orders: result.orders.map((order) => ({
          srNumber: order.srNumber,
          teamshipOrderId: order.teamshipOrderId,
          status: order.status,
          responseStatus: order.responseStatus,
          error: order.error,
          fieldActions: order.fieldActions,
          palletActions: order.palletActions.map((action) => ({
            rowNumber: action.rowNumber,
            sku: action.sku,
            quantity: action.quantity,
            commodity: action.commodity,
            fields: action.fields,
            browserInstruction: action.browserInstruction
          }))
        }))
      },
      null,
      2
    )
  );
}

function buildManualPlan(options: ManualSmokeOptions): TeamshipPhase2DryRunPlan {
  const plannedPalletRows = options.items.map((item, index) => buildPalletRow(index + 1, item));

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
      plannedPalletRowCount: plannedPalletRows.length,
      plannedBolCleanupCount: 1
    },
    orders: [
      {
        psNumber: options.psNumber,
        srNumber: options.srNumber,
        teamshipOrderId: options.teamshipOrderId,
        teamshipUrl: options.teamshipUrl,
        status: "READY",
        sourceReviewStatus: "FAIL",
        plannedFieldUpdates: [],
        plannedPalletRows,
        plannedBolCleanup: {
          removeCustomerOrderWeights: true,
          compactSpecialInstructions: false,
          reason: "Manual smoke test should mirror production API flow by clearing BOL customer-order weights after updates."
        },
        validationIssues: []
      }
    ]
  };
}

function buildPalletRow(rowNumber: number, item: ManualSmokeItem): TeamshipPhase2PalletRowPlan {
  const commodity = item.serialNumber ? `SKU: ${item.sku} SN: ${item.serialNumber}` : `SKU: ${item.sku} QTY: ${item.quantity}`;

  return {
    rowNumber,
    sku: item.sku,
    quantity: item.quantity,
    lengthIn: item.lengthIn,
    widthIn: item.widthIn,
    heightIn: item.heightIn,
    weightLb: item.weightLb,
    weightUnit: "lbs",
    commodity,
    hasUsableDimensions: true,
    dimensionSource: "CSR_OVERRIDE",
    dimensionConfidence: "HIGH",
    sourceNote: "Manual staging smoke-test value.",
    teamshipFields: buildTeamshipPalletFields({
      rowNumber,
      quantity: item.quantity,
      lengthIn: item.lengthIn,
      widthIn: item.widthIn,
      heightIn: item.heightIn,
      weightLb: item.weightLb,
      commodity
    })
  };
}

function buildTeamshipPalletFields({
  rowNumber,
  quantity,
  lengthIn,
  widthIn,
  heightIn,
  weightLb,
  commodity
}: {
  rowNumber: number;
  quantity: number;
  lengthIn: number;
  widthIn: number;
  heightIn: number;
  weightLb: number;
  commodity: string;
}) {
  return {
    [`pallet_${rowNumber}`]: quantity,
    [`pallet_${rowNumber}_length`]: lengthIn,
    [`pallet_${rowNumber}_width`]: widthIn,
    [`pallet_${rowNumber}_height`]: heightIn,
    [`pallet_${rowNumber}_weight`]: weightLb,
    [`pallet_${rowNumber}_weight_unit`]: "lbs",
    [`pallet_${rowNumber}_commodity`]: commodity
  };
}

function readOptions(args: string[]): ManualSmokeOptions {
  const teamshipUrl = readStringOption(args, "--teamship-url") ?? process.env.TEAMSHIP_TEST_ORDER_URL;

  if (!teamshipUrl) {
    throw new Error("Provide --teamship-url or TEAMSHIP_TEST_ORDER_URL.");
  }

  const parsedUrl = new URL(teamshipUrl);
  const teamshipOrderId = readStringOption(args, "--teamship-order-id") ?? readTeamshipOrderId(parsedUrl);
  const appBaseUrl = readStringOption(args, "--app-base-url") ?? process.env.TEAMSHIP_APP_BASE_URL ?? parsedUrl.origin;
  const apiBaseUrl = readStringOption(args, "--api-base-url") ?? process.env.TEAMSHIP_API_BASE_URL ?? `${appBaseUrl.replace(/\/+$/, "")}/api`;
  const mode = readMode(args);
  const srNumber = readStringOption(args, "--sr") ?? process.env.TEAMSHIP_TEST_SR_NUMBER;
  const psNumber = readStringOption(args, "--ps") ?? process.env.TEAMSHIP_TEST_PS_NUMBER ?? "MANUAL-STAGING-TEST";
  const email = readStringOption(args, "--email") ?? process.env.TEAMSHIP_EMAIL ?? "dry-run@example.com";
  const password = readStringOption(args, "--password") ?? process.env.TEAMSHIP_PASSWORD ?? "not-used-for-dry-run";
  const liveAllowlistSrNumbers = readListOption(args, "--allow-sr", process.env.TEAMSHIP_LIVE_ALLOWLIST_SR_NUMBERS);
  const allowLiveUpdates = args.includes("--allow-live-updates") || process.env.TEAMSHIP_ALLOW_LIVE_UPDATES === "true";
  const confirmLiveWrite = args.includes("--confirm-live-write");
  const items = readItems(args);

  if (!teamshipOrderId) {
    throw new Error("Unable to read Teamship order ID from URL. Provide --teamship-order-id.");
  }

  if (!srNumber) {
    throw new Error("Provide --sr or TEAMSHIP_TEST_SR_NUMBER.");
  }

  return {
    teamshipUrl,
    teamshipOrderId,
    appBaseUrl: appBaseUrl.replace(/\/+$/, ""),
    apiBaseUrl: apiBaseUrl.replace(/\/+$/, ""),
    srNumber,
    psNumber,
    mode,
    email,
    password,
    allowLiveUpdates,
    confirmLiveWrite,
    liveAllowlistSrNumbers,
    items
  };
}

function assertSafeLiveOptions(options: ManualSmokeOptions) {
  if (options.mode !== "LIVE_API") {
    return;
  }

  if (!options.appBaseUrl.includes("staging.teamshipos.com") || !options.apiBaseUrl.includes("staging.teamshipos.com")) {
    throw new Error("Manual live smoke tests are restricted to staging.teamshipos.com.");
  }

  if (!options.allowLiveUpdates) {
    throw new Error("Live smoke test requires --allow-live-updates or TEAMSHIP_ALLOW_LIVE_UPDATES=true.");
  }

  if (!options.confirmLiveWrite) {
    throw new Error("Live smoke test requires --confirm-live-write.");
  }

  if (!options.liveAllowlistSrNumbers.map(normalizeIdentifier).includes(normalizeIdentifier(options.srNumber))) {
    throw new Error("Live smoke test SR must be included in --allow-sr or TEAMSHIP_LIVE_ALLOWLIST_SR_NUMBERS.");
  }
}

function readItems(args: string[]) {
  const itemArgs = args.flatMap((arg, index) => (arg === "--item" ? [args[index + 1] ?? ""] : [])).filter(Boolean);

  if (itemArgs.length > 0) {
    return itemArgs.map(parseItem);
  }

  return [
    {
      sku: readStringOption(args, "--sku") ?? process.env.TEAMSHIP_TEST_SKU ?? "TEST-SKU",
      serialNumber: readNullableString(readStringOption(args, "--serial") ?? process.env.TEAMSHIP_TEST_SERIAL ?? "TEST-SERIAL"),
      quantity: readPositiveNumber(readStringOption(args, "--quantity") ?? process.env.TEAMSHIP_TEST_QUANTITY, 1),
      lengthIn: readPositiveNumber(readStringOption(args, "--length") ?? process.env.TEAMSHIP_TEST_LENGTH_IN, 1),
      widthIn: readPositiveNumber(readStringOption(args, "--width") ?? process.env.TEAMSHIP_TEST_WIDTH_IN, 1),
      heightIn: readPositiveNumber(readStringOption(args, "--height") ?? process.env.TEAMSHIP_TEST_HEIGHT_IN, 1),
      weightLb: readPositiveNumber(readStringOption(args, "--weight") ?? process.env.TEAMSHIP_TEST_WEIGHT_LB, 1)
    }
  ];
}

function parseItem(value: string): ManualSmokeItem {
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

function readMode(args: string[]) {
  if (args.includes("--live")) {
    return "LIVE_API";
  }

  return "DRY_RUN";
}

function readStringOption(args: string[], name: string) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1]?.trim() || null : null;
}

function readListOption(args: string[], name: string, fallback: string | undefined) {
  return [
    ...args.flatMap((arg, index) => (arg === name ? [args[index + 1] ?? ""] : [])),
    fallback ?? ""
  ]
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter(Boolean);
}

function readTeamshipOrderId(url: URL) {
  return url.pathname.match(/\/ship-inventories\/([^/]+)/)?.[1] ?? null;
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

function normalizeIdentifier(value: string) {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
