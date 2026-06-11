import { CandidateStatus, LeadPipelineStage } from "@prisma/client";
import { prisma } from "@/server/db";
import { tenantWhere } from "@/server/tenant-query";
import type { TenantContext } from "@/server/tenant-context";

type SearchProfileDelegate = typeof prisma.tradeMiningSearchProfile;

type SearchProfileClient = typeof prisma & {
  tradeMiningSearchProfile?: SearchProfileDelegate;
};

export type CandidateFeedSort = "score_desc" | "score_asc" | "updated_desc";

export type CandidateFeedFilters = {
  status?: CandidateStatus | "ACTIVE";
  searchProfileId?: string;
  sort?: CandidateFeedSort;
};

export type LeadPipelineSort = "score_desc" | "updated_desc" | "approved_desc";

export type LeadPipelineFilters = {
  stage?: LeadPipelineStage | "ALL";
  ownerUserId?: string | "ALL" | "UNASSIGNED";
  sort?: LeadPipelineSort;
};

type JsonObject = Record<string, unknown>;

type SearchProfileSummary = {
  id: string;
  name: string;
  priorityWeight: number;
};

export async function getCandidateFeed(tenant: TenantContext, filters: CandidateFeedFilters = {}) {
  const companies = await prisma.company.findMany({
    where: tenantWhere(tenant, buildCandidateWhere(filters)),
    include: {
      importRecords: {
        where: tenantWhere(tenant),
        orderBy: [
          {
            arrivalDate: "desc"
          },
          {
            createdAt: "desc"
          }
        ],
        take: 100
      },
      leads: {
        where: tenantWhere(tenant),
        orderBy: {
          updatedAt: "desc"
        },
        take: 1
      }
    },
    orderBy: {
      updatedAt: "desc"
    }
  });

  const searchProfileIds = new Set<string>();

  for (const company of companies) {
    for (const record of company.importRecords) {
      const searchProfileId = readString(asObject(record.rawJson), "searchProfileId");
      if (searchProfileId) {
        searchProfileIds.add(searchProfileId);
      }
    }
  }

  const searchProfiles = await loadSearchProfileSummaries(tenant, [...searchProfileIds]);

  const candidates = companies
    .map((company) => {
      const evidence = summarizeTradeMiningEvidence(company.importRecords, searchProfiles);
      const scoring = scoreCandidate({
        companyPriorityScore: company.priorityScore,
        candidateStatus: company.candidateStatus,
        alreadyInPipeline: company.leads.length > 0,
        evidence
      });

      return {
        id: company.id,
        companyName: company.name,
        normalizedName: company.normalizedName,
        domain: company.domain,
        source: company.source,
        candidateStatus: company.candidateStatus,
        candidateStatusUpdatedAt: company.candidateStatusUpdatedAt,
        candidateStatusReason: company.candidateStatusReason,
        candidateScore: scoring.score,
        scoreReasoning: scoring.reasoning,
        importedScoreReasoning: evidence.importedScoreReasoning,
        shipmentCount: evidence.shipmentCount,
        latestShipmentDate: evidence.latestShipmentDate,
        matchedSearchProfileId: evidence.searchProfile?.id ?? null,
        matchedSearchProfileName: evidence.searchProfile?.name ?? "Unmatched import",
        destinationMarket: evidence.destinationMarket,
        destinationPort: evidence.destinationPort,
        originCountry: evidence.originCountry,
        originPort: evidence.originPort,
        shipFromPort: evidence.shipFromPort,
        productDescription: evidence.productDescription,
        hsCode: evidence.hsCode,
        assignedRep: company.leads[0]?.ownerUserId ?? "Unassigned",
        currentPipelineStage: company.leads[0]?.stage ?? null,
        alreadyInPipeline: company.leads.length > 0,
        createdAt: company.createdAt,
        updatedAt: company.updatedAt
      };
    })
    .filter((candidate) => !filters.searchProfileId || candidate.matchedSearchProfileId === filters.searchProfileId);

  return sortCandidates(candidates, filters.sort ?? "score_desc");
}

export async function getCandidateFeedFilters(tenant: TenantContext) {
  const searchProfileClient = prisma as SearchProfileClient;

  if (!searchProfileClient.tradeMiningSearchProfile) {
    return {
      searchProfiles: []
    };
  }

  const searchProfiles = await searchProfileClient.tradeMiningSearchProfile.findMany({
    where: tenantWhere(tenant),
    orderBy: [
      {
        priorityWeight: "desc"
      },
      {
        name: "asc"
      }
    ],
    select: {
      id: true,
      name: true
    }
  });

  return {
    searchProfiles
  };
}

export async function getTradeMiningSearchProfiles(tenant: TenantContext) {
  const searchProfileClient = prisma as SearchProfileClient;

  if (!searchProfileClient.tradeMiningSearchProfile) {
    return {
      profiles: [],
      setupWarning:
        "TradeMining search profiles need the latest Prisma Client. Run `npm run prisma:generate`, restart the dev server, then run migrations and seed data."
    };
  }

  try {
    const profiles = await searchProfileClient.tradeMiningSearchProfile.findMany({
      where: tenantWhere(tenant),
      orderBy: [
        {
          enabled: "desc"
        },
        {
          priorityWeight: "desc"
        },
        {
          name: "asc"
        }
      ]
    });

    return {
      profiles: profiles.map((profile) => ({
        id: profile.id,
        name: profile.name,
        description: profile.description,
        enabled: profile.enabled,
        destinationMarkets: asStringArray(profile.destinationMarkets),
        destinationPorts: asStringArray(profile.destinationPorts),
        originPorts: asStringArray(profile.originPorts),
        shipFromPorts: asStringArray(profile.shipFromPorts),
        originCountries: asStringArray(profile.originCountries),
        productKeywords: asStringArray(profile.productKeywords),
        hsCodes: asStringArray(profile.hsCodes),
        lookbackWindowDays: profile.lookbackWindowDays,
        minShipmentCount: profile.minShipmentCount,
        minShipmentVolume: profile.minShipmentVolume?.toString() ?? null,
        scheduleFrequency: profile.scheduleFrequency,
        scheduleTimezone: profile.scheduleTimezone,
        priorityWeight: profile.priorityWeight,
        lastRunAt: profile.lastRunAt,
        lastRunStatus: profile.lastRunStatus ?? "Not run yet"
      })),
      setupWarning: null
    };
  } catch (error) {
    if (isMissingSearchProfileTableError(error)) {
      return {
        profiles: [],
        setupWarning:
          "TradeMining search profile table is not available yet. Run `npm run prisma:migrate` and `npm run prisma:seed`, then refresh this page."
      };
    }

    throw error;
  }
}

export async function getLeadPipeline(tenant: TenantContext, filters: LeadPipelineFilters = {}) {
  const leads = await prisma.lead.findMany({
    where: tenantWhere(tenant, buildLeadPipelineWhere(filters)),
    include: {
      company: {
        include: {
          contacts: {
            where: tenantWhere(tenant),
            take: 5
          }
        }
      },
      contact: true
    },
    orderBy: buildLeadPipelineOrder(filters.sort ?? "approved_desc")
  });

  return leads.map((lead) => {
    const contactCount = lead.company.contacts.length;
    const hasSelectedContact = Boolean(lead.contact);
    const contactStatus = hasSelectedContact
      ? "Primary contact selected"
      : contactCount > 0
        ? `${contactCount} contacts available`
        : "No contacts yet";
    const apolloStatus = contactCount > 0 ? "Contacts imported" : "Apollo not started";
    const sequenceStatus = hasSelectedContact ? "Sequence not started" : "Contacts not ranked";
    const nextStep = getPipelineNextStep({
      stage: lead.stage,
      contactCount,
      hasSelectedContact,
      apolloStatus
    });

    return {
      id: lead.id,
      companyId: lead.companyId,
      companyName: lead.company.name,
      normalizedName: lead.company.normalizedName,
      contactName: lead.contact?.fullName,
      stage: lead.stage,
      candidateStatus: lead.company.candidateStatus,
      score: lead.score,
      companyScore: lead.company.priorityScore,
      ownerUserId: lead.ownerUserId,
      assignedRep: lead.ownerUserId ?? "Unassigned",
      contactStatus,
      apolloStatus,
      sequenceStatus,
      nextStep,
      notes: lead.notes,
      approvedAt: lead.createdAt,
      updatedAt: lead.updatedAt
    };
  });
}

export async function getLeadPipelineFilters(tenant: TenantContext) {
  const owners = await prisma.lead.findMany({
    where: tenantWhere(tenant, {
      ownerUserId: {
        not: null
      }
    }),
    distinct: ["ownerUserId"],
    select: {
      ownerUserId: true
    },
    orderBy: {
      ownerUserId: "asc"
    }
  });

  return {
    stages: Object.values(LeadPipelineStage),
    owners: owners.flatMap((owner) => (owner.ownerUserId ? [owner.ownerUserId] : []))
  };
}

function asStringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function buildLeadPipelineWhere(filters: LeadPipelineFilters) {
  const where: {
    stage?: LeadPipelineStage;
    ownerUserId?: string | null;
  } = {};

  if (filters.stage && filters.stage !== "ALL") {
    where.stage = filters.stage;
  }

  if (filters.ownerUserId === "UNASSIGNED") {
    where.ownerUserId = null;
  } else if (filters.ownerUserId && filters.ownerUserId !== "ALL") {
    where.ownerUserId = filters.ownerUserId;
  }

  return where;
}

function buildLeadPipelineOrder(sort: LeadPipelineSort) {
  if (sort === "score_desc") {
    return [
      {
        score: "desc" as const
      },
      {
        updatedAt: "desc" as const
      }
    ];
  }

  if (sort === "updated_desc") {
    return [
      {
        updatedAt: "desc" as const
      },
      {
        score: "desc" as const
      }
    ];
  }

  return [
    {
      createdAt: "desc" as const
    },
    {
      score: "desc" as const
    }
  ];
}

function getPipelineNextStep({
  stage,
  contactCount,
  hasSelectedContact,
  apolloStatus
}: {
  stage: LeadPipelineStage;
  contactCount: number;
  hasSelectedContact: boolean;
  apolloStatus: string;
}) {
  if (stage === LeadPipelineStage.DISQUALIFIED || stage === LeadPipelineStage.LOST || stage === LeadPipelineStage.WON) {
    return "No active next step";
  }

  if (stage === LeadPipelineStage.MEETING_BOOKED) {
    return "Prepare discovery notes";
  }

  if (stage === LeadPipelineStage.QUALIFIED) {
    return "Prepare quote or handoff";
  }

  if (stage === LeadPipelineStage.CONTACTED || stage === LeadPipelineStage.REPLIED) {
    return "Review outreach response";
  }

  if (!hasSelectedContact && contactCount > 0) {
    return "Rank and select contacts";
  }

  if (apolloStatus === "Apollo not started") {
    return "Ready for Apollo enrichment";
  }

  return "Research account fit";
}

function buildCandidateWhere(filters: CandidateFeedFilters) {
  if (!filters.status || filters.status === "ACTIVE") {
    return {
      candidateStatus: {
        in: [CandidateStatus.NEW, CandidateStatus.REVIEWING, CandidateStatus.APPROVED_FOR_PIPELINE]
      }
    };
  }

  return {
    candidateStatus: filters.status
  };
}

async function loadSearchProfileSummaries(tenant: TenantContext, searchProfileIds: string[]) {
  if (searchProfileIds.length === 0) {
    return new Map<string, SearchProfileSummary>();
  }

  const searchProfileClient = prisma as SearchProfileClient;

  if (!searchProfileClient.tradeMiningSearchProfile) {
    return new Map<string, SearchProfileSummary>();
  }

  const profiles = await searchProfileClient.tradeMiningSearchProfile.findMany({
    where: tenantWhere(tenant, {
      id: {
        in: searchProfileIds
      }
    }),
    select: {
      id: true,
      name: true,
      priorityWeight: true
    }
  });

  return new Map(profiles.map((profile) => [profile.id, profile]));
}

function summarizeTradeMiningEvidence(
  importRecords: Array<{
    rawJson: unknown;
    arrivalDate: Date | null;
    sourcePort: string | null;
    destinationCity: string | null;
    destinationState: string | null;
    originCountry: string | null;
    productDescription: string | null;
  }>,
  searchProfiles: Map<string, SearchProfileSummary>
) {
  const latestRecord = importRecords[0];
  const latestRawJson = asObject(latestRecord?.rawJson);
  const searchProfileId = readString(latestRawJson, "searchProfileId");

  const containerCount = sumNumericRawValues(importRecords, ["containerCount", "containers", "shipmentVolume"]);
  const shipmentWeight = sumNumericRawValues(importRecords, ["weight", "weightKg", "shipmentWeight"]);

  return {
    shipmentCount: importRecords.length,
    latestShipmentDate: latestRecord?.arrivalDate ?? null,
    searchProfile: searchProfileId ? searchProfiles.get(searchProfileId) ?? null : null,
    destinationMarket:
      firstStringFromRecords(importRecords, "destinationMarket") ??
      formatDestination(latestRawJson, latestRecord?.destinationCity ?? null, latestRecord?.destinationState ?? null),
    destinationPort: firstStringFromRecords(importRecords, "destinationPort"),
    originCountry: latestRecord?.originCountry ?? firstStringFromRecords(importRecords, "originCountry"),
    originPort: latestRecord?.sourcePort ?? firstStringFromRecords(importRecords, "originPort"),
    shipFromPort: firstStringFromRecords(importRecords, "shipFromPort"),
    productDescription: latestRecord?.productDescription ?? firstStringFromRecords(importRecords, "productDescription"),
    hsCode: firstStringFromRecords(importRecords, "hsCode"),
    containerCount,
    shipmentWeight,
    importedScoreReasoning: readImportedScoreReasoning(latestRawJson)
  };
}

function scoreCandidate({
  companyPriorityScore,
  candidateStatus,
  alreadyInPipeline,
  evidence
}: {
  companyPriorityScore: number;
  candidateStatus: CandidateStatus;
  alreadyInPipeline: boolean;
  evidence: ReturnType<typeof summarizeTradeMiningEvidence>;
}) {
  const frequencyScore = Math.min(30, evidence.shipmentCount * 8);
  const volumeScore = Math.min(15, Math.floor(evidence.containerCount * 4 + evidence.shipmentWeight / 10000));
  const recencyScore = scoreRecency(evidence.latestShipmentDate);
  const destinationScore = evidence.destinationMarket || evidence.destinationPort ? 10 : 0;
  const originScore = evidence.originCountry || evidence.originPort || evidence.shipFromPort ? 8 : 0;
  const productScore = evidence.productDescription || evidence.hsCode ? 10 : 0;
  const profileScore = Math.min(12, Math.floor((evidence.searchProfile?.priorityWeight ?? 0) / 8));
  const existingPriorityScore = Math.min(15, Math.floor(companyPriorityScore / 6));
  const pipelinePenalty = alreadyInPipeline ? -18 : 0;
  const rejectedPenalty =
    candidateStatus === CandidateStatus.REJECTED || candidateStatus === CandidateStatus.DISQUALIFIED ? -100 : 0;
  const rawScore =
    frequencyScore +
    volumeScore +
    recencyScore +
    destinationScore +
    originScore +
    productScore +
    profileScore +
    existingPriorityScore +
    pipelinePenalty +
    rejectedPenalty;
  const score = clamp(rawScore, 0, 100);

  const reasoning = [
    `${evidence.shipmentCount} shipment${evidence.shipmentCount === 1 ? "" : "s"}`,
    evidence.latestShipmentDate ? `${scoreRecencyLabel(evidence.latestShipmentDate)} shipment recency` : "no shipment date",
    evidence.destinationMarket || evidence.destinationPort ? "destination fit present" : "destination fit missing",
    evidence.originCountry || evidence.originPort || evidence.shipFromPort ? "origin fit present" : "origin fit missing",
    evidence.productDescription || evidence.hsCode ? "product/HS fit present" : "product/HS fit missing",
    evidence.searchProfile ? `${evidence.searchProfile.name} profile priority` : "no matched search profile",
    alreadyInPipeline ? "already in pipeline; deprioritized" : "not yet in pipeline"
  ].join("; ");

  return {
    score,
    reasoning
  };
}

function sortCandidates<T extends { candidateScore: number; updatedAt: Date }>(candidates: T[], sort: CandidateFeedSort) {
  return candidates.sort((left, right) => {
    if (sort === "score_asc") {
      return left.candidateScore - right.candidateScore || right.updatedAt.getTime() - left.updatedAt.getTime();
    }

    if (sort === "updated_desc") {
      return right.updatedAt.getTime() - left.updatedAt.getTime() || right.candidateScore - left.candidateScore;
    }

    return right.candidateScore - left.candidateScore || right.updatedAt.getTime() - left.updatedAt.getTime();
  });
}

function asObject(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : {};
}

function readString(value: JsonObject, key: string) {
  const rawValue = value[key];
  return typeof rawValue === "string" && rawValue.trim() ? rawValue.trim() : null;
}

function readNumber(value: JsonObject, key: string) {
  const rawValue = value[key];

  if (typeof rawValue === "number" && Number.isFinite(rawValue)) {
    return rawValue;
  }

  if (typeof rawValue === "string") {
    const parsed = Number(rawValue);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

function firstStringFromRecords(records: Array<{ rawJson: unknown }>, key: string) {
  for (const record of records) {
    const value = readString(asObject(record.rawJson), key);
    if (value) {
      return value;
    }
  }

  return null;
}

function sumNumericRawValues(records: Array<{ rawJson: unknown }>, keys: string[]) {
  return records.reduce((total, record) => {
    const rawJson = asObject(record.rawJson);
    return total + keys.reduce((recordTotal, key) => recordTotal + readNumber(rawJson, key), 0);
  }, 0);
}

function readImportedScoreReasoning(rawJson: JsonObject) {
  const scoreReasoning = asObject(rawJson.scoreReasoning);
  const summary = readString(scoreReasoning, "summary") ?? readString(rawJson, "scoreReasoning");

  if (summary) {
    return summary;
  }

  const reasons = scoreReasoning.reasons;
  return Array.isArray(reasons) ? reasons.filter((reason): reason is string => typeof reason === "string").join("; ") : null;
}

function scoreRecency(latestShipmentDate: Date | null) {
  if (!latestShipmentDate) {
    return 0;
  }

  const ageInDays = (Date.now() - latestShipmentDate.getTime()) / 86_400_000;

  if (ageInDays <= 30) {
    return 20;
  }

  if (ageInDays <= 90) {
    return 12;
  }

  if (ageInDays <= 180) {
    return 6;
  }

  return 0;
}

function scoreRecencyLabel(latestShipmentDate: Date) {
  const ageInDays = (Date.now() - latestShipmentDate.getTime()) / 86_400_000;

  if (ageInDays <= 30) {
    return "recent";
  }

  if (ageInDays <= 90) {
    return "current";
  }

  if (ageInDays <= 180) {
    return "aging";
  }

  return "older";
}

function formatDestination(rawJson: JsonObject, fallbackCity: string | null, fallbackState: string | null) {
  const city = readString(rawJson, "destinationCity") ?? fallbackCity;
  const state = readString(rawJson, "destinationState") ?? fallbackState;

  if (city && state) {
    return `${city}, ${state}`;
  }

  return city ?? state ?? null;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function isMissingSearchProfileTableError(error: unknown) {
  if (!error || typeof error !== "object") {
    return false;
  }

  const code = "code" in error ? error.code : undefined;
  return code === "P2021" || code === "P2022";
}
