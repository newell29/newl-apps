import { executeTeamshipPhase2BrowserJob } from "@/modules/shipment-documents/teamship-browser-update-execution";
import {
  executeTeamshipPhase2Job,
  type TeamshipPhase2AgentMode,
  type TeamshipPhase2ExecutionResult
} from "@/modules/shipment-documents/teamship-phase2-agent-execution";
import type { TeamshipPhase2DryRunPlan } from "@/modules/shipment-documents/teamship-phase2-dry-run";

type WorkerOptions = {
  baseUrl: string;
  token: string;
  agentId: string;
  mode: "dry-run" | "live-api" | "live-browser";
  allowLiveUpdates: boolean;
  liveAllowlistSrNumbers: string[];
  browserExecutablePath: string | null;
  browserHeaded: boolean;
  browserSlowMoMs: number;
  browserErrorPauseMs: number;
  browserFieldUpdatesEnabled: boolean;
  browserBolCleanupEnabled: boolean;
  browserScreenshotRootDir: string | null;
  browserAllowedHosts: string[] | undefined;
  loop: boolean;
  intervalMs: number;
};

type ClaimResponse = {
  job: TeamshipUpdateJobSummary | null;
  executionPayload: TeamshipPhase2DryRunPlan | null;
  teamshipCredentials?: {
    email: string;
    password: string;
    apiBaseUrl: string | null;
    appBaseUrl?: string | null;
  } | null;
  error?: string;
};

type CompleteResponse = {
  job?: TeamshipUpdateJobSummary;
  error?: string;
};

type TeamshipUpdateJobSummary = {
  id: string;
  documentLabel: string;
  agentMode: TeamshipPhase2AgentMode;
  status: string;
  dryRun: boolean;
  selectedSrNumbers: string[];
};

async function main() {
  const options = readOptions(process.argv.slice(2));

  do {
    const didWork = await runOnce(options);

    if (!options.loop) {
      break;
    }

    if (!didWork) {
      await sleep(options.intervalMs);
    }
  } while (options.loop);
}

async function runOnce(options: WorkerOptions) {
  const claimed = await claimNextJob(options);

  if (!claimed.job || !claimed.executionPayload) {
    console.log("No approved Teamship Phase 2 jobs are waiting.");
    return false;
  }

  console.log(
    `Claimed Teamship Phase 2 job ${claimed.job.id} (${claimed.job.documentLabel}) with ${claimed.job.selectedSrNumbers.length} shipment(s).`
  );

  try {
    assertTeamshipCredentials(claimed);
    const result = await executeJob({ options, claimed });
    logExecutionSummary(result);
    await completeJob({
      options,
      jobId: claimed.job.id,
      status: result.hasFailures ? "NEEDS_REVIEW" : "SUCCESS",
      result
    });
    console.log(
      `Reported ${result.mode} ${result.hasFailures ? "needs-review" : "success"} completion for job ${claimed.job.id}.`
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Teamship Phase 2 worker error.";
    await completeJob({
      options,
      jobId: claimed.job.id,
      status: "FAILED",
      result: {
        mode: options.mode === "dry-run" ? "DRY_RUN" : options.mode === "live-browser" ? "LIVE_BROWSER" : "LIVE_API",
        dryRun: options.mode === "dry-run",
        wouldUpdateTeamship: options.mode !== "dry-run",
        executedAt: new Date().toISOString(),
        agentId: options.agentId,
        jobId: claimed.job.id,
        error: message
      }
    });
    throw error;
  }

  return true;
}

async function executeJob({
  options,
  claimed
}: {
  options: WorkerOptions;
  claimed: ClaimResponse & { job: TeamshipUpdateJobSummary; executionPayload: TeamshipPhase2DryRunPlan };
}): Promise<TeamshipPhase2ExecutionResult> {
  if (claimed.job.agentMode === "LIVE_API" && options.mode === "dry-run") {
    throw new Error("This approved job requires live mode, but the VM worker is running in dry-run mode.");
  }

  if (claimed.job.agentMode === "LIVE_API" && options.mode === "live-browser") {
    return executeTeamshipPhase2BrowserJob({
      job: {
        id: claimed.job.id,
        agentMode: claimed.job.agentMode,
        dryRun: claimed.job.dryRun
      },
      plan: claimed.executionPayload,
      credentials: claimed.teamshipCredentials!,
      options: {
        agentId: options.agentId,
        allowLiveUpdates: options.allowLiveUpdates,
        liveAllowlistSrNumbers: options.liveAllowlistSrNumbers,
        browserExecutablePath: options.browserExecutablePath,
        headed: options.browserHeaded,
        slowMoMs: options.browserSlowMoMs,
        errorPauseMs: options.browserErrorPauseMs,
        fieldUpdatesEnabled: options.browserFieldUpdatesEnabled,
        bolCleanupEnabled: options.browserBolCleanupEnabled,
        screenshotRootDir: options.browserScreenshotRootDir,
        allowedHosts: options.browserAllowedHosts
      }
    });
  }

  return executeTeamshipPhase2Job({
    job: {
      id: claimed.job.id,
      agentMode: claimed.job.agentMode,
      dryRun: claimed.job.dryRun
    },
    plan: claimed.executionPayload,
    credentials: claimed.teamshipCredentials!,
    options: {
      agentId: options.agentId,
      allowLiveUpdates: options.allowLiveUpdates,
      liveAllowlistSrNumbers: options.liveAllowlistSrNumbers
    }
  });
}

async function claimNextJob(options: WorkerOptions): Promise<ClaimResponse> {
  const response = await fetch(`${options.baseUrl}/api/shipment-documents/teamship-review/update-jobs/agent/next`, {
    method: "POST",
    headers: buildAgentHeaders(options)
  });
  const responseText = await response.text();
  const json = parseJsonResponse<ClaimResponse>(responseText);

  if (!response.ok) {
    throw new Error(json?.error ?? `Unable to claim Teamship update job. HTTP ${response.status}.`);
  }

  if (!json) {
    throw new Error(
      `Unable to claim Teamship update job. Expected JSON but received HTTP ${response.status} ${describeResponseBody(responseText)}.`
    );
  }

  return json;
}

async function completeJob({
  options,
  jobId,
  status,
  result
}: {
  options: WorkerOptions;
  jobId: string;
  status: "SUCCESS" | "FAILED" | "NEEDS_REVIEW";
  result: unknown;
}) {
  const response = await fetch(`${options.baseUrl}/api/shipment-documents/teamship-review/update-jobs/agent/${jobId}`, {
    method: "PATCH",
    headers: {
      ...buildAgentHeaders(options),
      "content-type": "application/json"
    },
    body: JSON.stringify({ status, result })
  });
  const responseText = await response.text();
  const json = parseJsonResponse<CompleteResponse>(responseText);

  if (!response.ok) {
    throw new Error(json?.error ?? `Unable to complete Teamship update job ${jobId}. HTTP ${response.status}.`);
  }

  if (!json) {
    throw new Error(
      `Unable to complete Teamship update job ${jobId}. Expected JSON but received HTTP ${response.status} ${describeResponseBody(responseText)}.`
    );
  }

  return json;
}

function parseJsonResponse<T>(value: string) {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function describeResponseBody(value: string) {
  const preview = value.replace(/\s+/g, " ").trim().slice(0, 120);

  return preview ? `with body starting: ${JSON.stringify(preview)}` : "with an empty response body";
}

function buildAgentHeaders(options: WorkerOptions) {
  return {
    authorization: `Bearer ${options.token}`,
    "x-newl-agent-id": options.agentId
  };
}

function assertTeamshipCredentials(claimed: ClaimResponse) {
  if (!claimed.teamshipCredentials?.email || !claimed.teamshipCredentials.password) {
    throw new Error("Claimed job did not include Teamship credentials from tenant Settings.");
  }
}

function readOptions(args: string[]): WorkerOptions {
  const baseUrl = readStringOption(args, "--base-url") ?? process.env.NEWL_APPS_BASE_URL;
  const token = readStringOption(args, "--token") ?? process.env.NEWL_AGENT_TOKEN ?? process.env.INGESTION_API_TOKEN;
  const agentId = readStringOption(args, "--agent-id") ?? process.env.NEWL_AGENT_ID ?? "teamship-vm-agent";
  const mode = readMode(readStringOption(args, "--mode") ?? process.env.TEAMSHIP_AGENT_MODE ?? "dry-run");
  const allowLiveUpdates = args.includes("--allow-live-updates") || process.env.TEAMSHIP_ALLOW_LIVE_UPDATES === "true";
  const liveAllowlistSrNumbers = readListOption(args, "--allow-sr", process.env.TEAMSHIP_LIVE_ALLOWLIST_SR_NUMBERS);
  const browserExecutablePath =
    readStringOption(args, "--browser-executable-path") ?? process.env.TEAMSHIP_BROWSER_EXECUTABLE_PATH ?? null;
  const browserHeaded = args.includes("--headed") || process.env.TEAMSHIP_BROWSER_HEADED === "true";
  const browserSlowMoMs = readPositiveNumber(
    readStringOption(args, "--browser-slow-mo-ms") ?? process.env.TEAMSHIP_BROWSER_SLOW_MO_MS,
    0
  );
  const browserPauseOnError = args.includes("--pause-on-error") || process.env.TEAMSHIP_BROWSER_PAUSE_ON_ERROR === "true";
  const browserErrorPauseMs = readPositiveNumber(
    readStringOption(args, "--browser-error-pause-ms") ?? process.env.TEAMSHIP_BROWSER_ERROR_PAUSE_MS,
    browserPauseOnError ? 600_000 : 0
  );
  const browserFieldUpdatesEnabled =
    args.includes("--field-updates") ||
    process.env.TEAMSHIP_BROWSER_FIELD_UPDATES === "true" ||
    process.env.TEAMSHIP_BROWSER_ENABLE_FIELD_UPDATES === "true";
  const browserBolCleanupEnabled =
    args.includes("--bol-cleanup") ||
    process.env.TEAMSHIP_BROWSER_BOL_CLEANUP === "true" ||
    process.env.TEAMSHIP_BROWSER_ENABLE_BOL_CLEANUP === "true";
  const browserScreenshotRootDir =
    readStringOption(args, "--screenshot-dir") ?? process.env.TEAMSHIP_BROWSER_SCREENSHOT_DIR ?? null;
  const browserAllowedHosts = readOptionalListOption(args, "--browser-allowed-host", process.env.TEAMSHIP_BROWSER_ALLOWED_HOSTS);
  const loop = args.includes("--loop") || process.env.TEAMSHIP_AGENT_LOOP === "true";
  const intervalMs = readPositiveNumber(readStringOption(args, "--interval-ms") ?? process.env.TEAMSHIP_AGENT_INTERVAL_MS, 30_000);

  if (!baseUrl) {
    throw new Error("NEWL_APPS_BASE_URL or --base-url is required.");
  }

  if (!token) {
    throw new Error("NEWL_AGENT_TOKEN, INGESTION_API_TOKEN, or --token is required.");
  }

  return {
    baseUrl: baseUrl.replace(/\/+$/, ""),
    token,
    agentId,
    mode,
    allowLiveUpdates,
    liveAllowlistSrNumbers,
    browserExecutablePath,
    browserHeaded,
    browserSlowMoMs,
    browserErrorPauseMs,
    browserFieldUpdatesEnabled,
    browserBolCleanupEnabled,
    browserScreenshotRootDir,
    browserAllowedHosts,
    loop,
    intervalMs
  };
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

function readOptionalListOption(args: string[], name: string, fallback: string | undefined) {
  const values = readListOption(args, name, fallback);
  return values.length > 0 ? values : undefined;
}

function readMode(value: string): WorkerOptions["mode"] {
  if (value === "dry-run" || value === "live-api" || value === "live-browser") {
    return value;
  }

  throw new Error("TEAMSHIP_AGENT_MODE must be dry-run, live-api, or live-browser.");
}

function readPositiveNumber(value: string | undefined | null, fallback: number) {
  const parsed = value ? Number(value) : fallback;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function logExecutionSummary(result: TeamshipPhase2ExecutionResult) {
  console.log(`Teamship Phase 2 ${result.mode} finished with ${result.hasFailures ? "issues" : "success"}.`);

  for (const order of result.orders) {
    const orderLabel = order.srNumber || order.teamshipOrderId || "unknown order";
    const browser = readRecord(order.updatePayload?.browser);
    const screenshotDir = readString(browser?.screenshotDir);
    const fieldUpdatesSkipped = readBoolean(browser?.fieldUpdatesSkipped);
    const skippedFieldUpdateCount = readNumber(browser?.skippedFieldUpdateCount);
    const palletSnapshot = readRecord(browser?.palletSnapshot);
    const palletRowCount = readNumber(palletSnapshot?.rowCount);
    const palletControlCount = readArray(palletSnapshot?.controls)?.length;

    console.log(
      [
        `- ${orderLabel}: ${order.status}`,
        order.responseStatus ? `response ${order.responseStatus}` : null,
        order.error ? `error ${order.error}` : null,
        screenshotDir ? `screenshots ${screenshotDir}` : null,
        fieldUpdatesSkipped ? `field updates skipped ${skippedFieldUpdateCount ?? 0}` : null,
        typeof palletRowCount === "number" ? `pallet rows ${palletRowCount}` : null,
        typeof palletControlCount === "number" ? `pallet controls ${palletControlCount}` : null
      ]
        .filter(Boolean)
        .join(" | ")
    );
  }

  const failedOrders = result.orders.filter((order) => order.status === "FAILED");

  if (failedOrders.length === 0) {
    return;
  }

  console.error(`Teamship Phase 2 worker completed with ${failedOrders.length} failed order(s).`);

  for (const order of failedOrders) {
    console.error(`- ${order.srNumber || order.teamshipOrderId || "unknown order"}: ${order.error ?? "Unknown failure."}`);
  }
}

function readRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function readArray(value: unknown) {
  return Array.isArray(value) ? value : null;
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value : null;
}

function readBoolean(value: unknown) {
  return typeof value === "boolean" ? value : null;
}

function readNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
