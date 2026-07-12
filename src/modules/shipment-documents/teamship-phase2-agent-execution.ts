import type { TeamshipPhase2DryRunPlan, TeamshipPhase2OrderPlan } from "@/modules/shipment-documents/teamship-phase2-dry-run";

export type TeamshipPhase2AgentMode = "DRY_RUN" | "LIVE_API";

export type TeamshipPhase2AgentCredentials = {
  email: string;
  password: string;
  apiBaseUrl: string | null;
};

export type TeamshipPhase2WorkerJob = {
  id: string;
  agentMode: TeamshipPhase2AgentMode;
  dryRun: boolean;
};

export type TeamshipPhase2ExecutionOptions = {
  agentId: string;
  allowLiveUpdates: boolean;
  fetchImpl?: typeof fetch;
};

export type TeamshipPhase2ExecutionResult = {
  mode: TeamshipPhase2AgentMode;
  dryRun: boolean;
  wouldUpdateTeamship: boolean;
  executedAt: string;
  agentId: string;
  jobId: string;
  summary: TeamshipPhase2DryRunPlan["summary"];
  orders: TeamshipPhase2ExecutionOrderResult[];
  notes: string[];
};

export type TeamshipPhase2ExecutionOrderResult = {
  psNumber: string;
  srNumber: string;
  teamshipOrderId: string | null;
  status: TeamshipPhase2OrderPlan["status"] | "UPDATED" | "FAILED";
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
  updatePayload?: Record<string, unknown>;
  responseStatus?: number;
  error?: string;
};

const DEFAULT_TEAMSHIP_API_BASE_URL = "https://app.teamshipos.com/api";

type TeamshipLoginResponse = {
  data?: {
    token?: string;
  };
  token?: string;
};

export async function executeTeamshipPhase2Job({
  job,
  plan,
  credentials,
  options
}: {
  job: TeamshipPhase2WorkerJob;
  plan: TeamshipPhase2DryRunPlan;
  credentials: TeamshipPhase2AgentCredentials;
  options: TeamshipPhase2ExecutionOptions;
}) {
  if (job.agentMode === "DRY_RUN" || job.dryRun) {
    return buildDryRunEvidence({ job, plan, agentId: options.agentId });
  }

  if (!options.allowLiveUpdates) {
    throw new Error("Live Teamship updates require TEAMSHIP_ALLOW_LIVE_UPDATES=true or --allow-live-updates on the VM worker.");
  }

  return executeLiveApiUpdates({ job, plan, credentials, options });
}

export function buildDryRunEvidence({
  job,
  plan,
  agentId
}: {
  job: Pick<TeamshipPhase2WorkerJob, "id">;
  plan: TeamshipPhase2DryRunPlan;
  agentId: string;
}): TeamshipPhase2ExecutionResult {
  return {
    mode: "DRY_RUN",
    dryRun: true,
    wouldUpdateTeamship: false,
    executedAt: new Date().toISOString(),
    agentId,
    jobId: job.id,
    summary: plan.summary,
    orders: plan.orders.map((order) => mapPlannedOrder(order)),
    notes: [
      "Dry-run worker did not call Teamship update endpoints and did not save changes.",
      "The returned fieldActions and palletActions are the exact approved instructions a live adapter must execute.",
      "Newl Apps will rescan Teamship after this completion response is accepted."
    ]
  };
}

async function executeLiveApiUpdates({
  job,
  plan,
  credentials,
  options
}: {
  job: TeamshipPhase2WorkerJob;
  plan: TeamshipPhase2DryRunPlan;
  credentials: TeamshipPhase2AgentCredentials;
  options: TeamshipPhase2ExecutionOptions;
}): Promise<TeamshipPhase2ExecutionResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const apiBaseUrl = resolveTeamshipApiBaseUrl(credentials);
  const token = await loginToTeamship(fetchImpl, credentials, apiBaseUrl);
  const orders: TeamshipPhase2ExecutionOrderResult[] = [];

  for (const order of plan.orders) {
    const mappedOrder = mapPlannedOrder(order);

    if (order.status !== "READY" || !order.teamshipOrderId) {
      orders.push({
        ...mappedOrder,
        status: "FAILED",
        error: "Only READY orders with a Teamship order ID can be updated by the live API worker."
      });
      continue;
    }

    const updatePayload = buildTeamshipUpdatePayload(order);

    try {
      const responseStatus = await updateTeamshipShippingOrder({
        apiBaseUrl,
        token,
        teamshipOrderId: order.teamshipOrderId,
        updatePayload,
        fetchImpl
      });

      orders.push({
        ...mappedOrder,
        status: "UPDATED",
        updatePayload,
        responseStatus
      });
    } catch (error) {
      orders.push({
        ...mappedOrder,
        status: "FAILED",
        updatePayload,
        error: error instanceof Error ? error.message : "Unknown Teamship update failure."
      });
    }
  }

  const failedOrders = orders.filter((order) => order.status === "FAILED");

  if (failedOrders.length > 0) {
    throw new Error(`Live Teamship update failed for ${failedOrders.length} order(s): ${failedOrders.map((order) => order.srNumber).join(", ")}`);
  }

  return {
    mode: "LIVE_API",
    dryRun: false,
    wouldUpdateTeamship: true,
    executedAt: new Date().toISOString(),
    agentId: options.agentId,
    jobId: job.id,
    summary: plan.summary,
    orders,
    notes: [
      "Live API worker submitted approved order-level fields and pallet rows to Teamship.",
      "Newl Apps will rescan Teamship after this completion response is accepted."
    ]
  };
}

function mapPlannedOrder(order: TeamshipPhase2OrderPlan): TeamshipPhase2ExecutionOrderResult {
  return {
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
  };
}

export function buildTeamshipUpdatePayload(order: TeamshipPhase2OrderPlan): Record<string, unknown> {
  const flatFields = Object.assign(
    {},
    ...order.plannedFieldUpdates.map((field) => ({ [field.teamshipField]: field.proposedValue })),
    ...order.plannedPalletRows.map((row) => row.teamshipFields)
  );

  return {
    ...flatFields,
    pallet_dims: order.plannedPalletRows.map((row) => ({
      quantity: row.quantity,
      length: row.lengthIn,
      width: row.widthIn,
      height: row.heightIn,
      weight: row.weightLb,
      weight_unit: row.weightUnit,
      commodity: row.commodity
    }))
  };
}

async function loginToTeamship(fetchImpl: typeof fetch, credentials: TeamshipPhase2AgentCredentials, apiBaseUrl: string) {
  const response = await fetchImpl(`${apiBaseUrl}/v1/login`, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json"
    },
    body: JSON.stringify({
      email: credentials.email,
      password: credentials.password
    }),
    cache: "no-store"
  });
  const json = (await response.json().catch(() => null)) as TeamshipLoginResponse | null;

  if (!response.ok || !json) {
    throw new Error(`Teamship login failed with status ${response.status}.`);
  }

  const token = json.data?.token ?? json.token;

  if (!token) {
    throw new Error("Teamship login succeeded but did not return an API token.");
  }

  return token;
}

async function updateTeamshipShippingOrder({
  apiBaseUrl,
  token,
  teamshipOrderId,
  updatePayload,
  fetchImpl
}: {
  apiBaseUrl: string;
  token: string;
  teamshipOrderId: string;
  updatePayload: Record<string, unknown>;
  fetchImpl: typeof fetch;
}) {
  const url = `${apiBaseUrl}/v1/ship-inventories/${encodeURIComponent(teamshipOrderId)}`;
  const response = await fetchImpl(url, {
    method: "PATCH",
    headers: buildTeamshipHeaders(token),
    body: JSON.stringify(updatePayload),
    cache: "no-store"
  });

  if (response.ok) {
    return response.status;
  }

  if (response.status === 404 || response.status === 405) {
    const putResponse = await fetchImpl(url, {
      method: "PUT",
      headers: buildTeamshipHeaders(token),
      body: JSON.stringify(updatePayload),
      cache: "no-store"
    });

    if (putResponse.ok) {
      return putResponse.status;
    }

    throw new Error(`Teamship update failed with status ${putResponse.status}.`);
  }

  throw new Error(`Teamship update failed with status ${response.status}.`);
}

function buildTeamshipHeaders(token: string) {
  return {
    accept: "application/json",
    "content-type": "application/json",
    authorization: `Bearer ${token}`
  };
}

function resolveTeamshipApiBaseUrl(credentials: TeamshipPhase2AgentCredentials) {
  return (credentials.apiBaseUrl?.trim() || process.env.TEAMSHIP_API_BASE_URL?.trim() || DEFAULT_TEAMSHIP_API_BASE_URL).replace(/\/+$/, "");
}
