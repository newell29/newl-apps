import crypto from "node:crypto";

import { JobStatus, ModuleKey, Prisma } from "@prisma/client";

import { createRivetDevelopmentJob } from "@/modules/assistant/rivet-development-jobs";
import { prisma } from "@/server/db";

export const WEBSITE_GROWTH_BACKLINK_FAILURE_JOB_TYPE =
  "WEBSITE_GROWTH_BACKLINK_EXECUTOR_FAILURE";
export const WEBSITE_GROWTH_BACKLINK_WORKFLOW_KEY =
  "WEBSITE_GROWTH_BACKLINK_OUTREACH";
export const WEBSITE_GROWTH_RIVET_APPROVAL_VALUE =
  "OWNER_APPROVED_WEBSITE_GROWTH_FAILURE_TRIAGE";

const SYSTEM_ACTOR = "system:website-growth-failure-manager";
const IDENTICAL_FAILURE_CIRCUIT_BREAKER_COUNT = 2;
const FAILURE_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;

export type WebsiteGrowthBacklinkFailureClassification =
  | "CODE_DEFECT"
  | "AUTHORIZATION_REQUIRED"
  | "AMBIGUOUS_EXTERNAL_ACTION"
  | "RUNTIME_TRANSIENT"
  | "INVESTIGATION_REQUIRED";

export type WebsiteGrowthBacklinkFailureInput = {
  sourceJobId: string;
  sourceRunId: string;
  status: "error" | "skipped";
  error?: string | null;
  errorReason?: string | null;
  summary?: string | null;
  diagnostics?: string[];
  runAt?: string | null;
};

export function classifyWebsiteGrowthBacklinkFailure(
  input: Pick<
    WebsiteGrowthBacklinkFailureInput,
    "error" | "errorReason" | "summary" | "diagnostics"
  >
): WebsiteGrowthBacklinkFailureClassification {
  const text = [
    input.errorReason,
    input.error,
    input.summary,
    ...(input.diagnostics ?? [])
  ]
    .filter(Boolean)
    .join("\n")
    .toLowerCase();

  if (
    /\b(?:sendmail|send mail|mail\.send|microsoft graph|outreach send|message send|draft message)\b/.test(
      text
    )
  ) {
    return "AMBIGUOUS_EXTERNAL_ACTION";
  }
  if (
    /\b(?:forbidden|unauthorized|permission|access policy|access denied|invalid credential|invalid token|authentication|auth_permanent|secret|mailbox scope)\b/.test(
      text
    )
  ) {
    return "AUTHORIZATION_REQUIRED";
  }
  if (
    /\b(?:syntaxerror|typeerror|referenceerror|cannot find module|module not found|unexpected token|unsupported option|unknown option|invalid tool arguments|schema validation|is not a function)\b/.test(
      text
    )
  ) {
    return "CODE_DEFECT";
  }
  if (
    /\b(?:timeout|timed out|rate_limit|overloaded|server_error|gateway closed|browser target|stale target|connection reset|econnreset|temporary|temporarily)\b/.test(
      text
    )
  ) {
    return "RUNTIME_TRANSIENT";
  }
  return "INVESTIGATION_REQUIRED";
}

export async function recordWebsiteGrowthBacklinkFailure({
  tenantId,
  input,
  env = process.env,
  now = new Date()
}: {
  tenantId: string;
  input: WebsiteGrowthBacklinkFailureInput;
  env?: Record<string, string | undefined>;
  now?: Date;
}) {
  const normalized = normalizeFailureInput(input);
  const fingerprint = buildFailureFingerprint(normalized);
  const existing = await prisma.automationJobRun.findFirst({
    where: {
      tenantId,
      jobType: WEBSITE_GROWTH_BACKLINK_FAILURE_JOB_TYPE,
      input: {
        path: ["sourceRunId"],
        equals: normalized.sourceRunId
      }
    },
    select: {
      id: true,
      output: true
    }
  });
  if (existing) {
    return {
      duplicate: true,
      incidentId: existing.id,
      notify: false,
      disableExecutor: false,
      teamsMessage: null,
      developmentJobId: readJsonString(existing.output, "developmentJobId")
    };
  }

  const classification = classifyWebsiteGrowthBacklinkFailure(normalized);
  const autoTriageApproved =
    env.WEBSITE_GROWTH_RIVET_AUTO_TRIAGE_APPROVAL?.trim() ===
    WEBSITE_GROWTH_RIVET_APPROVAL_VALUE;
  const recentIdentical = await prisma.automationJobRun.findMany({
    where: {
      tenantId,
      jobType: WEBSITE_GROWTH_BACKLINK_FAILURE_JOB_TYPE,
      createdAt: { gte: new Date(now.getTime() - FAILURE_LOOKBACK_MS) },
      input: {
        path: ["fingerprint"],
        equals: fingerprint
      }
    },
    select: { output: true },
    take: IDENTICAL_FAILURE_CIRCUIT_BREAKER_COUNT
  });
  const existingDevelopmentJobId =
    recentIdentical
      .map((incident) => readJsonString(incident.output, "developmentJobId"))
      .find((value): value is string => Boolean(value)) ?? null;
  const disableExecutor =
    recentIdentical.length + 1 >= IDENTICAL_FAILURE_CIRCUIT_BREAKER_COUNT;

  const result = await prisma.$transaction(async (tx) => {
    const incident = await tx.automationJobRun.create({
      data: {
        tenantId,
        jobType: WEBSITE_GROWTH_BACKLINK_FAILURE_JOB_TYPE,
        status: JobStatus.ERROR,
        startedAt: normalized.runAt ? new Date(normalized.runAt) : now,
        finishedAt: now,
        input: {
          version: 1,
          sourceJobId: normalized.sourceJobId,
          sourceRunId: normalized.sourceRunId,
          sourceStatus: normalized.status,
          fingerprint
        },
        output: {
          phase: "RECORDED",
          classification,
          disableExecutor,
          autoTriageApproved
        },
        errorMessage: normalized.error ?? normalized.summary ?? normalized.errorReason
      }
    });

    let developmentJobId: string | null = existingDevelopmentJobId;
    if (
      (classification === "CODE_DEFECT" ||
        classification === "INVESTIGATION_REQUIRED") &&
      autoTriageApproved &&
      !existingDevelopmentJobId
    ) {
      const feedback = await tx.operationalFeedback.create({
        data: {
          tenantId,
          moduleKey: ModuleKey.WEBSITE_GROWTH,
          workflowKey: WEBSITE_GROWTH_BACKLINK_WORKFLOW_KEY,
          subjectType: "OPENCLAW_CRON_RUN",
          subjectId: normalized.sourceRunId,
          reporterUserId: SYSTEM_ACTOR,
          reporterStatement: buildFailureStatement(normalized),
          expectedOutcome:
            "The approved backlink executor completes and records a deterministic Teams outcome.",
          observedOutcome:
            normalized.error ?? normalized.summary ?? "The executor failed.",
          classification,
          status: "CONFIRMED",
          evidence: {
            sourceJobId: normalized.sourceJobId,
            sourceRunId: normalized.sourceRunId,
            errorReason: normalized.errorReason,
            diagnostics: normalized.diagnostics
          }
        }
      });
      const suggestion = await tx.developmentSuggestion.create({
        data: {
          tenantId,
          moduleKey: ModuleKey.WEBSITE_GROWTH,
          workflowKey: WEBSITE_GROWTH_BACKLINK_WORKFLOW_KEY,
          title: "Fix Website Growth backlink executor failure",
          summary: buildFailureStatement(normalized),
          rationale:
            "The owner-approved failure policy allows Rivet to diagnose code defects and prepare a reviewed draft PR. It cannot retry outreach, merge, deploy, change permissions, or contact a publisher.",
          status: "APPROVED",
          riskLevel: "MEDIUM",
          sourceFeedbackIds: [feedback.id],
          feedbackCount: 1,
          proposedScope: {
            issueKey: `WEBSITE_GROWTH_BACKLINK_${fingerprint.slice(0, 16).toUpperCase()}`,
            approvalPolicy: WEBSITE_GROWTH_RIVET_APPROVAL_VALUE,
            requiresHumanMerge: true,
            allowedAutomaticActions: [
              "READ_REQUIRED_CONTEXT",
              "EDIT_ISOLATED_BRANCH",
              "ADD_REGRESSION_TESTS",
              "UPDATE_DOCUMENTATION",
              "COMMIT",
              "PUSH_FEATURE_BRANCH",
              "OPEN_PULL_REQUEST"
            ],
            forbiddenAutomaticActions: [
              "RETRY_OUTREACH",
              "MERGE",
              "DEPLOY",
              "PERMISSION_CHANGE",
              "CUSTOMER_OR_PUBLISHER_COMMUNICATION"
            ]
          },
          decisionAt: now,
          decisionNotes:
            "Automatically approved under the owner-enabled Website Growth Rivet failure-triage policy."
        }
      });
      const developmentJob = await createRivetDevelopmentJob(
        tx,
        { tenantId, userId: SYSTEM_ACTOR },
        suggestion,
        [
          {
            id: feedback.id,
            moduleKey: ModuleKey.WEBSITE_GROWTH,
            workflowKey: WEBSITE_GROWTH_BACKLINK_WORKFLOW_KEY,
            classification,
            subjectType: "OPENCLAW_CRON_RUN",
            subjectId: normalized.sourceRunId,
            reporterStatement: buildFailureStatement(normalized),
            expectedOutcome:
              "The approved backlink executor completes and records a deterministic Teams outcome.",
            observedOutcome:
              normalized.error ?? normalized.summary ?? "The executor failed."
          }
        ]
      );
      developmentJobId = developmentJob.id;
      await tx.developmentSuggestion.update({
        where: {
          tenantId_id: {
            tenantId,
            id: suggestion.id
          }
        },
        data: {
          developmentThreadId: developmentJob.id
        }
      });
      await tx.automationJobRun.update({
        where: { id: incident.id },
        data: {
          output: {
            phase: "RIVET_QUEUED",
            classification,
            disableExecutor,
            autoTriageApproved,
            feedbackId: feedback.id,
            suggestionId: suggestion.id,
            developmentJobId
          }
        }
      });
    } else if (existingDevelopmentJobId) {
      await tx.automationJobRun.update({
        where: { id: incident.id },
        data: {
          output: {
            phase: "RIVET_ALREADY_QUEUED",
            classification,
            disableExecutor,
            autoTriageApproved,
            developmentJobId: existingDevelopmentJobId
          }
        }
      });
    }

    await tx.auditLog.create({
      data: {
        tenantId,
        actorUserId: null,
        action: "website-growth.backlink.failure-recorded",
        entityType: "AutomationJobRun",
        entityId: incident.id,
        after: {
          sourceRunId: normalized.sourceRunId,
          classification,
          fingerprint,
          disableExecutor,
          developmentJobId
        }
      }
    });
    return {
      incidentId: incident.id,
      developmentJobId
    };
  });

  return {
    duplicate: false,
    ...result,
    notify: true,
    disableExecutor,
    teamsMessage: buildFailureTeamsMessage({
      classification,
      disableExecutor,
      developmentJobId: result.developmentJobId
    })
  };
}

function normalizeFailureInput(
  input: WebsiteGrowthBacklinkFailureInput
): WebsiteGrowthBacklinkFailureInput {
  const sourceJobId = normalizeRequiredText(input.sourceJobId, "sourceJobId", 200);
  const sourceRunId = normalizeRequiredText(input.sourceRunId, "sourceRunId", 200);
  if (input.status !== "error" && input.status !== "skipped") {
    throw new Error("The backlink failure status must be error or skipped.");
  }
  const runAt = input.runAt?.trim() || null;
  if (runAt && Number.isNaN(Date.parse(runAt))) {
    throw new Error("The backlink failure runAt value is invalid.");
  }
  return {
    sourceJobId,
    sourceRunId,
    status: input.status,
    error: redactSensitiveText(normalizeOptionalText(input.error, 2_000)),
    errorReason: redactSensitiveText(
      normalizeOptionalText(input.errorReason, 200)
    ),
    summary: redactSensitiveText(normalizeOptionalText(input.summary, 2_000)),
    diagnostics: (input.diagnostics ?? [])
      .map((value) => normalizeOptionalText(value, 500))
      .filter((value): value is string => Boolean(value))
      .map((value) => redactSensitiveText(value) ?? "")
      .filter(Boolean)
      .slice(0, 20),
    runAt
  };
}

function buildFailureFingerprint(input: WebsiteGrowthBacklinkFailureInput) {
  const signature = [
    input.errorReason,
    input.error,
    input.summary,
    ...(input.diagnostics ?? [])
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .replace(/[a-f0-9]{16,}/g, "<id>")
    .replace(/\d+/g, "<n>")
    .replace(/\s+/g, " ")
    .slice(0, 4_000);
  return crypto.createHash("sha256").update(signature).digest("hex");
}

function buildFailureStatement(input: WebsiteGrowthBacklinkFailureInput) {
  return [
    `Website Growth backlink run ${input.sourceRunId} failed.`,
    input.errorReason ? `Reason: ${input.errorReason}.` : null,
    input.error ?? input.summary ?? null,
    ...(input.diagnostics ?? [])
  ]
    .filter(Boolean)
    .join(" ")
    .slice(0, 4_000);
}

function buildFailureTeamsMessage({
  classification,
  disableExecutor,
  developmentJobId
}: {
  classification: WebsiteGrowthBacklinkFailureClassification;
  disableExecutor: boolean;
  developmentJobId: string | null;
}) {
  const action =
    (classification === "CODE_DEFECT" ||
      classification === "INVESTIGATION_REQUIRED") &&
    developmentJobId
      ? `Rivet queued development job ${developmentJobId} to prepare a draft PR.`
      : classification === "CODE_DEFECT" ||
          classification === "INVESTIGATION_REQUIRED"
        ? "The code defect was recorded, but the one-time Rivet auto-triage setting is not enabled."
        : classification === "AMBIGUOUS_EXTERNAL_ACTION"
          ? "Scout stopped without retrying because an email or other external action may already have occurred."
          : classification === "AUTHORIZATION_REQUIRED"
            ? "Owner action is required for authentication, mailbox scope, permissions, or configuration."
            : classification === "RUNTIME_TRANSIENT"
              ? "The transient runtime failure was recorded. No outreach was automatically retried."
              : "The failure was recorded for review before outreach can safely continue.";
  return [
    "Website Growth backlink run failed.",
    action,
    disableExecutor
      ? "Circuit breaker: the weekday executor was disabled after the same failure repeated. It must be reviewed before it is enabled again."
      : "The next scheduled run remains available; no uncertain send was retried.",
    "Nothing was merged or deployed."
  ].join("\n");
}

function readJsonString(value: Prisma.JsonValue | null, key: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const result = (value as Prisma.JsonObject)[key];
  return typeof result === "string" ? result : null;
}

function normalizeRequiredText(value: string, field: string, max: number) {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${field} is required.`);
  return normalized.slice(0, max);
}

function normalizeOptionalText(
  value: string | null | undefined,
  max: number
) {
  const normalized = value?.trim();
  return normalized ? normalized.slice(0, max) : null;
}

function redactSensitiveText(value: string | null) {
  if (!value) return null;
  return value
    .replace(
      /\b(?:authorization\s*:\s*)?bearer\s+[^\s,;]+/gi,
      "Authorization: Bearer [REDACTED]"
    )
    .replace(
      /\b(authorization|bearer|api[-_\s]?key|access[-_\s]?token|refresh[-_\s]?token|client[-_\s]?secret|password)\b(\s*[:=]\s*)([^\s,;]+)/gi,
      "$1$2[REDACTED]"
    )
    .replace(
      /([?&](?:code|token|access_token|refresh_token|client_secret)=)[^&\s]+/gi,
      "$1[REDACTED]"
    )
    .replace(
      /\b(?:sk_(?:live|test)|ory_ac|ghp|github_pat)_[A-Za-z0-9._-]+\b/g,
      "[REDACTED]"
    );
}
