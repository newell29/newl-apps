import { Type } from "typebox";
import { defineToolPlugin } from "openclaw/plugin-sdk/tool-plugin";

const DEFAULT_TOKEN_ENV = "OPENCLAW_WEBSITE_GROWTH_BACKLINK_TOKEN";

type WebsiteGrowthPluginConfig = {
  baseUrl: string;
  backlinkTokenEnv?: string;
  vercelProtectionBypassEnv?: string;
};

const emptyParameters = Type.Object({});
const sendEmailParameters = Type.Object({
  opportunityId: Type.String({ minLength: 1, maxLength: 100 }),
  kind: Type.Union([
    Type.Literal("INITIAL"),
    Type.Literal("FOLLOW_UP")
  ]),
  recipientName: Type.Optional(Type.String({ maxLength: 200 })),
  recipientEmail: Type.String({ format: "email", maxLength: 320 }),
  recipientCountry: Type.Union([
    Type.Literal("CA"),
    Type.Literal("US")
  ]),
  contactSourceUrl: Type.String({ format: "uri", maxLength: 1000 }),
  consentBasis: Type.Union([
    Type.Literal("EXPRESS"),
    Type.Literal("EXISTING_RELATIONSHIP"),
    Type.Literal("CONSPICUOUSLY_PUBLISHED_BUSINESS"),
    Type.Literal("PUBLISHER_SUBMISSION"),
    Type.Literal("US_BUSINESS_OUTREACH")
  ]),
  subject: Type.String({ minLength: 1, maxLength: 180 }),
  body: Type.String({ minLength: 1, maxLength: 4000 })
});
const reportParameters = Type.Object({
  opportunityId: Type.String({ minLength: 1, maxLength: 100 }),
  status: Type.Union([
    Type.Literal("SUBMITTED"),
    Type.Literal("BLOCKED"),
    Type.Literal("LIVE"),
    Type.Literal("LOST")
  ]),
  notes: Type.String({ minLength: 1, maxLength: 2000 }),
  liveUrl: Type.Optional(Type.String({ format: "uri", maxLength: 1000 })),
  directoryLoginUrl: Type.Optional(Type.String({ format: "uri", maxLength: 1000 })),
  directoryUsername: Type.Optional(Type.String({ maxLength: 320 })),
  acceptedTermsUrl: Type.Optional(Type.String({ format: "uri", maxLength: 1000 })),
  acceptedTermsSummary: Type.Optional(Type.String({ maxLength: 1000 }))
});

const configSchema = Type.Object({
  baseUrl: Type.String({ description: "Newl Apps base URL." }),
  backlinkTokenEnv: Type.Optional(Type.String({
    description: "Environment variable containing the dedicated backlink executor token."
  })),
  vercelProtectionBypassEnv: Type.Optional(Type.String({
    description: "Optional Vercel Preview automation bypass environment variable."
  }))
});

const plugin = defineToolPlugin({
  id: "newl-website-growth",
  name: "Newl Website Growth",
  description: "Executes only human-approved, non-paid Website Growth backlink outreach and directory work.",
  configSchema,
  tools: (tool) => [
    tool({
      name: "newl_backlink_claim",
      label: "Claim Approved Backlink Work",
      description: "Claim up to five human-approved, non-paid Website Growth backlink opportunities. Never invent or execute work that this tool does not return.",
      parameters: emptyParameters,
      factory: createApiTool("/api/website-growth/backlinks/executor/claim", { limit: 5 })
    }),
    tool({
      name: "newl_backlink_follow_ups",
      label: "Get Due Backlink Follow-ups",
      description: "Return only approved outreach whose first or second follow-up is due and which has no recorded reply or opt-out.",
      parameters: emptyParameters,
      factory: createApiTool("/api/website-growth/backlinks/executor/follow-ups", { limit: 5 })
    }),
    tool({
      name: "newl_backlink_verification",
      label: "Get Backlinks Due for Verification",
      description: "Return submitted directory or editorial links that are due for a public browser recheck. Report LIVE only when the backlink is visible without authentication.",
      parameters: emptyParameters,
      factory: createApiTool("/api/website-growth/backlinks/executor/verification", { limit: 5 })
    }),
    tool({
      name: "newl_backlink_sync_replies",
      label: "Sync Backlink Outreach Replies",
      description: "Read only the dedicated outreach mailbox through Newl Apps, match replies to sent Website Growth conversations, suppress opt-outs and stop their follow-ups.",
      parameters: emptyParameters,
      factory: createApiTool("/api/website-growth/backlinks/executor/sync-replies", {})
    }),
    tool({
      name: "newl_backlink_summary",
      label: "Summarize Backlink Outreach",
      description: "Return deterministic Website Growth review and execution counts plus the Newl Apps review link for the Teams reminder.",
      parameters: emptyParameters,
      factory: createApiTool("/api/website-growth/backlinks/executor/summary", {})
    }),
    tool({
      name: "newl_backlink_send_email",
      label: "Send Approved Backlink Outreach",
      description: "Send one personalized message through the dedicated Newl mailbox. Newl Apps rechecks human approval, recipient suppression, consent evidence, country rules and volume limits before Microsoft 365 is called.",
      parameters: sendEmailParameters,
      factory: createParameterizedApiTool("/api/website-growth/backlinks/executor/send-email")
    }),
    tool({
      name: "newl_backlink_report",
      label: "Report Backlink Execution",
      description: "Report a confirmed directory submission, blocked action, lost opportunity or publicly verified live backlink. Never include a password or secret in any field.",
      parameters: reportParameters,
      factory: createParameterizedApiTool("/api/website-growth/backlinks/executor/report")
    })
  ]
});

export default plugin;

export function createApiTool(path: string, payload: Record<string, unknown>) {
  return ({ config }: { config: WebsiteGrowthPluginConfig }) => ({
    name: "newl_website_growth_api",
    label: "Newl Website Growth API",
    description: "Calls the configured Newl Apps Website Growth executor endpoint.",
    parameters: emptyParameters,
    async execute() {
      return callNewlApps(config, path, payload);
    }
  });
}

export function createParameterizedApiTool(path: string) {
  return ({ config }: { config: WebsiteGrowthPluginConfig }) => ({
    name: "newl_website_growth_api",
    label: "Newl Website Growth API",
    description: "Calls the configured Newl Apps Website Growth executor endpoint.",
    parameters: Type.Record(Type.String(), Type.Unknown()),
    async execute(_toolCallId: string, params: unknown) {
      const payload =
        params && typeof params === "object" && !Array.isArray(params)
          ? params as Record<string, unknown>
          : {};
      return callNewlApps(config, path, payload);
    }
  });
}

async function callNewlApps(
  config: WebsiteGrowthPluginConfig,
  path: string,
  payload: Record<string, unknown>
) {
  const tokenEnv = config.backlinkTokenEnv?.trim() || DEFAULT_TOKEN_ENV;
  const token = process.env[tokenEnv]?.trim();
  if (!token) {
    return textResult(
      `Website Growth backlink execution is not configured. ${tokenEnv} is missing.`,
      "not_configured"
    );
  }
  const baseUrl = normalizeBaseUrl(config.baseUrl);
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json"
  };
  if (config.vercelProtectionBypassEnv) {
    const bypass = process.env[config.vercelProtectionBypassEnv]?.trim();
    if (bypass) headers["x-vercel-protection-bypass"] = bypass;
  }

  try {
    const response = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(60_000)
    });
    const json = (await response.json().catch(() => null)) as
      | { data?: unknown; error?: string }
      | null;
    if (!response.ok) {
      return textResult(
        json?.error ?? `Newl Apps returned ${response.status}.`,
        response.status === 401 ? "unauthorized" : "failed"
      );
    }
    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify(json?.data ?? {})
      }],
      details: {
        status: "ok",
        data: json?.data ?? {}
      }
    };
  } catch (error) {
    return textResult(
      error instanceof Error ? error.message : "Newl Apps request failed.",
      "failed"
    );
  }
}

function normalizeBaseUrl(value: string) {
  const parsed = new URL(value);
  if (parsed.protocol !== "https:") {
    throw new Error("Newl Apps baseUrl must use HTTPS.");
  }
  return parsed.toString().replace(/\/+$/, "");
}

function textResult(text: string, status: string) {
  return {
    content: [{ type: "text" as const, text }],
    details: { status }
  };
}
