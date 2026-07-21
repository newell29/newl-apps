import crypto from "node:crypto";

import { prisma } from "@/server/db";
import type { AuthenticatedContext } from "@/server/tenant-context";

const MAX_PROMPT_LENGTH = 4_000;
const MAX_RESPONSE_LENGTH = 4_000;
const MAX_ERROR_LENGTH = 1_000;
const MAX_LIST_LIMIT = 100;
const DEFAULT_STALE_AFTER_SECONDS = 300;

export const OPENCLAW_FAILURE_KINDS = [
  "MODEL_FAILURE",
  "TOOL_FAILURE",
  "DELIVERY_FAILURE",
  "NO_RESPONSE",
  "UNKNOWN"
] as const;

export type OpenClawFailureKind = typeof OPENCLAW_FAILURE_KINDS[number];

export type StartOpenClawTurnInput = {
  runId: string;
  prompt: string;
  channel?: string;
  externalMessageId?: string | null;
  externalConversationId?: string | null;
  sessionKey?: string | null;
};

export type FailOpenClawTurnInput = StartOpenClawTurnInput & {
  failureKind: OpenClawFailureKind;
  response?: string | null;
  provider?: string | null;
  model?: string | null;
  toolName?: string | null;
  toolCallId?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
};

export async function startOpenClawTurn(
  context: AuthenticatedContext,
  input: StartOpenClawTurnInput
) {
  const normalized = normalizeStartInput(input);
  return prisma.openClawUnresolvedTurn.upsert({
    where: {
      tenantId_runId: {
        tenantId: context.tenantId,
        runId: normalized.runId
      }
    },
    create: {
      tenantId: context.tenantId,
      userId: context.userId,
      runId: normalized.runId,
      channel: normalized.channel,
      status: "PENDING",
      promptText: normalized.prompt,
      promptFingerprint: fingerprintPrompt(normalized.prompt),
      externalMessageIdHash: hashOptional(normalized.externalMessageId),
      externalConversationIdHash: hashOptional(normalized.externalConversationId),
      sessionKeyHash: hashOptional(normalized.sessionKey)
    },
    update: {
      userId: context.userId,
      channel: normalized.channel,
      promptText: normalized.prompt,
      promptFingerprint: fingerprintPrompt(normalized.prompt),
      externalMessageIdHash: hashOptional(normalized.externalMessageId),
      externalConversationIdHash: hashOptional(normalized.externalConversationId),
      sessionKeyHash: hashOptional(normalized.sessionKey),
      lastObservedAt: new Date()
    },
    select: { id: true, status: true }
  });
}

export async function completeOpenClawTurn(context: AuthenticatedContext, runId: string) {
  const normalizedRunId = requireIdentifier(runId, "runId", 100);
  return prisma.openClawUnresolvedTurn.deleteMany({
    where: {
      tenantId: context.tenantId,
      userId: context.userId,
      runId: normalizedRunId,
      status: "PENDING"
    }
  });
}

export async function failOpenClawTurn(
  context: AuthenticatedContext,
  input: FailOpenClawTurnInput
) {
  const normalized = normalizeStartInput(input);
  const failureKind = requireFailureKind(input.failureKind);
  const now = new Date();
  return prisma.openClawUnresolvedTurn.upsert({
    where: {
      tenantId_runId: {
        tenantId: context.tenantId,
        runId: normalized.runId
      }
    },
    create: {
      tenantId: context.tenantId,
      userId: context.userId,
      runId: normalized.runId,
      channel: normalized.channel,
      status: "OPEN",
      failureKind,
      promptText: normalized.prompt,
      promptFingerprint: fingerprintPrompt(normalized.prompt),
      responseText: sanitizeOptionalText(input.response, MAX_RESPONSE_LENGTH),
      provider: sanitizeOptionalText(input.provider, 100),
      model: sanitizeOptionalText(input.model, 100),
      toolName: sanitizeOptionalText(input.toolName, 160),
      errorCode: sanitizeOptionalText(input.errorCode, 120),
      errorMessage: sanitizeOptionalText(input.errorMessage, MAX_ERROR_LENGTH),
      externalMessageIdHash: hashOptional(normalized.externalMessageId),
      externalConversationIdHash: hashOptional(normalized.externalConversationId),
      sessionKeyHash: hashOptional(normalized.sessionKey),
      toolCallIdHash: hashOptional(input.toolCallId),
      detectedAt: now,
      lastObservedAt: now
    },
    update: {
      userId: context.userId,
      channel: normalized.channel,
      status: "OPEN",
      failureKind,
      promptText: normalized.prompt,
      promptFingerprint: fingerprintPrompt(normalized.prompt),
      responseText: sanitizeOptionalText(input.response, MAX_RESPONSE_LENGTH),
      provider: sanitizeOptionalText(input.provider, 100),
      model: sanitizeOptionalText(input.model, 100),
      toolName: sanitizeOptionalText(input.toolName, 160),
      errorCode: sanitizeOptionalText(input.errorCode, 120),
      errorMessage: sanitizeOptionalText(input.errorMessage, MAX_ERROR_LENGTH),
      externalMessageIdHash: hashOptional(normalized.externalMessageId),
      externalConversationIdHash: hashOptional(normalized.externalConversationId),
      sessionKeyHash: hashOptional(normalized.sessionKey),
      toolCallIdHash: hashOptional(input.toolCallId),
      lastObservedAt: now
    },
    select: { id: true, status: true, failureKind: true }
  });
}

export async function listOpenClawUnresolvedTurns(
  context: AuthenticatedContext,
  options: { limit?: number; staleAfterSeconds?: number; now?: Date } = {}
) {
  const limit = Math.min(Math.max(Math.trunc(options.limit ?? 50), 1), MAX_LIST_LIMIT);
  const staleAfterSeconds = Math.min(
    Math.max(Math.trunc(options.staleAfterSeconds ?? DEFAULT_STALE_AFTER_SECONDS), 60),
    86_400
  );
  const now = options.now ?? new Date();
  const staleBefore = new Date(now.getTime() - staleAfterSeconds * 1_000);
  const rows = await prisma.openClawUnresolvedTurn.findMany({
    where: {
      tenantId: context.tenantId,
      OR: [
        { status: "OPEN" },
        { status: "PENDING", detectedAt: { lte: staleBefore } }
      ]
    },
    orderBy: [{ detectedAt: "desc" }],
    take: limit,
    select: {
      id: true,
      runId: true,
      status: true,
      failureKind: true,
      promptText: true,
      promptFingerprint: true,
      responseText: true,
      provider: true,
      model: true,
      toolName: true,
      errorCode: true,
      errorMessage: true,
      detectedAt: true,
      lastObservedAt: true,
      user: { select: { name: true, email: true } }
    }
  });

  return rows.map((row) => ({
    ...row,
    failureKind:
      row.status === "PENDING" && !row.failureKind
        ? "NO_RESPONSE"
        : row.failureKind ?? "UNKNOWN",
    stalePending: row.status === "PENDING"
  }));
}

function normalizeStartInput(input: StartOpenClawTurnInput) {
  return {
    runId: requireIdentifier(input.runId, "runId", 100),
    prompt: sanitizeRequiredText(input.prompt, MAX_PROMPT_LENGTH, "prompt"),
    channel: requireIdentifier(input.channel ?? "msteams", "channel", 40).toLowerCase(),
    externalMessageId: sanitizeOptionalText(input.externalMessageId, 300),
    externalConversationId: sanitizeOptionalText(input.externalConversationId, 300),
    sessionKey: sanitizeOptionalText(input.sessionKey, 500)
  };
}

function requireFailureKind(value: unknown): OpenClawFailureKind {
  if (typeof value !== "string" || !OPENCLAW_FAILURE_KINDS.includes(value as OpenClawFailureKind)) {
    throw new Error("failureKind is invalid.");
  }
  return value as OpenClawFailureKind;
}

function requireIdentifier(value: unknown, field: string, maxLength: number) {
  if (typeof value !== "string") throw new Error(`${field} is required.`);
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength || !/^[A-Za-z0-9._:/-]+$/.test(normalized)) {
    throw new Error(`${field} is invalid.`);
  }
  return normalized;
}

function sanitizeRequiredText(value: unknown, maxLength: number, field: string) {
  const normalized = sanitizeOptionalText(value, maxLength);
  if (!normalized) throw new Error(`${field} is required.`);
  return normalized;
}

export function sanitizeOpenClawIssueText(value: string, maxLength = MAX_PROMPT_LENGTH) {
  const normalized = value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    .replace(/\b(?:sk|ghp|github_pat|xox[baprs])[-_][A-Za-z0-9_-]{8,}\b/gi, "[REDACTED]")
    .replace(/\b(password|passwd|token|secret|api[ _-]?key)\b\s*[:=]\s*\S+/gi, "$1=[REDACTED]")
    .replace(/\s+/g, " ")
    .trim();
  return normalized.length <= maxLength
    ? normalized
    : `${normalized.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

function sanitizeOptionalText(value: unknown, maxLength: number) {
  if (typeof value !== "string") return null;
  return sanitizeOpenClawIssueText(value, maxLength) || null;
}

function fingerprintPrompt(prompt: string) {
  const normalized = prompt.toLowerCase().replace(/\s+/g, " ").trim();
  return crypto.createHash("sha256").update(normalized).digest("hex");
}

function hashOptional(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;
  return crypto.createHash("sha256").update(value.trim()).digest("hex");
}
