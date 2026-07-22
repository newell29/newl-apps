import { createHash } from "node:crypto";
import { Type } from "typebox";
import { defineToolPlugin } from "openclaw/plugin-sdk/tool-plugin";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DEFAULT_PRINT_TOKEN_ENV = "OPENCLAW_PRINT_TOKEN";
const RESERVED_TOKEN_ENVS = new Set(["OPENCLAW_TEAMSHIP_READ_TOKEN", "OPENCLAW_ASSISTANT_TOKEN"]);

type PrintPluginConfig = {
  baseUrl: string;
  tenantId: string;
  printTokenEnv?: string;
  vercelProtectionBypassEnv?: string;
};

type PrintToolContext = {
  messageChannel?: string;
  requesterSenderId?: string;
};

type PrintJobResponse = {
  id: string;
  shippingOrderNumber: string;
  customerName: string;
  warehouseName: string;
  status: string;
  approvedPalletCount: number;
  documentPlan: {
    pickingListCopies: number;
    bolCopies: number;
    outboundLabelCopies: number;
  };
  printerPlan: {
    pickingList: { queue: string; displayName: string };
    bol: { exactName: string };
    outboundLabels: { exactName: string };
  };
  result?: {
    documents?: Array<{ kind?: string; status?: string; printer?: string; copies?: number }>;
  } | null;
  errorMessage?: string | null;
};

const planParameters = Type.Object({
  shippingOrderNumber: Type.String({
    pattern: "^\\d{1,10}$",
    description: "The exact numeric Teamship shipping-order number, for example 30666. Do not pass an SR or PS number."
  })
});

const approvalParameters = Type.Object({
  jobId: Type.String({ minLength: 10, maxLength: 40 }),
  confirmed: Type.Boolean({
    description: "Set true only after the authenticated employee explicitly approves this exact print request in Teams."
  })
});

const statusParameters = Type.Object({
  jobId: Type.String({ minLength: 10, maxLength: 40 })
});

const configSchema = Type.Object({
  baseUrl: Type.String({ description: "Newl Apps base URL." }),
  tenantId: Type.String({ description: "Microsoft Entra tenant ID used by the configured Teams channel." }),
  printTokenEnv: Type.Optional(Type.String({
    description: "Environment variable containing the dedicated Newl Apps print token."
  })),
  vercelProtectionBypassEnv: Type.Optional(Type.String({
    description: "Optional environment variable containing a Vercel Preview automation bypass secret."
  }))
});

export default defineToolPlugin({
  id: "newl-print",
  name: "Newl Printing",
  description: "Creates and approves audited, single-order Teamship printing jobs through Newl Apps.",
  configSchema,
  tools: (tool) => [
    tool({
      name: "newl_print_plan",
      label: "Plan Shipping Documents",
      description: "Call when an authenticated employee asks to print the picking list, BOL, and outbound pallet labels for one exact numeric Teamship shipping-order number. This creates an approval-required plan only; it does not print. Phase 1 supports Garland at Annagem only and never accepts a batch.",
      parameters: planParameters,
      factory: createPrintPlanTool
    }),
    tool({
      name: "newl_print_approve",
      label: "Approve Shipping Documents",
      description: "Call only after the same authenticated employee explicitly approves the exact print request ID returned by newl_print_plan. Never infer approval from the original request, silence, a scheduled job, or a batch instruction.",
      parameters: approvalParameters,
      factory: createPrintApprovalTool
    }),
    tool({
      name: "newl_print_status",
      label: "Check Print Status",
      description: "Check the status of a single print request created by the same authenticated employee. This tool never retries a failed or uncertain print job.",
      parameters: statusParameters,
      factory: createPrintStatusTool
    })
  ]
});

export function createPrintPlanTool({ config, toolContext }: { config: PrintPluginConfig; toolContext: PrintToolContext }) {
  return {
    name: "newl_print_plan",
    label: "Plan Shipping Documents",
    description: "Create an approval-required single-order print plan.",
    parameters: planParameters,
    async execute(toolCallId: string, params: unknown, signal?: AbortSignal) {
      const auth = resolveAuth(config, toolContext);
      if (!auth.ok) return auth.result;
      const shippingOrderNumber = readShippingOrderNumber(params);
      const response = await callPrintingApi(config, auth.value, {
        action: "plan",
        shippingOrderNumber,
        requestKey: createHash("sha256").update(`${toolCallId}:${auth.value.senderId}:${shippingOrderNumber}`).digest("hex")
      }, signal);
      if (!response.ok || !response.body.data) {
        return textResult(response.body.error || `Print planning returned HTTP ${response.status}.`, "failed");
      }
      return textResult(
        response.body.data.status === "PENDING_APPROVAL" ? formatApprovalRequest(response.body.data) : formatPrintStatus(response.body.data),
        statusDetail(response.body.data.status)
      );
    }
  };
}

export function createPrintApprovalTool({ config, toolContext }: { config: PrintPluginConfig; toolContext: PrintToolContext }) {
  return {
    name: "newl_print_approve",
    label: "Approve Shipping Documents",
    description: "Approve one exact print request after explicit employee confirmation.",
    parameters: approvalParameters,
    async execute(_toolCallId: string, params: unknown, signal?: AbortSignal) {
      const auth = resolveAuth(config, toolContext);
      if (!auth.ok) return auth.result;
      const values = asRecord(params);
      const jobId = readJobId(values.jobId);
      if (values.confirmed !== true) return textResult("Explicit confirmation is required. Nothing was printed.", "failed");
      let response = await callPrintingApi(config, auth.value, { action: "approve", jobId, confirmed: true }, signal);
      if (!response.ok || !response.body.data) {
        return textResult(response.body.error || `Print approval returned HTTP ${response.status}.`, "failed");
      }
      let job = response.body.data;
      const deadline = Date.now() + 90_000;
      while (["APPROVED", "CLAIMED"].includes(job.status) && Date.now() < deadline && !signal?.aborted) {
        try {
          await sleep(2_000, signal);
        } catch {
          break;
        }
        response = await callPrintingApi(config, auth.value, { action: "status", jobId }, signal);
        if (!response.ok || !response.body.data) break;
        job = response.body.data;
      }
      return textResult(formatPrintStatus(job), statusDetail(job.status));
    }
  };
}

export function createPrintStatusTool({ config, toolContext }: { config: PrintPluginConfig; toolContext: PrintToolContext }) {
  return {
    name: "newl_print_status",
    label: "Check Print Status",
    description: "Read one print request without retrying it.",
    parameters: statusParameters,
    async execute(_toolCallId: string, params: unknown, signal?: AbortSignal) {
      const auth = resolveAuth(config, toolContext);
      if (!auth.ok) return auth.result;
      const jobId = readJobId(asRecord(params).jobId);
      const response = await callPrintingApi(config, auth.value, { action: "status", jobId }, signal);
      if (!response.ok || !response.body.data) {
        return textResult(response.body.error || `Print status returned HTTP ${response.status}.`, "failed");
      }
      return textResult(formatPrintStatus(response.body.data), statusDetail(response.body.data.status));
    }
  };
}

function resolveAuth(config: PrintPluginConfig, toolContext: PrintToolContext) {
  const senderId = normalizeUuid(toolContext.requesterSenderId);
  const tenantId = normalizeUuid(config.tenantId);
  if (toolContext.messageChannel !== "msteams" || !senderId || !tenantId) {
    return { ok: false as const, result: textResult("Newl Apps printing requires an authenticated Microsoft Teams message with a valid Entra identity.", "unauthorized") };
  }
  const tokenEnv = config.printTokenEnv?.trim() || DEFAULT_PRINT_TOKEN_ENV;
  if (RESERVED_TOKEN_ENVS.has(tokenEnv)) {
    return { ok: false as const, result: textResult("Newl Apps printing requires a dedicated credential separate from Teamship reads and other assistant actions.", "not_configured") };
  }
  const token = process.env[tokenEnv]?.trim();
  if (!token) return { ok: false as const, result: textResult("Newl Apps print authentication is not configured on this OpenClaw runtime.", "not_configured") };
  const bypassEnv = config.vercelProtectionBypassEnv?.trim();
  const bypassToken = bypassEnv ? process.env[bypassEnv]?.trim() : undefined;
  if (bypassEnv && !bypassToken) {
    return { ok: false as const, result: textResult("Newl Apps Preview protection authentication is not configured on this OpenClaw runtime.", "not_configured") };
  }
  return { ok: true as const, value: { senderId, tenantId, token, bypassToken } };
}

async function callPrintingApi(
  config: PrintPluginConfig,
  auth: { senderId: string; tenantId: string; token: string; bypassToken?: string },
  body: Record<string, unknown>,
  signal?: AbortSignal
) {
  const response = await fetch(new URL("/api/assistant/printing", normalizeBaseUrl(config.baseUrl)), {
    method: "POST",
    redirect: "manual",
    signal,
    headers: {
      authorization: `Bearer ${auth.token}`,
      "content-type": "application/json",
      "x-newl-teams-tenant-id": auth.tenantId,
      "x-newl-teams-aad-object-id": auth.senderId,
      ...(auth.bypassToken ? { "x-vercel-protection-bypass": auth.bypassToken } : {})
    },
    body: JSON.stringify(body)
  });
  const parsed = await response.json().catch(() => null) as { data?: PrintJobResponse; error?: string } | null;
  return { ok: response.ok, status: response.status, body: parsed ?? {} };
}

function formatApprovalRequest(job: PrintJobResponse) {
  return [
    `Print request ${job.id} is awaiting approval for Teamship shipping order ${job.shippingOrderNumber}.`,
    `${job.customerName}, ${job.warehouseName}: 1 picking list to ${job.printerPlan.pickingList.displayName}, 1 BOL to ${job.printerPlan.bol.exactName}, and ${job.approvedPalletCount} outbound pallet label(s) to ${job.printerPlan.outboundLabels.exactName}.`,
    `Reply \"Approve print request ${job.id}\" to continue. Nothing has printed yet.`
  ].join("\n");
}

function formatPrintStatus(job: PrintJobResponse) {
  if (job.status === "COMPLETED") {
    const documents = job.result?.documents ?? [];
    const summary = documents.map((item) => `${item.kind}: ${item.status}, ${item.copies} copy/copies to ${item.printer}`).join("; ");
    return `Print request ${job.id} for order ${job.shippingOrderNumber} completed. ${summary}`;
  }
  if (["FAILED", "EXPIRED"].includes(job.status)) {
    return `Print request ${job.id} for order ${job.shippingOrderNumber} is ${job.status}. ${job.errorMessage || "The worker did not report success."} It was not retried automatically. Check the physical output before creating any new print request.`;
  }
  if (job.status === "PENDING_APPROVAL") return formatApprovalRequest(job);
  return `Print request ${job.id} for order ${job.shippingOrderNumber} is ${job.status}. The worker has not reported completion yet; nothing will be retried automatically.`;
}

function statusDetail(status: string) {
  if (status === "COMPLETED") return "ok" as const;
  if (["FAILED", "EXPIRED"].includes(status)) return "failed" as const;
  if (status === "PENDING_APPROVAL") return "awaiting_approval" as const;
  return "queued" as const;
}

function readShippingOrderNumber(params: unknown) {
  const value = asRecord(params).shippingOrderNumber;
  if (typeof value !== "string" || !/^\d{1,10}$/.test(value.trim())) throw new Error("An exact numeric Teamship shipping-order number is required.");
  return value.trim();
}

function readJobId(value: unknown) {
  if (typeof value !== "string" || !/^[a-z0-9]{10,40}$/i.test(value.trim())) throw new Error("A valid print request ID is required.");
  return value.trim();
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Print tool parameters are invalid.");
  return value as Record<string, unknown>;
}

export function normalizeUuid(value: unknown) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return UUID_PATTERN.test(normalized) ? normalized : null;
}

function normalizeBaseUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "::1"].includes(url.hostname))) {
    throw new Error("Newl Apps printing requires HTTPS outside local development.");
  }
  return url;
}

function sleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new Error("Print status wait was cancelled."));
    }, { once: true });
  });
}

function textResult(text: string, status: "ok" | "failed" | "not_configured" | "unauthorized" | "awaiting_approval" | "queued") {
  return { content: [{ type: "text" as const, text }], details: { status } };
}
