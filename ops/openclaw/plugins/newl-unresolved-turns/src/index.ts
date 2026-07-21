import { Type } from "typebox";
import type {
  OpenClawPluginApi,
  OpenClawPluginDefinition,
  OpenClawPluginToolContext
} from "openclaw/plugin-sdk/plugin-entry";
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DEFAULT_TOKEN_ENV = "OPENCLAW_ASSISTANT_TOKEN";

type UnresolvedTurnConfig = {
  baseUrl: string;
  tenantId: string;
  developerObjectId: string;
  developerAgentId?: string;
  assistantTokenEnv?: string;
  vercelProtectionBypassEnv?: string;
};

type TurnState = {
  runId: string;
  createdAt: number;
  prompt: string;
  senderId: string;
  sessionKey?: string;
  messageId?: string;
  conversationId?: string;
  failure?: {
    failureKind: "MODEL_FAILURE" | "TOOL_FAILURE";
    provider?: string;
    model?: string;
    toolName?: string;
    toolCallId?: string;
    errorCode?: string;
    errorMessage?: string;
  };
};

type PostAction = {
  action: "start" | "complete" | "fail";
  runId: string;
  prompt?: string;
  channel?: string;
  externalMessageId?: string;
  externalConversationId?: string;
  sessionKey?: string;
  response?: string;
  failureKind?: "MODEL_FAILURE" | "TOOL_FAILURE" | "DELIVERY_FAILURE";
  provider?: string;
  model?: string;
  toolName?: string;
  toolCallId?: string;
  errorCode?: string;
  errorMessage?: string;
};

const listParameters = Type.Object({
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 50 })),
  staleAfterSeconds: Type.Optional(Type.Integer({ minimum: 60, maximum: 86400, default: 300 }))
});

const plugin: OpenClawPluginDefinition = definePluginEntry({
  id: "newl-unresolved-turns",
  name: "Newl Unresolved Turns",
  description: "Captures failed or unanswered Microsoft Teams turns for developer review.",
  register(api) {
    registerUnresolvedTurnHooks(api, readConfig(api.pluginConfig));
    api.registerTool(
      (toolContext) => createUnresolvedTurnsTool(readConfig(api.pluginConfig), toolContext),
      { name: "newl_unresolved_turns", optional: true }
    );
  }
});

export function registerUnresolvedTurnHooks(api: OpenClawPluginApi, config: UnresolvedTurnConfig) {
  const byRunId = new Map<string, TurnState>();
  const runIdBySessionKey = new Map<string, string>();

  api.on("message_received", async (event, context) => {
    pruneStaleStates(byRunId, runIdBySessionKey, Date.now() - 15 * 60 * 1_000);
    const senderId = normalizeUuid(event.senderId ?? context.senderId);
    const runId = normalizeIdentifier(event.runId ?? context.runId);
    const sessionKey = normalizeOptionalIdentifier(event.sessionKey ?? context.sessionKey, 500);
    if (context.channelId !== "msteams" || !senderId || !runId || !event.content.trim()) return;
    if (event.content.trim().startsWith("/")) return;

    const state: TurnState = {
      runId,
      createdAt: Date.now(),
      prompt: event.content,
      senderId,
      sessionKey,
      messageId: normalizeOptionalIdentifier(event.messageId ?? context.messageId, 300),
      conversationId: normalizeOptionalIdentifier(event.threadId ?? context.conversationId, 300)
    };
    byRunId.set(runId, state);
    if (sessionKey) runIdBySessionKey.set(sessionKey, runId);
    await safelyPost(api, config, state, {
      action: "start",
      ...basePayload(state)
    });
  }, { timeoutMs: 10_000 });

  api.on("model_call_ended", async (event) => {
    if (event.outcome !== "error") return;
    const state = byRunId.get(event.runId);
    if (!state) return;
    state.failure = {
      failureKind: "MODEL_FAILURE",
      provider: event.provider,
      model: event.model,
      errorCode: event.failureKind ?? event.errorCategory,
      errorMessage: event.errorCategory ?? event.failureKind ?? "Model call failed."
    };
  });

  api.on("after_tool_call", async (event) => {
    const state = event.runId ? byRunId.get(event.runId) : undefined;
    if (!state) return;
    const failure = classifyToolFailure(event.result, event.error);
    if (!failure) return;
    state.failure = {
      failureKind: "TOOL_FAILURE",
      toolName: event.toolName,
      toolCallId: event.toolCallId,
      errorCode: failure.status,
      errorMessage: failure.message
    };
  });

  api.on("message_sent", async (event, context) => {
    const state = findState(
      byRunId,
      runIdBySessionKey,
      event.runId ?? context.runId,
      event.sessionKey ?? context.sessionKey
    );
    if (!state) return;

    if (!event.success) {
      await safelyPost(api, config, state, {
        action: "fail",
        ...basePayload(state),
        failureKind: "DELIVERY_FAILURE",
        response: event.content,
        errorMessage: event.error ?? "Microsoft Teams delivery failed."
      });
    } else if (state.failure) {
      await safelyPost(api, config, state, {
        action: "fail",
        ...basePayload(state),
        ...state.failure,
        response: event.content
      });
    } else {
      await safelyPost(api, config, state, {
        action: "complete",
        runId: state.runId
      });
    }
    clearState(byRunId, runIdBySessionKey, state);
  }, { timeoutMs: 10_000 });
}

export default plugin;

export function classifyToolFailure(result: unknown, error?: string) {
  if (error?.trim()) return { status: "failed", message: error.trim() };
  if (!result || typeof result !== "object") return null;
  const details = (result as { details?: unknown }).details;
  if (!details || typeof details !== "object") return null;
  const status = (details as { status?: unknown }).status;
  if (!["failed", "not_configured", "unauthorized"].includes(String(status))) return null;
  const message = readToolMessage(result) ?? `Tool returned ${String(status)}.`;
  return { status: String(status), message };
}

export function createUnresolvedTurnsTool(
  config: UnresolvedTurnConfig,
  toolContext: OpenClawPluginToolContext
) {
  if (toolContext.agentId !== (config.developerAgentId?.trim() || "developer")) return null;
  return {
    name: "newl_unresolved_turns",
    label: "Newl Unresolved Turns",
    description: "List sanitized failed or unanswered Nemo turns for developer review. This read-only tool must be enabled only for the developer agent, never for the employee-facing Nemo agent.",
    parameters: listParameters,
    async execute(_toolCallId: string, params: unknown, signal?: AbortSignal) {
      const tenantId = normalizeUuid(config.tenantId);
      const developerObjectId = normalizeUuid(config.developerObjectId);
      if (!tenantId || !developerObjectId) {
        return textResult("Newl Apps unresolved-turn review identity is not configured.", "not_configured");
      }
      const token = readToken(config);
      if (!token) return textResult("Newl Apps unresolved-turn authentication is not configured.", "not_configured");
      const options = readListOptions(params);
      const url = new URL("/api/assistant/openclaw/unresolved-turns", normalizeBaseUrl(config.baseUrl));
      url.searchParams.set("limit", String(options.limit));
      url.searchParams.set("staleAfterSeconds", String(options.staleAfterSeconds));
      const response = await fetch(url, {
        signal,
        redirect: "manual",
        headers: buildHeaders(config, token, tenantId, developerObjectId)
      });
      const body = await response.json().catch(() => null) as {
        data?: { issues?: unknown[] };
        error?: string;
      } | null;
      if (!response.ok || !body?.data?.issues) {
        return textResult(body?.error ?? `Newl Apps unresolved-turn list returned HTTP ${response.status}.`, "failed");
      }
      return textResult(JSON.stringify({ issues: body.data.issues }, null, 2), "ok");
    }
  };
}

function findState(
  byRunId: Map<string, TurnState>,
  runIdBySessionKey: Map<string, string>,
  runIdValue: unknown,
  sessionKeyValue: unknown
) {
  const runId = normalizeIdentifier(runIdValue);
  if (runId && byRunId.has(runId)) return byRunId.get(runId);
  const sessionKey = normalizeOptionalIdentifier(sessionKeyValue, 500);
  return sessionKey ? byRunId.get(runIdBySessionKey.get(sessionKey) ?? "") : undefined;
}

function clearState(
  byRunId: Map<string, TurnState>,
  runIdBySessionKey: Map<string, string>,
  state: TurnState
) {
  byRunId.delete(state.runId);
  if (state.sessionKey && runIdBySessionKey.get(state.sessionKey) === state.runId) {
    runIdBySessionKey.delete(state.sessionKey);
  }
}

function pruneStaleStates(
  byRunId: Map<string, TurnState>,
  runIdBySessionKey: Map<string, string>,
  olderThan: number
) {
  for (const state of byRunId.values()) {
    if (state.createdAt <= olderThan) clearState(byRunId, runIdBySessionKey, state);
  }
}

function basePayload(state: TurnState) {
  return {
    runId: state.runId,
    prompt: state.prompt,
    channel: "msteams",
    externalMessageId: state.messageId,
    externalConversationId: state.conversationId,
    sessionKey: state.sessionKey
  };
}

async function safelyPost(
  api: OpenClawPluginApi,
  config: UnresolvedTurnConfig,
  state: TurnState,
  payload: PostAction
) {
  try {
    const token = readToken(config);
    const tenantId = normalizeUuid(config.tenantId);
    if (!token || !tenantId) throw new Error("Unresolved-turn authentication is not configured.");
    const response = await fetch(
      new URL("/api/assistant/openclaw/unresolved-turns", normalizeBaseUrl(config.baseUrl)),
      {
        method: "POST",
        redirect: "manual",
        headers: buildHeaders(config, token, tenantId, state.senderId),
        body: JSON.stringify(payload)
      }
    );
    if (!response.ok) {
      const body = await response.json().catch(() => null) as { error?: string } | null;
      throw new Error(body?.error ?? `HTTP ${response.status}`);
    }
  } catch (error) {
    api.logger.warn(`Newl unresolved-turn capture skipped: ${error instanceof Error ? error.message : "unknown error"}`);
  }
}

function buildHeaders(
  config: UnresolvedTurnConfig,
  token: string,
  tenantId: string,
  senderId: string
) {
  const bypassEnv = config.vercelProtectionBypassEnv?.trim();
  const bypassToken = bypassEnv ? process.env[bypassEnv]?.trim() : undefined;
  return {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
    "x-newl-teams-tenant-id": tenantId,
    "x-newl-teams-aad-object-id": senderId,
    ...(bypassToken ? { "x-vercel-protection-bypass": bypassToken } : {})
  };
}

function readToken(config: UnresolvedTurnConfig) {
  return process.env[config.assistantTokenEnv?.trim() || DEFAULT_TOKEN_ENV]?.trim();
}

function readConfig(value: unknown): UnresolvedTurnConfig {
  if (!value || typeof value !== "object") throw new Error("Newl unresolved-turn plugin configuration is required.");
  return value as UnresolvedTurnConfig;
}

function readListOptions(value: unknown) {
  const params = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    limit: boundedInteger(params.limit, 50, 1, 100),
    staleAfterSeconds: boundedInteger(params.staleAfterSeconds, 300, 60, 86_400)
  };
}

function boundedInteger(value: unknown, fallback: number, min: number, max: number) {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max
    ? value
    : fallback;
}

function readToolMessage(result: unknown) {
  const content = (result as { content?: unknown }).content;
  if (!Array.isArray(content)) return null;
  const text = content.find((item) => item && typeof item === "object" && "text" in item) as { text?: unknown } | undefined;
  return typeof text?.text === "string" ? text.text : null;
}

function normalizeUuid(value: unknown) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return UUID_PATTERN.test(normalized) ? normalized : null;
}

function normalizeIdentifier(value: unknown) {
  return normalizeOptionalIdentifier(value, 100);
}

function normalizeOptionalIdentifier(value: unknown, maxLength: number) {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const normalized = String(value).trim();
  if (!normalized || normalized.length > maxLength) return undefined;
  return normalized;
}

function normalizeBaseUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && ["127.0.0.1", "localhost", "::1"].includes(url.hostname))) {
    throw new Error("Newl unresolved-turn requests require HTTPS outside loopback development.");
  }
  return url;
}

function textResult(text: string, status: "ok" | "failed" | "not_configured") {
  return {
    content: [{ type: "text" as const, text }],
    details: { status }
  };
}
