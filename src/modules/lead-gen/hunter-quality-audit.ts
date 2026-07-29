import crypto from "node:crypto";

import { JobStatus, ModuleKey, Prisma } from "@prisma/client";

import { createRivetDevelopmentJob } from "@/modules/assistant/rivet-development-jobs";
import {
  evaluateTradeMiningRunQuality,
  summarizeTradeMiningRunState,
  type TradeMiningRunStateSummary,
  type TradeMiningQualityFinding
} from "@/modules/trademining/run-quality";
import { prisma } from "@/server/db";
import type { AuthenticatedContext } from "@/server/tenant-context";

export const HUNTER_QUALITY_AUDIT_JOB_TYPE = "HUNTER_QUALITY_AUDIT";
export const HUNTER_QUALITY_INCIDENT_JOB_TYPE = "HUNTER_QUALITY_INCIDENT";
export const HUNTER_QUALITY_WORKFLOW_KEY = "HUNTER_COMPANY_RESEARCH_QUALITY";
export const HUNTER_TRADEMINING_QUALITY_WORKFLOW_KEY =
  "HUNTER_TRADEMINING_PROFILE_QUALITY";
export const HUNTER_RIVET_APPROVAL_VALUE =
  "OWNER_APPROVED_HUNTER_QUALITY_TRIAGE";

const SYSTEM_ACTOR = "system:hunter-quality-auditor";
const SAMPLE_SIZE = 5;
const SAMPLE_LOOKBACK_MS = 14 * 24 * 60 * 60 * 1000;
const INCIDENT_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;
const INCIDENT_CIRCUIT_BREAKER_COUNT = 2;

export type HunterQualityFindingCategory =
  | "NO_ISSUE"
  | "MODEL_JUDGMENT"
  | "EVIDENCE_RETRIEVAL"
  | "EVIDENCE_HANDOFF"
  | "DETERMINISTIC_RULE"
  | "DATA_OR_CONFIG";

type OpportunityTier =
  | "HOT_OPPORTUNITY"
  | "QUALIFIED_CURRENT_ACCOUNT"
  | "WATCHLIST"
  | "BLOCKED"
  | "UNKNOWN";

export type HunterQualityAuditCompletion = {
  auditedAt: string;
  findings: Array<{
    signalId: string;
    category: HunterQualityFindingCategory;
    severity: "NONE" | "LOW" | "MEDIUM" | "HIGH";
    observedTier: OpportunityTier;
    recommendedTier: OpportunityTier;
    reproducible: boolean;
    summary: string;
    rationale: string;
    evidenceUrls: string[];
  }>;
};

type SampleSignal = {
  id: string;
  companyId: string | null;
  companyName: string;
  normalizedCompanyName: string;
  title: string;
  summary: string;
  serviceLine: string;
  signalType: string;
  confidence: number;
  sourceUrl: string | null;
  observedAt: Date;
  evidence: Prisma.JsonValue | null;
  company: {
    name: string;
    domain: string | null;
    primaryIndustry: string | null;
    priorityScore: number;
  } | null;
};

export async function prepareHunterQualityAudit(
  context: Pick<AuthenticatedContext, "tenantId">,
  now = new Date()
) {
  const localDate = formatLocalDate(now, "America/Toronto");
  const existing = await prisma.automationJobRun.findFirst({
    where: {
      tenantId: context.tenantId,
      jobType: HUNTER_QUALITY_AUDIT_JOB_TYPE,
      startedAt: { gte: new Date(now.getTime() - 36 * 60 * 60 * 1000) }
    },
    orderBy: { startedAt: "desc" },
    select: { id: true, status: true, input: true }
  });
  if (
    existing &&
    readJsonString(existing.input, "localDate") === localDate
  ) {
    return {
      state: existing.status === JobStatus.RUNNING ? ("already_running" as const) : ("already_attempted" as const),
      runId: existing.id
    };
  }

  const [signals, profiles, tradeRuns] = await Promise.all([
    prisma.hunterOpportunitySignal.findMany({
      where: {
        tenantId: context.tenantId,
        sourceName: "Hunter company research",
        observedAt: { gte: new Date(now.getTime() - SAMPLE_LOOKBACK_MS) }
      },
      orderBy: [{ updatedAt: "desc" }, { confidence: "desc" }],
      take: 250,
      select: {
        id: true,
        companyId: true,
        companyName: true,
        normalizedCompanyName: true,
        title: true,
        summary: true,
        serviceLine: true,
        signalType: true,
        confidence: true,
        sourceUrl: true,
        observedAt: true,
        evidence: true,
        company: {
          select: {
            name: true,
            domain: true,
            primaryIndustry: true,
            priorityScore: true
          }
        }
      }
    }),
    prisma.tradeMiningSearchProfile.findMany({
      where: { tenantId: context.tenantId },
      select: {
        id: true,
        name: true,
        enabled: true,
        scheduleTimezone: true,
        updatedAt: true
      }
    }),
    prisma.automationJobRun.findMany({
      where: {
        tenantId: context.tenantId,
        jobType: "trademining.ingestion",
        startedAt: { gte: new Date(now.getTime() - SAMPLE_LOOKBACK_MS) }
      },
      orderBy: { startedAt: "desc" },
      take: 1_000,
      select: {
        id: true,
        status: true,
        startedAt: true,
        finishedAt: true,
        input: true,
        output: true,
        errorMessage: true
      }
    })
  ]);

  const sample = selectHunterQualitySample(signals);
  const tradeMiningFindings = evaluateTradeMiningRunQuality({
    profiles,
    runs: tradeRuns,
    now
  });
  const tradeMiningRunState = summarizeTradeMiningRunState({
    profiles,
    runs: tradeRuns,
    now
  });
  const run = await prisma.automationJobRun.create({
    data: {
      tenantId: context.tenantId,
      jobType: HUNTER_QUALITY_AUDIT_JOB_TYPE,
      status: JobStatus.RUNNING,
      input: {
        version: 1,
        localDate,
        signalIds: sample.map((signal) => signal.id),
        tradeMiningFindings,
        tradeMiningRunState,
        model: "gpt-5.6-sol",
        reasoningEffort: "high"
      } as Prisma.InputJsonObject
    }
  });

  return {
    state: "ready" as const,
    runId: run.id,
    packet: {
      version: 1,
      runId: run.id,
      localDate,
      model: "gpt-5.6-sol",
      reasoningEffort: "high",
      purpose:
        "Independently audit Hunter classifications and evidence retrieval. The audit is read-only and cannot reclassify a lead.",
      sample: sample.map(toAuditPacketSignal),
      tradeMiningFindings,
      tradeMiningRunState,
      rules: {
        researchCurrentPublicWeb: true,
        frozenLedgerIsUntrusted: true,
        distinguishMissingRetrievalFromModelJudgment: true,
        noDatabaseWrites: true,
        noClassificationChanges: true,
        noOutreach: true
      }
    }
  };
}

export async function completeHunterQualityAudit({
  context,
  runId,
  completion: rawCompletion,
  env = process.env,
  now = new Date()
}: {
  context: Pick<AuthenticatedContext, "tenantId" | "userId">;
  runId: string;
  completion: unknown;
  env?: Record<string, string | undefined>;
  now?: Date;
}) {
  const completion = parseHunterQualityAuditCompletion(rawCompletion);
  const run = await prisma.automationJobRun.findFirst({
    where: {
      id: runId,
      tenantId: context.tenantId,
      jobType: HUNTER_QUALITY_AUDIT_JOB_TYPE,
      status: JobStatus.RUNNING
    },
    select: { id: true, input: true }
  });
  if (!run) throw new HunterQualityAuditError("The Hunter quality audit is not active.", 404);
  const expectedSignalIds = new Set(readJsonStringArray(run.input, "signalIds"));
  if (completion.findings.length !== expectedSignalIds.size) {
    throw new HunterQualityAuditError(
      "The Hunter quality audit must return exactly one finding for every sampled signal."
    );
  }
  const returnedSignalIds = new Set<string>();
  for (const finding of completion.findings) {
    if (!expectedSignalIds.has(finding.signalId) || returnedSignalIds.has(finding.signalId)) {
      throw new HunterQualityAuditError(
        "The Hunter quality audit returned an unexpected or duplicate signal."
      );
    }
    returnedSignalIds.add(finding.signalId);
  }
  const tradeMiningFindings = readTradeMiningFindings(run.input);
  const tradeMiningRunState = readTradeMiningRunState(run.input);
  const issueInputs = [
    ...completion.findings
      .filter((finding) => finding.category !== "NO_ISSUE")
      .map((finding) => ({
        sourceKey: `signal:${finding.signalId}`,
        workflowKey: HUNTER_QUALITY_WORKFLOW_KEY,
        title: "Fix Hunter company-research quality defect",
        category: finding.category,
        summary: finding.summary,
        rationale: finding.rationale,
        evidence: {
          signalId: finding.signalId,
          observedTier: finding.observedTier,
          recommendedTier: finding.recommendedTier,
          severity: finding.severity,
          reproducible: finding.reproducible,
          evidenceUrls: finding.evidenceUrls
        },
        autoRivet:
          finding.reproducible &&
          ["EVIDENCE_RETRIEVAL", "EVIDENCE_HANDOFF", "DETERMINISTIC_RULE"].includes(
            finding.category
          )
      })),
    ...tradeMiningFindings.map((finding) => ({
      sourceKey: `trademining:${finding.key}`,
      workflowKey: HUNTER_TRADEMINING_QUALITY_WORKFLOW_KEY,
      title: "Fix Hunter TradeMining profile-run quality defect",
      category: finding.category,
      summary: finding.summary,
      rationale:
        "The deterministic TradeMining run monitor detected a profile scheduling, retrieval, or count-reconciliation failure.",
      evidence: finding,
      autoRivet: finding.category === "CODE_DEFECT"
    }))
  ];

  const consolidatedIssues = consolidateHunterQualityIssues(issueInputs);
  const incidents: Array<
    Awaited<ReturnType<typeof recordHunterQualityIncident>>
  > = [];
  for (const issue of consolidatedIssues) {
    incidents.push(
      await recordHunterQualityIncident({
        tenantId: context.tenantId,
        issue,
        env,
        now
      })
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.automationJobRun.update({
      where: { id: run.id },
      data: {
        status: JobStatus.SUCCESS,
        finishedAt: now,
        output: {
          phase: "QUALITY_AUDIT_COMPLETE",
          auditedAt: completion.auditedAt,
          sampleSize: completion.findings.length,
          issueCount: issueInputs.length,
          consolidatedIssueCount: consolidatedIssues.length,
          tradeMiningIssueCount: tradeMiningFindings.length,
          findings: completion.findings,
          incidentIds: incidents.map((incident) => incident.incidentId),
          developmentJobIds: incidents
            .map((incident) => incident.developmentJobId)
            .filter(Boolean)
        } as Prisma.InputJsonObject
      }
    });
    await tx.auditLog.create({
      data: {
        tenantId: context.tenantId,
        actorUserId: context.userId,
        action: "lead-gen.hunter-quality-audit.completed",
        entityType: "AutomationJobRun",
        entityId: run.id,
        after: {
          sampleSize: completion.findings.length,
          issueCount: issueInputs.length,
          consolidatedIssueCount: consolidatedIssues.length,
          tradeMiningIssueCount: tradeMiningFindings.length,
          developmentJobIds: incidents
            .map((incident) => incident.developmentJobId)
            .filter(Boolean)
        }
      }
    });
  });

  return {
    state: "completed" as const,
    runId: run.id,
    issueCount: issueInputs.length,
    developmentJobIds: incidents
      .map((incident) => incident.developmentJobId)
      .filter((value): value is string => Boolean(value)),
    teamsMessage: buildHunterQualityTeamsMessage({
      sampleSize: completion.findings.length,
      findings: completion.findings,
      tradeMiningFindings,
      tradeMiningRunState,
      incidents
    })
  };
}

export async function failHunterQualityAudit({
  context,
  runId,
  errorMessage,
  now = new Date()
}: {
  context: Pick<AuthenticatedContext, "tenantId" | "userId">;
  runId: string;
  errorMessage: string;
  now?: Date;
}) {
  const sanitized = redactSensitiveText(errorMessage).slice(0, 1_000);
  const result = await prisma.automationJobRun.updateMany({
    where: {
      id: runId,
      tenantId: context.tenantId,
      jobType: HUNTER_QUALITY_AUDIT_JOB_TYPE,
      status: JobStatus.RUNNING
    },
    data: {
      status: JobStatus.ERROR,
      finishedAt: now,
      errorMessage: sanitized
    }
  });
  if (result.count !== 1) {
    throw new HunterQualityAuditError("The Hunter quality audit is not active.", 404);
  }
  return {
    state: "failed" as const,
    runId,
    teamsMessage:
      "Hunter quality control could not complete its independent sample or TradeMining check. No classifications were changed and no Rivet job was queued. Review the protected Rivet worker log. Nothing was merged or deployed."
  };
}

export function selectHunterQualitySample<T extends { id: string; evidence: Prisma.JsonValue | null }>(
  signals: T[]
) {
  const selected: T[] = [];
  const selectedIds = new Set<string>();
  for (const tier of [
    "HOT_OPPORTUNITY",
    "QUALIFIED_CURRENT_ACCOUNT",
    "WATCHLIST",
    "BLOCKED"
  ]) {
    const match = signals.find(
      (signal) =>
        !selectedIds.has(signal.id) && readOpportunityTier(signal.evidence) === tier
    );
    if (match) {
      selected.push(match);
      selectedIds.add(match.id);
    }
  }
  for (const signal of signals) {
    if (selected.length >= SAMPLE_SIZE) break;
    if (!selectedIds.has(signal.id)) {
      selected.push(signal);
      selectedIds.add(signal.id);
    }
  }
  return selected;
}

export function parseHunterQualityAuditCompletion(
  value: unknown
): HunterQualityAuditCompletion {
  const root = object(value, "completion");
  const findings = array(root.findings, "completion.findings");
  if (findings.length > SAMPLE_SIZE) {
    throw new HunterQualityAuditError(`completion.findings cannot exceed ${SAMPLE_SIZE} items.`);
  }
  return {
    auditedAt: isoDate(root.auditedAt, "completion.auditedAt"),
    findings: findings.map((item, index) => {
      const finding = object(item, `completion.findings[${index}]`);
      return {
        signalId: text(finding.signalId, 100, `completion.findings[${index}].signalId`),
        category: enumValue(
          finding.category,
          [
            "NO_ISSUE",
            "MODEL_JUDGMENT",
            "EVIDENCE_RETRIEVAL",
            "EVIDENCE_HANDOFF",
            "DETERMINISTIC_RULE",
            "DATA_OR_CONFIG"
          ] as const,
          `completion.findings[${index}].category`
        ),
        severity: enumValue(
          finding.severity,
          ["NONE", "LOW", "MEDIUM", "HIGH"] as const,
          `completion.findings[${index}].severity`
        ),
        observedTier: enumValue(
          finding.observedTier,
          [
            "HOT_OPPORTUNITY",
            "QUALIFIED_CURRENT_ACCOUNT",
            "WATCHLIST",
            "BLOCKED",
            "UNKNOWN"
          ] as const,
          `completion.findings[${index}].observedTier`
        ),
        recommendedTier: enumValue(
          finding.recommendedTier,
          [
            "HOT_OPPORTUNITY",
            "QUALIFIED_CURRENT_ACCOUNT",
            "WATCHLIST",
            "BLOCKED",
            "UNKNOWN"
          ] as const,
          `completion.findings[${index}].recommendedTier`
        ),
        reproducible: boolean(
          finding.reproducible,
          `completion.findings[${index}].reproducible`
        ),
        summary: text(finding.summary, 1_000, `completion.findings[${index}].summary`),
        rationale: text(
          finding.rationale,
          2_000,
          `completion.findings[${index}].rationale`
        ),
        evidenceUrls: stringArray(
          finding.evidenceUrls,
          10,
          1_000,
          `completion.findings[${index}].evidenceUrls`
        )
      };
    })
  };
}

async function recordHunterQualityIncident({
  tenantId,
  issue,
  env,
  now
}: {
  tenantId: string;
  issue: {
    sourceKey: string;
    workflowKey: string;
    title: string;
    category: string;
    summary: string;
    rationale: string;
    evidence: unknown;
    autoRivet: boolean;
    scopeKey: string;
  };
  env: Record<string, string | undefined>;
  now: Date;
}) {
  const fingerprint = crypto
    .createHash("sha256")
    .update(
      issue.autoRivet
        ? issue.scopeKey
        : `${issue.workflowKey}|${issue.category}|${normalizeFingerprintText(issue.summary)}`
    )
    .digest("hex");
  const recent = await prisma.automationJobRun.findMany({
    where: {
      tenantId,
      jobType: HUNTER_QUALITY_INCIDENT_JOB_TYPE,
      createdAt: { gte: new Date(now.getTime() - INCIDENT_LOOKBACK_MS) },
      OR: [
        { input: { path: ["fingerprint"], equals: fingerprint } },
        { input: { path: ["scopeKey"], equals: issue.scopeKey } }
      ]
    },
    select: { id: true, output: true },
    take: INCIDENT_CIRCUIT_BREAKER_COUNT
  });
  const existingDevelopmentJobId =
    recent
      .map((incident) => readJsonString(incident.output, "developmentJobId"))
      .find((value): value is string => Boolean(value)) ?? null;
  const circuitBreaker =
    recent.length + 1 >= INCIDENT_CIRCUIT_BREAKER_COUNT;
  const approved =
    env.HUNTER_RIVET_AUTO_TRIAGE_APPROVAL?.trim() ===
    HUNTER_RIVET_APPROVAL_VALUE;

  return prisma.$transaction(async (tx) => {
    const incident = await tx.automationJobRun.create({
      data: {
        tenantId,
        jobType: HUNTER_QUALITY_INCIDENT_JOB_TYPE,
        status: JobStatus.ERROR,
        startedAt: now,
        finishedAt: now,
        input: {
          version: 1,
          sourceKey: issue.sourceKey,
          workflowKey: issue.workflowKey,
          scopeKey: issue.scopeKey,
          fingerprint
        },
        output: {
          phase: "RECORDED",
          category: issue.category,
          circuitBreaker,
          autoTriageApproved: approved
        },
        errorMessage: redactSensitiveText(issue.summary).slice(0, 1_000)
      }
    });
    let developmentJobId = existingDevelopmentJobId;
    let developmentJobQueued = false;
    if (issue.autoRivet && approved && !existingDevelopmentJobId && !circuitBreaker) {
      const feedback = await tx.operationalFeedback.create({
        data: {
          tenantId,
          moduleKey: ModuleKey.LEAD_GEN,
          workflowKey: issue.workflowKey,
          subjectType: "HUNTER_QUALITY_AUDIT",
          subjectId: issue.sourceKey,
          reporterUserId: SYSTEM_ACTOR,
          reporterStatement: redactSensitiveText(issue.summary).slice(0, 4_000),
          expectedOutcome:
            "Hunter preserves relevant evidence, applies deterministic gates correctly, and completes every enabled TradeMining profile exactly once per day.",
          observedOutcome: redactSensitiveText(issue.rationale).slice(0, 4_000),
          classification: issue.category,
          status: "CONFIRMED",
          evidence: sanitizeJson(issue.evidence)
        }
      });
      const suggestion = await tx.developmentSuggestion.create({
        data: {
          tenantId,
          moduleKey: ModuleKey.LEAD_GEN,
          workflowKey: issue.workflowKey,
          title: issue.title,
          summary: redactSensitiveText(issue.summary).slice(0, 4_000),
          rationale:
            "The owner-approved Hunter quality policy allows Rivet to diagnose a reproducible defect and prepare a reviewed draft PR. Rivet cannot reclassify leads, rerun outreach, merge, deploy, or change production data.",
          status: "APPROVED",
          riskLevel: "MEDIUM",
          sourceFeedbackIds: [feedback.id],
          feedbackCount: 1,
          proposedScope: {
            issueKey: `HUNTER_QUALITY_${fingerprint.slice(0, 16).toUpperCase()}`,
            approvalPolicy: HUNTER_RIVET_APPROVAL_VALUE,
            requiresHumanMerge: true,
            frozenEvidenceRequired: true,
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
              "RECLASSIFY_LEAD",
              "RETRY_TRADEMINING",
              "RETRY_OUTREACH",
              "MERGE",
              "DEPLOY",
              "PRODUCTION_DATABASE_WRITE",
              "PERMISSION_CHANGE",
              "CUSTOMER_COMMUNICATION"
            ]
          },
          decisionAt: now,
          decisionNotes:
            "Automatically approved under the owner-enabled Hunter quality Rivet policy."
        }
      });
      const developmentJob = await createRivetDevelopmentJob(
        tx,
        { tenantId, userId: SYSTEM_ACTOR },
        suggestion,
        [
          {
            id: feedback.id,
            moduleKey: ModuleKey.LEAD_GEN,
            workflowKey: issue.workflowKey,
            classification: issue.category,
            subjectType: "HUNTER_QUALITY_AUDIT",
            subjectId: issue.sourceKey,
            reporterStatement: issue.summary,
            expectedOutcome:
              "Hunter preserves relevant evidence and applies deterministic rules correctly.",
            observedOutcome: issue.rationale
          }
        ]
      );
      developmentJobId = developmentJob.id;
      developmentJobQueued = true;
      await tx.developmentSuggestion.update({
        where: { tenantId_id: { tenantId, id: suggestion.id } },
        data: { developmentThreadId: developmentJobId }
      });
    }
    await tx.automationJobRun.update({
      where: { id: incident.id },
      data: {
        output: {
          phase: developmentJobId
            ? developmentJobQueued
              ? "RIVET_QUEUED"
              : "RIVET_ALREADY_QUEUED"
            : "RECORDED",
          category: issue.category,
          circuitBreaker,
          autoTriageApproved: approved,
          developmentJobId
        }
      }
    });
    await tx.auditLog.create({
      data: {
        tenantId,
        actorUserId: null,
        action: "lead-gen.hunter-quality-incident.recorded",
        entityType: "AutomationJobRun",
        entityId: incident.id,
        after: {
          sourceKey: issue.sourceKey,
          scopeKey: issue.scopeKey,
          category: issue.category,
          fingerprint,
          circuitBreaker,
          developmentJobId
        }
      }
    });
    return {
      incidentId: incident.id,
      developmentJobId,
      developmentJobQueued,
      circuitBreaker,
      autoTriageApproved: approved
    };
  });
}

function consolidateHunterQualityIssues<T extends {
  sourceKey: string;
  workflowKey: string;
  title: string;
  category: string;
  summary: string;
  rationale: string;
  evidence: unknown;
  autoRivet: boolean;
}>(issues: T[]) {
  const groups = new Map<string, T[]>();
  for (const issue of issues) {
    const scopeKey = `${issue.workflowKey}:${
      issue.autoRivet ? "REPRODUCIBLE_CODE_DEFECT" : issue.sourceKey
    }`;
    const group = groups.get(scopeKey) ?? [];
    group.push(issue);
    groups.set(scopeKey, group);
  }
  return [...groups.entries()].map(([scopeKey, group]) => {
    const first = group[0]!;
    if (group.length === 1) return { ...first, scopeKey };
    const categories = [...new Set(group.map((item) => item.category))];
    return {
      ...first,
      sourceKey: group.map((item) => item.sourceKey).join(","),
      category: categories.length === 1 ? categories[0]! : "MULTIPLE_CODE_DEFECTS",
      summary: `${group.length} related ${first.workflowKey.toLowerCase().replaceAll("_", " ")} defects were found and must be corrected together: ${group
        .map((item) => item.summary)
        .join(" | ")}`,
      rationale: group.map((item) => item.rationale).join(" | "),
      evidence: {
        groupedDefects: group.map((item) => ({
          sourceKey: item.sourceKey,
          category: item.category,
          evidence: item.evidence
        }))
      },
      autoRivet: group.every((item) => item.autoRivet),
      scopeKey
    };
  });
}

function toAuditPacketSignal(signal: SampleSignal) {
  return {
    signalId: signal.id,
    companyId: signal.companyId,
    companyName: signal.companyName,
    normalizedCompanyName: signal.normalizedCompanyName,
    domain: signal.company?.domain ?? null,
    industry: signal.company?.primaryIndustry ?? null,
    priorityScore: signal.company?.priorityScore ?? null,
    serviceLine: signal.serviceLine,
    signalType: signal.signalType,
    signalTitle: signal.title,
    signalSummary: signal.summary,
    signalConfidence: signal.confidence,
    sourceUrl: signal.sourceUrl,
    observedAt: signal.observedAt.toISOString(),
    observedTier: readOpportunityTier(signal.evidence),
    frozenResearchLedger: signal.evidence
  };
}

function buildHunterQualityTeamsMessage({
  sampleSize,
  findings,
  tradeMiningFindings,
  tradeMiningRunState,
  incidents
}: {
  sampleSize: number;
  findings: HunterQualityAuditCompletion["findings"];
  tradeMiningFindings: TradeMiningQualityFinding[];
  tradeMiningRunState: TradeMiningRunStateSummary;
  incidents: Array<{
    developmentJobId: string | null;
    developmentJobQueued: boolean;
    circuitBreaker: boolean;
    autoTriageApproved: boolean;
  }>;
}) {
  const leadIssues = findings.filter((finding) => finding.category !== "NO_ISSUE");
  const queuedDevelopmentJobIds = incidents
    .filter((incident) => incident.developmentJobQueued)
    .map((incident) => incident.developmentJobId)
    .filter((value): value is string => Boolean(value));
  const manualReviewCount =
    leadIssues.filter((finding) =>
      ["MODEL_JUDGMENT", "DATA_OR_CONFIG"].includes(finding.category)
    ).length +
    tradeMiningFindings.filter((finding) => finding.category !== "CODE_DEFECT").length;
  return [
    `Hunter quality control audited ${sampleSize} company classifications. TradeMining status at audit time: ${tradeMiningRunState.completed}/${tradeMiningRunState.enabledProfiles} completed, ${tradeMiningRunState.active} active, ${tradeMiningRunState.failed} failed, ${tradeMiningRunState.missing} missing; ${tradeMiningFindings.length === 0 ? "no run defects were detected" : `${tradeMiningFindings.length} run issue(s) were detected`}.`,
    leadIssues.length === 0
      ? "The independent company sample found no classification or evidence defect."
      : `The independent company sample found ${leadIssues.length} issue(s): ${summarizeCategories(leadIssues.map((finding) => finding.category))}.`,
    queuedDevelopmentJobIds.length > 0
      ? `Rivet queued ${queuedDevelopmentJobIds.length} restricted development job(s): ${queuedDevelopmentJobIds.join(", ")}. Each can only prepare a draft PR.`
      : manualReviewCount > 0
        ? `${manualReviewCount} item(s) require human judgment, configuration, credentials, or runtime review; Rivet was not allowed to change them automatically.`
        : incidents.some((incident) => !incident.autoTriageApproved)
          ? "A reproducible defect was recorded, but the Hunter Rivet standing-approval value is not enabled."
          : "No new Rivet development job was needed.",
    incidents.some((incident) => incident.circuitBreaker)
      ? "Circuit breaker: a repeated defect was not queued again; the existing Rivet job or owner review must resolve it."
      : "No repeated-defect circuit breaker was triggered.",
    "No lead was reclassified, no search or outreach was retried, and nothing was merged or deployed."
  ].join("\n");
}

function summarizeCategories(categories: string[]) {
  const counts = new Map<string, number>();
  for (const category of categories) {
    counts.set(category, (counts.get(category) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([category, count]) => `${category.toLowerCase().replaceAll("_", " ")} ${count}`)
    .join(", ");
}

function readOpportunityTier(value: Prisma.JsonValue | null): OpportunityTier {
  const research = objectOrEmpty(objectOrEmpty(value).research);
  const tier = research.opportunityTier;
  return [
    "HOT_OPPORTUNITY",
    "QUALIFIED_CURRENT_ACCOUNT",
    "WATCHLIST",
    "BLOCKED"
  ].includes(String(tier))
    ? (tier as OpportunityTier)
    : "UNKNOWN";
}

function readTradeMiningFindings(value: Prisma.JsonValue | null) {
  const raw = objectOrEmpty(value).tradeMiningFindings;
  if (!Array.isArray(raw)) return [];
  return raw.filter(isTradeMiningFinding).slice(0, 100);
}

function readTradeMiningRunState(value: Prisma.JsonValue | null): TradeMiningRunStateSummary {
  const raw = objectOrEmpty(objectOrEmpty(value).tradeMiningRunState);
  return {
    enabledProfiles: readSafeCount(raw.enabledProfiles),
    completed: readSafeCount(raw.completed),
    active: readSafeCount(raw.active),
    failed: readSafeCount(raw.failed),
    missing: readSafeCount(raw.missing)
  };
}

function readSafeCount(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : 0;
}

function isTradeMiningFinding(value: unknown): value is TradeMiningQualityFinding {
  const item = objectOrEmpty(value);
  return (
    typeof item.key === "string" &&
    typeof item.category === "string" &&
    typeof item.severity === "string" &&
    typeof item.profileName === "string" &&
    typeof item.summary === "string"
  );
}

function readJsonString(value: Prisma.JsonValue | null, key: string) {
  const field = objectOrEmpty(value)[key];
  return typeof field === "string" ? field : null;
}

function readJsonStringArray(value: Prisma.JsonValue | null, key: string) {
  const field = objectOrEmpty(value)[key];
  return Array.isArray(field)
    ? field.filter((item): item is string => typeof item === "string")
    : [];
}

function normalizeFingerprintText(value: string) {
  return value
    .toLowerCase()
    .replace(/[a-f0-9]{16,}/g, "<id>")
    .replace(/\d+/g, "<n>")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 2_000);
}

function sanitizeJson(value: unknown): Prisma.InputJsonValue {
  return {
    redactedSnapshot: redactSensitiveText(JSON.stringify(value)).slice(0, 20_000)
  };
}

function redactSensitiveText(value: string) {
  return value
    .replace(
      /\b(?:authorization\s*:\s*)?bearer\s+[^\s,;]+/gi,
      "Authorization: Bearer [REDACTED]"
    )
    .replace(
      /\b(authorization|bearer|api[-_\s]?key|access[-_\s]?token|refresh[-_\s]?token|client[-_\s]?secret|password)\b(\s*[:=]\s*)([^\s,;]+)/gi,
      "$1$2[REDACTED]"
    );
}

function formatLocalDate(value: Date, timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(value);
}

function object(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HunterQualityAuditError(`${path} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function objectOrEmpty(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function array(value: unknown, path: string) {
  if (!Array.isArray(value)) {
    throw new HunterQualityAuditError(`${path} must be an array.`);
  }
  return value;
}

function text(value: unknown, max: number, path: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new HunterQualityAuditError(`${path} must be a non-empty string.`);
  }
  return redactSensitiveText(value.trim()).slice(0, max);
}

function boolean(value: unknown, path: string) {
  if (typeof value !== "boolean") {
    throw new HunterQualityAuditError(`${path} must be a boolean.`);
  }
  return value;
}

function enumValue<const T extends readonly string[]>(
  value: unknown,
  values: T,
  path: string
): T[number] {
  if (typeof value !== "string" || !values.includes(value)) {
    throw new HunterQualityAuditError(`${path} is invalid.`);
  }
  return value as T[number];
}

function isoDate(value: unknown, path: string) {
  const normalized = text(value, 100, path);
  if (Number.isNaN(Date.parse(normalized))) {
    throw new HunterQualityAuditError(`${path} must be an ISO date.`);
  }
  return normalized;
}

function stringArray(
  value: unknown,
  limit: number,
  max: number,
  path: string
) {
  const values = array(value, path);
  if (values.length > limit) {
    throw new HunterQualityAuditError(`${path} cannot exceed ${limit} items.`);
  }
  return values.map((item, index) => {
    const result = text(item, max, `${path}[${index}]`);
    let url: URL;
    try {
      url = new URL(result);
    } catch {
      throw new HunterQualityAuditError(`${path}[${index}] must be an HTTPS URL.`);
    }
    if (url.protocol !== "https:") {
      throw new HunterQualityAuditError(`${path}[${index}] must be an HTTPS URL.`);
    }
    return url.toString();
  });
}

export class HunterQualityAuditError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "HunterQualityAuditError";
    this.status = status;
  }
}
