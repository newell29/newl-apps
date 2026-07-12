type WorkerOptions = {
  baseUrl: string;
  token: string;
  agentId: string;
  mode: "dry-run" | "live-api";
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
  status: string;
  dryRun: boolean;
  selectedSrNumbers: string[];
};

type TeamshipPhase2DryRunPlan = {
  mode: "DRY_RUN";
  dryRun: true;
  wouldUpdateTeamship: false;
  summary: {
    orderCount: number;
    readyCount: number;
    blockedCount: number;
    skippedCount: number;
    plannedFieldUpdateCount: number;
    plannedPalletRowCount: number;
  };
  orders: TeamshipPhase2OrderPlan[];
};

type TeamshipPhase2OrderPlan = {
  psNumber: string;
  srNumber: string;
  teamshipOrderId: string | null;
  teamshipUrl: string | null;
  status: "READY" | "BLOCKED" | "SKIPPED";
  plannedFieldUpdates: Array<{
    label: string;
    teamshipField: string;
    currentValue: string | null;
    proposedValue: string;
    reason: string;
  }>;
  plannedPalletRows: Array<{
    rowNumber: number;
    sku: string;
    quantity: number;
    hasUsableDimensions: boolean;
    commodity: string;
    teamshipFields: Record<string, string | number>;
  }>;
  validationIssues: string[];
};

type AgentExecutionResult = {
  mode: "DRY_RUN" | "LIVE_API";
  dryRun: boolean;
  wouldUpdateTeamship: boolean;
  executedAt: string;
  agentId: string;
  jobId: string;
  summary: TeamshipPhase2DryRunPlan["summary"];
  orders: Array<{
    psNumber: string;
    srNumber: string;
    teamshipOrderId: string | null;
    status: TeamshipPhase2OrderPlan["status"];
    fieldActions: Array<{
      teamshipField: string;
      from: string | null;
      to: string;
      reason: string;
    }>;
    palletActions: Array<{
      rowNumber: number;
      sku: string;
      quantity: number;
      hasUsableDimensions: boolean;
      commodity: string;
      fields: Record<string, string | number>;
    }>;
    validationIssues: string[];
  }>;
  notes: string[];
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
      status: "SUCCESS",
      result
    });
    console.log(`Reported ${result.mode} completion for job ${claimed.job.id}.`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Teamship Phase 2 worker error.";
    await completeJob({
      options,
      jobId: claimed.job.id,
      status: "FAILED",
      result: {
        mode: options.mode === "dry-run" ? "DRY_RUN" : "LIVE_API",
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
}): Promise<AgentExecutionResult> {
  if (options.mode === "live-api") {
    throw new Error(
      "LIVE_API mode is intentionally not enabled yet. Add a verified Teamship update adapter before setting TEAMSHIP_AGENT_MODE=live-api."
    );
  }

  return buildDryRunEvidence({ options, job: claimed.job, plan: claimed.executionPayload });
}

function buildDryRunEvidence({
  options,
  job,
  plan
}: {
  options: WorkerOptions;
  job: TeamshipUpdateJobSummary;
  plan: TeamshipPhase2DryRunPlan;
}): AgentExecutionResult {
  return {
    mode: "DRY_RUN",
    dryRun: true,
    wouldUpdateTeamship: false,
    executedAt: new Date().toISOString(),
    agentId: options.agentId,
    jobId: job.id,
    summary: plan.summary,
    orders: plan.orders.map((order) => ({
      psNumber: order.psNumber,
      srNumber: order.srNumber,
      teamshipOrderId: order.teamshipOrderId,
      status: order.status,
      fieldActions: order.plannedFieldUpdates.map((field) => ({
        teamshipField: field.teamshipField,
        from: field.currentValue,
        to: field.proposedValue,
        reason: field.reason
      })),
      palletActions: order.plannedPalletRows.map((row) => ({
        rowNumber: row.rowNumber,
        sku: row.sku,
        quantity: row.quantity,
        hasUsableDimensions: row.hasUsableDimensions,
        commodity: row.commodity,
        fields: row.teamshipFields
      })),
      validationIssues: order.validationIssues
    })),
    notes: [
      "Dry-run worker did not call Teamship update endpoints and did not save changes.",
      "The returned fieldActions and palletActions are the exact approved instructions a live adapter must execute.",
      "Newl Apps will rescan Teamship after this completion response is accepted."
    ]
  };
}

async function claimNextJob(options: WorkerOptions): Promise<ClaimResponse> {
  const response = await fetch(`${options.baseUrl}/api/shipment-documents/teamship-review/update-jobs/agent/next`, {
    method: "POST",
    headers: buildAgentHeaders(options)
  });
  const json = (await response.json().catch(() => null)) as ClaimResponse | null;

  if (!response.ok || !json) {
    throw new Error(json?.error ?? `Unable to claim Teamship update job. HTTP ${response.status}.`);
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
  const json = (await response.json().catch(() => null)) as CompleteResponse | null;

  if (!response.ok || !json) {
    throw new Error(json?.error ?? `Unable to complete Teamship update job ${jobId}. HTTP ${response.status}.`);
  }

  return json;
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
    loop,
    intervalMs
  };
}

function readStringOption(args: string[], name: string) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1]?.trim() || null : null;
}

function readMode(value: string): WorkerOptions["mode"] {
  if (value === "dry-run" || value === "live-api") {
    return value;
  }

  throw new Error("TEAMSHIP_AGENT_MODE must be dry-run or live-api.");
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
