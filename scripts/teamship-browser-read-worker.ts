import { createTeamshipPlaywrightReadAdapter } from "@/modules/teamship/browser-read-execution";
import { buildTeamshipBrowserWorkerHeaders } from "@/modules/teamship/browser-worker-client";
import type {
  ClaimedTeamshipBrowserJob,
  TeamshipBrowserJobResult
} from "@/modules/teamship/browser-read-jobs";

type ClaimResponse = {
  data?: { job?: ClaimedTeamshipBrowserJob | null };
  error?: string;
};

type WorkerOptions = {
  baseUrl: string;
  token: string;
  workerId: string;
  once: boolean;
  pollIntervalMs: number;
  vercelProtectionBypass: string | null;
};

async function main() {
  const options = readOptions();
  const adapter = createTeamshipPlaywrightReadAdapter({
    appBaseUrl: process.env.TEAMSHIP_APP_BASE_URL?.trim() || "https://app.teamshipos.com",
    allowedHosts: readAllowedHosts(process.env.TEAMSHIP_BROWSER_ALLOWED_HOSTS),
    browserExecutablePath: process.env.TEAMSHIP_BROWSER_EXECUTABLE_PATH?.trim() || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    headed: process.env.TEAMSHIP_BROWSER_READ_HEADED === "true",
    navigationTimeoutMs: readPositiveInteger(process.env.TEAMSHIP_BROWSER_READ_TIMEOUT_MS, 30_000)
  });

  console.log(`Teamship browser read worker ${options.workerId} started (${options.once ? "once" : "polling"}).`);
  do {
    const job = await claimJob(options);
    if (!job) {
      if (options.once) {
        console.log("No Teamship browser read job is waiting.");
        return;
      }
      await sleep(options.pollIntervalMs);
      continue;
    }

    console.log(`Claimed Teamship browser read job ${job.id} (${job.operation}).`);
    try {
      const result = await executeJob(adapter, job);
      await completeJob(options, job.id, result);
      console.log(`Completed Teamship browser read job ${job.id}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown Teamship browser worker failure.";
      await failJob(options, job.id, "WORKER_ERROR", message).catch((failError) => {
        console.error(failError instanceof Error ? failError.message : "Unable to report Teamship browser job failure.");
      });
      console.error(`Failed Teamship browser read job ${job.id}: ${message}`);
      if (options.once) {
        process.exitCode = 1;
        return;
      }
    }
  } while (!options.once);
}

async function executeJob(
  adapter: ReturnType<typeof createTeamshipPlaywrightReadAdapter>,
  job: ClaimedTeamshipBrowserJob
): Promise<TeamshipBrowserJobResult> {
  if (job.operation === "searchInventoryAll" && job.input.operation === "searchInventoryAll") {
    return {
      operation: job.operation,
      rows: await adapter.searchInventoryAll({ credentials: job.credentials, scope: job.scope, sku: job.input.sku })
    };
  }
  if (job.operation === "searchLpn" && job.input.operation === "searchLpn") {
    return {
      operation: job.operation,
      rows: await adapter.searchLpn({
        credentials: job.credentials,
        scope: job.scope,
        queryType: job.input.queryType,
        query: job.input.query
      })
    };
  }
  if (job.operation === "getReceivingOrder" && job.input.operation === "getReceivingOrder") {
    return {
      operation: job.operation,
      rows: await adapter.getReceivingOrder({ credentials: job.credentials, scope: job.scope, orderId: job.input.orderId })
    };
  }
  if (job.operation === "getProductHistory" && job.input.operation === "getProductHistory") {
    return {
      operation: job.operation,
      rows: await adapter.getProductHistory({ credentials: job.credentials, scope: job.scope, productId: job.input.productId })
    };
  }
  throw new Error("Claimed Teamship browser job operation did not match its input payload.");
}

async function claimJob(options: WorkerOptions) {
  const response = await workerFetch(options, "/api/assistant/teamship/browser-jobs/claim", { method: "POST" });
  const body = await readJson<ClaimResponse>(response, "claim Teamship browser job");
  if (!response.ok) throw new Error(body.error ?? `Unable to claim Teamship browser job. HTTP ${response.status}.`);
  return body.data?.job ?? null;
}

async function completeJob(options: WorkerOptions, jobId: string, result: TeamshipBrowserJobResult) {
  const response = await workerFetch(options, `/api/assistant/teamship/browser-jobs/${encodeURIComponent(jobId)}/complete`, {
    method: "POST",
    body: JSON.stringify({ result })
  });
  const body = await readJson<{ error?: string }>(response, "complete Teamship browser job");
  if (!response.ok) throw new Error(body.error ?? `Unable to complete Teamship browser job ${jobId}. HTTP ${response.status}.`);
}

async function failJob(options: WorkerOptions, jobId: string, errorCode: string, errorMessage: string) {
  const response = await workerFetch(options, `/api/assistant/teamship/browser-jobs/${encodeURIComponent(jobId)}/fail`, {
    method: "POST",
    body: JSON.stringify({ errorCode, errorMessage })
  });
  const body = await readJson<{ error?: string }>(response, "fail Teamship browser job");
  if (!response.ok) throw new Error(body.error ?? `Unable to fail Teamship browser job ${jobId}. HTTP ${response.status}.`);
}

function workerFetch(options: WorkerOptions, path: string, init: RequestInit) {
  return fetch(new URL(path, options.baseUrl), {
    ...init,
    redirect: "manual",
    headers: buildTeamshipBrowserWorkerHeaders(options)
  });
}

async function readJson<T>(response: Response, action: string): Promise<T> {
  const text = await response.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    const location = response.headers.get("location");
    throw new Error(`Unable to ${action}. Expected JSON but received HTTP ${response.status}${location ? ` redirect to ${location}` : ""}.`);
  }
}

function readOptions(): WorkerOptions {
  const baseUrl = process.env.NEWL_APPS_BASE_URL?.trim();
  const token = process.env.TEAMSHIP_BROWSER_WORKER_TOKEN?.trim();
  if (!baseUrl) throw new Error("NEWL_APPS_BASE_URL is required.");
  if (!token) throw new Error("TEAMSHIP_BROWSER_WORKER_TOKEN is required.");
  return {
    baseUrl: baseUrl.replace(/\/+$/, ""),
    token,
    workerId: process.env.TEAMSHIP_BROWSER_WORKER_ID?.trim() || "mac-mini-teamship-browser",
    once: process.argv.includes("--once"),
    pollIntervalMs: readPositiveInteger(process.env.TEAMSHIP_BROWSER_WORKER_POLL_MS, 2_000),
    vercelProtectionBypass: process.env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim() || null
  };
}

function readAllowedHosts(value: string | undefined) {
  return value?.split(",").map((host) => host.trim()).filter(Boolean);
}

function readPositiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Teamship browser read worker failed.");
  process.exitCode = 1;
});
