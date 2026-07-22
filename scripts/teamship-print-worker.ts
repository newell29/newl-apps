import {
  executeTeamshipPrintJob,
  TeamshipPrintExecutionError
} from "@/modules/teamship/print-execution";
import type {
  ClaimedTeamshipPrintJob,
  TeamshipPrintExecutionResult
} from "@/modules/teamship/print-jobs";

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
  console.log(`Teamship print worker ${options.workerId} started (${options.once ? "once" : "polling"}).`);
  do {
    const job = await claimJob(options);
    if (!job) {
      if (options.once) {
        console.log("No approved Teamship print job is waiting.");
        return;
      }
      await sleep(options.pollIntervalMs);
      continue;
    }

    console.log(`Claimed Teamship print job ${job.id} for order ${job.shippingOrderNumber}.`);
    try {
      const result = await executeTeamshipPrintJob(job, {
        appBaseUrl: process.env.TEAMSHIP_APP_BASE_URL?.trim() || undefined,
        allowedHosts: readAllowedHosts(process.env.TEAMSHIP_BROWSER_ALLOWED_HOSTS),
        browserExecutablePath: process.env.TEAMSHIP_BROWSER_EXECUTABLE_PATH?.trim() || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        headed: process.env.TEAMSHIP_PRINT_HEADED === "true",
        navigationTimeoutMs: readPositiveInteger(process.env.TEAMSHIP_PRINT_TIMEOUT_MS, 30_000)
      });
      await completeJob(options, job.id, result);
      console.log(`Completed Teamship print job ${job.id}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown Teamship print worker failure.";
      const partialResult = error instanceof TeamshipPrintExecutionError ? error.partialResult : undefined;
      await failJob(options, job.id, "PRINT_EXECUTION_FAILED", message, partialResult).catch((reportError) => {
        console.error(reportError instanceof Error ? reportError.message : "Unable to report print failure.");
      });
      console.error(`Failed Teamship print job ${job.id}: ${message}`);
      // Never retry an uncertain or partially printed job automatically.
      if (options.once) {
        process.exitCode = 1;
        return;
      }
    }
  } while (!options.once);
}

async function claimJob(options: WorkerOptions) {
  const response = await workerFetch(options, "/api/assistant/printing/jobs/claim", { method: "POST" });
  const body = await readJson<{ data?: { job?: ClaimedTeamshipPrintJob | null }; error?: string }>(response, "claim Teamship print job");
  if (!response.ok) throw new Error(body.error ?? `Unable to claim Teamship print job. HTTP ${response.status}.`);
  return body.data?.job ?? null;
}

async function completeJob(options: WorkerOptions, jobId: string, result: TeamshipPrintExecutionResult) {
  const response = await workerFetch(options, `/api/assistant/printing/jobs/${encodeURIComponent(jobId)}/complete`, {
    method: "POST",
    body: JSON.stringify({ result })
  });
  const body = await readJson<{ error?: string }>(response, "complete Teamship print job");
  if (!response.ok) throw new Error(body.error ?? `Unable to complete Teamship print job ${jobId}. HTTP ${response.status}.`);
}

async function failJob(options: WorkerOptions, jobId: string, errorCode: string, errorMessage: string, result?: unknown) {
  const response = await workerFetch(options, `/api/assistant/printing/jobs/${encodeURIComponent(jobId)}/fail`, {
    method: "POST",
    body: JSON.stringify({ errorCode, errorMessage, result })
  });
  const body = await readJson<{ error?: string }>(response, "fail Teamship print job");
  if (!response.ok) throw new Error(body.error ?? `Unable to fail Teamship print job ${jobId}. HTTP ${response.status}.`);
}

function workerFetch(options: WorkerOptions, pathname: string, init: RequestInit) {
  return fetch(new URL(pathname, options.baseUrl), {
    ...init,
    redirect: "manual",
    headers: {
      authorization: `Bearer ${options.token}`,
      "content-type": "application/json",
      "x-teamship-print-worker-id": options.workerId,
      ...(options.vercelProtectionBypass ? { "x-vercel-protection-bypass": options.vercelProtectionBypass } : {})
    }
  });
}

async function readJson<T>(response: Response, action: string): Promise<T> {
  const text = await response.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`Unable to ${action}. Expected JSON but received HTTP ${response.status}.`);
  }
}

function readOptions(): WorkerOptions {
  const baseUrl = process.env.NEWL_APPS_BASE_URL?.trim();
  const token = process.env.TEAMSHIP_PRINT_WORKER_TOKEN?.trim();
  if (!baseUrl) throw new Error("NEWL_APPS_BASE_URL is required.");
  if (!token) throw new Error("TEAMSHIP_PRINT_WORKER_TOKEN is required.");
  const url = new URL(baseUrl);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "::1"].includes(url.hostname))) {
    throw new Error("NEWL_APPS_BASE_URL must use HTTPS outside local development.");
  }
  return {
    baseUrl: baseUrl.replace(/\/+$/, ""),
    token,
    workerId: process.env.TEAMSHIP_PRINT_WORKER_ID?.trim() || "mac-mini-teamship-print",
    once: process.argv.includes("--once"),
    pollIntervalMs: readPositiveInteger(process.env.TEAMSHIP_PRINT_WORKER_POLL_MS, 2_000),
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
  console.error(error instanceof Error ? error.message : "Teamship print worker failed.");
  process.exitCode = 1;
});
