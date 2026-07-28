import {
  CandidateStatus,
  ContactStatus,
  HunterAutomationMode,
  HunterDecisionStatus,
  HunterServiceLine,
  HunterSignalStatus,
  JobStatus,
  Prisma,
  ReplyStatus,
  SequenceStatus
} from "@prisma/client";
import { prisma } from "@/server/db";
import { selectHunterPlanningCandidates } from "@/modules/lead-gen/hunter-planning-policy";

export const HUNTER_DRY_RUN_JOB_TYPE = "HUNTER_DAILY_PROSPECTING_PLAN";

export const DEFAULT_HUNTER_POLICY = {
  mode: HunterAutomationMode.DRY_RUN,
  killSwitch: false,
  dailyCompanyLimit: 30,
  maxContactsPerCompany: 2,
  warehousingPercent: 60,
  oceanAirPercent: 30,
  truckingPercent: 10,
  minimumPriorityScore: 35,
  minimumSignalConfidence: 50,
  scheduleTimezone: "America/Toronto"
};

type Candidate = {
  companyId: string | null;
  companyKey: string;
  companyName: string;
  serviceLine: HunterServiceLine;
  priorityScore: number;
  confidence: number;
  opportunityType: string;
  rationale: string;
  sourceTypes: string[];
  evidence: Prisma.InputJsonValue;
  recommendedPersona: string;
  recommendedCadence: string;
};

export async function runHunterDryPlan({
  tenantId,
  actorUserId,
  trigger = "MANUAL"
}: {
  tenantId: string;
  actorUserId: string | null;
  trigger?: "MANUAL" | "SCHEDULED" | "RESEARCH";
}) {
  const policy = await prisma.hunterAutomationPolicy.findUnique({ where: { tenantId } });
  const effective = policy ?? DEFAULT_HUNTER_POLICY;
  if (effective.killSwitch || effective.mode === HunterAutomationMode.OFF) {
    return { state: "disabled" as const, message: effective.killSwitch ? "Hunter kill switch is active." : "Hunter is off." };
  }

  const job = await prisma.automationJobRun.create({
    data: {
      tenantId,
      jobType: HUNTER_DRY_RUN_JOB_TYPE,
      status: JobStatus.RUNNING,
      input: {
        version: 1,
        trigger,
        mode: effective.mode,
        dailyCompanyLimit: effective.dailyCompanyLimit,
        allocation: {
          warehousing: effective.warehousingPercent,
          oceanAir: effective.oceanAirPercent,
          trucking: effective.truckingPercent
        }
      }
    }
  });

  try {
    const [companies, signals, suppressions] = await Promise.all([
      prisma.company.findMany({
        where: buildHunterPlanningCompanyWhere(tenantId),
        orderBy: [{ priorityScore: "desc" }, { updatedAt: "desc" }],
        take: Math.max(200, effective.dailyCompanyLimit * 10),
        select: {
          id: true,
          name: true,
          normalizedName: true,
          priorityScore: true,
          primaryIndustry: true,
          candidateStatus: true,
          importRecords: {
            orderBy: { arrivalDate: "desc" },
            take: 5,
            select: {
              arrivalDate: true,
              sourcePort: true,
              destinationCity: true,
              destinationState: true,
              originCountry: true,
              productDescription: true
            }
          },
        }
      }),
      prisma.hunterOpportunitySignal.findMany({
        where: {
          tenantId,
          status: { in: [HunterSignalStatus.NEW, HunterSignalStatus.ACTIVE] },
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }]
        },
        orderBy: [{ confidence: "desc" }, { observedAt: "desc" }],
        take: 500,
        include: {
          company: {
            select: {
              doNotProspect: true,
              candidateStatus: true,
              cashflowCustomers: { select: { id: true }, take: 1 },
              contacts: {
                select: {
                  contactStatus: true,
                  sequenceStatus: true,
                  replyStatus: true
                }
              }
            }
          }
        }
      }),
      prisma.hunterOutreachSuppression.findMany({
        where: {
          tenantId,
          active: true,
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }]
        },
        select: { scope: true, value: true, companyId: true }
      })
    ]);

    const suppressedCompanyIds = new Set(
      suppressions
        .map((row) => row.companyId)
        .filter((companyId): companyId is string => Boolean(companyId))
    );
    const suppressedValues = new Set(suppressions.map((row) => row.value.toLowerCase()));
    const signalsByKey = new Map<string, typeof signals>();
    for (const signal of signals) {
      const key = signal.normalizedCompanyName;
      signalsByKey.set(key, [...(signalsByKey.get(key) ?? []), signal]);
    }

    const candidates = new Map<string, Candidate>();
    for (const company of companies) {
      if (suppressedCompanyIds.has(company.id) || suppressedValues.has(company.normalizedName.toLowerCase())) continue;
      const matchedSignals = signalsByKey.get(company.normalizedName) ?? [];
      if (company.importRecords.length === 0 && matchedSignals.length === 0) continue;
      const strongest = [...matchedSignals].sort(
        (left, right) => hunterSignalPriority(right) - hunterSignalPriority(left)
      )[0];
      const serviceLine = strongest?.serviceLine ?? HunterServiceLine.WAREHOUSING;
      const confidence = strongest?.confidence ?? company.priorityScore;
      const strongestSignalScore = strongest ? hunterSignalPriority(strongest) : 0;
      const sourceTypes = [
        ...(company.importRecords.length > 0 ? ["TRADEMINING"] : []),
        ...matchedSignals.map((signal) => signal.signalType)
      ];
      const latestShipment = company.importRecords[0];
      candidates.set(company.normalizedName, {
        companyId: company.id,
        companyKey: company.normalizedName,
        companyName: company.name,
        serviceLine,
        priorityScore: Math.min(
          100,
          Math.max(company.priorityScore, strongestSignalScore) + (sourceTypes.length > 1 ? 5 : 0)
        ),
        confidence,
        opportunityType: strongest?.title ?? inferTradeMiningOpportunity(serviceLine),
        rationale: strongest?.summary ?? buildTradeMiningRationale(company.importRecords.length, latestShipment),
        sourceTypes: [...new Set(sourceTypes)],
        recommendedPersona: recommendPersona(serviceLine),
        recommendedCadence: recommendCadence(serviceLine),
        evidence: {
          primaryIndustry: company.primaryIndustry,
          candidateStatus: company.candidateStatus,
          latestShipment: latestShipment
            ? {
                ...latestShipment,
                arrivalDate: latestShipment.arrivalDate?.toISOString() ?? null
              }
            : null,
          externalSignals: matchedSignals.map((signal) => ({
            id: signal.id,
            type: signal.signalType,
            title: signal.title,
            sourceUrl: signal.sourceUrl,
            confidence: signal.confidence,
            observedAt: signal.observedAt.toISOString()
          }))
        }
      });
    }

    for (const signal of signals) {
      if (candidates.has(signal.normalizedCompanyName)) continue;
      if (
        signal.confidence < effective.minimumSignalConfidence ||
        suppressedValues.has(signal.normalizedCompanyName) ||
        (signal.companyId ? suppressedCompanyIds.has(signal.companyId) : false) ||
        isHunterCompanyBlocked(signal.company)
      ) {
        continue;
      }
      candidates.set(signal.normalizedCompanyName, {
        companyId: signal.companyId,
        companyKey: signal.normalizedCompanyName,
        companyName: signal.companyName,
        serviceLine: signal.serviceLine,
        priorityScore: hunterSignalPriority(signal),
        confidence: signal.confidence,
        opportunityType: signal.title,
        rationale: signal.summary,
        sourceTypes: [signal.signalType],
        recommendedPersona: recommendPersona(signal.serviceLine),
        recommendedCadence: recommendCadence(signal.serviceLine),
        evidence: {
          externalSignals: [{
            id: signal.id,
            type: signal.signalType,
            title: signal.title,
            sourceUrl: signal.sourceUrl,
            geography: signal.geography,
            confidence: signal.confidence,
            observedAt: signal.observedAt.toISOString()
          }]
        }
      });
    }

    const eligible = [...candidates.values()].filter((candidate) =>
      candidate.priorityScore >= effective.minimumPriorityScore &&
      (candidate.sourceTypes.includes("TRADEMINING") ||
        candidate.confidence >= effective.minimumSignalConfidence)
    );
    const selected = selectHunterPlanningCandidates(eligible, effective.dailyCompanyLimit, {
      [HunterServiceLine.WAREHOUSING]: effective.warehousingPercent,
      [HunterServiceLine.OCEAN_AIR]: effective.oceanAirPercent,
      [HunterServiceLine.TRUCKING]: effective.truckingPercent
    });
    const configSnapshot = {
      mode: effective.mode,
      dailyCompanyLimit: effective.dailyCompanyLimit,
      maxContactsPerCompany: effective.maxContactsPerCompany,
      allocation: {
        warehousing: effective.warehousingPercent,
        oceanAir: effective.oceanAirPercent,
        trucking: effective.truckingPercent
      },
      minimumPriorityScore: effective.minimumPriorityScore,
      minimumSignalConfidence: effective.minimumSignalConfidence
    };

    if (selected.length > 0) {
      await prisma.hunterProspectingDecision.createMany({
        data: selected.map((candidate, index) => ({
          tenantId,
          jobRunId: job.id,
          companyId: candidate.companyId,
          companyKey: candidate.companyKey,
          companyName: candidate.companyName,
          serviceLine: candidate.serviceLine,
          status: HunterDecisionStatus.WOULD_PURSUE,
          rank: index + 1,
          priorityScore: candidate.priorityScore,
          confidence: candidate.confidence,
          opportunityType: candidate.opportunityType,
          rationale: candidate.rationale,
          recommendedPersona: candidate.recommendedPersona,
          recommendedCadence: candidate.recommendedCadence,
          sourceTypes: candidate.sourceTypes,
          evidence: candidate.evidence,
          configSnapshot
        }))
      });
    }

    const counts = Object.fromEntries(Object.values(HunterServiceLine).map((line) => [
      line,
      selected.filter((candidate) => candidate.serviceLine === line).length
    ]));
    await prisma.automationJobRun.update({
      where: { id: job.id },
      data: {
        status: JobStatus.SUCCESS,
        finishedAt: new Date(),
        output: {
          phase: "DRY_RUN_COMPLETE",
          candidatePoolCount: eligible.length,
          selectedCount: selected.length,
          selectedByService: counts,
          externalSignalCount: signals.length,
          completedAt: new Date().toISOString()
        }
      }
    });
    await prisma.auditLog.create({
      data: {
        tenantId,
        actorUserId,
        action: "lead-gen.hunter-plan.completed",
        entityType: "AutomationJobRun",
        entityId: job.id,
        after: { selectedCount: selected.length, selectedByService: counts, trigger }
      }
    });
    return { state: "completed" as const, runId: job.id, selectedCount: selected.length, selectedByService: counts };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Hunter dry-run planning failed.";
    await prisma.automationJobRun.update({
      where: { id: job.id },
      data: { status: JobStatus.ERROR, finishedAt: new Date(), errorMessage: message }
    });
    throw error;
  }
}

export function buildHunterPlanningCompanyWhere(
  tenantId: string
): Prisma.CompanyWhereInput {
  return {
    tenantId,
    doNotProspect: false,
    candidateStatus: {
      notIn: [CandidateStatus.REJECTED, CandidateStatus.DISQUALIFIED]
    },
    cashflowCustomers: { none: {} },
    contacts: {
      none: {
        OR: [
          { contactStatus: ContactStatus.DO_NOT_CONTACT },
          { replyStatus: { not: ReplyStatus.NO_REPLY } },
          {
            sequenceStatus: {
              notIn: [SequenceStatus.NOT_STARTED, SequenceStatus.READY]
            }
          }
        ]
      }
    }
  };
}

function hunterSignalPriority(signal: { confidence: number; evidence: Prisma.JsonValue | null }) {
  const evidence = signal.evidence;
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) return signal.confidence;
  const research = (evidence as Prisma.JsonObject).research;
  if (!research || typeof research !== "object" || Array.isArray(research)) return signal.confidence;
  const finalScore = (research as Prisma.JsonObject).finalScore;
  return typeof finalScore === "number" && Number.isFinite(finalScore)
    ? Math.max(0, Math.min(100, Math.round(finalScore)))
    : signal.confidence;
}

export async function runDueHunterDryPlans(now = new Date()) {
  const policies = await prisma.hunterAutomationPolicy.findMany({
    where: {
      mode: { in: [HunterAutomationMode.DRY_RUN, HunterAutomationMode.ASSISTED] },
      killSwitch: false,
      tenant: {
        moduleAccess: {
          some: {
            enabled: true,
            module: { key: "LEAD_GEN" }
          }
        }
      }
    },
    select: {
      tenantId: true,
      scheduleTimezone: true
    }
  });
  const results: Array<{
    tenantId: string;
    state: "completed" | "skipped" | "failed";
    runId?: string;
    selectedCount?: number;
    error?: string;
  }> = [];

  for (const policy of policies) {
    const latest = await prisma.automationJobRun.findFirst({
      where: {
        tenantId: policy.tenantId,
        jobType: HUNTER_DRY_RUN_JOB_TYPE,
        status: JobStatus.SUCCESS
      },
      orderBy: { startedAt: "desc" },
      select: { startedAt: true }
    });
    if (
      latest &&
      formatCalendarDate(latest.startedAt, policy.scheduleTimezone) ===
        formatCalendarDate(now, policy.scheduleTimezone)
    ) {
      results.push({ tenantId: policy.tenantId, state: "skipped" });
      continue;
    }

    try {
      const result = await runHunterDryPlan({
        tenantId: policy.tenantId,
        actorUserId: null,
        trigger: "SCHEDULED"
      });
      if (result.state === "completed") {
        results.push({
          tenantId: policy.tenantId,
          state: "completed",
          runId: result.runId,
          selectedCount: result.selectedCount
        });
      } else {
        results.push({ tenantId: policy.tenantId, state: "skipped" });
      }
    } catch (error) {
      results.push({
        tenantId: policy.tenantId,
        state: "failed",
        error: error instanceof Error ? error.message : "Hunter planning failed."
      });
    }
  }

  return results;
}

function inferTradeMiningOpportunity(serviceLine: HunterServiceLine) {
  if (serviceLine === HunterServiceLine.OCEAN_AIR) return "Recurring international freight activity";
  if (serviceLine === HunterServiceLine.TRUCKING) return "Recurring inland transportation activity";
  return "Import activity may create warehousing or distribution demand";
}

export function isHunterCompanyBlocked(company: {
  doNotProspect: boolean;
  candidateStatus: CandidateStatus;
  cashflowCustomers: Array<{ id: string }>;
  contacts: Array<{
    contactStatus: ContactStatus;
    sequenceStatus: SequenceStatus;
    replyStatus: ReplyStatus;
  }>;
} | null) {
  if (!company) return false;
  if (
    company.doNotProspect ||
    company.candidateStatus === CandidateStatus.REJECTED ||
    company.candidateStatus === CandidateStatus.DISQUALIFIED ||
    company.cashflowCustomers.length > 0
  ) {
    return true;
  }
  return company.contacts.some((contact) =>
    contact.contactStatus === ContactStatus.DO_NOT_CONTACT ||
    contact.replyStatus !== ReplyStatus.NO_REPLY ||
    (contact.sequenceStatus !== SequenceStatus.NOT_STARTED &&
      contact.sequenceStatus !== SequenceStatus.READY)
  );
}

function buildTradeMiningRationale(count: number, latest: { destinationCity: string | null; destinationState: string | null; originCountry: string | null } | undefined) {
  const destination = [latest?.destinationCity, latest?.destinationState].filter(Boolean).join(", ");
  return `${count} recent shipment evidence record${count === 1 ? "" : "s"}${destination ? ` associated with ${destination}` : ""}${latest?.originCountry ? ` and origin ${latest.originCountry}` : ""}.`;
}

function recommendPersona(serviceLine: HunterServiceLine) {
  if (serviceLine === HunterServiceLine.OCEAN_AIR) return "VP/Director of Supply Chain, Logistics, Import or Procurement";
  if (serviceLine === HunterServiceLine.TRUCKING) return "Transportation, Logistics or Operations leader";
  return "VP/Director of Operations, Distribution, Warehousing or Supply Chain";
}

function recommendCadence(serviceLine: HunterServiceLine) {
  if (serviceLine === HunterServiceLine.OCEAN_AIR) return "Ocean / Air Freight Opportunity";
  if (serviceLine === HunterServiceLine.TRUCKING) return "Triggered Trucking Opportunity";
  return "Warehousing Opportunity";
}

function formatCalendarDate(date: Date, timeZone: string) {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).format(date);
  } catch {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).format(date);
  }
}
