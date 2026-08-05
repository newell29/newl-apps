export type TeamshipWorkerFailureStage =
  | "WORKER_PREFLIGHT"
  | "TEAMSHIP_LOGIN"
  | "TEAMSHIP_API"
  | "BOL_CLEANUP"
  | "UNKNOWN";

export class TeamshipWorkerStageError extends Error {
  readonly failureStage: TeamshipWorkerFailureStage;

  constructor(stage: TeamshipWorkerFailureStage, cause: unknown) {
    super(readErrorMessage(cause));
    this.name = "TeamshipWorkerStageError";
    this.failureStage = inferFailureStage(this.message, stage);
    this.cause = cause;
  }
}

export function readTeamshipWorkerFailure(value: unknown): {
  message: string | null;
  stage: TeamshipWorkerFailureStage | null;
} {
  const payload = readRecord(value);
  const message = sanitizeWorkerErrorMessage(typeof payload?.error === "string" ? payload.error : null);
  const stage = normalizeFailureStage(payload?.failureStage) ?? (message ? inferFailureStage(message, "UNKNOWN") : null);

  return { message, stage };
}

export function readWorkerFailureStage(error: unknown, fallback: TeamshipWorkerFailureStage): TeamshipWorkerFailureStage {
  if (error instanceof TeamshipWorkerStageError) {
    return error.failureStage;
  }

  return inferFailureStage(readErrorMessage(error), fallback);
}

export function sanitizeWorkerErrorMessage(value: string | null | undefined) {
  if (!value?.trim()) {
    return null;
  }

  return value
    .trim()
    .replace(/(bearer\s+)[^\s,;]+/gi, "$1[redacted]")
    .replace(/((?:password|token|secret|api[_-]?key)\s*[=:]\s*)[^\s,;]+/gi, "$1[redacted]")
    .slice(0, 1_000);
}

function inferFailureStage(message: string, fallback: TeamshipWorkerFailureStage): TeamshipWorkerFailureStage {
  if (/teamship login|api token/i.test(message)) {
    return "TEAMSHIP_LOGIN";
  }

  if (/allowlist|live mode|teamship credentials|tenant settings/i.test(message)) {
    return "WORKER_PREFLIGHT";
  }

  return fallback;
}

function readErrorMessage(error: unknown) {
  return sanitizeWorkerErrorMessage(error instanceof Error ? error.message : String(error)) ?? "Unknown Teamship worker error.";
}

function normalizeFailureStage(value: unknown): TeamshipWorkerFailureStage | null {
  return ["WORKER_PREFLIGHT", "TEAMSHIP_LOGIN", "TEAMSHIP_API", "BOL_CLEANUP", "UNKNOWN"].includes(String(value))
    ? (value as TeamshipWorkerFailureStage)
    : null;
}

function readRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}
