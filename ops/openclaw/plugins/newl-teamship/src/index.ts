import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import { basename, isAbsolute } from "node:path";
import { Type } from "typebox";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import { defineToolPlugin } from "openclaw/plugin-sdk/tool-plugin";

import {
  writeSpreadsheetFile,
  type SpreadsheetInput
} from "./spreadsheet.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DEFAULT_TOKEN_ENV = "OPENCLAW_TEAMSHIP_READ_TOKEN";
const DEFAULT_ASSISTANT_TOKEN_ENV = "OPENCLAW_ASSISTANT_TOKEN";

type TeamshipPluginConfig = {
  baseUrl: string;
  tenantId: string;
  readTokenEnv?: string;
  assistantTokenEnv?: string;
  digestAdminObjectId?: string;
  vercelProtectionBypassEnv?: string;
};

type TeamshipToolContext = {
  messageChannel?: string;
  requesterSenderId?: string;
  sessionKey?: string;
  workspaceDir?: string;
};

type CapturedTeamsMedia = {
  senderId: string;
  messageId: string | null;
  conversationId: string | null;
  capturedAt: number;
  paths: string[];
};

const capturedTeamsMediaBySession = new Map<string, CapturedTeamsMedia>();
const CAPTURE_TTL_MS = 10 * 60 * 1000;
const PDF_MAX_BYTES = 20 * 1024 * 1024;
const PDF_CHUNK_BYTES = 3 * 1024 * 1024;

const teamshipToolDescription = "Always call this tool for a current Teamship order, inventory, SKU, LPN, serial number, receiving order, warehouse, or product history question. Employees may use configured customer and warehouse names; do not ask them for numeric Teamship IDs. Newl Apps resolves names through the tenant's approved read-only scope reference, defaults a customer with one configured warehouse, and defaults Garland to Annagem when no warehouse is supplied. If a customer has several warehouses and none is supplied, preserve Newl Apps' warehouse clarification. Do not inspect authentication or configuration files first; the tool validates the authenticated Microsoft Teams sender, which cannot be supplied as a parameter. The plugin returns the sanitized tool answer as the authoritative result.";

const teamshipToolParameters = Type.Object({
  prompt: Type.String({
    minLength: 1,
    maxLength: 4000,
    description: "A read-only Teamship current-record question containing the exact record, SKU, LPN, or serial number and the configured customer name. Include the warehouse name when the employee supplied one. Numeric customer and warehouse IDs are not required; Newl Apps resolves approved names and safe defaults."
  })
});

const garlandExplainParameters = Type.Object({
  reference: Type.String({
    minLength: 7,
    maxLength: 50,
    description: "The Garland PS or SR number whose latest saved check should be explained."
  })
});

const garlandFeedbackParameters = Type.Object({
  reporterStatement: Type.String({
    minLength: 1,
    maxLength: 4000,
    description: "The employee's feedback in their own words. Preserve the distinction between what happened and what they expected."
  }),
  subjectId: Type.Optional(Type.String({ maxLength: 200, description: "Related PS or SR number when known." })),
  reviewRunId: Type.Optional(Type.String({ maxLength: 100 })),
  reviewOrderId: Type.Optional(Type.String({ maxLength: 100 })),
  artifactId: Type.Optional(Type.String({ maxLength: 100 })),
  expectedOutcome: Type.Optional(Type.String({ maxLength: 100, description: "For example PASS or FAIL." })),
  observedOutcome: Type.Optional(Type.String({ maxLength: 100, description: "The outcome Nemo or Newl Apps reported." })),
  classification: Type.Optional(Type.String({ maxLength: 80, description: "A short category such as CHECK_RESULT, PDF_EXTRACTION, or WORKFLOW." }))
});

const garlandPdfReviewParameters = Type.Object({
  targetReference: Type.String({
    minLength: 7,
    maxLength: 10,
    pattern: "^(?:[Pp][Ss]\\d{6}|[Ss][Rr]\\d{5,8})$",
    description: "The exact Garland PS or SR number named by the employee. Prefer PS because an SR can identify more than one PDF order."
  }),
  shipmentDate: Type.Optional(Type.String({
    pattern: "^\\d{4}-\\d{2}-\\d{2}$",
    description: "Shipment date in YYYY-MM-DD when the employee supplied one; otherwise omit it."
  }))
});

const garlandApproveUpdateParameters = Type.Object({
  artifactId: Type.String({ minLength: 1, maxLength: 100 }),
  jobId: Type.String({ minLength: 1, maxLength: 100 }),
  targetReference: Type.String({
    minLength: 7,
    maxLength: 10,
    pattern: "^(?:[Pp][Ss]\\d{6}|[Ss][Rr]\\d{5,8})$",
    description: "The exact PS or SR number shown in the proposal being approved."
  })
});

const emptyParameters = Type.Object({});

const spreadsheetCell = Type.Union([
  Type.String({ maxLength: 2000 }),
  Type.Number(),
  Type.Boolean(),
  Type.Null()
]);

const createSpreadsheetParameters = Type.Object({
  filename: Type.String({
    minLength: 1,
    maxLength: 100,
    description: "Short employee-facing filename. The tool always produces an .xlsx file in OpenClaw's exports directory."
  }),
  sheetName: Type.Optional(Type.String({ minLength: 1, maxLength: 31 })),
  columns: Type.Array(Type.Object({
    key: Type.String({ minLength: 1, maxLength: 80 }),
    header: Type.String({ minLength: 1, maxLength: 120 })
  }), { minItems: 1, maxItems: 25 }),
  rows: Type.Array(Type.Record(Type.String(), spreadsheetCell), { maxItems: 500 })
});

const configSchema = Type.Object({
  baseUrl: Type.String({ description: "Newl Apps base URL." }),
  tenantId: Type.String({
    description: "Microsoft Entra tenant ID used by the configured Teams channel."
  }),
  readTokenEnv: Type.Optional(Type.String({
    description: "Environment variable containing the Newl Apps Teamship read token."
  })),
  assistantTokenEnv: Type.Optional(Type.String({
    description: "Environment variable containing the Newl Apps Garland assistant token; it must differ from the Teamship read-token environment."
  })),
  digestAdminObjectId: Type.Optional(Type.String({
    description: "Microsoft Entra object ID used only by a sender-less scheduled admin digest. Interactive calls always use the actual Teams sender."
  })),
  vercelProtectionBypassEnv: Type.Optional(Type.String({
    description: "Optional environment variable containing a Vercel Preview automation bypass secret."
  }))
});

const plugin = defineToolPlugin({
  id: "newl-teamship",
  name: "Newl Teamship and Garland",
  description: "Runs identity-bound Teamship reads and Garland review, explanation, feedback, and approval-queue workflows through Newl Apps.",
  configSchema,
  tools: (tool) => [
    tool({
      name: "newl_teamship_read",
      label: "Newl Teamship Read",
      description: teamshipToolDescription,
      parameters: teamshipToolParameters,
      factory: createTeamshipReadTool
    }),
    tool({
      name: "newl_garland_pdf_review",
      label: "Review Garland PDF",
      description: "Always call this tool when an authenticated Microsoft Teams employee attaches a Garland order PDF, supplies an exact PS or SR number, and asks Nemo to check or review it. The tool uses only the PDF paths captured from that same trusted Teams session, saves the PDF in Newl Apps, checks only the selected PDF order, and prepares an approval-gated Teamship draft when the matched order is safe to update. Prefer PS because an SR can identify more than one PDF order. The review itself never changes Teamship or prints.",
      parameters: garlandPdfReviewParameters,
      factory: createGarlandPdfReviewTool
    }),
    tool({
      name: "newl_garland_approve_update",
      label: "Approve Garland Teamship Update",
      description: "Call only after an authenticated Teams employee explicitly approves the exact Garland update proposal shown by newl_garland_pdf_review. It validates the artifact, target reference, and draft job together, then queues the existing Teamship worker. Never infer approval from the upload or from a request to check an order. It never prints.",
      parameters: garlandApproveUpdateParameters,
      factory: createGarlandApproveUpdateTool
    }),
    tool({
      name: "newl_garland_explain",
      label: "Explain Garland Check",
      description: "Call this tool when an employee asks why a saved Garland check passed, failed, was missing, or stayed pending. Use the PS or SR number. The response distinguishes deterministic evidence from admin-approved operational lessons.",
      parameters: garlandExplainParameters,
      factory: createGarlandExplainTool
    }),
    tool({
      name: "newl_operational_feedback",
      label: "Submit Operational Feedback",
      description: "Call this tool when an employee says a workflow result should have passed, should have failed, extracted the wrong value, or otherwise needs correction. Save their statement as reported feedback; never describe it as an approved rule until an admin promotes it.",
      parameters: garlandFeedbackParameters,
      factory: createOperationalFeedbackTool
    }),
    tool({
      name: "newl_development_suggestion_digest",
      label: "Development Suggestion Digest",
      description: "Use only for the configured daily admin review. It groups unqueued employee feedback into approval-required development suggestions and lists failed or unanswered Nemo queries. It cannot start development, merge, deploy, write Teamship, or print.",
      parameters: emptyParameters,
      factory: createDevelopmentSuggestionDigestTool
    }),
    tool({
      name: "newl_create_spreadsheet",
      label: "Create Teams Spreadsheet",
      description: "Create a bounded Excel .xlsx file from data already authorized and returned in the current Microsoft Teams conversation. Use only when the employee explicitly asks for a downloadable spreadsheet. After this tool succeeds, upload its exact filePath with the message tool action upload-file in the same Teams conversation. Never return the local file path or a Markdown file link to the employee.",
      parameters: createSpreadsheetParameters,
      factory: createSpreadsheetTool
    })
  ]
});

const registerTools = plugin.register;
plugin.register = (api) => {
  registerTools?.(api);
  registerTrustedTeamsMediaCapture(api);
};

export default plugin;

export function createSpreadsheetTool({
  toolContext
}: {
  config: TeamshipPluginConfig;
  toolContext: TeamshipToolContext;
}) {
  return {
    name: "newl_create_spreadsheet",
    label: "Create Teams Spreadsheet",
    description: "Create a bounded Excel .xlsx file from data already authorized and returned in the current Microsoft Teams conversation. Use only when the employee explicitly asks for a downloadable spreadsheet. Upload the returned filePath through Teams with message(action=upload-file); never show the local path.",
    parameters: createSpreadsheetParameters,
    async execute(_toolCallId: string, params: unknown) {
      const senderId = normalizeUuid(toolContext.requesterSenderId);
      if (toolContext.messageChannel !== "msteams" || !senderId) {
        return textResult(
          "Spreadsheet creation requires an authenticated Microsoft Teams message with a valid Entra identity.",
          "unauthorized"
        );
      }
      if (!toolContext.workspaceDir) {
        return textResult("OpenClaw did not provide a workspace for spreadsheet creation.", "not_configured");
      }

      try {
        const input = readSpreadsheetInput(params);
        const result = await writeSpreadsheetFile(toolContext.workspaceDir, input);
        return {
          content: [{
            type: "text" as const,
            text: `Spreadsheet created as ${result.filename}. Upload it now with message(action=upload-file, filePath="${result.filePath}", filename="${result.filename}"). Do not show the local path in a Teams message.`
          }],
          details: {
            status: "ok",
            ...result
          }
        };
      } catch (error) {
        return textResult(
          error instanceof Error ? error.message : "Spreadsheet creation failed.",
          "failed"
        );
      }
    }
  };
}

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
    description: teamshipToolDescription,
    parameters: teamshipToolParameters,
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

export function createGarlandExplainTool({
  config,
  toolContext
}: {
  config: TeamshipPluginConfig;
  toolContext: TeamshipToolContext;
}) {
  return {
    name: "newl_garland_explain",
    label: "Explain Garland Check",
    description: "Explain the latest saved Garland check for a PS or SR number.",
    parameters: garlandExplainParameters,
    async execute(_toolCallId: string, params: unknown, signal?: AbortSignal) {
      const auth = resolveTrustedTeamsAuth(config, toolContext);
      if (!auth.ok) return auth.result;
      const reference = readParameterString(params, "reference", 50);
      const response = await fetch(new URL("/api/assistant/garland", normalizeBaseUrl(config.baseUrl)), {
        method: "POST",
        redirect: "manual",
        signal,
        headers: buildRequestHeaders(auth.value),
        body: JSON.stringify({ action: "explain", reference })
      });
      const body = await readGenericResponse(response);
      if (!response.ok || !body.data) {
        return textResult(body.error || `Garland explanation returned HTTP ${response.status}.`, "failed");
      }
      const data = body.data as Record<string, unknown>;
      return textResult(formatGarlandExplanation(data), "ok");
    }
  };
}

export function createOperationalFeedbackTool({
  config,
  toolContext
}: {
  config: TeamshipPluginConfig;
  toolContext: TeamshipToolContext;
}) {
  return {
    name: "newl_operational_feedback",
    label: "Submit Operational Feedback",
    description: "Save employee workflow feedback as reported evidence pending review.",
    parameters: garlandFeedbackParameters,
    async execute(_toolCallId: string, params: unknown, signal?: AbortSignal) {
      const auth = resolveTrustedTeamsAuth(config, toolContext);
      if (!auth.ok) return auth.result;
      const values = asRecord(params);
      const response = await fetch(new URL("/api/assistant/garland", normalizeBaseUrl(config.baseUrl)), {
        method: "POST",
        redirect: "manual",
        signal,
        headers: buildRequestHeaders(auth.value),
        body: JSON.stringify({
          action: "feedback",
          subjectType: "GARLAND_CHECK",
          subjectId: optionalParameterString(values.subjectId, 200),
          teamshipReviewRunId: optionalParameterString(values.reviewRunId, 100),
          teamshipReviewOrderId: optionalParameterString(values.reviewOrderId, 100),
          artifactId: optionalParameterString(values.artifactId, 100),
          reporterStatement: readParameterString(params, "reporterStatement", 4000),
          expectedOutcome: optionalParameterString(values.expectedOutcome, 100),
          observedOutcome: optionalParameterString(values.observedOutcome, 100),
          classification: optionalParameterString(values.classification, 80)
        })
      });
      const body = await readGenericResponse(response);
      if (!response.ok || !body.data) {
        return textResult(body.error || `Feedback submission returned HTTP ${response.status}.`, "failed");
      }
      const feedback = body.data as Record<string, unknown>;
      return textResult(
        `Feedback ${String(feedback.id ?? "")} was saved as ${String(feedback.status ?? "REPORTED")}. It is evidence for review, not an approved Nemo rule.`,
        "ok"
      );
    }
  };
}

export function createDevelopmentSuggestionDigestTool({
  config,
  toolContext
}: {
  config: TeamshipPluginConfig;
  toolContext: TeamshipToolContext;
}) {
  return {
    name: "newl_development_suggestion_digest",
    label: "Development Suggestion Digest",
    description: "Create and return the admin approval queue without starting development.",
    parameters: emptyParameters,
    async execute(_toolCallId: string, _params: unknown, signal?: AbortSignal) {
      const auth = resolveTrustedTeamsAuth(config, toolContext, config.digestAdminObjectId);
      if (!auth.ok) return auth.result;
      const response = await fetch(new URL("/api/assistant/garland", normalizeBaseUrl(config.baseUrl)), {
        method: "POST",
        redirect: "manual",
        signal,
        headers: buildRequestHeaders(auth.value),
        body: JSON.stringify({ action: "suggestion_digest" })
      });
      const body = await readGenericResponse(response);
      if (!response.ok || !body.data) {
        return textResult(body.error || `Suggestion digest returned HTTP ${response.status}.`, "failed");
      }
      const data = body.data as {
        awaitingApproval?: Array<Record<string, unknown>>;
        unresolvedQueries?: Array<Record<string, unknown>>;
        safety?: string;
      };
      const suggestions = data.awaitingApproval ?? [];
      const suggestionLines = suggestions.map(
        (item) => `- ${String(item.title ?? "Suggestion")} [ID ${String(item.id ?? "unknown")}] (${String(item.feedbackCount ?? 0)} feedback item(s), ${String(item.riskLevel ?? "MEDIUM")} risk) — approval required`
      );
      const unresolvedQueries = data.unresolvedQueries ?? [];
      const queryLines = unresolvedQueries.slice(0, 20).map((item) => {
        const prompt = String(item.promptText ?? "No prompt captured").replace(/\s+/g, " ").slice(0, 240);
        const detail = String(item.errorMessage ?? item.toolName ?? item.failureKind ?? "Unknown failure").replace(/\s+/g, " ").slice(0, 180);
        return `- ${String(item.failureKind ?? "UNKNOWN")}: ${prompt} — ${detail}`;
      });
      return textResult(
        [
          `${suggestions.length} development suggestion(s) await approval.`,
          ...suggestionLines,
          `${unresolvedQueries.length} failed or unanswered Nemo quer${unresolvedQueries.length === 1 ? "y" : "ies"} need review.`,
          ...queryLines,
          data.safety ?? "No development was started."
        ].join("\n"),
        "ok"
      );
    }
  };
}

export function createGarlandApproveUpdateTool({
  config,
  toolContext
}: {
  config: TeamshipPluginConfig;
  toolContext: TeamshipToolContext;
}) {
  return {
    name: "newl_garland_approve_update",
    label: "Approve Garland Teamship Update",
    description: "Approve one exact, previously prepared Garland Teamship update draft.",
    parameters: garlandApproveUpdateParameters,
    async execute(_toolCallId: string, params: unknown, signal?: AbortSignal) {
      const auth = resolveTrustedTeamsAuth(config, toolContext);
      if (!auth.ok) return auth.result;
      const artifactId = readParameterString(params, "artifactId", 100);
      const jobId = readParameterString(params, "jobId", 100);
      const targetReference = readParameterString(params, "targetReference", 10).toUpperCase();
      const response = await fetch(
        new URL(`/api/assistant/garland/artifacts/${artifactId}/update`, normalizeBaseUrl(config.baseUrl)),
        {
          method: "POST",
          redirect: "manual",
          signal,
          headers: buildRequestHeaders(auth.value),
          body: JSON.stringify({
            jobId,
            targetReference,
            confirmation: "APPROVE_TEAMSHIP_UPDATE"
          })
        }
      );
      const body = await readGenericResponse(response);
      if (!response.ok || !body.data) {
        return textResult(body.error || `Garland update approval returned HTTP ${response.status}.`, "failed");
      }
      const result = asRecord(body.data);
      return textResult(
        `${targetReference} update job ${String(result.jobId ?? jobId)} is ${String(result.status ?? "APPROVED")} and queued for the Teamship worker. Completion has not yet been verified. Nothing was printed.`,
        "ok"
      );
    }
  };
}

export function createGarlandPdfReviewTool({
  config,
  toolContext
}: {
  config: TeamshipPluginConfig;
  toolContext: TeamshipToolContext;
}) {
  return {
    name: "newl_garland_pdf_review",
    label: "Review Garland PDF",
    description: "Save and run a read-only Garland review for exactly one PS or SR selected from a PDF attached to the current trusted Teams message.",
    parameters: garlandPdfReviewParameters,
    async execute(_toolCallId: string, params: unknown, signal?: AbortSignal) {
      const auth = resolveTrustedTeamsAuth(config, toolContext);
      if (!auth.ok) return auth.result;
      const sessionKey = toolContext.sessionKey?.trim();
      const captured = sessionKey ? capturedTeamsMediaBySession.get(sessionKey) : undefined;
      if (
        !sessionKey ||
        !captured ||
        captured.senderId !== auth.value.senderId ||
        Date.now() - captured.capturedAt > CAPTURE_TTL_MS
      ) {
        return textResult("No current Garland PDF is attached to this authenticated Teams message. Ask the employee to attach it again.", "failed");
      }

      const targetReference = readParameterString(params, "targetReference", 10).toUpperCase();
      const shipmentDate = optionalParameterString(asRecord(params).shipmentDate, 10);
      const files = [];
      for (const candidatePath of captured.paths) {
        const file = await readCapturedPdf(candidatePath);
        if (file) files.push(file);
      }
      if (files.length === 0) {
        return textResult("The current Teams message does not contain a PDF attachment.", "failed");
      }

      const completed = [];
      for (const file of files) {
        const createResponse = await fetch(new URL("/api/assistant/garland/artifacts", normalizeBaseUrl(config.baseUrl)), {
          method: "POST",
          redirect: "manual",
          signal,
          headers: buildRequestHeaders(auth.value),
          body: JSON.stringify({
            fileName: file.fileName,
            contentType: "application/pdf",
            sizeBytes: file.bytes.byteLength,
            chunkCount: Math.ceil(file.bytes.byteLength / PDF_CHUNK_BYTES),
            contentHash: sha256(file.bytes),
            targetReference,
            externalMessageId: captured.messageId,
            externalConversationId: captured.conversationId
          })
        });
        const createBody = await readGenericResponse(createResponse);
        const artifactData = asRecord(createBody.data);
        const artifactId = artifactData.id;
        if (!createResponse.ok || typeof artifactId !== "string") {
          return textResult(createBody.error || `Could not create storage for ${file.fileName}.`, "failed");
        }
        if (artifactData.status === "REVIEWED") {
          completed.push(formatStoredArtifactResult(file.fileName, artifactData));
          continue;
        }
        if (artifactData.status !== "UPLOADING") {
          return textResult(
            artifactData.errorMessage
              ? `The prior upload of ${file.fileName} failed: ${String(artifactData.errorMessage)} Attach the PDF in a new Teams message to retry.`
              : `The prior upload of ${file.fileName} cannot be resumed. Attach it in a new Teams message to retry.`,
            "failed"
          );
        }

        for (let offset = 0, chunkIndex = 0; offset < file.bytes.byteLength; offset += PDF_CHUNK_BYTES, chunkIndex += 1) {
          const chunk = file.bytes.subarray(offset, Math.min(offset + PDF_CHUNK_BYTES, file.bytes.byteLength));
          const chunkResponse = await fetch(
            new URL(`/api/assistant/garland/artifacts/${artifactId}/chunks/${chunkIndex}`, normalizeBaseUrl(config.baseUrl)),
            {
              method: "PUT",
              redirect: "manual",
              signal,
              headers: {
                ...buildRequestHeaders(auth.value, false),
                "content-type": "application/octet-stream",
                "content-length": String(chunk.byteLength),
                "x-newl-content-sha256": sha256(chunk)
              },
              body: chunk
            }
          );
          const chunkBody = await readGenericResponse(chunkResponse);
          if (!chunkResponse.ok) {
            return textResult(chunkBody.error || `Could not store chunk ${chunkIndex + 1} for ${file.fileName}.`, "failed");
          }
        }

        const finalizeResponse = await fetch(
          new URL(`/api/assistant/garland/artifacts/${artifactId}/finalize`, normalizeBaseUrl(config.baseUrl)),
          {
            method: "POST",
            redirect: "manual",
            signal,
            headers: buildRequestHeaders(auth.value),
            body: JSON.stringify({ shipmentDate })
          }
        );
        const finalizeBody = await readGenericResponse(finalizeResponse);
        if (!finalizeResponse.ok || !finalizeBody.data) {
          return textResult(finalizeBody.error || `Could not review ${file.fileName}.`, "failed");
        }
        completed.push(finalizeBody.data as Record<string, unknown>);
      }

      capturedTeamsMediaBySession.delete(sessionKey);
      return textResult(formatPdfReviewResults(completed), "ok");
    }
  };
}

export function normalizeUuid(value: unknown) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return UUID_PATTERN.test(normalized) ? normalized : null;
}

export function registerTrustedTeamsMediaCapture(api: OpenClawPluginApi) {
  api.on("message_received", (event, ctx) => {
    if (ctx.channelId !== "msteams") return;
    const senderId = normalizeUuid(ctx.senderId ?? event.senderId);
    const sessionKey = ctx.sessionKey ?? event.sessionKey;
    if (!senderId || !sessionKey) return;
    const metadata = asRecord(event.metadata);
    const paths = uniqueStrings([
      ...arrayStrings(metadata.mediaPaths),
      ...(typeof metadata.mediaPath === "string" ? [metadata.mediaPath] : [])
    ]);
    if (paths.length === 0) return;

    pruneCapturedTeamsMedia();
    capturedTeamsMediaBySession.set(sessionKey, {
      senderId,
      messageId: typeof event.messageId === "string" ? event.messageId : null,
      conversationId: typeof ctx.conversationId === "string" ? ctx.conversationId : null,
      capturedAt: Date.now(),
      paths: paths.slice(0, 10)
    });
  });
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
}, json = true) {
  return {
    authorization: `Bearer ${token}`,
    ...(json ? { "content-type": "application/json" } : {}),
    "x-newl-teams-tenant-id": tenantId,
    "x-newl-teams-aad-object-id": senderId,
    ...(bypassToken ? { "x-vercel-protection-bypass": bypassToken } : {})
  };
}

function resolveTrustedTeamsAuth(
  config: TeamshipPluginConfig,
  toolContext: TeamshipToolContext,
  scheduledAdminObjectId?: string
):
  | { ok: true; value: { token: string; tenantId: string; senderId: string; bypassToken?: string } }
  | { ok: false; result: ReturnType<typeof textResult> } {
  const runtimeSenderId = normalizeUuid(toolContext.requesterSenderId);
  const senderId = runtimeSenderId ?? normalizeUuid(scheduledAdminObjectId);
  const tenantId = normalizeUuid(config.tenantId);
  if (toolContext.messageChannel !== "msteams" || !senderId || !tenantId) {
    return {
      ok: false,
      result: textResult("Newl Apps assistant tools require an authenticated Microsoft Teams message with a valid Entra identity.", "unauthorized")
    };
  }
  const assistantTokenEnv = config.assistantTokenEnv?.trim() || DEFAULT_ASSISTANT_TOKEN_ENV;
  const readTokenEnv = config.readTokenEnv?.trim() || DEFAULT_TOKEN_ENV;
  if (assistantTokenEnv === readTokenEnv) {
    return {
      ok: false,
      result: textResult(
        "Newl Apps assistant authentication must use a credential distinct from the Teamship read token.",
        "not_configured"
      )
    };
  }
  const token = process.env[assistantTokenEnv]?.trim();
  if (!token) {
    return { ok: false, result: textResult("Newl Apps assistant authentication is not configured on this OpenClaw runtime.", "not_configured") };
  }
  const bypassEnv = config.vercelProtectionBypassEnv?.trim();
  const bypassToken = bypassEnv ? process.env[bypassEnv]?.trim() : undefined;
  if (bypassEnv && !bypassToken) {
    return { ok: false, result: textResult("Newl Apps Preview protection authentication is not configured on this OpenClaw runtime.", "not_configured") };
  }
  return { ok: true, value: { token, tenantId, senderId, bypassToken } };
}

async function readCapturedPdf(candidatePath: string) {
  if (!isAbsolute(candidatePath)) {
    throw new Error("OpenClaw supplied a non-absolute attachment path.");
  }
  const resolvedPath = await realpath(candidatePath);
  const fileStat = await stat(resolvedPath);
  if (!fileStat.isFile() || fileStat.size < 1 || fileStat.size > PDF_MAX_BYTES) {
    throw new Error("Garland PDFs must be files between 1 byte and 20 MB.");
  }
  const bytes = await readFile(resolvedPath);
  if (bytes.byteLength < 5 || bytes.subarray(0, 5).toString("ascii") !== "%PDF-") {
    return null;
  }
  const capturedName = basename(resolvedPath);
  const fileName = capturedName.toLowerCase().endsWith(".pdf") ? capturedName : `${capturedName}.pdf`;
  return { fileName, bytes };
}

function formatGarlandExplanation(data: Record<string, unknown>) {
  const explanation = typeof data.explanation === "string" ? data.explanation : "The saved Garland check was found.";
  const issues = Array.isArray(data.issues) ? data.issues : [];
  const issueLines = issues.map((issue) => {
    const record = asRecord(issue);
    return `- ${String(record.label ?? record.key ?? "Field")}: ${String(record.message ?? record.status ?? "Issue")}`;
  });
  const lessons = Array.isArray(data.approvedLessons) ? data.approvedLessons : [];
  const lessonLines = lessons.map((lesson) => {
    const record = asRecord(lesson);
    return `- Approved lesson: ${String(record.title ?? "Lesson")} — ${String(record.ruleText ?? "")}`;
  });
  return [explanation, ...issueLines, ...lessonLines].join("\n");
}

function formatStoredArtifactResult(fileName: string, artifact: Record<string, unknown>) {
  const summary = asRecord(artifact.extractionSummary);
  return {
    fileName,
    artifactId: artifact.id,
    reviewRunId: artifact.teamshipReviewRunId,
    extraction: {
      targetReference: summary.targetReference,
      selectedPsNumber: summary.selectedPsNumber,
      selectedSrNumber: summary.selectedSrNumber,
      pageCount: summary.pageCount,
      totalOrderCount: summary.totalOrderCount,
      orderCount: summary.orderCount,
      ignoredOrderCount: summary.ignoredOrderCount,
      psNumbers: summary.psNumbers,
      srNumbers: summary.srNumbers
    },
    review: asRecord(summary.review),
    updateProposal: asRecord(summary.updateProposal),
    reused: true
  };
}

function formatPdfReviewResults(results: Array<Record<string, unknown>>) {
  const lines = results.map((result) => {
    const review = asRecord(result.review);
    const extraction = asRecord(result.extraction);
    const storageResult = result.reused === true ? "was already saved as" : "was saved as";
    const selectedReference = [extraction.selectedPsNumber, extraction.selectedSrNumber]
      .filter((value) => typeof value === "string" && value)
      .join(" / ");
    const ignoredOrderCount = Number(extraction.ignoredOrderCount ?? 0);
    const ignoredText = ignoredOrderCount > 0
      ? ` ${ignoredOrderCount} other order${ignoredOrderCount === 1 ? "" : "s"} in the PDF ${ignoredOrderCount === 1 ? "was" : "were"} ignored.`
      : "";
    const proposal = asRecord(result.updateProposal);
    const actions = arrayStrings(proposal.proposedActions);
    const investigationItems = arrayStrings(proposal.investigationItems);
    const proposalText = typeof proposal.jobId === "string" && proposal.jobId
      ? ` Update draft ${proposal.jobId} is ${String(proposal.status ?? "DRAFT")}. Proposed actions:\n${actions.map((action) => `- ${action}`).join("\n")}\nExplicit approval is required before Teamship is changed; approve artifact ${String(result.artifactId ?? "")}, job ${proposal.jobId}, for ${String(extraction.targetReference ?? selectedReference)}.`
      : ` No Teamship update draft was created.${actions.length ? ` Proposed actions:\n${actions.map((action) => `- ${action}`).join("\n")}` : ""}`;
    const investigationText = investigationItems.length
      ? `\nTeam investigation needed:\n${investigationItems.map((item) => `- ${item}`).join("\n")}`
      : "\nNo other differences require team investigation.";
    return `${String(result.fileName ?? "Garland PDF")} ${storageResult} artifact ${String(result.artifactId ?? "")}. Review ${String(result.reviewRunId ?? "")} checked only ${selectedReference || String(extraction.targetReference ?? "the selected order")}: ${String(review.passedCount ?? 0)} passed, ${String(review.failedCount ?? 0)} failed, ${String(review.missingTeamshipCount ?? 0)} missing in Teamship, and ${String(review.pendingTeamshipCount ?? 0)} pending.${ignoredText}${proposalText}${investigationText}\nNo Teamship values were changed and nothing was printed.`;
  });
  return lines.join("\n");
}

function readParameterString(params: unknown, field: string, maxLength: number) {
  const value = asRecord(params)[field];
  if (typeof value !== "string" || !value.trim() || value.length > maxLength) {
    throw new Error(`${field} must be between 1 and ${maxLength} characters.`);
  }
  return value.trim();
}

function optionalParameterString(value: unknown, maxLength: number) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, maxLength) : undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function arrayStrings(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function pruneCapturedTeamsMedia() {
  const cutoff = Date.now() - CAPTURE_TTL_MS;
  for (const [key, value] of capturedTeamsMediaBySession) {
    if (value.capturedAt < cutoff) capturedTeamsMediaBySession.delete(key);
  }
}

function sha256(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
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

function readSpreadsheetInput(params: unknown): SpreadsheetInput {
  if (!params || typeof params !== "object") throw new Error("Spreadsheet input is required.");
  const input = params as Record<string, unknown>;
  return {
    filename: typeof input.filename === "string" ? input.filename : "nemo-spreadsheet.xlsx",
    sheetName: typeof input.sheetName === "string" ? input.sheetName : "Data",
    columns: Array.isArray(input.columns)
      ? input.columns.map((column) => {
        const value = column && typeof column === "object"
          ? column as Record<string, unknown>
          : {};
        return {
          key: typeof value.key === "string" ? value.key : "",
          header: typeof value.header === "string" ? value.header : ""
        };
      })
      : [],
    rows: Array.isArray(input.rows)
      ? input.rows as SpreadsheetInput["rows"]
      : []
  };
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

async function readGenericResponse(response: Response) {
  const value = await response.json().catch(() => null) as { data?: unknown; error?: string } | null;
  return value ?? {};
}

function textResult(text: string, status: "ok" | "failed" | "not_configured" | "unauthorized") {
  return {
    content: [{ type: "text" as const, text }],
    details: { status }
  };
}
