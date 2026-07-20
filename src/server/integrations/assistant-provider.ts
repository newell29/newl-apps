import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";
import { IntegrationProvider, IntegrationStatus } from "@prisma/client";

export const ASSISTANT_PROVIDER_CREDENTIAL_NAME = "Company Assistant Provider";
const OPENAI_API_BASE_URL = "https://api.openai.com/v1";
const ASSISTANT_PROVIDER_SECRET_PREFIX = "assistant-provider:enc:v1";
const ASSISTANT_PROVIDER_REQUEST_TIMEOUT_MS = 90_000;
const ASSISTANT_PROVIDER_DISCOVERY_TIMEOUT_MS = 10_000;

export type AssistantProviderKind = "OPENAI" | "LOCAL_LLM";
export type AssistantReasoningEffort = "none" | "low" | "medium" | "high";

export type AssistantProviderAuth = {
  apiKey: string | null;
};

export type AssistantProviderSettings = {
  provider: AssistantProviderKind;
  liveResponsesEnabled: boolean;
  defaultModel: string;
  fallbackModel: string | null;
  temperature: number;
  maxTokens: number;
  endpointUrl: string | null;
  reasoningEffort: AssistantReasoningEffort | null;
  apiKeyConfigured: boolean;
  status: IntegrationStatus;
  runtimeReady: boolean;
  runtimeNotes: string;
};

export type AssistantReplySource = {
  title: string;
  excerpt: string;
};

export type AssistantConversationTurn = {
  role: "user" | "assistant";
  content: string;
};

export type AssistantMemorySnapshot = {
  kind: string;
  title: string;
  summary: string;
};

export type AssistantReplyRequest = {
  tenantName: string;
  prompt: string;
  intent: string;
  sources: AssistantReplySource[];
  conversationHistory: AssistantConversationTurn[];
  memorySnapshot: AssistantMemorySnapshot[];
  conversationSummary?: string | null;
  workspaceSnapshot?: {
    companyCount: number;
    contactCount: number;
    knowledgeDocumentCount: number;
    memoryCount: number;
    topCompanyNames: string[];
  };
  settings: AssistantProviderSettings;
};

export type AssistantReplyResult = {
  content: string;
  provider: string;
  model: string;
  usedFallbackModel: boolean;
  rawResponse: Record<string, unknown> | null;
};

type AssistantProviderCredentialRecord = {
  provider: IntegrationProvider;
  status: IntegrationStatus;
  publicConfig: unknown;
  secretRef?: string | null;
};

type AssistantProviderConfigInput = {
  liveResponsesEnabled: boolean;
  defaultModel: string;
  fallbackModel: string | null;
  temperature: number;
  maxTokens: number;
  endpointUrl: string | null;
  reasoningEffort: AssistantReasoningEffort | null;
};

export const DEFAULT_ASSISTANT_PROVIDER_SETTINGS: Omit<
  AssistantProviderSettings,
  "status" | "runtimeReady" | "runtimeNotes" | "apiKeyConfigured"
> = {
  provider: IntegrationProvider.OPENAI,
  liveResponsesEnabled: false,
  defaultModel: "gpt-5-mini",
  fallbackModel: "gpt-5-nano",
  temperature: 0.2,
  maxTokens: 900,
  endpointUrl: null,
  reasoningEffort: null
};

export function isAssistantProvider(provider: IntegrationProvider): provider is AssistantProviderKind {
  return provider === IntegrationProvider.OPENAI || provider === IntegrationProvider.LOCAL_LLM;
}

export function parseAssistantProviderSettings(
  credential?: AssistantProviderCredentialRecord | null
): AssistantProviderSettings {
  const provider =
    credential?.provider && isAssistantProvider(credential.provider)
      ? credential.provider
      : DEFAULT_ASSISTANT_PROVIDER_SETTINGS.provider;
  const config =
    credential?.publicConfig && typeof credential.publicConfig === "object"
      ? (credential.publicConfig as Record<string, unknown>)
      : {};
  const liveResponsesEnabled =
    readBoolean(config.liveResponsesEnabled) ?? (credential?.status === IntegrationStatus.ACTIVE);
  const defaultModel =
    normalizeAssistantModelId(readString(config.defaultModel)) ??
    DEFAULT_ASSISTANT_PROVIDER_SETTINGS.defaultModel;
  const fallbackModel = normalizeAssistantModelId(readString(config.fallbackModel));
  const temperature = readNumber(config.temperature) ?? DEFAULT_ASSISTANT_PROVIDER_SETTINGS.temperature;
  const maxTokens = readInteger(config.maxTokens) ?? DEFAULT_ASSISTANT_PROVIDER_SETTINGS.maxTokens;
  const endpointUrl = readString(config.endpointUrl);
  const reasoningEffort = readReasoningEffort(config.reasoningEffort);
  const apiKeyConfigured = Boolean(credential?.secretRef);
  const status = credential?.status ?? IntegrationStatus.DISABLED;
  const runtimeReady =
    provider === IntegrationProvider.OPENAI
      ? isOpenAiRuntimeReady()
      : Boolean(endpointUrl && endpointUrl.trim().length > 0);
  const runtimeNotes =
    provider === IntegrationProvider.OPENAI
      ? "Uses `OPENAI_API_KEY` until tenant-scoped secret resolution is added."
      : endpointUrl
        ? `Targets the local model endpoint at ${endpointUrl}${apiKeyConfigured ? " with a saved bearer token" : ""}.`
        : "Set a local model endpoint URL when the Newl-hosted runtime is available.";

  return {
    provider,
    liveResponsesEnabled,
    defaultModel,
    fallbackModel,
    temperature: clamp(temperature, 0, 2),
    maxTokens: clampInteger(maxTokens, 100, 4000),
    endpointUrl,
    reasoningEffort,
    apiKeyConfigured,
    status,
    runtimeReady,
    runtimeNotes
  };
}

export function buildAssistantProviderConfig(input: AssistantProviderConfigInput) {
  return {
    liveResponsesEnabled: input.liveResponsesEnabled,
    defaultModel: normalizeAssistantModelId(input.defaultModel) ?? DEFAULT_ASSISTANT_PROVIDER_SETTINGS.defaultModel,
    fallbackModel: normalizeAssistantModelId(input.fallbackModel),
    temperature: input.temperature,
    maxTokens: input.maxTokens,
    endpointUrl: input.endpointUrl,
    reasoningEffort: input.reasoningEffort
  };
}

function normalizeAssistantModelId(model: string | null) {
  if (!model) {
    return null;
  }

  const trimmed = model.trim();
  if (trimmed === "gpt-5.4") {
    return "gpt-5";
  }
  if (trimmed === "gpt-5.4-mini") {
    return "gpt-5-mini";
  }
  if (trimmed === "gpt-5.4-nano") {
    return "gpt-5-nano";
  }

  return trimmed;
}

export async function generateAssistantReply(
  request: AssistantReplyRequest,
  auth: AssistantProviderAuth = { apiKey: null }
): Promise<AssistantReplyResult> {
  if (request.settings.provider === IntegrationProvider.OPENAI) {
    return callProvider({
      baseUrl: OPENAI_API_BASE_URL,
      apiKey: readOpenAiApiKey(),
      providerLabel: "OPENAI",
      request
    });
  }

  if (!request.settings.endpointUrl) {
    throw new Error("Local LLM endpoint URL is not configured for this tenant.");
  }

  return callProvider({
    baseUrl: validateAssistantEndpointUrl(request.settings.endpointUrl),
    apiKey: auth.apiKey,
    providerLabel: "LOCAL_LLM",
    request
  });
}

export function isOpenAiRuntimeReady() {
  const apiKey = readOpenAiApiKey();
  return Boolean(apiKey);
}

async function callProvider({
  baseUrl,
  apiKey,
  providerLabel,
  request
}: {
  baseUrl: string;
  apiKey: string | null;
  providerLabel: string;
  request: AssistantReplyRequest;
}): Promise<AssistantReplyResult> {
  const primaryAttempt = await requestChatCompletion({
    baseUrl,
    apiKey,
    model: request.settings.defaultModel,
    request
  });

  if (primaryAttempt.ok) {
    return {
      content: primaryAttempt.content,
      provider: providerLabel,
      model: request.settings.defaultModel,
      usedFallbackModel: false,
      rawResponse: primaryAttempt.rawResponse
    };
  }

  if (
    request.settings.fallbackModel &&
    request.settings.fallbackModel !== request.settings.defaultModel
  ) {
    const fallbackAttempt = await requestChatCompletion({
      baseUrl,
      apiKey,
      model: request.settings.fallbackModel,
      request
    });

    if (fallbackAttempt.ok) {
      return {
        content: fallbackAttempt.content,
        provider: providerLabel,
        model: request.settings.fallbackModel,
        usedFallbackModel: true,
        rawResponse: fallbackAttempt.rawResponse
      };
    }

    throw new Error(fallbackAttempt.error ?? primaryAttempt.error ?? "Assistant provider request failed.");
  }

  throw new Error(primaryAttempt.error ?? "Assistant provider request failed.");
}

async function requestChatCompletion({
  baseUrl,
  apiKey,
  model,
  request
}: {
  baseUrl: string;
  apiKey: string | null;
  model: string;
  request: AssistantReplyRequest;
}) {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  const response = await fetch(`${normalizeBaseUrl(baseUrl)}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {})
    },
    body: JSON.stringify(buildChatCompletionPayload({
      model,
      request,
      useOpenAiReasoningParameters: shouldUseOpenAiReasoningParameters(normalizedBaseUrl, model)
    })),
    cache: "no-store",
    signal: AbortSignal.timeout(ASSISTANT_PROVIDER_REQUEST_TIMEOUT_MS)
  });

  const json = (await response.json().catch(() => null)) as Record<string, unknown> | null;

  if (!response.ok || !json) {
    return {
      ok: false as const,
      error: extractProviderError(json) ?? `Assistant provider request failed with status ${response.status}.`
    };
  }

  try {
    return {
      ok: true as const,
      content: readAssistantContent(json),
      rawResponse: json
    };
  } catch (error) {
    return {
      ok: false as const,
      error: error instanceof Error ? error.message : "Assistant provider returned an unreadable response."
    };
  }
}

function buildChatCompletionPayload({
  model,
  request,
  useOpenAiReasoningParameters
}: {
  model: string;
  request: AssistantReplyRequest;
  useOpenAiReasoningParameters: boolean;
}) {
  return {
    model,
    ...(request.settings.reasoningEffort
      ? { reasoning_effort: request.settings.reasoningEffort }
      : {}),
    ...(useOpenAiReasoningParameters
      ? { max_completion_tokens: request.settings.maxTokens }
      : {
          temperature: request.settings.temperature,
          max_tokens: request.settings.maxTokens
        }),
    messages: [
      {
        role: "system",
        content: buildSystemPrompt(request)
      },
      {
        role: "user",
        content: buildUserPrompt(request)
      }
    ]
  };
}

export async function testAssistantProviderConnection({
  settings,
  auth
}: {
  settings: AssistantProviderSettings;
  auth: AssistantProviderAuth;
}) {
  if (settings.provider !== IntegrationProvider.LOCAL_LLM || !settings.endpointUrl) {
    throw new Error("Save a local LLM provider and endpoint before testing the connection.");
  }

  validateAssistantEndpointUrl(settings.endpointUrl);
  const startedAt = Date.now();
  const models = await listAssistantProviderModels(settings.endpointUrl, auth);

  if (!models.includes(settings.defaultModel)) {
    throw new Error(
      `The endpoint is online, but model ${settings.defaultModel} was not found. Available models: ${models.join(", ") || "none"}.`
    );
  }

  const reply = await generateAssistantReply(
    {
      tenantName: "Connection test",
      prompt: "Using only the supplied source, reply with NEWL LOCAL MODEL OK.",
      intent: "CONNECTION_TEST",
      conversationHistory: [],
      memorySnapshot: [],
      sources: [
        {
          title: "Connection test source",
          excerpt: "The required connection-test reply is NEWL LOCAL MODEL OK."
        }
      ],
      settings
    },
    auth
  );

  return {
    model: reply.model,
    latencyMs: Date.now() - startedAt,
    reply: reply.content
  };
}

export function validateAssistantEndpointUrl(value: string) {
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    throw new Error("Local LLM endpoint must be a valid URL, such as http://127.0.0.1:11434/v1.");
  }

  if (url.username || url.password || url.search || url.hash) {
    throw new Error("Local LLM endpoint must not contain credentials, query parameters, or fragments.");
  }

  const isLoopback = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLoopback && process.env.NODE_ENV !== "production")) {
    throw new Error("Local LLM endpoints must use HTTPS. Plain HTTP is allowed only for loopback development URLs.");
  }

  if (process.env.NODE_ENV === "production") {
    const allowedHosts = (process.env.ASSISTANT_LOCAL_LLM_ALLOWED_HOSTS ?? "")
      .split(",")
      .map((host) => host.trim().toLowerCase())
      .filter(Boolean);

    if (allowedHosts.length === 0 || !allowedHosts.includes(url.hostname.toLowerCase())) {
      throw new Error("This local LLM hostname is not in ASSISTANT_LOCAL_LLM_ALLOWED_HOSTS.");
    }
  }

  return normalizeBaseUrl(url.toString());
}

export function encryptAssistantProviderSecret(payload: { apiKey: string }) {
  const key = createHash("sha256").update(getAssistantProviderEncryptionSecret()).digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `${ASSISTANT_PROVIDER_SECRET_PREFIX}:${iv.toString("base64url")}:${tag.toString("base64url")}:${encrypted.toString("base64url")}`;
}

export function parseAssistantProviderAuth(secretRef?: string | null): AssistantProviderAuth {
  if (!secretRef) {
    return { apiKey: null };
  }

  const parts = secretRef.split(":");
  if (parts.length !== 6) {
    throw new Error("Assistant provider secret is not in the expected encrypted format.");
  }

  const [prefixA, prefixB, prefixC, ivValue, tagValue, encryptedValue] = parts;
  if (`${prefixA}:${prefixB}:${prefixC}` !== ASSISTANT_PROVIDER_SECRET_PREFIX) {
    throw new Error("Assistant provider secret is not in the expected encrypted format.");
  }

  const key = createHash("sha256").update(getAssistantProviderEncryptionSecret()).digest();
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivValue, "base64url"));
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedValue, "base64url")),
    decipher.final()
  ]);
  const payload = JSON.parse(decrypted.toString("utf8")) as Record<string, unknown>;

  return {
    apiKey: readString(payload.apiKey)
  };
}

async function listAssistantProviderModels(endpointUrl: string, auth: AssistantProviderAuth) {
  const response = await fetch(`${normalizeBaseUrl(endpointUrl)}/models`, {
    method: "GET",
    headers: auth.apiKey ? { authorization: `Bearer ${auth.apiKey}` } : undefined,
    cache: "no-store",
    signal: AbortSignal.timeout(ASSISTANT_PROVIDER_DISCOVERY_TIMEOUT_MS)
  });
  const json = (await response.json().catch(() => null)) as Record<string, unknown> | null;

  if (!response.ok || !json) {
    throw new Error(extractProviderError(json) ?? `Local model discovery failed with status ${response.status}.`);
  }

  const data = Array.isArray(json.data) ? json.data : [];
  return data
    .map((entry) => entry && typeof entry === "object" ? readString((entry as Record<string, unknown>).id) : null)
    .filter((model): model is string => Boolean(model));
}

function getAssistantProviderEncryptionSecret() {
  const value = process.env.AUTH_SECRET?.trim();
  if (!value) {
    throw new Error("AUTH_SECRET is required to encrypt assistant provider credentials.");
  }

  return value;
}

function shouldUseOpenAiReasoningParameters(baseUrl: string, model: string) {
  if (baseUrl !== OPENAI_API_BASE_URL) {
    return false;
  }

  const normalizedModel = model.toLowerCase();
  return normalizedModel.startsWith("gpt-5") || normalizedModel.startsWith("o1") || normalizedModel.startsWith("o3");
}

function buildAssistantPrompt(request: AssistantReplyRequest) {
  return JSON.stringify(
    {
      tenant: request.tenantName,
      intent: request.intent,
      userPrompt: request.prompt,
      conversationSummary: request.conversationSummary ?? null,
      conversationHistory: request.conversationHistory.map((turn, index) => ({
        id: index + 1,
        role: turn.role,
        content: turn.content
      })),
      workspaceSnapshot: request.workspaceSnapshot ?? null,
      memorySnapshot: request.memorySnapshot.map((memory, index) => ({
        id: index + 1,
        kind: memory.kind,
        title: memory.title,
        summary: memory.summary
      })),
      sourceExcerpts: request.sources.map((source, index) => ({
        id: index + 1,
        title: source.title,
        excerpt: source.excerpt
      })),
      answerRules: [
        "Use the source excerpts as the factual boundary for tenant, customer, shipment, pricing, email, sales, and operational facts.",
        "For general knowledge, arithmetic, or harmless reasoning that does not require tenant facts, answer directly without pretending the source excerpts must contain the calculation.",
        "Use the conversation history to preserve continuity and resolve follow-up questions.",
        "Use the memory snapshot to understand the business context, but do not claim anything that is not present in the supplied memory or excerpts.",
        "If the prompt asks for a rate, explain what details are missing and point to existing rate tools when appropriate.",
        "If the prompt asks for customer or sales insight, cite the relevant company or lead names directly in the prose.",
        "For a Teamship procedural answer, identify the exact supporting Teamship Draft document title in the prose.",
        "Never use a procedural document as evidence of a current Teamship record.",
        "If evidence is thin, say so clearly."
      ]
    },
    null,
    2
  );
}

function buildSystemPrompt(request: AssistantReplyRequest) {
  const basePrompt =
    "You are Newl's company assistant. Be concise, operationally useful, and explicit when required facts are missing. Use only the provided tenant-scoped source excerpts, memory snapshot, and prior conversation turns for tenant, customer, shipment, pricing, email, sales, and operational facts. You may answer simple arithmetic and general non-tenant questions directly. If the user asks for a rate, collect missing shipment details instead of inventing a quote. For Teamship procedures, identify the exact supporting Teamship Draft document title and do not present Draft or unresolved material as an approved Newl rule. Do not fabricate customer history, service capabilities, pricing, tool outputs, current Teamship records, or conversation memory.";

  if (request.settings.provider === IntegrationProvider.LOCAL_LLM) {
    return `${basePrompt} Do not include hidden reasoning, chain-of-thought, scratchpad analysis, <think> blocks, or commentary about checking the instructions. Return only the final user-facing answer.`;
  }

  return basePrompt;
}

function buildUserPrompt(request: AssistantReplyRequest) {
  const prompt = buildAssistantPrompt(request);
  return request.settings.provider === IntegrationProvider.LOCAL_LLM
    ? `/no_think\n${prompt}`
    : prompt;
}

function readAssistantContent(payload: Record<string, unknown>) {
  const choices = Array.isArray(payload.choices) ? payload.choices : [];
  const firstChoice = choices[0] && typeof choices[0] === "object" ? choices[0] as Record<string, unknown> : null;
  const message = firstChoice?.message;
  const content = message && typeof message === "object" ? (message as Record<string, unknown>).content : null;
  const cleanedContent = typeof content === "string" ? stripHiddenReasoning(content) : "";

  if (cleanedContent.length === 0) {
    if (firstChoice?.finish_reason === "length") {
      throw new Error("Assistant provider reached the max token limit before producing a visible answer.");
    }
    throw new Error("Assistant provider returned an empty response.");
  }

  return cleanedContent;
}

function stripHiddenReasoning(content: string) {
  let cleaned = content
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .trim();

  const danglingCloseIndex = cleaned.toLowerCase().lastIndexOf("</think>");
  if (danglingCloseIndex >= 0) {
    cleaned = cleaned.slice(danglingCloseIndex + "</think>".length).trim();
  }

  return cleaned;
}

function extractProviderError(payload: Record<string, unknown> | null) {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const error = payload.error;
  if (error && typeof error === "object") {
    const message = (error as Record<string, unknown>).message;
    if (typeof message === "string" && message.trim().length > 0) {
      return message.trim();
    }
  }

  return null;
}

function readOpenAiApiKey() {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  return apiKey && apiKey !== "OPENAI_API_KEY_PLACEHOLDER" ? apiKey : null;
}

function normalizeBaseUrl(value: string) {
  return value.replace(/\/+$/, "");
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function readBoolean(value: unknown) {
  return typeof value === "boolean" ? value : null;
}

function readNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readInteger(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function readReasoningEffort(value: unknown): AssistantReasoningEffort | null {
  return value === "none" || value === "low" || value === "medium" || value === "high"
    ? value
    : null;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function clampInteger(value: number, min: number, max: number) {
  return Math.round(clamp(value, min, max));
}
