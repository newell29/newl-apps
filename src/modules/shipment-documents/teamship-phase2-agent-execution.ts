import type { TeamshipPhase2DryRunPlan, TeamshipPhase2OrderPlan } from "@/modules/shipment-documents/teamship-phase2-dry-run";

export type TeamshipPhase2AgentMode = "DRY_RUN" | "LIVE_API";
export type TeamshipPhase2ExecutionMode = TeamshipPhase2AgentMode | "LIVE_BROWSER";

export type TeamshipPhase2AgentCredentials = {
  email: string;
  password: string;
  apiBaseUrl: string | null;
  appBaseUrl?: string | null;
};

export type TeamshipPhase2WorkerJob = {
  id: string;
  agentMode: TeamshipPhase2AgentMode;
  dryRun: boolean;
};

export type TeamshipPhase2ExecutionOptions = {
  agentId: string;
  allowLiveUpdates: boolean;
  liveAllowlistSrNumbers?: string[];
  fetchImpl?: typeof fetch;
};

export type TeamshipPhase2ExecutionResult = {
  mode: TeamshipPhase2ExecutionMode;
  dryRun: boolean;
  wouldUpdateTeamship: boolean;
  executedAt: string;
  agentId: string;
  jobId: string;
  summary: TeamshipPhase2DryRunPlan["summary"];
  orders: TeamshipPhase2ExecutionOrderResult[];
  hasFailures: boolean;
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
    browserInstruction: TeamshipBrowserFieldInstruction;
  }>;
  palletActions: Array<{
    rowNumber: number;
    sku: string;
    quantity: number;
    hasUsableDimensions: boolean;
    commodity: string;
    fields: Record<string, string | number>;
    browserInstruction: {
      targetPage: "TEAMSHIP_ORDER_PALLETS";
      routeTemplate: "/ship-inventories/{teamshipOrderId}";
      absoluteUrl: string | null;
      targetRowNumber: number;
      zeroBasedLineItemIndex: number;
      actionBeforeFill: "FILL_EXISTING_PALLET_ROW" | "CLICK_ADD_ANOTHER_PALLET_SIZE";
      addAnotherPalletSizeButtonText: "Add Another Pallet Size" | null;
      fieldSelectors: {
        packages: string;
        commodity: string;
        dimensions: string;
      };
      saveInstruction: TeamshipBrowserSaveInstruction;
      note: string;
    };
  }>;
  saveInstruction: TeamshipBrowserSaveInstruction;
  validationIssues: string[];
  updatePayload?: Record<string, unknown>;
  apiUnsupportedActions?: string[];
  responseStatus?: number;
  error?: string;
};

const DEFAULT_TEAMSHIP_API_BASE_URL = "https://app.teamshipos.com/api";
const DEFAULT_TEAMSHIP_APP_BASE_URL = "https://app.teamshipos.com";

type TeamshipBrowserSaveInstruction = {
  action: "CLICK_SAVE_BUTTON_AFTER_EDIT" | "CONFIRM_INLINE_SAVE_OR_AUTOSAVE";
  buttonNames: string[];
  verification: string;
  fallback: string;
};

type TeamshipBrowserFieldInstruction = {
  preferredExecution: "TEAMSHIP_API";
  browserFallbackPage: "TEAMSHIP_SHIPPING_ORDER" | "TEAMSHIP_BOL_EDITOR";
  routeTemplate: "/ship-inventories/{teamshipOrderId}" | "/ship-inventories/{teamshipOrderId}/bol-editor";
  absoluteUrl?: string | null;
  fieldLabel: string;
  primaryLocator: {
    strategy: "LABEL_OR_NAME" | "DATA_FIELD_CONTENT";
    label?: string;
    selector?: string;
  };
  bolEditorFallback?: {
    dataField: string;
    selector: string;
    note: string;
  };
  editInstruction: string;
  saveInstruction: TeamshipBrowserSaveInstruction;
};

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
    return buildDryRunEvidence({
      job,
      plan,
      agentId: options.agentId,
      teamshipAppBaseUrl: resolveTeamshipAppBaseUrl(credentials)
    });
  }

  if (!options.allowLiveUpdates) {
    throw new Error("Live Teamship updates require TEAMSHIP_ALLOW_LIVE_UPDATES=true or --allow-live-updates on the VM worker.");
  }

  assertLiveAllowlist(plan, options.liveAllowlistSrNumbers);

  return executeLiveApiUpdates({ job, plan, credentials, options });
}

export function buildDryRunEvidence({
  job,
  plan,
  agentId,
  teamshipAppBaseUrl
}: {
  job: Pick<TeamshipPhase2WorkerJob, "id">;
  plan: TeamshipPhase2DryRunPlan;
  agentId: string;
  teamshipAppBaseUrl?: string | null;
}): TeamshipPhase2ExecutionResult {
  const appBaseUrl = normalizeBaseUrl(teamshipAppBaseUrl) || DEFAULT_TEAMSHIP_APP_BASE_URL;

  return {
    mode: "DRY_RUN",
    dryRun: true,
    wouldUpdateTeamship: false,
    executedAt: new Date().toISOString(),
    agentId,
    jobId: job.id,
    summary: plan.summary,
    orders: plan.orders.map((order) => mapPlannedOrder(order, appBaseUrl)),
    hasFailures: false,
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
  const appBaseUrl = resolveTeamshipAppBaseUrl(credentials, apiBaseUrl);
  const token = await loginToTeamship(fetchImpl, credentials, apiBaseUrl);
  const orders: TeamshipPhase2ExecutionOrderResult[] = [];

  for (const order of plan.orders) {
    const mappedOrder = mapPlannedOrder(order, appBaseUrl);

    if (order.status !== "READY" || !order.teamshipOrderId) {
      orders.push({
        ...mappedOrder,
        status: "FAILED",
        error: "Only READY orders with a Teamship order ID can be updated by the live API worker."
      });
      continue;
    }

    const { payload: updatePayload, unsupportedActions } = buildTeamshipDocumentedUpdatePayload(order);

    if (Object.keys(updatePayload).length === 0) {
      orders.push({
        ...mappedOrder,
        status: "FAILED",
        updatePayload,
        apiUnsupportedActions: unsupportedActions,
        error:
          "No documented Teamship shipping-order API fields were planned. Pallet DIMS/weight/commodity rows still require the live-browser worker or a Teamship pallet update endpoint."
      });
      continue;
    }

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
        apiUnsupportedActions: unsupportedActions,
        responseStatus
      });
    } catch (error) {
      orders.push({
        ...mappedOrder,
        status: "FAILED",
        updatePayload,
        apiUnsupportedActions: unsupportedActions,
        error: error instanceof Error ? error.message : "Unknown Teamship update failure."
      });
    }
  }

  const failedOrders = orders.filter((order) => order.status === "FAILED");

  return {
    mode: "LIVE_API",
    dryRun: false,
    wouldUpdateTeamship: true,
    executedAt: new Date().toISOString(),
    agentId: options.agentId,
    jobId: job.id,
    summary: plan.summary,
    orders,
    hasFailures: failedOrders.length > 0,
    notes: [
      failedOrders.length > 0
        ? `Live API worker completed with ${failedOrders.length} failed order(s): ${failedOrders.map((order) => order.srNumber).join(", ")}.`
        : "Live API worker submitted approved order-level fields and pallet rows to Teamship.",
      "Newl Apps will rescan Teamship after this completion response is accepted."
    ]
  };
}

function mapPlannedOrder(
  order: TeamshipPhase2OrderPlan,
  teamshipAppBaseUrl = DEFAULT_TEAMSHIP_APP_BASE_URL
): TeamshipPhase2ExecutionOrderResult {
  return {
    psNumber: order.psNumber,
    srNumber: order.srNumber,
    teamshipOrderId: order.teamshipOrderId,
    status: order.status,
    fieldActions: order.plannedFieldUpdates.map((field) => ({
      teamshipField: field.teamshipField,
      from: field.currentValue,
      to: field.proposedValue,
      reason: field.reason,
      browserInstruction: withBrowserUrl(buildFieldBrowserInstruction(field.teamshipField), order.teamshipOrderId, teamshipAppBaseUrl)
    })),
    palletActions: order.plannedPalletRows.map((row) => ({
      rowNumber: row.rowNumber,
      sku: row.sku,
      quantity: row.quantity,
      hasUsableDimensions: row.hasUsableDimensions,
      commodity: row.commodity,
      fields: row.teamshipFields,
      browserInstruction: withBrowserUrl(buildPalletBrowserInstruction(row.rowNumber), order.teamshipOrderId, teamshipAppBaseUrl)
    })),
    saveInstruction: buildOrderCompletionSaveInstruction(),
    validationIssues: order.validationIssues
  };
}

function withBrowserUrl<T extends { routeTemplate: string }>(
  instruction: T,
  teamshipOrderId: string | null,
  teamshipAppBaseUrl: string
): T & { absoluteUrl: string | null } {
  return {
    ...instruction,
    absoluteUrl: buildTeamshipBrowserUrl(instruction.routeTemplate, teamshipOrderId, teamshipAppBaseUrl)
  };
}

function buildTeamshipBrowserUrl(routeTemplate: string, teamshipOrderId: string | null, teamshipAppBaseUrl: string) {
  if (!teamshipOrderId) {
    return null;
  }

  const route = routeTemplate.replace("{teamshipOrderId}", encodeURIComponent(teamshipOrderId));
  const normalizedRoute = route.startsWith("/") ? route : `/${route}`;

  return `${normalizeBaseUrl(teamshipAppBaseUrl) || DEFAULT_TEAMSHIP_APP_BASE_URL}${normalizedRoute}`;
}

function buildPalletBrowserInstruction(rowNumber: number) {
  const lineItemIndex = rowNumber - 1;
  const fieldSelectors = {
    packages: `[data-field-content="line_item_${lineItemIndex}_packages"]`,
    commodity: `[data-field-content="line_item_${lineItemIndex}_commodity"]`,
    dimensions: `[data-field-content="line_item_${lineItemIndex}_dimensions"]`
  };

  if (rowNumber === 1) {
    return {
      targetPage: "TEAMSHIP_ORDER_PALLETS" as const,
      routeTemplate: "/ship-inventories/{teamshipOrderId}" as const,
      targetRowNumber: rowNumber,
      zeroBasedLineItemIndex: lineItemIndex,
      actionBeforeFill: "FILL_EXISTING_PALLET_ROW" as const,
      addAnotherPalletSizeButtonText: null,
      fieldSelectors,
      saveInstruction: buildShippingOrderSaveInstruction(),
      note: "Use the existing first pallet row in the Pallets section on the Teamship shipping order page."
    };
  }

  return {
    targetPage: "TEAMSHIP_ORDER_PALLETS" as const,
    routeTemplate: "/ship-inventories/{teamshipOrderId}" as const,
    targetRowNumber: rowNumber,
    zeroBasedLineItemIndex: lineItemIndex,
    actionBeforeFill: "CLICK_ADD_ANOTHER_PALLET_SIZE" as const,
    addAnotherPalletSizeButtonText: "Add Another Pallet Size" as const,
    fieldSelectors,
    saveInstruction: buildShippingOrderSaveInstruction(),
    note:
      `On the Teamship shipping order page, click "Add Another Pallet Size" until pallet row ${rowNumber} exists, then fill this row's fields.`
  };
}

function buildFieldBrowserInstruction(teamshipField: string): TeamshipBrowserFieldInstruction {
  const instruction = FIELD_BROWSER_INSTRUCTIONS[teamshipField];

  if (instruction) {
    return instruction;
  }

  return {
    preferredExecution: "TEAMSHIP_API",
    browserFallbackPage: "TEAMSHIP_SHIPPING_ORDER",
    routeTemplate: "/ship-inventories/{teamshipOrderId}",
    fieldLabel: teamshipField,
    primaryLocator: {
      strategy: "LABEL_OR_NAME",
      label: teamshipField
    },
    editInstruction: `Find the Teamship order field named "${teamshipField}", replace it with the approved Newl Apps value, then save.`,
    saveInstruction: buildShippingOrderSaveInstruction()
  };
}

const FIELD_BROWSER_INSTRUCTIONS: Record<string, TeamshipBrowserFieldInstruction> = {
  poNumber: {
    preferredExecution: "TEAMSHIP_API",
    browserFallbackPage: "TEAMSHIP_SHIPPING_ORDER",
    routeTemplate: "/ship-inventories/{teamshipOrderId}",
    fieldLabel: "PO Number",
    primaryLocator: {
      strategy: "LABEL_OR_NAME",
      label: "PO Number"
    },
    bolEditorFallback: {
      dataField: "customer_order_0_order_number",
      selector: '[data-field-content="customer_order_0_order_number"]',
      note: "The BOL editor renders the customer PO in Customer Order Information. Prefer the shipping-order field when available."
    },
    editInstruction: "Open the Teamship shipping order, find PO Number, replace it with the approved Newl Apps value, then save.",
    saveInstruction: buildShippingOrderSaveInstruction()
  },
  edi_field_3: {
    preferredExecution: "TEAMSHIP_API",
    browserFallbackPage: "TEAMSHIP_SHIPPING_ORDER",
    routeTemplate: "/ship-inventories/{teamshipOrderId}",
    fieldLabel: "Freight Terms Code",
    primaryLocator: {
      strategy: "LABEL_OR_NAME",
      label: "Freight Terms Code"
    },
    bolEditorFallback: {
      dataField: "instructions",
      selector: '[data-field-content="instructions"]',
      note: "The BOL editor shows this inside the INSTRUCTIONS block as Payment Terms:<value>; keep the full instruction text intact."
    },
    editInstruction: "Open the Teamship shipping order, find Freight Terms Code, replace it with the approved Newl Apps value, then save.",
    saveInstruction: buildShippingOrderSaveInstruction()
  },
  carrier_value: {
    preferredExecution: "TEAMSHIP_API",
    browserFallbackPage: "TEAMSHIP_BOL_EDITOR",
    routeTemplate: "/ship-inventories/{teamshipOrderId}/bol-editor",
    fieldLabel: "Carrier / Ship Via",
    primaryLocator: {
      strategy: "DATA_FIELD_CONTENT",
      selector: '[data-field-content="carrier"]'
    },
    editInstruction: "Open the editable BOL, click the CARRIER field, replace it with the approved Newl Apps carrier value, and confirm the inline save.",
    saveInstruction: buildInlineBolEditorSaveInstruction()
  },
  edi_field_4: {
    preferredExecution: "TEAMSHIP_API",
    browserFallbackPage: "TEAMSHIP_SHIPPING_ORDER",
    routeTemplate: "/ship-inventories/{teamshipOrderId}",
    fieldLabel: "Special Instructions",
    primaryLocator: {
      strategy: "LABEL_OR_NAME",
      label: "Special Instructions"
    },
    bolEditorFallback: {
      dataField: "instructions",
      selector: '[data-field-content="instructions"]',
      note: "The BOL editor displays Special Instructions in the INSTRUCTIONS block below Payment Terms."
    },
    editInstruction: "Open the Teamship shipping order, find Special Instructions, replace it with the approved Newl Apps value, then save.",
    saveInstruction: buildShippingOrderSaveInstruction()
  }
};

function buildShippingOrderSaveInstruction(): TeamshipBrowserSaveInstruction {
  return {
    action: "CLICK_SAVE_BUTTON_AFTER_EDIT",
    buttonNames: ["Save", "Update", "Save Changes"],
    verification: "Wait for Teamship to finish saving, then re-read the field and confirm it matches the approved Newl Apps value.",
    fallback: "If the page uses inline autosave and no Save/Update button is visible, blur the field, wait for network idle, and verify the displayed value."
  };
}

function buildInlineBolEditorSaveInstruction(): TeamshipBrowserSaveInstruction {
  return {
    action: "CONFIRM_INLINE_SAVE_OR_AUTOSAVE",
    buttonNames: ["Save", "Update", "Done", "✓"],
    verification: "After editing, confirm the BOL field displays the approved value and any loading indicator has cleared before moving to the next field.",
    fallback:
      "The Teamship BOL editor may autosave inline fields. If no Save/Update button appears, press Enter or blur the field, wait for Livewire/network idle, and verify the field text changed."
  };
}

function buildOrderCompletionSaveInstruction(): TeamshipBrowserSaveInstruction {
  return {
    action: "CLICK_SAVE_BUTTON_AFTER_EDIT",
    buttonNames: ["Save", "Update", "Save Changes"],
    verification:
      "Before reporting SUCCESS, every edited order-level field and BOL editor line must display the approved Newl Apps value after save/autosave.",
    fallback:
      "If Teamship provides only inline autosave for the BOL editor, verify the updated display values and wait for loading indicators to clear before reporting completion."
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

export function buildTeamshipDocumentedUpdatePayload(order: TeamshipPhase2OrderPlan): {
  payload: Record<string, unknown>;
  unsupportedActions: string[];
} {
  const payload: Record<string, unknown> = {};
  const unsupportedActions: string[] = [];

  for (const field of order.plannedFieldUpdates) {
    const apiField = mapDocumentedTeamshipApiField(field.teamshipField);

    if (!apiField) {
      unsupportedActions.push(`Field ${field.teamshipField} is not documented for PUT /v1/ship-inventories/{id}.`);
      continue;
    }

    payload[apiField] = field.proposedValue;
  }

  if (order.plannedPalletRows.length > 0) {
    unsupportedActions.push(
      `${order.plannedPalletRows.length} pallet DIMS/weight/commodity row(s) are browser-only until Teamship documents a pallet update endpoint.`
    );
  }

  return { payload, unsupportedActions };
}

function mapDocumentedTeamshipApiField(teamshipField: string) {
  if (/^edi_field_\d+$/.test(teamshipField)) {
    return teamshipField;
  }

  const documentedFieldAliases: Record<string, string> = {
    shippingMethod: "shippingMethod",
    shippingServiceLevel: "shippingServiceLevel",
    pickETA_date: "pickETA_date",
    carrier: "carrier",
    carrier_value: "carrier",
    proNumber: "proNumber",
    poNumber: "poNumber",
    supplier: "supplier",
    ship_first_name: "ship_first_name",
    ship_last_name: "ship_last_name",
    ship_address: "ship_address",
    ship_city: "ship_city",
    ship_state: "ship_state",
    ship_zip: "ship_zip",
    ship_country: "ship_country",
    ship_phone_number: "ship_phone_number",
    ship_email: "ship_email"
  };

  return documentedFieldAliases[teamshipField] ?? null;
}

function assertLiveAllowlist(plan: TeamshipPhase2DryRunPlan, allowlistSrNumbers: string[] | undefined) {
  const allowlistValues = allowlistSrNumbers ?? [];

  if (allowlistValues.some((value) => value.trim() === "*")) {
    return;
  }

  const allowlist = new Set(allowlistValues.map(normalizeIdentifier).filter(Boolean));

  if (allowlist.size === 0) {
    throw new Error("Live Teamship updates require TEAMSHIP_LIVE_ALLOWLIST_SR_NUMBERS or --allow-sr for rollout safety.");
  }

  const blockedSrNumbers = plan.orders
    .filter((order) => order.status === "READY")
    .map((order) => order.srNumber)
    .filter((srNumber) => !allowlist.has(normalizeIdentifier(srNumber)));

  if (blockedSrNumbers.length > 0) {
    throw new Error(`Live Teamship update blocked because these SRs are not allowlisted: ${blockedSrNumbers.join(", ")}.`);
  }
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
    method: "PUT",
    headers: buildTeamshipHeaders(token),
    body: JSON.stringify(updatePayload),
    cache: "no-store"
  });

  if (response.ok) {
    return response.status;
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
  return normalizeBaseUrl(credentials.apiBaseUrl) || normalizeBaseUrl(process.env.TEAMSHIP_API_BASE_URL) || DEFAULT_TEAMSHIP_API_BASE_URL;
}

function resolveTeamshipAppBaseUrl(credentials: TeamshipPhase2AgentCredentials, apiBaseUrl?: string) {
  return (
    normalizeBaseUrl(credentials.appBaseUrl) ||
    normalizeBaseUrl(process.env.TEAMSHIP_APP_BASE_URL) ||
    deriveTeamshipAppBaseUrl(apiBaseUrl ?? resolveTeamshipApiBaseUrl(credentials)) ||
    DEFAULT_TEAMSHIP_APP_BASE_URL
  );
}

function deriveTeamshipAppBaseUrl(apiBaseUrl: string | null | undefined) {
  const normalizedApiBaseUrl = normalizeBaseUrl(apiBaseUrl);

  if (!normalizedApiBaseUrl) {
    return null;
  }

  return normalizedApiBaseUrl.replace(/\/api$/, "");
}

function normalizeBaseUrl(value: string | null | undefined) {
  const normalizedValue = value?.trim().replace(/\/+$/, "");

  return normalizedValue || null;
}

function normalizeIdentifier(value: string) {
  return value
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}
