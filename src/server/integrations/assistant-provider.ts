import { IntegrationProvider, IntegrationStatus } from "@prisma/client";

export const ASSISTANT_PROVIDER_CREDENTIAL_NAME = "Company Assistant Provider";
const OPENAI_API_BASE_URL = "https://api.openai.com/v1";

export type AssistantProviderKind = "OPENAI" | "LOCAL_LLM";

export type AssistantProviderSettings = {
  provider: AssistantProviderKind;
  liveResponsesEnabled: boolean;
  defaultModel: string;
  fallbackModel: string | null;
  temperature: number;
  maxTokens: number;
  endpointUrl: string | null;
  status: IntegrationStatus;
  runtimeReady: boolean;
  runtimeNotes: string;
};

export type AssistantReplySource = {
  title: string;
  excerpt: string;
};

export type AssistantReplyRequest = {
  tenantName: string;
  prompt: string;
  intent: string;
  sources: AssistantReplySource[];
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
};

type AssistantProviderConfigInput = {
  liveResponsesEnabled: boolean;
  defaultModel: string;
  fallbackModel: string | null;
  temperature: number;
  maxTokens: number;
  endpointUrl: string | null;
};

export const DEFAULT_ASSISTANT_PROVIDER_SETTINGS: Omit<
  AssistantProviderSettings,
  "status" | "runtimeReady" | "runtimeNotes"
> = {
  provider: IntegrationProvider.OPENAI,
  liveResponsesEnabled: false,
  defaultModel: "gpt-5-mini",
  fallbackModel: "gpt-5-nano",
  temperature: 0.2,
  maxTokens: 900,
  endpointUrl: null
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
  const defaultModel = readString(config.defaultModel) ?? DEFAULT_ASSISTANT_PROVIDER_SETTINGS.defaultModel;
  const fallbackModel = readString(config.fallbackModel);
  const temperature = readNumber(config.temperature) ?? DEFAULT_ASSISTANT_PROVIDER_SETTINGS.temperature;
  const maxTokens = readInteger(config.maxTokens) ?? DEFAULT_ASSISTANT_PROVIDER_SETTINGS.maxTokens;
  const endpointUrl = readString(config.endpointUrl);
  const status = credential?.status ?? IntegrationStatus.DISABLED;
  const runtimeReady =
    provider === IntegrationProvider.OPENAI
      ? isOpenAiRuntimeReady()
      : Boolean(endpointUrl && endpointUrl.trim().length > 0);
  const runtimeNotes =
    provider === IntegrationProvider.OPENAI
      ? "Uses `OPENAI_API_KEY` until tenant-scoped secret resolution is added."
      : endpointUrl
        ? `Targets the local model endpoint at ${endpointUrl}.`
        : "Set a local model endpoint URL when the Newl-hosted runtime is available.";

  return {
    provider,
    liveResponsesEnabled,
    defaultModel,
    fallbackModel,
    temperature: clamp(temperature, 0, 2),
    maxTokens: clampInteger(maxTokens, 100, 4000),
    endpointUrl,
    status,
    runtimeReady,
    runtimeNotes
  };
}

export function buildAssistantProviderConfig(input: AssistantProviderConfigInput) {
  return {
    liveResponsesEnabled: input.liveResponsesEnabled,
    defaultModel: input.defaultModel,
    fallbackModel: input.fallbackModel,
    temperature: input.temperature,
    maxTokens: input.maxTokens,
    endpointUrl: input.endpointUrl
  };
}

export async function generateAssistantReply(request: AssistantReplyRequest): Promise<AssistantReplyResult> {
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
    baseUrl: normalizeBaseUrl(request.settings.endpointUrl),
    apiKey: null,
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
  const response = await fetch(`${normalizeBaseUrl(baseUrl)}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {})
    },
    body: JSON.stringify({
      model,
      temperature: request.settings.temperature,
      max_tokens: request.settings.maxTokens,
      messages: [
        {
          role: "system",
          content:
            "You are Newl's company assistant. Answer using only the provided tenant-scoped source excerpts. Be concise, operationally useful, and explicit when required facts are missing. If the user asks for a rate, collect missing shipment details instead of inventing a quote. Do not fabricate customer history, service capabilities, pricing, or tool outputs."
        },
        {
          role: "user",
          content: buildAssistantPrompt(request)
        }
      ]
    }),
    cache: "no-store"
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

function buildAssistantPrompt(request: AssistantReplyRequest) {
  return JSON.stringify(
    {
      tenant: request.tenantName,
      intent: request.intent,
      userPrompt: request.prompt,
      sourceExcerpts: request.sources.map((source, index) => ({
        id: index + 1,
        title: source.title,
        excerpt: source.excerpt
      })),
      answerRules: [
        "Use the source excerpts as the factual boundary.",
        "If the prompt asks for a rate, explain what details are missing and point to existing rate tools when appropriate.",
        "If the prompt asks for customer or sales insight, cite the relevant company or lead names directly in the prose.",
        "If evidence is thin, say so clearly."
      ]
    },
    null,
    2
  );
}

function readAssistantContent(payload: Record<string, unknown>) {
  const choices = Array.isArray(payload.choices) ? payload.choices : [];
  const message = choices[0] && typeof choices[0] === "object" ? (choices[0] as Record<string, unknown>).message : null;
  const content = message && typeof message === "object" ? (message as Record<string, unknown>).content : null;

  if (typeof content !== "string" || content.trim().length === 0) {
    throw new Error("Assistant provider returned an empty response.");
  }

  return content.trim();
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

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function clampInteger(value: number, min: number, max: number) {
  return Math.round(clamp(value, min, max));
}
