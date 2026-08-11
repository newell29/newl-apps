import type { JobStatus } from "@prisma/client";

export type TradeMiningQualityCategory =
  | "CODE_DEFECT"
  | "AUTHORIZATION_REQUIRED"
  | "RUNTIME_TRANSIENT"
  | "DATA_OR_CONFIG";

export type TradeMiningQualityFinding = {
  key: string;
  category: TradeMiningQualityCategory;
  severity: "HIGH" | "MEDIUM";
  profileId: string | null;
  profileName: string;
  runId: string | null;
  summary: string;
  evidence: Record<string, string | number | boolean | null>;
};

export type TradeMiningRunStateSummary = {
  enabledProfiles: number;
  completed: number;
  active: number;
  failed: number;
  missing: number;
};

type Profile = {
  id: string;
  name: string;
  enabled: boolean;
  scheduleTimezone: string;
  updatedAt: Date;
};

type Run = {
  id: string;
  status: JobStatus;
  startedAt: Date;
  finishedAt: Date | null;
  input: unknown;
  output: unknown;
  errorMessage: string | null;
};

const STUCK_RUN_MS = 2 * 60 * 60 * 1000;

export function summarizeTradeMiningRunState({
  profiles,
  runs,
  now = new Date()
}: {
  profiles: Profile[];
  runs: Run[];
  now?: Date;
}): TradeMiningRunStateSummary {
  const summary: TradeMiningRunStateSummary = {
    enabledProfiles: 0,
    completed: 0,
    active: 0,
    failed: 0,
    missing: 0
  };
  for (const profile of profiles.filter((item) => item.enabled)) {
    summary.enabledProfiles += 1;
    const latest = runs
      .filter(
        (run) =>
          readString(run.input, "searchProfileId") === profile.id &&
          isSameLocalDate(run.startedAt, now, profile.scheduleTimezone)
      )
      .sort((left, right) => right.startedAt.getTime() - left.startedAt.getTime())[0];
    if (!latest) {
      summary.missing += 1;
    } else if (latest.status === "SUCCESS") {
      summary.completed += 1;
    } else if (latest.status === "RUNNING" || latest.status === "QUEUED") {
      summary.active += 1;
    } else {
      summary.failed += 1;
    }
  }
  return summary;
}

export function evaluateTradeMiningRunQuality({
  profiles,
  runs,
  now = new Date(),
  dueHour = 11
}: {
  profiles: Profile[];
  runs: Run[];
  now?: Date;
  dueHour?: number;
}) {
  const findings: TradeMiningQualityFinding[] = [];
  const profileMap = new Map(profiles.map((profile) => [profile.id, profile]));

  for (const run of runs) {
    const profileId = readString(run.input, "searchProfileId");
    if (!profileId || !isSameLocalDate(run.startedAt, now, profileMap.get(profileId)?.scheduleTimezone)) {
      continue;
    }
    const profile = profileMap.get(profileId);
    if (!profile) {
      findings.push({
        key: `REMOVED_PROFILE_RUN_REFERENCE:${profileId}`,
        category: "DATA_OR_CONFIG",
        severity: "MEDIUM",
        profileId,
        profileName: "Removed search profile",
        runId: run.id,
        summary:
          "A current-day TradeMining run references a profile that no longer exists; confirm whether the run started before the profile was removed.",
        evidence: {
          runStatus: run.status,
          startedAt: run.startedAt.toISOString(),
          profilePresent: false,
          profileEnabled: false
        }
      });
    } else if (!profile.enabled && run.startedAt.getTime() >= profile.updatedAt.getTime()) {
      findings.push({
        key: `DISABLED_PROFILE_RAN:${profileId}`,
        category: "CODE_DEFECT",
        severity: "HIGH",
        profileId,
        profileName: profile.name,
        runId: run.id,
        summary:
          "Hunter started a TradeMining ingestion run after the search profile was disabled.",
        evidence: {
          runStatus: run.status,
          startedAt: run.startedAt.toISOString(),
          profilePresent: true,
          profileEnabled: false,
          profileUpdatedAt: profile.updatedAt.toISOString()
        }
      });
    }
  }

  for (const profile of profiles.filter((item) => item.enabled)) {
    const localHour = getLocalHour(now, profile.scheduleTimezone);
    const profileRuns = runs
      .filter(
        (run) =>
          readString(run.input, "searchProfileId") === profile.id &&
          isSameLocalDate(run.startedAt, now, profile.scheduleTimezone)
      )
      .sort((left, right) => right.startedAt.getTime() - left.startedAt.getTime());

    if (profileRuns.length === 0) {
      if (localHour >= dueHour) {
        findings.push({
          key: `DAILY_RUN_MISSING:${profile.id}:${formatLocalDate(now, profile.scheduleTimezone)}`,
          category: "RUNTIME_TRANSIENT",
          severity: "HIGH",
          profileId: profile.id,
          profileName: profile.name,
          runId: null,
          summary: "The enabled TradeMining profile has no ingestion run for the current local day.",
          evidence: {
            localDate: formatLocalDate(now, profile.scheduleTimezone),
            scheduleTimezone: profile.scheduleTimezone,
            dueHour
          }
        });
      }
      continue;
    }

    const activeRuns = profileRuns.filter(
      (run) => run.status === "RUNNING" || run.status === "QUEUED"
    );
    if (activeRuns.length > 1) {
      findings.push({
        key: `OVERLAPPING_RUNS:${profile.id}`,
        category: "CODE_DEFECT",
        severity: "HIGH",
        profileId: profile.id,
        profileName: profile.name,
        runId: activeRuns[0]?.id ?? null,
        summary: "More than one TradeMining run is active for the same search profile.",
        evidence: {
          activeRunCount: activeRuns.length,
          newestRunStartedAt: activeRuns[0]?.startedAt.toISOString() ?? null
        }
      });
    }

    const latest = profileRuns[0];
    if (!latest) continue;
    if (
      (latest.status === "RUNNING" || latest.status === "QUEUED") &&
      now.getTime() - latest.startedAt.getTime() > STUCK_RUN_MS
    ) {
      findings.push({
        key: `STUCK_RUN:${profile.id}:${latest.id}`,
        category: "RUNTIME_TRANSIENT",
        severity: "HIGH",
        profileId: profile.id,
        profileName: profile.name,
        runId: latest.id,
        summary: "The latest TradeMining run has remained active for more than two hours.",
        evidence: {
          runStatus: latest.status,
          startedAt: latest.startedAt.toISOString(),
          ageMinutes: Math.floor((now.getTime() - latest.startedAt.getTime()) / 60_000)
        }
      });
    }
    if (latest.status === "ERROR" || latest.status === "CANCELLED") {
      findings.push({
        key: `RUN_FAILED:${profile.id}:${failureSignature(latest.errorMessage)}`,
        category: classifyRunFailure(latest.errorMessage),
        severity: "HIGH",
        profileId: profile.id,
        profileName: profile.name,
        runId: latest.id,
        summary: "The latest TradeMining run did not complete successfully.",
        evidence: {
          runStatus: latest.status,
          startedAt: latest.startedAt.toISOString(),
          finishedAt: latest.finishedAt?.toISOString() ?? null,
          error: redactSensitiveText(latest.errorMessage)
        }
      });
      continue;
    }

    if (latest.status !== "SUCCESS") continue;
    const coverage = readCoverage(latest.output);
    if (!coverage) {
      findings.push({
        key: `COVERAGE_MISSING:${profile.id}`,
        category: "CODE_DEFECT",
        severity: "HIGH",
        profileId: profile.id,
        profileName: profile.name,
        runId: latest.id,
        summary: "The successful TradeMining run did not save the required coverage metrics.",
        evidence: {
          runStatus: latest.status,
          startedAt: latest.startedAt.toISOString()
        }
      });
      continue;
    }
    if (coverage.retrievalComplete !== true) {
      findings.push({
        key: `RETRIEVAL_INCOMPLETE:${profile.id}`,
        category: "CODE_DEFECT",
        severity: "HIGH",
        profileId: profile.id,
        profileName: profile.name,
        runId: latest.id,
        summary:
          "TradeMining reported an incomplete retrieval after adaptive date/port splitting.",
        evidence: {
          matchedRecords: coverage.matchedRecords,
          exportedRecords: coverage.exportedRecords,
          queryCount: coverage.queryCount,
          retrievalComplete: coverage.retrievalComplete
        }
      });
    }
    if (
      coverage.exportedRecords !== null &&
      coverage.recordsProcessed !== null &&
      coverage.exportedRecords !== coverage.recordsProcessed
    ) {
      findings.push({
        key: `EXPORTED_INGESTED_MISMATCH:${profile.id}`,
        category: "CODE_DEFECT",
        severity: "HIGH",
        profileId: profile.id,
        profileName: profile.name,
        runId: latest.id,
        summary: "The exported TradeMining row count does not equal the ingested row count.",
        evidence: {
          exportedRecords: coverage.exportedRecords,
          recordsProcessed: coverage.recordsProcessed,
          recordsCreated: coverage.recordsCreated,
          recordsUpdated: coverage.recordsUpdated
        }
      });
    }

    const previousPositive = runs.some((run) => {
      if (
        run.id === latest.id ||
        run.status !== "SUCCESS" ||
        readString(run.input, "searchProfileId") !== profile.id
      ) {
        return false;
      }
      const priorCoverage = readCoverage(run.output);
      return (priorCoverage?.matchedRecords ?? 0) > 0;
    });
    if (coverage.matchedRecords === 0 && previousPositive) {
      findings.push({
        key: `ZERO_RESULT_ANOMALY:${profile.id}`,
        category: "DATA_OR_CONFIG",
        severity: "MEDIUM",
        profileId: profile.id,
        profileName: profile.name,
        runId: latest.id,
        summary:
          "The current TradeMining run returned zero matches although a recent run for this profile returned records.",
        evidence: {
          matchedRecords: 0,
          queryCount: coverage.queryCount,
          retrievalComplete: coverage.retrievalComplete,
          previousPositiveRun: true
        }
      });
    }
  }

  return dedupeFindings(findings);
}

function readCoverage(value: unknown) {
  const output = object(value);
  const metadata = object(output.metadata);
  const coverage = object(metadata.coverage);
  const matchedRecords = readNumber(coverage, "matchedRecords");
  const exportedRecords = readNumber(coverage, "exportedRecords");
  const queryCount = readNumber(coverage, "queryCount");
  const recordsProcessed = readNumber(output, "recordsProcessed");
  if (
    matchedRecords === null &&
    exportedRecords === null &&
    queryCount === null &&
    recordsProcessed === null &&
    typeof coverage.retrievalComplete !== "boolean"
  ) {
    return null;
  }
  return {
    matchedRecords,
    exportedRecords,
    queryCount,
    recordsProcessed,
    recordsCreated: readNumber(output, "recordsCreated"),
    recordsUpdated: readNumber(output, "recordsUpdated"),
    retrievalComplete:
      typeof coverage.retrievalComplete === "boolean"
        ? coverage.retrievalComplete
        : null
  };
}

function classifyRunFailure(error: string | null): TradeMiningQualityCategory {
  const value = (error ?? "").toLowerCase();
  if (
    /\b(?:unauthorized|forbidden|invalid token|invalid credential|authentication|password|permission)\b/.test(
      value
    )
  ) {
    return "AUTHORIZATION_REQUIRED";
  }
  if (
    /\b(?:syntaxerror|typeerror|referenceerror|cannot find module|schema validation|unsupported option|is not a function)\b/.test(
      value
    )
  ) {
    return "CODE_DEFECT";
  }
  return "RUNTIME_TRANSIENT";
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readString(value: unknown, key: string) {
  const field = object(value)[key];
  return typeof field === "string" && field.trim() ? field.trim() : null;
}

function readNumber(value: unknown, key: string) {
  const field = object(value)[key];
  if (typeof field === "number" && Number.isFinite(field)) return field;
  if (typeof field === "string" && field.trim()) {
    const parsed = Number(field);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function isSameLocalDate(left: Date, right: Date, timeZone = "America/Toronto") {
  return formatLocalDate(left, timeZone) === formatLocalDate(right, timeZone);
}

function formatLocalDate(value: Date, timeZone: string) {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).format(value);
  } catch {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Toronto",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).format(value);
  }
}

function getLocalHour(value: Date, timeZone: string) {
  try {
    return Number(
      new Intl.DateTimeFormat("en-US", {
        timeZone,
        hour: "2-digit",
        hourCycle: "h23"
      }).format(value)
    );
  } catch {
    return Number(
      new Intl.DateTimeFormat("en-US", {
        timeZone: "America/Toronto",
        hour: "2-digit",
        hourCycle: "h23"
      }).format(value)
    );
  }
}

function failureSignature(value: string | null) {
  return (value ?? "unknown")
    .toLowerCase()
    .replace(/\d+/g, "<n>")
    .replace(/[^a-z0-9<>]+/g, "-")
    .slice(0, 80);
}

function redactSensitiveText(value: string | null) {
  if (!value) return null;
  return value
    .replace(
      /\b(?:authorization\s*:\s*)?bearer\s+[^\s,;]+/gi,
      "Authorization: Bearer [REDACTED]"
    )
    .replace(
      /\b(api[-_\s]?key|access[-_\s]?token|refresh[-_\s]?token|client[-_\s]?secret|password)\b(\s*[:=]\s*)([^\s,;]+)/gi,
      "$1$2[REDACTED]"
    )
    .slice(0, 1_000);
}

function dedupeFindings(findings: TradeMiningQualityFinding[]) {
  return [
    ...new Map(
      findings.map((finding) => [`${finding.key}:${finding.runId ?? ""}`, finding])
    ).values()
  ];
}
