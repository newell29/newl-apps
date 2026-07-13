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
  browserScreenshotRootDir: string | null;
  browserAllowedHosts: string[];
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
  const browserScreenshotRootDir =
    readStringOption(args, "--screenshot-dir") ?? process.env.TEAMSHIP_BROWSER_SCREENSHOT_DIR ?? null;
  const browserAllowedHosts = readListOption(args, "--browser-allowed-host", process.env.TEAMSHIP_BROWSER_ALLOWED_HOSTS);
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

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
