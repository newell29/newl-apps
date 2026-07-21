import { Type } from "typebox";
import { defineToolPlugin } from "openclaw/plugin-sdk/tool-plugin";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DEFAULT_TOKEN_ENV = "OPENCLAW_TEAMSHIP_READ_TOKEN";

type TeamshipPluginConfig = {
  baseUrl: string;
  tenantId: string;
  readTokenEnv?: string;
  vercelProtectionBypassEnv?: string;
};

type TeamshipToolContext = {
  messageChannel?: string;
  requesterSenderId?: string;
};

const configSchema = Type.Object({
  baseUrl: Type.String({ description: "Newl Apps base URL." }),
  tenantId: Type.String({
    description: "Microsoft Entra tenant ID used by the configured Teams channel."
  }),
  readTokenEnv: Type.Optional(Type.String({
    description: "Environment variable containing the Newl Apps Teamship read token."
  })),
  vercelProtectionBypassEnv: Type.Optional(Type.String({
    description: "Optional environment variable containing a Vercel Preview automation bypass secret."
  }))
});

export default defineToolPlugin({
  id: "newl-teamship",
  name: "Newl Teamship",
  description: "Runs tenant-scoped, read-only Teamship lookups through Newl Apps using the authenticated Teams sender identity.",
  configSchema,
  tools: (tool) => [
    tool({
      name: "newl_teamship_read",
      label: "Newl Teamship Read",
      description: "Always call this tool for a current Teamship order, inventory, SKU, LPN, receiving order, warehouse, or product history question. Do not inspect authentication or configuration files first; the tool validates the authenticated Microsoft Teams sender, which cannot be supplied as a parameter.",
      parameters: Type.Object({
        prompt: Type.String({
          minLength: 1,
          maxLength: 4000,
          description: "A normalized, exact, read-only Teamship current-record question."
        })
      }),
      factory: createTeamshipReadTool
    })
  ]
});

export function createTeamshipReadTool({
  config,
  toolContext
}: {
  config: TeamshipPluginConfig;
  toolContext: TeamshipToolContext;
}) {
  return {
    name: "newl_teamship_read",
    label: "Newl Teamship Read",
    description: "Always call this tool for a current Teamship record question. Do not pre-judge authentication or inspect configuration files; this tool validates the trusted Microsoft Teams sender and returns the authoritative result.",
    parameters: Type.Object({
      prompt: Type.String({ minLength: 1, maxLength: 4000 })
    }),
    async execute(_toolCallId: string, params: unknown, signal?: AbortSignal) {
      const senderId = normalizeUuid(toolContext.requesterSenderId);
      const tenantId = normalizeUuid(config.tenantId);
      if (toolContext.messageChannel !== "msteams" || !senderId || !tenantId) {
        return textResult(
          "Newl Apps Teamship reads require an authenticated Microsoft Teams message with a valid Entra identity.",
          "unauthorized"
        );
      }

      const prompt = readPrompt(params);
      const token = process.env[config.readTokenEnv?.trim() || DEFAULT_TOKEN_ENV]?.trim();
      if (!token) {
        return textResult("Newl Apps Teamship read authentication is not configured on this OpenClaw runtime.", "not_configured");
      }

      const bypassEnv = config.vercelProtectionBypassEnv?.trim();
      const bypassToken = bypassEnv ? process.env[bypassEnv]?.trim() : undefined;
      if (bypassEnv && !bypassToken) {
        return textResult("Newl Apps Preview protection authentication is not configured on this OpenClaw runtime.", "not_configured");
      }

      const response = await fetch(new URL("/api/assistant/teamship/read", normalizeBaseUrl(config.baseUrl)), {
        method: "POST",
        redirect: "manual",
        signal,
        headers: buildRequestHeaders({ token, tenantId, senderId, bypassToken }),
        body: JSON.stringify({ prompt })
      });
      const body = await readResponseBody(response);
      if (!response.ok || !body.data?.answer) {
        return textResult(body.error || `Newl Apps Teamship read returned HTTP ${response.status}.`, "failed");
      }

      const sourceTitles = (body.data.sources ?? [])
        .map((source) => source.title?.trim())
        .filter((title): title is string => Boolean(title));
      const text = sourceTitles.length > 0
        ? `${body.data.answer}\nSources: ${sourceTitles.join("; ")}`
        : body.data.answer;
      return textResult(text, "ok");
    }
  };
}

export function normalizeUuid(value: unknown) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return UUID_PATTERN.test(normalized) ? normalized : null;
}

export function buildRequestHeaders({
  token,
  tenantId,
  senderId,
  bypassToken
}: {
  token: string;
  tenantId: string;
  senderId: string;
  bypassToken?: string;
}) {
  return {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
    "x-newl-teams-tenant-id": tenantId,
    "x-newl-teams-aad-object-id": senderId,
    ...(bypassToken ? { "x-vercel-protection-bypass": bypassToken } : {})
  };
}

function normalizeBaseUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== "https:" && !isLoopback(url)) {
    throw new Error("Newl Apps Teamship reads require HTTPS outside a loopback development environment.");
  }
  return url;
}

function isLoopback(url: URL) {
  return url.protocol === "http:" && ["127.0.0.1", "localhost", "::1"].includes(url.hostname);
}

function readPrompt(params: unknown) {
  if (!params || typeof params !== "object") {
    throw new Error("A Teamship prompt is required.");
  }
  const prompt = (params as Record<string, unknown>).prompt;
  if (typeof prompt !== "string" || !prompt.trim() || prompt.length > 4000) {
    throw new Error("A Teamship prompt between 1 and 4000 characters is required.");
  }
  return prompt.trim();
}

async function readResponseBody(response: Response) {
  const value = await response.json().catch(() => null) as {
    data?: {
      answer?: string;
      sources?: Array<{ title?: string }>;
    };
    error?: string;
  } | null;
  return value ?? {};
}

function textResult(text: string, status: "ok" | "failed" | "not_configured" | "unauthorized") {
  return {
    content: [{ type: "text" as const, text }],
    details: { status }
  };
}
