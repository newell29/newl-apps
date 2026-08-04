import { createHash } from "node:crypto";

import {
  ApolloCompanyMatchClassification,
  CandidateStatus,
  HunterAutomationMode,
  JobStatus,
  Prisma,
  SequenceStatus
} from "@prisma/client";

import {
  evaluateHunterOutreachEligibility,
  getHunterOutreachResearchMaxAgeDays
} from "@/modules/lead-gen/hunter-outreach-eligibility";
import { normalizeHunterCompanyDomain } from "@/modules/lead-gen/hunter-company-identity";
import { enqueueHunterCompanyOutreachHandoff } from "@/modules/lead-gen/hunter-outreach-handoff";
import { HUNTER_APOLLO_EXCEPTION_RESOLUTION_JOB_TYPE } from "@/modules/lead-gen/hunter-job-types";
import {
  isMappedApolloZeroEmployeeState,
  requiresApolloMatchReview
} from "@/modules/lead-gen/apollo-contact-discovery-review";
import { prisma } from "@/server/db";
import {
  resolveApolloOrganizationForCompany,
  type ApolloOrganizationCandidate
} from "@/server/integrations/apollo";
import {
  APOLLO_IDENTITY_RESOLUTION_MODEL,
  APOLLO_IDENTITY_RESOLUTION_PROMPT_VERSION,
  generateApolloIdentityResolution,
  type ApolloIdentityPublicEvidence,
  type ApolloIdentityResolutionPacket,
  type ApolloIdentityResolutionSynthesis
} from "@/server/integrations/openai-apollo-identity";

export { HUNTER_APOLLO_EXCEPTION_RESOLUTION_JOB_TYPE } from "@/modules/lead-gen/hunter-job-types";

const AUTOPILOT_RESOLVER_VERSION = 3;
const PROCESSING_LEASE_MS = 15 * 60 * 1_000;
const DEFAULT_DAILY_COMPANY_LIMIT = 10;
const MAX_DAILY_COMPANY_LIMIT = 25;
const MAX_PUBLIC_QUERIES = 5;
const MAX_PUBLIC_EVIDENCE = 20;
const MIN_AUTO_RESOLVE_CONFIDENCE = 90;
const SHARED_PUBLIC_DOMAINS = new Set([
  "apollo.io",
  "bloomberg.com",
  "facebook.com",
  "glassdoor.com",
  "indeed.com",
  "linkedin.com",
  "pitchbook.com",
  "zoominfo.com"
]);

type AutopilotInput = {
  version: number;
  companyId: string;
  sourceMatchId: string;
  researchSignalId: string;
  identityFingerprint: string;
  maximumApolloOrganizationSearches: number;
};

export type ApolloExceptionAutopilotStatus = {
  enabled: boolean;
  dailyCompanyLimit: number;
  processedLast24Hours: number;
  autoResolvedLast24Hours: number;
  stillAmbiguousLast24Hours: number;
  failedLast24Hours: number;
  queued: number;
  running: number;
};

export async function prepareNextApolloExceptionResolution({
  tenantId,
  now = new Date()
}: {
  tenantId: string;
  now?: Date;
}) {
  const enabled = isApolloExceptionAutopilotEnabled();
  if (!enabled) {
    return {
      state: "disabled" as const,
      message: "Apollo exception autopilot is disabled."
    };
  }
  const policy = await prisma.hunterAutomationPolicy.findUnique({
    where: { tenantId },
    select: { mode: true, killSwitch: true }
  });
  if (!policy || policy.killSwitch || policy.mode !== HunterAutomationMode.ASSISTED) {
    return {
      state: "disabled" as const,
      message: "Hunter Assisted mode is required for Apollo exception autopilot."
    };
  }

  await releaseExpiredResolutionLease({ tenantId, now });
  const running = await prisma.automationJobRun.findFirst({
    where: {
      tenantId,
      jobType: HUNTER_APOLLO_EXCEPTION_RESOLUTION_JOB_TYPE,
      status: JobStatus.RUNNING,
      startedAt: { gte: new Date(now.getTime() - PROCESSING_LEASE_MS) }
    },
    orderBy: { startedAt: "asc" },
    select: { id: true }
  });
  if (running) {
    return { state: "already_processing" as const, runId: running.id };
  }

  let job = await prisma.automationJobRun.findFirst({
    where: {
      tenantId,
      jobType: HUNTER_APOLLO_EXCEPTION_RESOLUTION_JOB_TYPE,
      status: JobStatus.QUEUED
    },
    orderBy: { startedAt: "asc" }
  });
  if (!job) {
    job = await enqueueNextEligibleException({ tenantId, now });
  }
  if (!job) {
    return {
      state: "idle" as const,
      message: "No new or materially changed Apollo exception requires identity resolution."
    };
  }

  const input = parseAutopilotInput(job.input);
  const packet = await loadResolutionPacket({ tenantId, input });
  const claimed = await prisma.automationJobRun.updateMany({
    where: {
      id: job.id,
      tenantId,
      status: JobStatus.QUEUED
    },
    data: {
      status: JobStatus.RUNNING,
      startedAt: now,
      output: {
        state: "RESEARCHING_PUBLIC_IDENTITY",
        preparedAt: now.toISOString()
      }
    }
  });
  if (claimed.count !== 1) {
    return { state: "already_processing" as const, runId: job.id };
  }
  return {
    state: "prepared" as const,
    runId: job.id,
    packet,
    queries: buildApolloExceptionIdentityQueries(packet),
    limits: {
      publicQueries: MAX_PUBLIC_QUERIES,
      publicEvidence: MAX_PUBLIC_EVIDENCE,
      apolloOrganizationSearches: input.maximumApolloOrganizationSearches
    }
  };
}

export async function completeApolloExceptionResolution({
  tenantId,
  runId,
  publicEvidence,
  now = new Date()
}: {
  tenantId: string;
  runId: string;
  publicEvidence: unknown;
  now?: Date;
}) {
  const job = await prisma.automationJobRun.findFirst({
    where: {
      id: runId,
      tenantId,
      jobType: HUNTER_APOLLO_EXCEPTION_RESOLUTION_JOB_TYPE,
      status: JobStatus.RUNNING
    }
  });
  if (!job) throw new Error("Apollo exception resolution job is not running for this tenant.");
  const input = parseAutopilotInput(job.input);
  const evidence = validatePublicEvidence(publicEvidence);
  const packet = await loadResolutionPacket({ tenantId, input, publicEvidence: evidence });
  const { synthesis, usage } = await generateApolloIdentityResolution({
    packet,
    safetyIdentifier: createHash("sha256")
      .update(`${tenantId}|${input.companyId}`)
      .digest("hex")
  });
  const company = await prisma.company.findFirst({
    where: { id: input.companyId, tenantId },
    select: {
      id: true,
      name: true,
      domain: true,
      linkedinUrl: true
    }
  });
  if (!company) throw new Error("Apollo exception company no longer exists for this tenant.");

  const existingCanonicalCompanies = synthesis.officialDomain
    ? await loadExistingCanonicalApolloCompanies({
        tenantId,
        companyId: company.id,
        officialDomain: synthesis.officialDomain
      })
    : [];
  const canonicalReuse = selectCanonicalApolloIdentityReuse({
    companyId: company.id,
    synthesis,
    evidence,
    companies: existingCanonicalCompanies
  });
  const candidate = canonicalReuse?.candidate ??
    await resolveApolloOrganizationForCompany({
      companyName: company.name,
      domain: company.domain,
      verifiedIdentityContext: JSON.stringify({
        version: AUTOPILOT_RESOLVER_VERSION,
        identityResolution: synthesis
      })
    });
  const decision = decideApolloExceptionResolution({ synthesis, candidate, evidence });
  const recorded = await persistAutopilotMatch({
    tenantId,
    company,
    input,
    synthesis,
    evidence,
    candidate,
    decision,
    now
  });
  const handoff = decision.autoResolved
    ? canonicalReuse?.hasPriorOutreach
      ? {
          state: "canonical_duplicate_suppressed",
          canonicalCompanyId: canonicalReuse.canonicalCompanyId,
          canonicalCompanyName: canonicalReuse.canonicalCompanyName,
          reason:
            "This Apollo organization already has Hunter outreach history under its canonical company record."
        }
      : await enqueueResolvedCompanyHandoff({ tenantId, companyId: company.id })
    : null;
  const searchCount = readApolloSearchCount(candidate);
  const output = {
    state: decision.autoResolved ? "AUTO_RESOLVED" : "HUMAN_REVIEW_REQUIRED",
    companyId: company.id,
    sourceMatchId: input.sourceMatchId,
    recordedMatchId: recorded.id,
    identityFingerprint: input.identityFingerprint,
    synthesis: {
      ...synthesis,
      model: APOLLO_IDENTITY_RESOLUTION_MODEL,
      promptVersion: APOLLO_IDENTITY_RESOLUTION_PROMPT_VERSION
    },
    publicEvidence: evidence,
    candidate: candidate ? summarizeCandidate(candidate) : null,
    autoResolutionReason: decision.reason,
    apolloOrganizationSearches: searchCount,
    canonicalIdentityReuse: canonicalReuse
      ? {
          canonicalCompanyId: canonicalReuse.canonicalCompanyId,
          canonicalCompanyName: canonicalReuse.canonicalCompanyName,
          hasPriorOutreach: canonicalReuse.hasPriorOutreach
        }
      : null,
    modelUsage: usage,
    handoff,
    completedAt: now.toISOString()
  };
  await prisma.$transaction([
    prisma.automationJobRun.update({
      where: { id: job.id },
      data: {
        status: JobStatus.SUCCESS,
        finishedAt: now,
        output: toInputJsonValue(output),
        errorMessage: null
      }
    }),
    prisma.auditLog.create({
      data: {
        tenantId,
        action: decision.autoResolved
          ? "lead-gen.apollo-exception-autopilot.auto-resolved"
          : "lead-gen.apollo-exception-autopilot.review-required",
        entityType: "Company",
        entityId: company.id,
        after: toInputJsonValue({
          runId: job.id,
          sourceMatchId: input.sourceMatchId,
          recordedMatchId: recorded.id,
          identityFingerprint: input.identityFingerprint,
          selectedOrganizationId: decision.autoResolved ? candidate?.id ?? null : null,
          reason: decision.reason,
          apolloOrganizationSearches: searchCount,
          publicEvidenceCount: evidence.length,
          model: APOLLO_IDENTITY_RESOLUTION_MODEL,
          promptVersion: APOLLO_IDENTITY_RESOLUTION_PROMPT_VERSION
        })
      }
    })
  ]);
  return output;
}

export async function failApolloExceptionResolution({
  tenantId,
  runId,
  errorMessage,
  now = new Date()
}: {
  tenantId: string;
  runId: string;
  errorMessage: string;
  now?: Date;
}) {
  const message = sanitizeError(errorMessage);
  const updated = await prisma.automationJobRun.updateMany({
    where: {
      id: runId,
      tenantId,
      jobType: HUNTER_APOLLO_EXCEPTION_RESOLUTION_JOB_TYPE,
      status: { in: [JobStatus.QUEUED, JobStatus.RUNNING] }
    },
    data: {
      status: JobStatus.ERROR,
      finishedAt: now,
      errorMessage: message,
      output: {
        state: "ERROR",
        errorMessage: message,
        failedAt: now.toISOString()
      }
    }
  });
  if (updated.count === 0) {
    throw new Error("Apollo exception resolution job could not be failed for this tenant.");
  }
  return { state: "failed" as const, runId, errorMessage: message };
}

export async function getApolloExceptionAutopilotStatus({
  tenantId,
  now = new Date()
}: {
  tenantId: string;
  now?: Date;
}): Promise<ApolloExceptionAutopilotStatus> {
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1_000);
  const [recent, queued, running] = await Promise.all([
    prisma.automationJobRun.findMany({
      where: {
        tenantId,
        jobType: HUNTER_APOLLO_EXCEPTION_RESOLUTION_JOB_TYPE,
        startedAt: { gte: since },
        status: { in: [JobStatus.SUCCESS, JobStatus.ERROR] }
      },
      select: { status: true, output: true }
    }),
    prisma.automationJobRun.count({
      where: {
        tenantId,
        jobType: HUNTER_APOLLO_EXCEPTION_RESOLUTION_JOB_TYPE,
        status: JobStatus.QUEUED
      }
    }),
    prisma.automationJobRun.count({
      where: {
        tenantId,
        jobType: HUNTER_APOLLO_EXCEPTION_RESOLUTION_JOB_TYPE,
        status: JobStatus.RUNNING
      }
    })
  ]);
  return summarizeApolloExceptionAutopilotStatus({
    enabled: isApolloExceptionAutopilotEnabled(),
    dailyCompanyLimit: getApolloExceptionDailyCompanyLimit(),
    recent,
    queued,
    running
  });
}

export function summarizeApolloExceptionAutopilotStatus({
  enabled,
  dailyCompanyLimit,
  recent,
  queued,
  running
}: {
  enabled: boolean;
  dailyCompanyLimit: number;
  recent: Array<{ status: JobStatus; output: unknown }>;
  queued: number;
  running: number;
}): ApolloExceptionAutopilotStatus {
  return {
    enabled,
    dailyCompanyLimit,
    processedLast24Hours: recent.length,
    autoResolvedLast24Hours: recent.filter(
      (job) => readOutputState(job.output) === "AUTO_RESOLVED"
    ).length,
    stillAmbiguousLast24Hours: recent.filter(
      (job) => readOutputState(job.output) === "HUMAN_REVIEW_REQUIRED"
    ).length,
    failedLast24Hours: recent.filter((job) => job.status === JobStatus.ERROR).length,
    queued,
    running
  };
}

export function decideApolloExceptionResolution({
  synthesis,
  candidate,
  evidence
}: {
  synthesis: ApolloIdentityResolutionSynthesis;
  candidate: ApolloOrganizationCandidate | null;
  evidence: ApolloIdentityPublicEvidence[];
}) {
  if (!candidate?.id) {
    return {
      autoResolved: false,
      reason: "No Apollo organization candidate was returned after public identity research."
    };
  }
  if (
    synthesis.disposition !== "EXACT_OPERATING_COMPANY" &&
    synthesis.disposition !== "VERIFIED_PARENT_OR_BRAND"
  ) {
    return {
      autoResolved: false,
      reason: `Public identity research remained ${synthesis.disposition.toLowerCase().replaceAll("_", " ")}.`
    };
  }
  if (synthesis.confidence < MIN_AUTO_RESOLVE_CONFIDENCE) {
    return {
      autoResolved: false,
      reason: `Public identity confidence ${synthesis.confidence}% was below the ${MIN_AUTO_RESOLVE_CONFIDENCE}% automatic threshold.`
    };
  }
  if (candidate.classification !== ApolloCompanyMatchClassification.DIRECT_COMPANY) {
    return {
      autoResolved: false,
      reason: "Apollo did not return a unique direct-company candidate."
    };
  }
  if (!candidate.domainMatch || !synthesis.officialDomain) {
    return {
      autoResolved: false,
      reason: "Automatic resolution requires the Apollo candidate to match the independently verified official domain."
    };
  }
  if (!hasCitedOfficialDomainEvidence(synthesis, evidence)) {
    return {
      autoResolved: false,
      reason: "The cited public evidence did not include the verified official company domain."
    };
  }
  return {
    autoResolved: true,
    reason: "A unique direct Apollo organization matched the independently verified official domain at 90% or better public-identity confidence."
  };
}

export function requiresApolloExceptionIdentityResolution({
  classification,
  apolloOrganizationId,
  companyDomain,
  matchDomain,
  score,
  matchReason
}: {
  classification: ApolloCompanyMatchClassification;
  apolloOrganizationId: string | null;
  companyDomain: string | null;
  matchDomain: string | null;
  score: number;
  matchReason: string | null;
}) {
  if (requiresApolloMatchReview(classification)) return true;
  return Boolean(
    classification === ApolloCompanyMatchClassification.DIRECT_COMPANY &&
    apolloOrganizationId &&
    !normalizeHunterCompanyDomain(companyDomain) &&
    !normalizeHunterCompanyDomain(matchDomain) &&
    score <= 19 &&
    isMappedApolloZeroEmployeeState({
      apolloOrganizationId,
      matchReason
    })
  );
}

function hasCitedOfficialDomainEvidence(
  synthesis: ApolloIdentityResolutionSynthesis,
  evidence: ApolloIdentityPublicEvidence[]
) {
  const officialDomain = synthesis.officialDomain?.toLowerCase().replace(/^www\./u, "");
  if (!officialDomain || isSharedPublicIdentityDomain(officialDomain)) return false;
  const cited = new Set(synthesis.evidenceIndices);
  return evidence.some((item) => {
    if (!cited.has(item.evidenceIndex)) return false;
    const sourceDomain = item.sourceDomain.toLowerCase().replace(/^www\./u, "");
    return sourceDomain === officialDomain || sourceDomain.endsWith(`.${officialDomain}`);
  });
}

export function buildApolloExceptionIdentityQueries(
  packet: Omit<ApolloIdentityResolutionPacket, "publicEvidence">
) {
  const geography = packet.shipmentGeography[0] ?? null;
  const recoveryAliases = buildApolloExceptionRecoveryAliases(packet.companyName);
  const candidateNames = packet.priorApolloCandidates
    .map((candidate) => candidate.companyName?.trim())
    .filter((value): value is string => Boolean(value))
    .slice(0, 2);
  return [
    `"${packet.companyName}" official company website`,
    `"${packet.companyName}" parent company subsidiary operating brand`,
    geography ? `"${packet.companyName}" "${geography}" company` : null,
    ...recoveryAliases.map(
      (alias) => `"${alias}" official company website operating brand`
    ),
    ...candidateNames.map(
      (candidateName) => `"${packet.companyName}" "${candidateName}" company relationship`
    )
  ]
    .filter((value): value is string => Boolean(value))
    .filter((value, index, values) => values.indexOf(value) === index)
    .slice(0, MAX_PUBLIC_QUERIES);
}

export function buildApolloExceptionRecoveryAliases(companyName: string) {
  const legalTokens = new Set([
    "co",
    "company",
    "corp",
    "corporation",
    "inc",
    "incorporated",
    "llc",
    "ltd",
    "limited",
    "plc",
    "the"
  ]);
  const tokens = companyName
    .replace(/&/gu, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(/\s+/u)
    .filter(Boolean)
    .filter((token) => !legalTokens.has(token.toLowerCase()));
  const candidates: string[] = [];
  if (tokens.length >= 4 || (tokens.length >= 3 && tokens[0]!.length <= 3)) {
    const tail = tokens.slice(1).join(" ");
    if (tail.length >= 8) candidates.push(tail);
  }
  return candidates.filter(
    (candidate, index, values) => values.indexOf(candidate) === index
  ).slice(0, 2);
}

type ExistingCanonicalApolloCompany = {
  id: string;
  name: string;
  domain: string | null;
  apolloOrganizationId: string | null;
  hasPriorOutreach: boolean;
};

export function selectCanonicalApolloIdentityReuse({
  companyId,
  synthesis,
  evidence,
  companies
}: {
  companyId: string;
  synthesis: ApolloIdentityResolutionSynthesis;
  evidence: ApolloIdentityPublicEvidence[];
  companies: ExistingCanonicalApolloCompany[];
}) {
  const officialDomain = normalizeHunterCompanyDomain(synthesis.officialDomain);
  if (
    !officialDomain ||
    synthesis.confidence < MIN_AUTO_RESOLVE_CONFIDENCE ||
    (
      synthesis.disposition !== "EXACT_OPERATING_COMPANY" &&
      synthesis.disposition !== "VERIFIED_PARENT_OR_BRAND"
    ) ||
    !hasCitedOfficialDomainEvidence(synthesis, evidence)
  ) {
    return null;
  }
  const eligible = companies.filter(
    (company) =>
      company.id !== companyId &&
      Boolean(company.apolloOrganizationId) &&
      normalizeHunterCompanyDomain(company.domain) === officialDomain
  );
  const organizationIds = [...new Set(
    eligible
      .map((company) => company.apolloOrganizationId)
      .filter((value): value is string => Boolean(value))
  )];
  if (organizationIds.length !== 1) return null;
  const canonical = eligible.find(
    (company) => company.apolloOrganizationId === organizationIds[0]
  );
  if (!canonical) return null;
  return {
    canonicalCompanyId: canonical.id,
    canonicalCompanyName: canonical.name,
    hasPriorOutreach: eligible.some(
      (company) =>
        company.apolloOrganizationId === organizationIds[0] && company.hasPriorOutreach
    ),
    candidate: {
      id: organizationIds[0],
      name: synthesis.operatingName ?? canonical.name,
      domain: officialDomain,
      linkedinUrl: null,
      score: 100,
      nameMatchType: "EXACT" as const,
      domainMatch: true,
      logisticsProviderMatch: false,
      branchLocationMatch: false,
      strongBaseNameMatch: true,
      classification: ApolloCompanyMatchClassification.DIRECT_COMPANY,
      matchReason:
        `direct company; reused tenant canonical Apollo identity from "${canonical.name}" after exact verified-domain resolution`,
      query: {
        source: "tenant-canonical-apollo-identity",
        canonical_company_id: canonical.id,
        official_domain: officialDomain,
        organization_ids: [organizationIds[0]]
      },
      rawPayload: {
        source: "tenant-canonical-apollo-identity",
        canonical_company_id: canonical.id,
        organization_id: organizationIds[0]
      }
    } satisfies ApolloOrganizationCandidate
  };
}

async function loadExistingCanonicalApolloCompanies({
  tenantId,
  companyId,
  officialDomain
}: {
  tenantId: string;
  companyId: string;
  officialDomain: string;
}): Promise<ExistingCanonicalApolloCompany[]> {
  const domain = normalizeHunterCompanyDomain(officialDomain);
  if (!domain) return [];
  const domainVariants = [domain, `www.${domain}`];
  const companies = await prisma.company.findMany({
    where: {
      tenantId,
      id: { not: companyId },
      apolloOrganizationId: { not: null },
      OR: [
        { domain: { in: domainVariants } },
        {
          apolloCompanyMatches: {
            some: {
              tenantId,
              classification: ApolloCompanyMatchClassification.DIRECT_COMPANY,
              apolloDomain: { in: domainVariants }
            }
          }
        }
      ]
    },
    orderBy: { createdAt: "asc" },
    take: 25,
    select: {
      id: true,
      name: true,
      domain: true,
      apolloOrganizationId: true,
      contacts: {
        where: { sequenceStatus: { not: SequenceStatus.NOT_STARTED } },
        take: 1,
        select: { id: true }
      },
      outreachPlans: {
        take: 1,
        select: { id: true }
      },
      apolloCompanyMatches: {
        where: {
          tenantId,
          classification: ApolloCompanyMatchClassification.DIRECT_COMPANY,
          apolloDomain: { in: domainVariants }
        },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { apolloDomain: true }
      }
    }
  });
  return companies.map((company) => ({
    id: company.id,
    name: company.name,
    domain: company.apolloCompanyMatches[0]?.apolloDomain ?? company.domain,
    apolloOrganizationId: company.apolloOrganizationId,
    hasPriorOutreach:
      company.contacts.length > 0 || company.outreachPlans.length > 0
  }));
}

function isApolloExceptionAutopilotEnabled() {
  return ["1", "true", "yes", "on"].includes(
    process.env.HUNTER_APOLLO_EXCEPTION_AUTOPILOT_ENABLED?.trim().toLowerCase() ?? ""
  );
}

function getApolloExceptionDailyCompanyLimit() {
  const parsed = Number.parseInt(
    process.env.HUNTER_APOLLO_EXCEPTION_DAILY_COMPANY_LIMIT ?? "",
    10
  );
  return Number.isFinite(parsed)
    ? Math.min(MAX_DAILY_COMPANY_LIMIT, Math.max(1, parsed))
    : DEFAULT_DAILY_COMPANY_LIMIT;
}

async function enqueueNextEligibleException({
  tenantId,
  now
}: {
  tenantId: string;
  now: Date;
}) {
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1_000);
  const recentCount = await prisma.automationJobRun.count({
    where: {
      tenantId,
      jobType: HUNTER_APOLLO_EXCEPTION_RESOLUTION_JOB_TYPE,
      startedAt: { gte: since }
    }
  });
  if (recentCount >= getApolloExceptionDailyCompanyLimit()) return null;

  const companies = await prisma.company.findMany({
    where: {
      tenantId,
      doNotProspect: false,
      candidateStatus: {
        notIn: [CandidateStatus.REJECTED, CandidateStatus.DISQUALIFIED]
      },
      apolloCompanyMatches: { some: { tenantId } }
    },
    orderBy: [{ priorityScore: "desc" }, { updatedAt: "desc" }],
    take: 100,
    select: {
      id: true,
      name: true,
      normalizedName: true,
      domain: true,
      primaryIndustry: true,
      apolloOrganizationId: true,
      apolloCompanyMatches: {
        where: { tenantId },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: {
          id: true,
          classification: true,
          apolloDomain: true,
          score: true,
          matchReason: true,
          reviewedAt: true,
          queryJson: true,
          createdAt: true
        }
      },
      hunterOpportunitySignals: {
        where: { tenantId, sourceName: "Hunter company research" },
        orderBy: { observedAt: "desc" },
        take: 1,
        select: {
          id: true,
          sourceName: true,
          serviceLine: true,
          observedAt: true,
          evidence: true
        }
      },
      hunterProspectingDecisions: {
        where: { tenantId },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: {
          id: true,
          status: true,
          companyId: true,
          companyName: true,
          recommendedPersona: true,
          serviceLine: true,
          opportunityType: true,
          rationale: true,
          recommendedSender: true,
          recommendedCadence: true,
          createdAt: true,
          jobRunId: true
        }
      }
    }
  });
  const duplicateJobs = await prisma.automationJobRun.findMany({
    where: {
      tenantId,
      jobType: HUNTER_APOLLO_EXCEPTION_RESOLUTION_JOB_TYPE
    },
    orderBy: { startedAt: "desc" },
    take: 250,
    select: { input: true }
  });
  for (const company of companies) {
    const match = company.apolloCompanyMatches[0] ?? null;
    const signal = company.hunterOpportunitySignals[0] ?? null;
    const decision = company.hunterProspectingDecisions[0] ?? null;
    if (
      !match ||
      match.reviewedAt ||
      !requiresApolloExceptionIdentityResolution({
        classification: match.classification,
        apolloOrganizationId: company.apolloOrganizationId,
        companyDomain: company.domain,
        matchDomain: match.apolloDomain,
        score: match.score,
        matchReason: match.matchReason
      }) ||
      !signal ||
      !decision
    ) {
      continue;
    }
    const eligibility = evaluateHunterOutreachEligibility({
      researchSignal: signal,
      prospectingDecision: decision,
      maxResearchAgeDays: getHunterOutreachResearchMaxAgeDays()
    });
    if (eligibility.status !== "ELIGIBLE") continue;
    const identityFingerprint = fingerprintIdentity({
      companyId: company.id,
      name: company.name,
      normalizedName: company.normalizedName,
      domain: company.domain,
      sourceMatchId: match.id,
      sourceMatchQuery: match.queryJson,
      researchSignalId: signal.id,
      researchEvidence: signal.evidence,
      resolverVersion: AUTOPILOT_RESOLVER_VERSION
    });
    if (
      duplicateJobs.some(
        (job) => readInputFingerprint(job.input) === identityFingerprint
      )
    ) {
      continue;
    }
    return prisma.automationJobRun.create({
      data: {
        tenantId,
        jobType: HUNTER_APOLLO_EXCEPTION_RESOLUTION_JOB_TYPE,
        status: JobStatus.QUEUED,
        input: {
          version: AUTOPILOT_RESOLVER_VERSION,
          companyId: company.id,
          sourceMatchId: match.id,
          researchSignalId: signal.id,
          identityFingerprint,
          maximumApolloOrganizationSearches: 3
        },
        output: {
          state: "QUEUED",
          queuedAt: now.toISOString()
        }
      }
    });
  }
  return null;
}

async function loadResolutionPacket({
  tenantId,
  input,
  publicEvidence = []
}: {
  tenantId: string;
  input: AutopilotInput;
  publicEvidence?: ApolloIdentityPublicEvidence[];
}): Promise<ApolloIdentityResolutionPacket> {
  const company = await prisma.company.findFirst({
    where: { id: input.companyId, tenantId },
    select: {
      id: true,
      name: true,
      normalizedName: true,
      domain: true,
      primaryIndustry: true,
      apolloOrganizationId: true,
      importRecords: {
        orderBy: [{ arrivalDate: "desc" }, { createdAt: "desc" }],
        take: 25,
        select: {
          destinationCity: true,
          destinationState: true,
          originCountry: true
        }
      },
      apolloCompanyMatches: {
        where: { tenantId },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: {
          id: true,
          classification: true,
          apolloDomain: true,
          score: true,
          matchReason: true,
          reviewedAt: true,
          queryJson: true
        }
      },
      hunterOpportunitySignals: {
        where: { id: input.researchSignalId, tenantId },
        take: 1,
        select: {
          id: true,
          sourceName: true,
          serviceLine: true,
          observedAt: true,
          evidence: true
        }
      },
      hunterProspectingDecisions: {
        where: { tenantId },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: {
          id: true,
          status: true,
          companyId: true,
          companyName: true,
          recommendedPersona: true,
          serviceLine: true,
          opportunityType: true,
          rationale: true,
          recommendedSender: true,
          recommendedCadence: true,
          createdAt: true,
          jobRunId: true
        }
      }
    }
  });
  if (!company) throw new Error("Apollo exception company was not found for this tenant.");
  const currentMatch = company.apolloCompanyMatches[0] ?? null;
  const researchSignal = company.hunterOpportunitySignals[0] ?? null;
  const prospectingDecision = company.hunterProspectingDecisions[0] ?? null;
  if (
    !currentMatch ||
    currentMatch.id !== input.sourceMatchId ||
    currentMatch.reviewedAt ||
    !requiresApolloExceptionIdentityResolution({
      classification: currentMatch.classification,
      apolloOrganizationId: company.apolloOrganizationId,
      companyDomain: company.domain,
      matchDomain: currentMatch.apolloDomain,
      score: currentMatch.score,
      matchReason: currentMatch.matchReason
    })
  ) {
    throw new Error(
      "Apollo exception identity changed after this job was queued; a fresh resolution is required."
    );
  }
  if (!researchSignal || !prospectingDecision) {
    throw new Error("Apollo exception no longer has the qualified Hunter research handoff.");
  }
  const eligibility = evaluateHunterOutreachEligibility({
    researchSignal,
    prospectingDecision,
    maxResearchAgeDays: getHunterOutreachResearchMaxAgeDays()
  });
  if (eligibility.status !== "ELIGIBLE") {
    throw new Error("Apollo exception is no longer eligible for contact discovery.");
  }
  const query = isRecord(currentMatch.queryJson)
    ? currentMatch.queryJson as Record<string, unknown>
    : null;
  const resolver = isRecord(query?.identity_resolver)
    ? query.identity_resolver as Record<string, unknown>
    : null;
  const candidates = Array.isArray(resolver?.candidates)
    ? resolver.candidates.map(readPriorCandidate).filter(isNotNull).slice(0, 10)
    : [];
  const shipmentGeography = company.importRecords
    .flatMap((record) => [
      [record.destinationCity, record.destinationState].filter(Boolean).join(", "),
      record.originCountry
    ])
    .filter((value): value is string => Boolean(value))
    .filter((value, index, values) => values.indexOf(value) === index)
    .slice(0, 6);
  return {
    companyId: company.id,
    companyName: company.name,
    normalizedName: company.normalizedName,
    knownDomain: company.domain,
    primaryIndustry: company.primaryIndustry,
    shipmentGeography,
    priorApolloCandidates: candidates,
    publicEvidence
  };
}

async function persistAutopilotMatch({
  tenantId,
  company,
  input,
  synthesis,
  evidence,
  candidate,
  decision,
  now
}: {
  tenantId: string;
  company: { id: string; name: string; domain: string | null; linkedinUrl: string | null };
  input: AutopilotInput;
  synthesis: ApolloIdentityResolutionSynthesis;
  evidence: ApolloIdentityPublicEvidence[];
  candidate: ApolloOrganizationCandidate | null;
  decision: { autoResolved: boolean; reason: string };
  now: Date;
}) {
  const classification = decision.autoResolved
    ? ApolloCompanyMatchClassification.DIRECT_COMPANY
    : candidate?.classification === ApolloCompanyMatchClassification.LOGISTICS_PROVIDER
      ? ApolloCompanyMatchClassification.LOGISTICS_PROVIDER
      : candidate?.classification === ApolloCompanyMatchClassification.NO_MATCH
        ? ApolloCompanyMatchClassification.NO_MATCH
        : ApolloCompanyMatchClassification.MATCH_QUALITY_REVIEW;
  const query = {
    ...(candidate?.query ?? {}),
    exception_autopilot: {
      version: AUTOPILOT_RESOLVER_VERSION,
      source_match_id: input.sourceMatchId,
      identity_fingerprint: input.identityFingerprint,
      state: decision.autoResolved ? "AUTO_RESOLVED" : "HUMAN_REVIEW_REQUIRED",
      reason: decision.reason,
      model: APOLLO_IDENTITY_RESOLUTION_MODEL,
      prompt_version: APOLLO_IDENTITY_RESOLUTION_PROMPT_VERSION,
      synthesis,
      public_evidence: evidence.map((item) => ({
        evidenceIndex: item.evidenceIndex,
        query: item.query,
        title: item.title,
        url: item.url,
        sourceDomain: item.sourceDomain
      }))
    }
  };
  return prisma.$transaction(async (tx) => {
    const match = await tx.apolloCompanyMatch.create({
      data: {
        tenantId,
        companyId: company.id,
        apolloOrganizationId: candidate?.id ?? null,
        apolloCompanyName: candidate?.name ?? null,
        apolloDomain: candidate?.domain ?? null,
        apolloLinkedinUrl: candidate?.linkedinUrl ?? null,
        score: candidate?.score ?? 0,
        classification,
        nameMatchType: candidate?.nameMatchType ?? null,
        domainMatch: candidate?.domainMatch ?? false,
        logisticsProviderMatch: candidate?.logisticsProviderMatch ?? false,
        branchLocationMatch: candidate?.branchLocationMatch ?? false,
        matchReason: [candidate?.matchReason, decision.reason].filter(Boolean).join("; "),
        queryJson: toInputJsonValue(query),
        rawJson: candidate?.rawPayload
          ? toInputJsonValue(candidate.rawPayload)
          : Prisma.JsonNull,
        createdAt: now
      }
    });
    if (decision.autoResolved && candidate?.id) {
      await tx.company.updateMany({
        where: { id: company.id, tenantId },
        data: {
          apolloOrganizationId: candidate.id,
          domain: candidate.domain ?? synthesis.officialDomain ?? company.domain,
          linkedinUrl: candidate.linkedinUrl ?? company.linkedinUrl
        }
      });
    }
    return match;
  });
}

async function releaseExpiredResolutionLease({
  tenantId,
  now
}: {
  tenantId: string;
  now: Date;
}) {
  const expiredBefore = new Date(now.getTime() - PROCESSING_LEASE_MS);
  await prisma.automationJobRun.updateMany({
    where: {
      tenantId,
      jobType: HUNTER_APOLLO_EXCEPTION_RESOLUTION_JOB_TYPE,
      status: JobStatus.RUNNING,
      startedAt: { lt: expiredBefore }
    },
    data: {
      status: JobStatus.ERROR,
      finishedAt: now,
      errorMessage: "Apollo exception resolution worker lease expired.",
      output: {
        state: "ERROR",
        errorMessage: "Apollo exception resolution worker lease expired.",
        failedAt: now.toISOString()
      }
    }
  });
}

function validatePublicEvidence(value: unknown): ApolloIdentityPublicEvidence[] {
  if (!Array.isArray(value) || value.length > MAX_PUBLIC_EVIDENCE) {
    throw new Error(`Apollo identity evidence must contain at most ${MAX_PUBLIC_EVIDENCE} rows.`);
  }
  const seen = new Set<string>();
  return value.map((item, index) => {
    if (!isRecord(item)) throw new Error(`Apollo identity evidence ${index} must be an object.`);
    const url = requiredString(item.url, `evidence ${index} URL`, 2_000);
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error(`Apollo identity evidence ${index} URL is invalid.`);
    }
    if (parsed.protocol !== "https:") {
      throw new Error(`Apollo identity evidence ${index} must use HTTPS.`);
    }
    const canonicalUrl = `${parsed.origin}${parsed.pathname}`.replace(/\/$/u, "");
    if (seen.has(canonicalUrl)) throw new Error("Apollo identity evidence contains a duplicate URL.");
    seen.add(canonicalUrl);
    return {
      evidenceIndex: index,
      query: requiredString(item.query, `evidence ${index} query`, 500),
      title: requiredString(item.title, `evidence ${index} title`, 500),
      url,
      sourceDomain: parsed.hostname.toLowerCase().replace(/^www\./u, ""),
      excerpt: requiredString(item.excerpt, `evidence ${index} excerpt`, 1_500)
    };
  });
}

function parseAutopilotInput(value: unknown): AutopilotInput {
  if (!isRecord(value)) throw new Error("Apollo exception job input is invalid.");
  const parsed = {
    version: integer(value.version, "version"),
    companyId: requiredString(value.companyId, "companyId", 200),
    sourceMatchId: requiredString(value.sourceMatchId, "sourceMatchId", 200),
    researchSignalId: requiredString(value.researchSignalId, "researchSignalId", 200),
    identityFingerprint: requiredString(value.identityFingerprint, "identityFingerprint", 128),
    maximumApolloOrganizationSearches: integer(
      value.maximumApolloOrganizationSearches,
      "maximumApolloOrganizationSearches"
    )
  };
  if (parsed.version !== AUTOPILOT_RESOLVER_VERSION) {
    throw new Error("Apollo exception job version is not supported.");
  }
  if (!/^[a-f0-9]{64}$/u.test(parsed.identityFingerprint)) {
    throw new Error("Apollo exception identityFingerprint is invalid.");
  }
  if (
    parsed.maximumApolloOrganizationSearches < 1 ||
    parsed.maximumApolloOrganizationSearches > 3
  ) {
    throw new Error("Apollo exception organization-search limit is invalid.");
  }
  return parsed;
}

async function enqueueResolvedCompanyHandoff({
  tenantId,
  companyId
}: {
  tenantId: string;
  companyId: string;
}) {
  try {
    return await enqueueHunterCompanyOutreachHandoff({
      tenantId,
      companyId,
      forceContactReview: true
    });
  } catch (error) {
    return {
      state: "queue_failed" as const,
      message: sanitizeError(
        error instanceof Error
          ? error.message
          : "Resolved company contact-discovery handoff could not be queued."
      )
    };
  }
}

function readPriorCandidate(value: unknown) {
  if (!isRecord(value)) return null;
  return {
    organizationId: nullableString(value.organizationId),
    companyName: nullableString(value.companyName),
    domain: nullableString(value.domain),
    score: typeof value.score === "number" ? Math.round(value.score) : 0,
    classification: typeof value.classification === "string" ? value.classification : "UNKNOWN"
  };
}

function readApolloSearchCount(candidate: ApolloOrganizationCandidate | null) {
  const resolver = isRecord(candidate?.query.identity_resolver)
    ? candidate?.query.identity_resolver as Record<string, unknown>
    : null;
  return Array.isArray(resolver?.searches_completed)
    ? resolver.searches_completed.length
    : 0;
}

function summarizeCandidate(candidate: ApolloOrganizationCandidate) {
  return {
    organizationId: candidate.id,
    companyName: candidate.name,
    domain: candidate.domain,
    linkedinUrl: candidate.linkedinUrl,
    score: candidate.score,
    classification: candidate.classification,
    nameMatchType: candidate.nameMatchType,
    domainMatch: candidate.domainMatch,
    matchReason: candidate.matchReason,
    query: candidate.query
  };
}

function fingerprintIdentity(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function readInputFingerprint(value: unknown) {
  return isRecord(value) && typeof value.identityFingerprint === "string"
    ? value.identityFingerprint
    : null;
}

function readOutputState(value: unknown) {
  return isRecord(value) && typeof value.state === "string" ? value.state : null;
}

function requiredString(value: unknown, field: string, maximum: number) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > maximum) {
    throw new Error(`Apollo exception ${field} is invalid.`);
  }
  return value.trim();
}

function nullableString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function integer(value: unknown, field: string) {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new Error(`Apollo exception ${field} is invalid.`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isNotNull<T>(value: T | null): value is T {
  return value !== null;
}

function toInputJsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function sanitizeError(value: string) {
  return value
    .replace(/\b(?:sk|pk)-[A-Za-z0-9_-]+\b/gu, "[REDACTED]")
    .slice(0, 500);
}

export function isSharedPublicIdentityDomain(value: string) {
  const domain = value.toLowerCase().replace(/^www\./u, "");
  return [...SHARED_PUBLIC_DOMAINS].some(
    (shared) => domain === shared || domain.endsWith(`.${shared}`)
  );
}
