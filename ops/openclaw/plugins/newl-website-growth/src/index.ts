import { Type } from "typebox";
import { defineToolPlugin } from "openclaw/plugin-sdk/tool-plugin";

import {
  fillProtectedDirectoryCredentials,
  type DirectoryCredentialContext,
  type DirectoryCredentialFillInput
} from "./directory-credentials.js";

const DEFAULT_TOKEN_ENV = "OPENCLAW_WEBSITE_GROWTH_BACKLINK_TOKEN";
const DEFAULT_DIRECTORY_PASSWORD_MASTER_ENV =
  "NEWL_DIRECTORY_PASSWORD_MASTER_V1";

export type WebsiteGrowthPluginConfig = {
  baseUrl: string;
  backlinkTokenEnv?: string;
  vercelProtectionBypassEnv?: string;
  directoryPasswordMasterEnv?: string;
};

const emptyParameters = Type.Object({});
const summaryParameters = Type.Object({
  runStartedAt: Type.String({
    format: "date-time",
    description:
      "UTC timestamp recorded immediately before this outreach cycle began."
  })
});
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
  directoryAccountState: Type.Optional(Type.Union([
    Type.Literal("EMAIL_VERIFICATION_PENDING"),
    Type.Literal("HUMAN_ACTION_REQUIRED"),
    Type.Literal("ACTIVE"),
    Type.Literal("FAILED")
  ])),
  directoryChallengeType: Type.Optional(Type.Union([
    Type.Literal("CAPTCHA"),
    Type.Literal("MFA"),
    Type.Literal("PHONE_VERIFICATION"),
    Type.Literal("EMAIL_VERIFICATION"),
    Type.Literal("PASSWORD_POLICY"),
    Type.Literal("TERMS"),
    Type.Literal("OTHER")
  ])),
  directoryChallengeDetail: Type.Optional(Type.String({ maxLength: 1000 })),
  acceptedTermsUrl: Type.Optional(Type.String({ format: "uri", maxLength: 1000 })),
  acceptedTermsSummary: Type.Optional(Type.String({ maxLength: 1000 }))
});
const directoryCredentialFillParameters = Type.Object({
  opportunityId: Type.String({ minLength: 1, maxLength: 100 }),
  targetId: Type.String({ minLength: 1, maxLength: 200 }),
  usernameRef: Type.String({ minLength: 1, maxLength: 100 }),
  passwordRef: Type.String({ minLength: 1, maxLength: 100 }),
  confirmPasswordRef: Type.String({ minLength: 1, maxLength: 100 })
});

const configSchema = Type.Object({
  baseUrl: Type.String({ description: "Newl Apps base URL." }),
  backlinkTokenEnv: Type.Optional(Type.String({
    description: "Environment variable containing the dedicated backlink executor token."
  })),
  vercelProtectionBypassEnv: Type.Optional(Type.String({
    description: "Optional Vercel Preview automation bypass environment variable."
  })),
  directoryPasswordMasterEnv: Type.Optional(Type.String({
    description:
      "Protected local environment variable containing the directory credential master. It is never sent to Newl Apps or the model."
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
      factory: createApiTool("newl_backlink_claim", "/api/website-growth/backlinks/executor/claim", { limit: 5 })
    }),
    tool({
      name: "newl_backlink_follow_ups",
      label: "Get Due Backlink Follow-ups",
      description: "Return only approved outreach whose first or second follow-up is due and which has no recorded reply or opt-out.",
      parameters: emptyParameters,
      factory: createApiTool("newl_backlink_follow_ups", "/api/website-growth/backlinks/executor/follow-ups", { limit: 5 })
    }),
    tool({
      name: "newl_backlink_verification",
      label: "Get Backlinks Due for Verification",
      description: "Return submitted directory or editorial links that are due for a public browser recheck. Report LIVE only when the backlink is visible without authentication.",
      parameters: emptyParameters,
      factory: createApiTool("newl_backlink_verification", "/api/website-growth/backlinks/executor/verification", { limit: 5 })
    }),
    tool({
      name: "newl_backlink_sync_replies",
      label: "Sync Backlink Outreach Replies",
      description: "Read only the dedicated outreach mailbox through Newl Apps, match replies to sent Website Growth conversations, suppress opt-outs and stop their follow-ups.",
      parameters: emptyParameters,
      factory: createApiTool("newl_backlink_sync_replies", "/api/website-growth/backlinks/executor/sync-replies", {})
    }),
    tool({
      name: "newl_backlink_sync_directory_verifications",
      label: "Sync Directory Verification Emails",
      description:
        "Check only pending directory accounts in the dedicated partnerships mailbox. Safely activates same-organization verification links without returning their URLs; ambiguous cases become human-action items.",
      parameters: emptyParameters,
      factory: createApiTool(
        "newl_backlink_sync_directory_verifications",
        "/api/website-growth/backlinks/executor/sync-directory-verifications",
        {}
      )
    }),
    tool({
      name: "newl_backlink_summary",
      label: "Summarize Backlink Outreach",
      description: "Return deterministic current-run and lifetime Website Growth execution counts, blocker reasons and the Newl Apps review link for the Teams reminder.",
      parameters: summaryParameters,
      factory: createParameterizedApiTool("newl_backlink_summary", "/api/website-growth/backlinks/executor/summary")
    }),
    tool({
      name: "newl_backlink_send_email",
      label: "Send Approved Backlink Outreach",
      description: "Send one personalized message through the dedicated Newl mailbox. Newl Apps rechecks human approval, recipient suppression, consent evidence, country rules and volume limits before Microsoft 365 is called.",
      parameters: sendEmailParameters,
      factory: createParameterizedApiTool("newl_backlink_send_email", "/api/website-growth/backlinks/executor/send-email")
    }),
    tool({
      name: "newl_backlink_fill_directory_credentials",
      label: "Fill Protected Directory Credentials",
      description:
        "Prepare the approved directory account in Newl Apps, derive its unique password outside the model, and fill only the username/password browser fields. Never returns the password.",
      parameters: directoryCredentialFillParameters,
      factory: createDirectoryCredentialFillTool()
    }),
    tool({
      name: "newl_backlink_report",
      label: "Report Backlink Execution",
      description: "Report a confirmed directory submission, blocked action, lost opportunity or publicly verified live backlink. Never include a password or secret in any field.",
      parameters: reportParameters,
      factory: createParameterizedApiTool("newl_backlink_report", "/api/website-growth/backlinks/executor/report")
    })
  ]
});

export default plugin;

export function createApiTool(
  name: string,
  path: string,
  payload: Record<string, unknown>
) {
  return ({ config }: { config: WebsiteGrowthPluginConfig }) => ({
    name,
    label: "Newl Website Growth API",
    description: "Calls the configured Newl Apps Website Growth executor endpoint.",
    parameters: emptyParameters,
    async execute() {
      return callNewlApps(config, path, payload);
    }
  });
}

export function createParameterizedApiTool(name: string, path: string) {
  return ({ config }: { config: WebsiteGrowthPluginConfig }) => ({
    name,
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

export function createDirectoryCredentialFillTool() {
  return ({ config }: { config: WebsiteGrowthPluginConfig }) => ({
    name: "newl_backlink_fill_directory_credentials",
    label: "Fill Protected Directory Credentials",
    description:
      "Derives and fills a unique directory password without exposing it to the model, logs, Teams, or Newl Apps.",
    parameters: directoryCredentialFillParameters,
    async execute(_toolCallId: string, params: unknown) {
      try {
        const input = parseDirectoryCredentialFillInput(params);
        const context = await callNewlAppsData<DirectoryCredentialContext>(
          config,
          "/api/website-growth/backlinks/executor/directory-account",
          { opportunityId: input.opportunityId }
        );
        const masterEnv =
          config.directoryPasswordMasterEnv?.trim() ||
          DEFAULT_DIRECTORY_PASSWORD_MASTER_ENV;
        const workerEnvironment = { ...process.env };
        const masterValue = process.env[masterEnv]?.trim();
        delete workerEnvironment[masterEnv];
        workerEnvironment.NEWL_DIRECTORY_PASSWORD_MASTER_V1 =
          masterValue;
        const result = await fillProtectedDirectoryCredentials({
          input,
          context,
          env: workerEnvironment
        });
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify(result)
          }],
          details: {
            status: "ok",
            data: result
          }
        };
      } catch (error) {
        return textResult(
          error instanceof Error
            ? error.message
            : "Protected directory credential fill failed.",
          "failed"
        );
      }
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

async function callNewlAppsData<T>(
  config: WebsiteGrowthPluginConfig,
  path: string,
  payload: Record<string, unknown>
) {
  const tokenEnv = config.backlinkTokenEnv?.trim() || DEFAULT_TOKEN_ENV;
  const token = process.env[tokenEnv]?.trim();
  if (!token) {
    throw new Error(
      `Website Growth backlink execution is not configured. ${tokenEnv} is missing.`
    );
  }
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json"
  };
  if (config.vercelProtectionBypassEnv) {
    const bypass = process.env[config.vercelProtectionBypassEnv]?.trim();
    if (bypass) headers["x-vercel-protection-bypass"] = bypass;
  }
  const response = await fetch(`${normalizeBaseUrl(config.baseUrl)}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(60_000)
  });
  const json = (await response.json().catch(() => null)) as
    | { data?: T; error?: string }
    | null;
  if (!response.ok || !json?.data) {
    throw new Error(
      json?.error ?? `Newl Apps returned ${response.status}.`
    );
  }
  return json.data;
}

function parseDirectoryCredentialFillInput(
  value: unknown
): DirectoryCredentialFillInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Directory credential field references are required.");
  }
  const record = value as Record<string, unknown>;
  const read = (name: keyof DirectoryCredentialFillInput) => {
    const result = record[name];
    if (typeof result !== "string" || !result.trim()) {
      throw new Error(`Directory credential ${name} is required.`);
    }
    return result.trim();
  };
  return {
    opportunityId: read("opportunityId"),
    targetId: read("targetId"),
    usernameRef: read("usernameRef"),
    passwordRef: read("passwordRef"),
    confirmPasswordRef: read("confirmPasswordRef")
  };
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
