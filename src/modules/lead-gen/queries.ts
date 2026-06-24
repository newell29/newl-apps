import {
  ApolloStatus,
  CandidateStatus,
  ContactSource,
  ContactStatus,
  ContactTier,
  ContactOutreachDraftStatus,
  IntegrationProvider,
  JobStatus,
  LeadPipelineStage,
  Prisma,
  ReplyStatus,
  SequenceStatus
} from "@prisma/client";
import { prisma } from "@/server/db";
import { tenantWhere } from "@/server/tenant-query";
import type { TenantContext } from "@/server/tenant-context";
import { scoreContact } from "@/modules/lead-gen/contact-scoring";
import {
  classifyTradeMiningIndustryFromRecords,
  INDUSTRY_OPTIONS
} from "@/modules/lead-gen/industry-classification";
import { defaultTradeMiningCompanyIdentityRoles } from "@/modules/lead-gen/search-profile-validation";
import { recommendSequenceForContact } from "@/modules/lead-gen/sequence-catalog";
import {
  DEFAULT_TRADEMINING_SCORING_SETTINGS,
  type TradeMiningScoringSettings
} from "@/modules/settings/types";
import { mapApolloRepOptions, parseApolloRepMapping } from "@/modules/settings/apollo-rep-mapping";
import {
  buildApolloSequenceMappingsWithDefaults,
  mapApolloSequenceOptions,
  parseApolloSequenceDirectory,
  parseApolloSequenceMapping,
  parseSearchProfileApolloSequenceMapping,
  resolveApolloSequenceMappings
} from "@/modules/settings/apollo-sequence-mapping";
import { isOpenAiDraftGenerationConfigured } from "@/server/integrations/openai";

type SearchProfileDelegate = typeof prisma.tradeMiningSearchProfile;

type SearchProfileClient = typeof prisma & {
  tradeMiningSearchProfile?: SearchProfileDelegate;
};

type LeadPipelineFilterRepOption = {
  value: string;
  label: string;
};

type TradeMiningScoringQueryClient = typeof prisma & {
  tradeMiningScoringConfig?: {
    findUnique(args: { where: { tenantId: string } }): Promise<{
      recentWindowDays: number;
      comparisonWindowDays: number;
      lookbackWindowDays: number;
      momentumWeight: number;
      marketFitWeight: number;
      industryFitWeight: number;
      companySizeWeight: number;
      roleWeight: number;
      confidenceWeight: number;
      workflowWeight: number;
      preferredIndustryKeywords: unknown;
      penalizedIndustryKeywords: unknown;
      preferredHsCodePrefixes: unknown;
      penalizedHsCodePrefixes: unknown;
      oversizeTeuThreshold: { toString(): string } | string | null;
      oversizeShipmentCount30dThreshold: number | null;
      oversizePenalty: number;
      midMarketTeuMin: { toString(): string } | string | null;
      midMarketTeuMax: { toString(): string } | string | null;
      midMarketBoost: number;
      contactDecisionMakerWeight: number;
      contactManagerWeight: number;
      contactLogisticsDepartmentWeight: number;
      contactWeakFunctionPenalty: number;
      contactCompanyContextWeight: number;
      contactEmailWeight: number;
      contactLinkedinWeight: number;
      contactPhoneWeight: number;
      contactPrimaryContactBoost: number;
      contactApprovedStatusBoost: number;
      contactReviewingStatusBoost: number;
      contactTier1Threshold: number;
      contactTier2Threshold: number;
      contactTier3Threshold: number;
      preferredContactTitleKeywords: unknown;
      penalizedContactTitleKeywords: unknown;
      preferredContactDepartments: unknown;
      penalizedContactDepartments: unknown;
      aiClassificationEnabled: boolean;
      aiModel: string | null;
    } | null>;
  };
};

export type CandidateFeedSort =
  | "score_desc"
  | "score_asc"
  | "updated_desc"
  | "shipment_count_desc"
  | "latest_shipment_desc";

export type CandidateFeedFilters = {
  query?: string;
  status?: CandidateStatus | "ACTIVE";
  searchProfileId?: string;
  industry?: string;
  minScore?: number;
  maxScore?: number;
  minShipmentCount?: number;
  sort?: CandidateFeedSort;
};

export type LeadPipelineSort = "score_desc" | "updated_desc" | "approved_desc" | "company_name_asc";

export type LeadPipelineCandidateStatusFilter = CandidateStatus | "ALL";

export type LeadPipelineContactStatusFilter =
  | "ALL"
  | "NOT_ENRICHED"
  | "PRIMARY_SELECTED"
  | "APPROVED"
  | "REVIEWING"
  | "FOUND";

export type LeadPipelineApolloStatusFilter =
  | "ALL"
  | "NOT_STARTED"
  | "QUEUED"
  | "ENRICHED"
  | "NOT_FOUND"
  | "NEEDS_REVIEW";

export type LeadPipelineSequenceStatusFilter =
  | "ALL"
  | "NOT_STARTED"
  | "READY"
  | "ENROLLED"
  | "REPLIED";

export type LeadPipelineFilters = {
  stage?: LeadPipelineStage | "ALL";
  ownerUserId?: string | "ALL" | "UNASSIGNED";
  industry?: string;
  candidateStatus?: LeadPipelineCandidateStatusFilter;
  contactStatus?: LeadPipelineContactStatusFilter;
  apolloStatus?: LeadPipelineApolloStatusFilter;
  sequenceStatus?: LeadPipelineSequenceStatusFilter;
  minShipments30d?: number;
  maxShipments30d?: number;
  minShipments90d?: number;
  maxShipments90d?: number;
  minScore?: number;
  maxScore?: number;
  sort?: LeadPipelineSort;
};

export type ContactDirectorySort = "score_desc" | "updated_desc" | "name_asc";

export type ContactDirectoryFilters = {
  query?: string;
  companyId?: string;
  searchProfileId?: string;
  contactStatus?: ContactStatus | "ALL";
  apolloStatus?: ApolloStatus | "ALL";
  sequenceStatus?: SequenceStatus | "ALL";
  replyStatus?: ReplyStatus | "ALL";
  source?: ContactSource | "ALL";
  contactTier?: ContactTier | "ALL";
  draftStatus?: ContactDraftStatusFilter;
  requiresAiDraft?: ContactBooleanFilter;
  approvedDraft?: ContactBooleanFilter;
  hasSequenceSelected?: ContactBooleanFilter;
  assignedRep?: string | "ALL" | "UNASSIGNED";
  sort?: ContactDirectorySort;
};

export type ContactBooleanFilter = "ALL" | "YES" | "NO";

export type ContactDraftStatusFilter =
  | "ALL"
  | ContactOutreachDraftStatus
  | "DRAFT_REQUIRED"
  | "NO_NEWL_DRAFT"
  | "APOLLO_TEMPLATE_LATER";

type JsonObject = Record<string, unknown>;

type SearchProfileSummary = {
  id: string;
  name: string;
  priorityWeight: number;
  destinationMarkets: string[];
  destinationPorts: string[];
  originPorts: string[];
  shipFromPorts: string[];
  originCountries: string[];
  productKeywords: string[];
  hsCodes: string[];
  contactCadenceConfig: unknown;
};

type CandidateScoringConfig = TradeMiningScoringSettings;

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
  const scoringConfig = await loadTradeMiningScoringConfig(tenant);

  const candidates = companies
    .map((company) => {
      const evidence = summarizeTradeMiningEvidence(company.importRecords, searchProfiles);
      const scoring = scoreCompanyFromEvidence({
        companyPriorityScore: company.priorityScore,
        candidateStatus: company.candidateStatus,
        alreadyInPipeline: company.leads.length > 0,
        evidence,
        config: scoringConfig
      });
      const industry = resolveCompanyIndustry({
        companyName: company.name,
        domain: company.domain,
        primaryIndustry: company.primaryIndustry,
        secondaryIndustry: company.secondaryIndustry,
        industryConfidence: company.industryConfidence,
        industrySource: company.industrySource,
        importRecords: company.importRecords
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
        primaryIndustry: industry.primaryIndustry,
        secondaryIndustry: industry.secondaryIndustry,
        industryConfidence: industry.confidence,
        industrySource: industry.source,
        assignedRep: company.leads[0]?.ownerUserId ?? "Unassigned",
        currentPipelineStage: company.leads[0]?.stage ?? null,
        alreadyInPipeline: company.leads.length > 0,
        createdAt: company.createdAt,
        updatedAt: company.updatedAt
      };
    })
    .filter((candidate) => !filters.searchProfileId || candidate.matchedSearchProfileId === filters.searchProfileId)
    .filter((candidate) => matchesIndustryFilter(candidate.primaryIndustry, candidate.secondaryIndustry, filters.industry))
    .filter((candidate) => isWithinScoreRange(candidate.candidateScore, filters.minScore, filters.maxScore))
    .filter((candidate) => filters.minShipmentCount === undefined || candidate.shipmentCount >= filters.minShipmentCount)
    .filter((candidate) => matchesFoundCompanyQuery(candidate, filters.query));

  return sortCandidates(candidates, filters.sort ?? "score_desc");
}

export async function calculateLeadPipelineScoreForCompany(
  tenant: Pick<TenantContext, "tenantId">,
  companyId: string
) {
  const company = await prisma.company.findFirst({
    where: {
      tenantId: tenant.tenantId,
      id: companyId
    },
    include: {
      importRecords: {
        where: {
          tenantId: tenant.tenantId
        },
        orderBy: [
          {
            arrivalDate: "desc"
          },
          {
            createdAt: "desc"
          }
        ],
        take: 100
      }
    }
  });

  if (!company) {
    return null;
  }

  const scoringConfig = await loadTradeMiningScoringConfig(tenant);
  const searchProfileIds = new Set<string>();

  for (const record of company.importRecords) {
    const searchProfileId = readString(asObject(record.rawJson), "searchProfileId");
    if (searchProfileId) {
      searchProfileIds.add(searchProfileId);
    }
  }

  const searchProfiles = await loadSearchProfileSummaries(tenant, [...searchProfileIds]);
  const evidence = summarizeTradeMiningEvidence(company.importRecords, searchProfiles);

  return scoreCompanyFromEvidence({
    companyPriorityScore: company.priorityScore,
    candidateStatus: company.candidateStatus,
    alreadyInPipeline: false,
    evidence,
    config: scoringConfig
  }).score;
}

export async function getCandidateFeedFilters(tenant: TenantContext) {
  const searchProfileClient = prisma as SearchProfileClient;

  if (!searchProfileClient.tradeMiningSearchProfile) {
    return {
      searchProfiles: [],
      industries: INDUSTRY_OPTIONS
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
    searchProfiles,
    industries: INDUSTRY_OPTIONS
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
    const [profiles, pendingRunRequests] = await Promise.all([
      searchProfileClient.tradeMiningSearchProfile.findMany({
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
      }),
      prisma.automationJobRun.findMany({
        where: tenantWhere(tenant, {
          jobType: "trademining.run_request",
          status: {
            in: [JobStatus.QUEUED, JobStatus.RUNNING]
          }
        }),
        orderBy: {
          createdAt: "desc"
        },
        select: {
          id: true,
          status: true,
          createdAt: true,
          input: true
        }
      })
    ]);

    const pendingRequestByProfileId = new Map<
      string,
      {
        id: string;
        status: string;
        createdAt: Date;
      }
    >();

    for (const request of pendingRunRequests) {
      const profileId = readSearchProfileIdFromJson(request.input);
      if (!profileId || pendingRequestByProfileId.has(profileId)) {
        continue;
      }

      pendingRequestByProfileId.set(profileId, {
        id: request.id,
        status: request.status,
        createdAt: request.createdAt
      });
    }

    return {
      profiles: profiles.map((profile) => ({
        pendingRunRequestId: pendingRequestByProfileId.get(profile.id)?.id ?? null,
        pendingRunStatus: pendingRequestByProfileId.get(profile.id)?.status ?? null,
        pendingRunRequestedAt: pendingRequestByProfileId.get(profile.id)?.createdAt ?? null,
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
        allowedCompanyIdentityRoles: asStringArray(profile.allowedCompanyIdentityRoles ?? defaultTradeMiningCompanyIdentityRoles),
        excludedCompanyKeywords: asStringArray(profile.excludedCompanyKeywords),
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

export async function getTradeMiningSearchProfileSuggestions(tenant: TenantContext) {
  try {
    const [profiles, importRecords] = await Promise.all([
      prisma.tradeMiningSearchProfile.findMany({
        where: tenantWhere(tenant),
        select: {
          destinationMarkets: true,
          destinationPorts: true,
          originPorts: true,
          shipFromPorts: true,
          originCountries: true
        }
      }),
      prisma.tradeMiningImportRecord.findMany({
        where: tenantWhere(tenant),
        select: {
          sourcePort: true,
          originCountry: true,
          destinationCity: true,
          destinationState: true,
          rawJson: true
        },
        orderBy: {
          createdAt: "desc"
        },
        take: 500
      })
    ]);

    const destinationMarkets = new Set<string>();
    const destinationPorts = new Set<string>();
    const originPorts = new Set<string>();
    const shipFromPorts = new Set<string>();
    const originCountries = new Set<string>();

    for (const profile of profiles) {
      for (const value of asStringArray(profile.destinationMarkets)) destinationMarkets.add(value);
      for (const value of asStringArray(profile.destinationPorts)) destinationPorts.add(value);
      for (const value of asStringArray(profile.originPorts)) originPorts.add(value);
      for (const value of asStringArray(profile.shipFromPorts)) shipFromPorts.add(value);
      for (const value of asStringArray(profile.originCountries)) originCountries.add(value);
    }

    for (const record of importRecords) {
      const rawJson = asObject(record.rawJson);
      addSuggestion(
        destinationMarkets,
        readString(rawJson, "destinationMarket") ??
          formatMarket(record.destinationCity, record.destinationState)
      );
      addSuggestion(
        destinationPorts,
        readString(rawJson, "destinationPort") ?? readString(rawJson, "arrivalPort")
      );
      addSuggestion(
        originPorts,
        record.sourcePort ??
          readString(rawJson, "originPort") ??
          readString(rawJson, "foreignPort")
      );
      addSuggestion(
        shipFromPorts,
        readString(rawJson, "shipFromPort") ?? readString(rawJson, "placeOfReceipt")
      );
      addSuggestion(originCountries, record.originCountry ?? readString(rawJson, "originCountry"));
    }

    return {
      destinationMarkets: sortSuggestions(destinationMarkets),
      destinationPorts: sortSuggestions(destinationPorts),
      originPorts: sortSuggestions(originPorts),
      shipFromPorts: sortSuggestions(shipFromPorts),
      originCountries: sortSuggestions(originCountries)
    };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2021") {
      return {
        destinationMarkets: [],
        destinationPorts: [],
        originPorts: [],
        shipFromPorts: [],
        originCountries: []
      };
    }

    throw error;
  }
}

export async function getLeadPipeline(tenant: TenantContext, filters: LeadPipelineFilters = {}) {
  const [repDirectory, scoringConfig] = await Promise.all([
    getLeadPipelineRepDirectory(tenant),
    loadTradeMiningScoringConfig(tenant)
  ]);
  const leads = await prisma.lead.findMany({
    where: tenantWhere(tenant, buildLeadPipelineWhere(filters)),
    include: {
      company: {
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
          contacts: {
            where: tenantWhere(tenant),
            include: {
              outreachDrafts: {
                where: tenantWhere(tenant),
                take: 5
              }
            },
            take: 5
          }
        }
      },
      contact: true
    },
    orderBy: buildLeadPipelineOrder(filters.sort ?? "approved_desc")
  });

  const searchProfileIds = new Set<string>();
  for (const lead of leads) {
    for (const record of lead.company.importRecords) {
      const searchProfileId = readString(asObject(record.rawJson), "searchProfileId");
      if (searchProfileId) {
        searchProfileIds.add(searchProfileId);
      }
    }
  }
  const searchProfiles = await loadSearchProfileSummaries(tenant, [...searchProfileIds]);

  const pipelineLeads = leads.map((lead) => {
    const contacts = lead.company.contacts;
    const evidence = summarizeTradeMiningEvidence(lead.company.importRecords, searchProfiles);
    const scoring = scoreCompanyFromEvidence({
      companyPriorityScore: lead.company.priorityScore,
      candidateStatus: lead.company.candidateStatus,
      alreadyInPipeline: false,
      evidence,
      config: scoringConfig
    });
    const shipmentCount30d = countShipmentsSinceDays(lead.company.importRecords, 30);
    const shipmentCount90d = countShipmentsSinceDays(lead.company.importRecords, 90);
    const contactCount = contacts.length;
    const hasSelectedContact = Boolean(lead.contact);
    const contactStatus = summarizeContactStatus(contacts, hasSelectedContact);
    const apolloStatus = summarizeApolloStatus(contacts, lead.notes);
    const sequenceStatus = summarizeSequenceStatus(contacts);
    const sequenceReadiness = summarizeSequenceReadiness(contacts);
    const industry = resolveCompanyIndustry({
      companyName: lead.company.name,
      domain: lead.company.domain,
      primaryIndustry: lead.company.primaryIndustry,
      secondaryIndustry: lead.company.secondaryIndustry,
      industryConfidence: lead.company.industryConfidence,
      industrySource: lead.company.industrySource,
      importRecords: lead.company.importRecords
    });
    const nextStep = getPipelineNextStep({
      stage: lead.stage,
      contactCount,
      hasSelectedContact,
      apolloStatus
    });
    const latestRecord = lead.company.importRecords[0];
    const latestRawRecord = asObject(latestRecord?.rawJson);
    const selectedOrFirstContact =
      contacts.find((contact) => contact.id === lead.contactId) ??
      contacts.find((contact) => Boolean(contact.linkedinUrl)) ??
      contacts[0];

    return {
      id: lead.id,
      companyId: lead.companyId,
      companyName: lead.company.name,
      normalizedName: lead.company.normalizedName,
      companyDomain: lead.company.domain,
      companyWebsiteUrl: lead.company.domain ? buildCompanyWebsiteUrl(lead.company.domain) : null,
      companyLinkedinUrl: lead.company.linkedinUrl ?? selectedOrFirstContact?.linkedinUrl ?? null,
      contactName: lead.contact?.fullName,
      stage: lead.stage,
      candidateStatus: lead.company.candidateStatus,
      score: scoring.score,
      companyScore: lead.company.priorityScore,
      scoreBreakdown: scoring.breakdown,
      primaryIndustry: industry.primaryIndustry,
      secondaryIndustry: industry.secondaryIndustry,
      industryConfidence: industry.confidence,
      industrySource: industry.source,
      destinationPort:
        readString(latestRawRecord, "destinationPort") ??
        readString(latestRawRecord, "arrivalPort") ??
        readString(latestRawRecord, "destination_port") ??
        readString(latestRawRecord, "arrival_port"),
      originPort:
        latestRecord?.sourcePort ??
        readString(latestRawRecord, "originPort") ??
        readString(latestRawRecord, "foreignPort") ??
        readString(latestRawRecord, "origin_port") ??
        readString(latestRawRecord, "foreign_port"),
      shipFromPort:
        readString(latestRawRecord, "shipFromPort") ??
        readString(latestRawRecord, "placeOfReceipt") ??
        readString(latestRawRecord, "ship_from_port") ??
        readString(latestRawRecord, "place_of_receipt"),
      shipmentCount30d,
      shipmentCount90d,
      ownerUserId: lead.ownerUserId,
      assignedRepValue: lead.ownerUserId,
      assignedRep: lead.ownerUserId ? repDirectory.get(lead.ownerUserId) ?? lead.ownerUserId : "Unassigned",
      contactStatus,
      apolloStatus,
      sequenceStatus,
      sequenceReadiness,
      nextStep,
      notes: lead.notes,
      approvedAt: lead.createdAt,
      updatedAt: lead.updatedAt
    };
  });

  const filteredPipelineLeads = pipelineLeads
    .filter((lead) => matchesLeadPipelineCandidateStatus(lead.candidateStatus, filters.candidateStatus))
    .filter((lead) => matchesLeadPipelineContactStatus(lead.contactStatus, filters.contactStatus))
    .filter((lead) => matchesLeadPipelineApolloStatus(lead.apolloStatus, filters.apolloStatus))
    .filter((lead) => matchesLeadPipelineSequenceStatus(lead.sequenceStatus, filters.sequenceStatus))
    .filter((lead) => matchesIndustryFilter(lead.primaryIndustry, lead.secondaryIndustry, filters.industry))
    .filter((lead) => matchesNumericRange(lead.shipmentCount30d, filters.minShipments30d, filters.maxShipments30d))
    .filter((lead) => matchesNumericRange(lead.shipmentCount90d, filters.minShipments90d, filters.maxShipments90d));

  if (filters.sort === "company_name_asc") {
    return filteredPipelineLeads.sort((left, right) => left.companyName.localeCompare(right.companyName));
  }

  if (filters.sort === "score_desc") {
    return filteredPipelineLeads.sort((left, right) => right.score - left.score || right.updatedAt.getTime() - left.updatedAt.getTime());
  }

  if (filters.sort === "updated_desc") {
    return filteredPipelineLeads.sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime() || right.score - left.score);
  }

  if (filters.sort === "approved_desc") {
    return filteredPipelineLeads.sort((left, right) => right.approvedAt.getTime() - left.approvedAt.getTime() || right.score - left.score);
  }

  return filteredPipelineLeads;
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

  const apolloMappings = await prisma.integrationCredential.findMany({
    where: tenantWhere(tenant, {
      provider: IntegrationProvider.APOLLO
    }),
    orderBy: {
      name: "asc"
    },
    select: {
      publicConfig: true
    }
  });

  const mappedOwners = apolloMappings.flatMap((credential) => parseApolloRepOptions(credential.publicConfig));
  const seen = new Set<string>();
  const mergedOwners: LeadPipelineFilterRepOption[] = [];

  for (const owner of mappedOwners) {
    if (seen.has(owner.value)) {
      continue;
    }

    seen.add(owner.value);
    mergedOwners.push(owner);
  }

  for (const owner of owners.flatMap((item) => (item.ownerUserId ? [item.ownerUserId] : []))) {
    if (seen.has(owner)) {
      continue;
    }

    seen.add(owner);
    mergedOwners.push({
      value: owner,
      label: owner
    });
  }

  return {
    stages: Object.values(LeadPipelineStage),
    owners: mergedOwners,
    industries: INDUSTRY_OPTIONS,
    candidateStatuses: Object.values(CandidateStatus),
    contactStatuses: ["NOT_ENRICHED", "PRIMARY_SELECTED", "APPROVED", "REVIEWING", "FOUND"] satisfies LeadPipelineContactStatusFilter[],
    apolloStatuses: ["NOT_STARTED", "QUEUED", "ENRICHED", "NOT_FOUND", "NEEDS_REVIEW"] satisfies LeadPipelineApolloStatusFilter[],
    sequenceStatuses: ["NOT_STARTED", "READY", "ENROLLED", "REPLIED"] satisfies LeadPipelineSequenceStatusFilter[]
  };
}

async function getLeadPipelineRepDirectory(tenant: TenantContext) {
  const mappings = await prisma.integrationCredential.findMany({
    where: tenantWhere(tenant, {
      provider: IntegrationProvider.APOLLO
    }),
    orderBy: {
      name: "asc"
    },
    select: {
      publicConfig: true
    }
  });

  const directory = new Map<string, string>();

  for (const mapping of mappings) {
    for (const rep of parseApolloRepOptions(mapping.publicConfig)) {
      directory.set(rep.value, rep.label);
    }
  }

  return directory;
}

function parseApolloRepOptions(publicConfig: unknown): LeadPipelineFilterRepOption[] {
  return mapApolloRepOptions(parseApolloRepMapping(publicConfig));
}

export async function getContactDirectory(tenant: TenantContext, filters: ContactDirectoryFilters = {}) {
  const [scoringConfig, apolloCredentials] = await Promise.all([
    loadTradeMiningScoringConfig(tenant),
    prisma.integrationCredential.findMany({
      where: tenantWhere(tenant, {
        provider: IntegrationProvider.APOLLO
      }),
      select: {
        publicConfig: true
      },
      take: 1
    })
  ]);
  const apolloPublicConfig = apolloCredentials[0]?.publicConfig;
  const apolloSequenceDirectory = parseApolloSequenceDirectory(apolloPublicConfig);
  const apolloSequenceMapping = buildApolloSequenceMappingsWithDefaults({
    existingMappings: parseApolloSequenceMapping(apolloPublicConfig),
    directory: apolloSequenceDirectory
  });
  const contacts = await prisma.contact.findMany({
    where: tenantWhere(tenant, buildContactDirectoryWhere(tenant, filters)),
    include: {
      company: {
        select: {
          id: true,
          name: true,
          normalizedName: true,
          priorityScore: true,
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
            take: 25,
            select: {
              rawJson: true,
              arrivalDate: true,
              sourcePort: true,
              destinationCity: true,
              destinationState: true,
              originCountry: true,
              productDescription: true
            }
          },
          leads: {
            where: tenantWhere(tenant),
            select: {
              score: true
            },
            take: 1
          }
        }
      },
      leads: {
        where: tenantWhere(tenant),
        select: {
          id: true
        },
        take: 1
      },
      outreachDrafts: {
        where: tenantWhere(tenant),
        orderBy: {
          updatedAt: "desc"
        },
        take: 1
      }
    },
    orderBy: buildContactDirectoryOrder(filters.sort ?? "score_desc")
  });
  const searchProfileIds = new Set<string>();

  for (const contact of contacts) {
    for (const record of contact.company.importRecords) {
      const searchProfileId = readString(asObject(record.rawJson), "searchProfileId");
      if (searchProfileId) {
        searchProfileIds.add(searchProfileId);
      }
    }
  }

  const searchProfiles = await loadSearchProfileSummaries(tenant, [...searchProfileIds]);

  const mappedContacts = contacts.map((contact) => {
    const evidence = summarizeTradeMiningEvidence(contact.company.importRecords, searchProfiles);
    const scoring = scoreContact({
      fullName: contact.fullName,
      title: contact.title,
      department: contact.department,
      seniority: contact.seniority,
      email: contact.email,
      phone: contact.phone,
      linkedinUrl: contact.linkedinUrl,
      contactStatus: contact.contactStatus,
      replyStatus: contact.replyStatus,
      companyPriorityScore: contact.company.priorityScore,
      companyLeadScore: contact.company.leads[0]?.score ?? null,
      isPrimaryContact: contact.leads.length > 0
    }, scoringConfig);
    const effectiveSequenceMappings = resolveApolloSequenceMappings({
      existingMappings: evidence.searchProfile
        ? parseSearchProfileApolloSequenceMapping(evidence.searchProfile.contactCadenceConfig)
        : apolloSequenceMapping,
      directory: apolloSequenceDirectory
    });
    const recommendation = recommendSequenceForContact({
      contactTier: scoring.tier,
      title: contact.title,
      department: contact.department,
      companyName: contact.company.name,
      sequenceMappings: effectiveSequenceMappings,
      sequenceDirectory: apolloSequenceDirectory
    });
    const draft = contact.outreachDrafts[0] ?? null;
    const tierMapping = effectiveSequenceMappings.find((entry) => entry.tier === scoring.tier) ?? null;
    const requiresAiDraft = tierMapping?.requiresAiDraft ?? false;

    return {
      id: contact.id,
      companyId: contact.companyId,
      companyName: contact.company.name,
      companyNormalizedName: contact.company.normalizedName,
      matchedSearchProfileId: evidence.searchProfile?.id ?? null,
      matchedSearchProfileName: evidence.searchProfile?.name ?? null,
      firstName: contact.firstName,
      lastName: contact.lastName,
      fullName: contact.fullName,
      title: contact.title,
      department: contact.department,
      seniority: contact.seniority,
      email: contact.email,
      phone: contact.phone,
      linkedinUrl: contact.linkedinUrl,
      source: contact.source,
      contactStatus: contact.contactStatus,
      contactScore: scoring.score,
      contactTier: scoring.tier,
      contactScoreSummary: scoring.summary,
      apolloStatus: contact.apolloStatus,
      sequenceStatus: contact.sequenceStatus,
      replyStatus: contact.replyStatus,
      recommendedSequenceId: contact.recommendedSequenceId ?? recommendation.id,
      recommendedSequenceName: contact.recommendedSequenceName ?? recommendation.name,
      selectedSequenceId: contact.selectedSequenceId ?? contact.recommendedSequenceId ?? recommendation.id,
      selectedSequenceName: contact.selectedSequenceName ?? contact.recommendedSequenceName ?? recommendation.name,
      sequenceRecommendationReason: contact.sequenceRecommendationReason ?? recommendation.reason,
      sequenceOverrideReason: contact.sequenceOverrideReason,
      sequenceManuallyOverridden: contact.sequenceManuallyOverridden,
      requiresAiDraft,
      draftGenerationConfigured: isOpenAiDraftGenerationConfigured(),
      draft: draft
        ? {
            id: draft.id,
            sequenceName: draft.sequenceName,
            sequenceId: draft.sequenceId,
            subject: draft.subject,
            body: draft.body,
            status: draft.status,
            source: draft.source,
            aiGenerated: draft.aiGenerated,
            personalizationNotes: draft.personalizationNotes,
            editedAt: draft.editedAt,
            updatedAt: draft.updatedAt
          }
        : null,
      draftStatus: readDraftStatus(scoring.tier, draft?.status ?? null, requiresAiDraft),
      lastTouchAt: contact.lastTouchAt,
      lastReplyAt: contact.lastReplyAt,
      assignedRep: contact.assignedRep ?? "Unassigned",
      updatedAt: contact.updatedAt
    };
  });

  const filteredContacts = mappedContacts.filter((contact) => {
    if (filters.searchProfileId && contact.matchedSearchProfileId !== filters.searchProfileId) {
      return false;
    }

    if (filters.contactTier !== "ALL" && filters.contactTier && contact.contactTier !== filters.contactTier) {
      return false;
    }

    if (!matchesBooleanFilter(filters.requiresAiDraft, contact.requiresAiDraft)) {
      return false;
    }

    if (!matchesBooleanFilter(filters.approvedDraft, contact.draft?.status === ContactOutreachDraftStatus.APPROVED)) {
      return false;
    }

    if (!matchesBooleanFilter(filters.hasSequenceSelected, Boolean(contact.selectedSequenceId || contact.selectedSequenceName))) {
      return false;
    }

    if (!matchesDraftStatusFilter(filters.draftStatus, contact.draftStatus)) {
      return false;
    }

    return true;
  });

  if (filters.sort === "name_asc") {
    return filteredContacts.sort((left, right) => left.fullName.localeCompare(right.fullName));
  }

  if (filters.sort === "updated_desc") {
    return filteredContacts.sort(
      (left, right) => right.updatedAt.getTime() - left.updatedAt.getTime() || right.contactScore - left.contactScore
    );
  }

  return filteredContacts.sort(
    (left, right) => right.contactScore - left.contactScore || right.updatedAt.getTime() - left.updatedAt.getTime()
  );
}

export async function getContactDirectoryFilters(tenant: TenantContext) {
  const [pipelineAccounts, owners, approvedAccountCount, apolloCredentials, searchProfiles] = await Promise.all([
    prisma.lead.findMany({
      where: tenantWhere(tenant),
      distinct: ["companyId"],
      select: {
        company: {
          select: {
            id: true,
            name: true
          }
        }
      },
      orderBy: {
        createdAt: "desc"
      }
    }),
    prisma.contact.findMany({
      where: tenantWhere(tenant, {
        assignedRep: {
          not: null
        },
        company: {
          leads: {
            some: tenantWhere(tenant)
          }
        }
      }),
      distinct: ["assignedRep"],
      select: {
        assignedRep: true
      },
      orderBy: {
        assignedRep: "asc"
      }
    }),
    prisma.lead.count({
      where: tenantWhere(tenant)
    }),
    prisma.integrationCredential.findMany({
      where: tenantWhere(tenant, {
        provider: IntegrationProvider.APOLLO
      }),
      select: {
        publicConfig: true
      },
      take: 1
    }),
    prisma.tradeMiningSearchProfile.findMany({
      where: tenantWhere(tenant, {
        enabled: true
      }),
      select: {
        id: true,
        name: true
      },
      orderBy: {
        name: "asc"
      }
    })
  ]);
  const sequenceOptions = mapApolloSequenceOptions(parseApolloSequenceDirectory(apolloCredentials[0]?.publicConfig));

  return {
    companies: pipelineAccounts.map((lead) => lead.company),
    searchProfiles,
    owners: owners.flatMap((owner) => (owner.assignedRep ? [owner.assignedRep] : [])),
    approvedAccountCount,
    contactStatuses: Object.values(ContactStatus),
    apolloStatuses: Object.values(ApolloStatus),
    sequenceStatuses: Object.values(SequenceStatus),
    replyStatuses: Object.values(ReplyStatus),
    sources: Object.values(ContactSource),
    contactTiers: Object.values(ContactTier),
    draftStatuses: [
      "DRAFT_REQUIRED",
      "NO_NEWL_DRAFT",
      "APOLLO_TEMPLATE_LATER",
      ...Object.values(ContactOutreachDraftStatus)
    ] satisfies ContactDraftStatusFilter[],
    booleanFilterOptions: ["YES", "NO"] satisfies Exclude<ContactBooleanFilter, "ALL">[],
    sequenceOptions
  };
}

function asStringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function addSuggestion(set: Set<string>, value: string | null | undefined) {
  if (!value) {
    return;
  }

  const normalized = value.trim();
  if (normalized.length > 0) {
    set.add(normalized);
  }
}

function formatMarket(city: string | null, state: string | null) {
  if (city && state) {
    return `${city}, ${state}`;
  }

  return city ?? state ?? null;
}

function sortSuggestions(values: Set<string>) {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function buildContactDirectoryWhere(tenant: TenantContext, filters: ContactDirectoryFilters) {
  const where: Prisma.ContactWhereInput = {
    assignedRep: {
      not: null
    },
    company: {
      leads: {
        some: tenantWhere(tenant)
      }
    }
  };

  if (filters.query?.trim()) {
    const query = filters.query.trim();
    where.OR = [
      {
        fullName: {
          contains: query,
          mode: "insensitive"
        }
      },
      {
        title: {
          contains: query,
          mode: "insensitive"
        }
      },
      {
        email: {
          contains: query,
          mode: "insensitive"
        }
      },
      {
        company: {
          name: {
            contains: query,
            mode: "insensitive"
          }
        }
      }
    ];
  }

  if (filters.companyId) {
    where.companyId = filters.companyId;
  }

  if (filters.contactStatus && filters.contactStatus !== "ALL") {
    where.contactStatus = filters.contactStatus;
  }

  if (filters.apolloStatus && filters.apolloStatus !== "ALL") {
    where.apolloStatus = filters.apolloStatus;
  }

  if (filters.sequenceStatus && filters.sequenceStatus !== "ALL") {
    where.sequenceStatus = filters.sequenceStatus;
  }

  if (filters.replyStatus && filters.replyStatus !== "ALL") {
    where.replyStatus = filters.replyStatus;
  }

  if (filters.source && filters.source !== "ALL") {
    where.source = filters.source;
  }

  if (filters.assignedRep === "UNASSIGNED") {
    where.assignedRep = null;
  } else if (filters.assignedRep && filters.assignedRep !== "ALL") {
    where.assignedRep = filters.assignedRep;
  }

  return where;
}

function buildContactDirectoryOrder(sort: ContactDirectorySort) {
  if (sort === "updated_desc") {
    return [
      {
        updatedAt: "desc" as const
      },
      {
        contactScore: "desc" as const
      }
    ];
  }

  if (sort === "name_asc") {
    return [
      {
        updatedAt: "desc" as const
      }
    ];
  }

  return [
    {
      contactScore: "desc" as const
    },
    {
      updatedAt: "desc" as const
    }
  ];
}

function buildLeadPipelineWhere(filters: LeadPipelineFilters) {
  const where: {
    stage?: LeadPipelineStage;
    ownerUserId?: string | null;
    score?: {
      gte?: number;
      lte?: number;
    };
  } = {};

  if (filters.stage && filters.stage !== "ALL") {
    where.stage = filters.stage;
  }

  if (filters.ownerUserId === "UNASSIGNED") {
    where.ownerUserId = null;
  } else if (filters.ownerUserId && filters.ownerUserId !== "ALL") {
    where.ownerUserId = filters.ownerUserId;
  }

  if (filters.minScore !== undefined || filters.maxScore !== undefined) {
    where.score = {
      ...(filters.minScore !== undefined ? { gte: filters.minScore } : {}),
      ...(filters.maxScore !== undefined ? { lte: filters.maxScore } : {})
    };
  }

  return where;
}

function buildLeadPipelineOrder(sort: LeadPipelineSort) {
  if (sort === "company_name_asc") {
    return [
      {
        createdAt: "desc" as const
      }
    ];
  }

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

function isWithinScoreRange(score: number, minScore: number | undefined, maxScore: number | undefined) {
  if (minScore !== undefined && score < minScore) {
    return false;
  }

  if (maxScore !== undefined && score > maxScore) {
    return false;
  }

  return true;
}

function summarizeContactStatus(
  contacts: Array<{ contactStatus: ContactStatus }>,
  hasSelectedContact: boolean
) {
  if (contacts.length === 0) {
    return "Not enriched";
  }

  if (hasSelectedContact) {
    return "Primary contact selected";
  }

  const approvedCount = contacts.filter((contact) => contact.contactStatus === ContactStatus.APPROVED).length;
  const reviewingCount = contacts.filter((contact) => contact.contactStatus === ContactStatus.REVIEWING).length;

  if (approvedCount > 0) {
    return `${approvedCount} approved contact${approvedCount === 1 ? "" : "s"}`;
  }

  if (reviewingCount > 0) {
    return `${reviewingCount} in review`;
  }

  return `${contacts.length} contact${contacts.length === 1 ? "" : "s"} found`;
}

function summarizeApolloStatus(contacts: Array<{ apolloStatus: ApolloStatus }>, notes?: string | null) {
  if (notes?.includes("Apollo enrichment completed with no contacts")) {
    return "Not found";
  }

  if (notes?.includes("Apollo enrichment completed on")) {
    return "Enriched";
  }

  if (notes?.includes("Apollo enrichment requested on")) {
    return "Queued";
  }

  if (contacts.length === 0) {
    return "Not started";
  }

  if (contacts.some((contact) => contact.apolloStatus === ApolloStatus.ERROR)) {
    return "Needs review";
  }

  if (contacts.some((contact) => contact.apolloStatus === ApolloStatus.ENRICHED)) {
    return "Enriched";
  }

  if (contacts.every((contact) => contact.apolloStatus === ApolloStatus.NOT_FOUND)) {
    return "Not found";
  }

  return "Not started";
}

function summarizeSequenceStatus(contacts: Array<{ sequenceStatus: SequenceStatus }>) {
  if (contacts.length === 0) {
    return "Not started";
  }

  if (contacts.some((contact) => contact.sequenceStatus === SequenceStatus.ENROLLED)) {
    return "Enrolled";
  }

  if (contacts.some((contact) => contact.sequenceStatus === SequenceStatus.READY)) {
    return "Ready";
  }

  if (contacts.some((contact) => contact.sequenceStatus === SequenceStatus.REPLIED)) {
    return "Replied";
  }

  return "Not started";
}

function summarizeSequenceReadiness(
  contacts: Array<{
    selectedSequenceName: string | null;
    recommendedSequenceName: string | null;
    sequenceManuallyOverridden: boolean;
    contactTier: ContactTier;
    outreachDrafts: Array<{ status: ContactOutreachDraftStatus }>;
  }>
) {
  if (contacts.length === 0) {
    return "No contacts yet";
  }

  const selectedCount = contacts.filter((contact) => contact.selectedSequenceName || contact.recommendedSequenceName).length;
  const draftCount = contacts.filter(
    (contact) => contact.contactTier === ContactTier.TIER_1 && contact.outreachDrafts.length > 0
  ).length;
  const overriddenCount = contacts.filter((contact) => contact.sequenceManuallyOverridden).length;

  return [
    `${selectedCount} with selected cadence`,
    `${draftCount} Tier 1 draft${draftCount === 1 ? "" : "s"}`,
    overriddenCount > 0 ? `${overriddenCount} override${overriddenCount === 1 ? "" : "s"}` : null
  ]
    .filter(Boolean)
    .join("; ");
}

function matchesLeadPipelineCandidateStatus(
  candidateStatus: CandidateStatus,
  filter: LeadPipelineCandidateStatusFilter | undefined
) {
  return !filter || filter === "ALL" ? true : candidateStatus === filter;
}

function matchesLeadPipelineContactStatus(
  contactStatus: string,
  filter: LeadPipelineContactStatusFilter | undefined
) {
  if (!filter || filter === "ALL") {
    return true;
  }

  if (filter === "NOT_ENRICHED") {
    return contactStatus === "Not enriched";
  }

  if (filter === "PRIMARY_SELECTED") {
    return contactStatus === "Primary contact selected";
  }

  if (filter === "APPROVED") {
    return contactStatus.includes("approved contact");
  }

  if (filter === "REVIEWING") {
    return contactStatus.includes("in review");
  }

  if (filter === "FOUND") {
    return contactStatus.includes("contact") && contactStatus.includes("found");
  }

  return true;
}

function matchesLeadPipelineApolloStatus(
  apolloStatus: string,
  filter: LeadPipelineApolloStatusFilter | undefined
) {
  if (!filter || filter === "ALL") {
    return true;
  }

  return apolloStatus.toLowerCase() === filter.replaceAll("_", " ").toLowerCase();
}

function matchesLeadPipelineSequenceStatus(
  sequenceStatus: string,
  filter: LeadPipelineSequenceStatusFilter | undefined
) {
  if (!filter || filter === "ALL") {
    return true;
  }

  return sequenceStatus.toLowerCase() === filter.replaceAll("_", " ").toLowerCase();
}

function matchesNumericRange(value: number, min: number | undefined, max: number | undefined) {
  if (min !== undefined && value < min) {
    return false;
  }

  if (max !== undefined && value > max) {
    return false;
  }

  return true;
}

function matchesIndustryFilter(
  primaryIndustry: string | null | undefined,
  secondaryIndustry: string | null | undefined,
  filter: string | undefined
) {
  if (!filter) {
    return true;
  }

  return primaryIndustry === filter || secondaryIndustry === filter;
}

function countShipmentsSinceDays(
  records: Array<{
    arrivalDate: Date | null;
    createdAt: Date;
  }>,
  days: number
) {
  const threshold = new Date();
  threshold.setDate(threshold.getDate() - days);

  return records.filter((record) => {
    const basisDate = record.arrivalDate ?? record.createdAt;
    return basisDate >= threshold;
  }).length;
}

function readDraftStatus(
  contactTier: ContactTier,
  status: ContactOutreachDraftStatus | null,
  requiresAiDraft: boolean
) {
  if (status) {
    return status;
  }

  if (requiresAiDraft) {
    return "Draft required";
  }

  if (contactTier === ContactTier.TIER_1) {
    return "No Newl draft";
  }

  return "Apollo/template later";
}

function matchesBooleanFilter(filter: ContactBooleanFilter | undefined, value: boolean) {
  if (!filter || filter === "ALL") {
    return true;
  }

  return filter === "YES" ? value : !value;
}

function matchesDraftStatusFilter(filter: ContactDraftStatusFilter | undefined, draftStatus: string) {
  if (!filter || filter === "ALL") {
    return true;
  }

  return normalizeDraftStatusFilterValue(filter) === normalizeDraftStatusFilterValue(draftStatus);
}

function normalizeDraftStatusFilterValue(value: string) {
  if (value === "Draft required") {
    return "DRAFT_REQUIRED";
  }

  if (value === "No Newl draft") {
    return "NO_NEWL_DRAFT";
  }

  if (value === "Apollo/template later") {
    return "APOLLO_TEMPLATE_LATER";
  }

  return value;
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

  if (apolloStatus === "Not started") {
    return "Ready for Apollo enrichment";
  }

  if (apolloStatus === "Queued") {
    return "Await Apollo enrichment results";
  }

  return "Research account fit";
}

function buildCompanyWebsiteUrl(domain: string) {
  const trimmed = domain.trim();
  if (!trimmed) {
    return null;
  }

  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return trimmed;
  }

  return `https://${trimmed}`;
}

function buildCandidateWhere(filters: CandidateFeedFilters) {
  if (!filters.status || filters.status === "ACTIVE") {
    return {
      candidateStatus: {
        in: [CandidateStatus.NEW, CandidateStatus.REVIEWING]
      }
    };
  }

  return {
    candidateStatus: filters.status
  };
}

async function loadSearchProfileSummaries(tenant: Pick<TenantContext, "tenantId">, searchProfileIds: string[]) {
  if (searchProfileIds.length === 0) {
    return new Map<string, SearchProfileSummary>();
  }

  const searchProfileClient = prisma as SearchProfileClient;

  if (!searchProfileClient.tradeMiningSearchProfile) {
    return new Map<string, SearchProfileSummary>();
  }

  const profiles = await searchProfileClient.tradeMiningSearchProfile.findMany({
    where: {
      tenantId: tenant.tenantId,
      id: {
        in: searchProfileIds
      }
    },
    select: {
      id: true,
      name: true,
      priorityWeight: true,
      destinationMarkets: true,
      destinationPorts: true,
      originPorts: true,
      shipFromPorts: true,
      originCountries: true,
      productKeywords: true,
      hsCodes: true,
      contactCadenceConfig: true
    }
  });

  return new Map(
    profiles.map((profile) => [
      profile.id,
      {
        id: profile.id,
        name: profile.name,
        priorityWeight: profile.priorityWeight,
        destinationMarkets: asStringArray(profile.destinationMarkets),
        destinationPorts: asStringArray(profile.destinationPorts),
        originPorts: asStringArray(profile.originPorts),
        shipFromPorts: asStringArray(profile.shipFromPorts),
        originCountries: asStringArray(profile.originCountries),
        productKeywords: asStringArray(profile.productKeywords),
        hsCodes: asStringArray(profile.hsCodes),
        contactCadenceConfig: profile.contactCadenceConfig
      }
    ])
  );
}

export function summarizeTradeMiningEvidence(
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

  const containerCount = sumNumericRawValues(importRecords, ["containerCount", "container_count", "containers", "shipmentVolume"]);
  const shipmentWeight = sumNumericRawValues(importRecords, ["weight", "weightKg", "shipmentWeight"]);
  const totalTeu = sumNumericRawValues(importRecords, ["teu"]);
  const totalQuantity = sumNumericRawValues(importRecords, ["quantity"]);
  const destinationCity = latestRecord?.destinationCity ?? firstStringFromRecords(importRecords, "destinationCity");
  const destinationState = latestRecord?.destinationState ?? firstStringFromRecords(importRecords, "destinationState");
  const destinationZip = firstStringFromRecords(importRecords, "destinationZip");
  const destinationPort = firstStringFromRecords(importRecords, "destinationPort") ?? firstStringFromRecords(importRecords, "arrivalPort");
  const destinationMarket =
    firstStringFromRecords(importRecords, "destinationMarket") ??
    formatDestination(latestRawJson, destinationCity ?? null, destinationState ?? null);
  const originCountry = latestRecord?.originCountry ?? firstStringFromRecords(importRecords, "originCountry");
  const originPort = latestRecord?.sourcePort ?? firstStringFromRecords(importRecords, "originPort");
  const foreignPort = firstStringFromRecords(importRecords, "foreignPort");
  const shipFromPort = firstStringFromRecords(importRecords, "shipFromPort");
  const placeOfReceipt = firstStringFromRecords(importRecords, "placeOfReceipt");
  const productDescription = latestRecord?.productDescription ?? firstStringFromRecords(importRecords, "productDescription");
  const hsCode = firstStringFromRecords(importRecords, "hsCode");
  const sourceRole = firstStringFromRecords(importRecords, "sourceRole");
  const companyMatchName = firstStringFromRecords(importRecords, "companyMatchName");
  const carrier = firstStringFromRecords(importRecords, "carrier");
  const vessel = firstStringFromRecords(importRecords, "vessel");
  const voyage = firstStringFromRecords(importRecords, "voyage");
  const searchProfile = searchProfileId ? searchProfiles.get(searchProfileId) ?? null : null;
  const profileFit = scoreProfileFit({
    destinationMarket,
    destinationPort,
    destinationCity,
    destinationState,
    originCountry,
    originPort,
    foreignPort,
    shipFromPort,
    placeOfReceipt,
    productDescription,
    hsCode,
    searchProfile
  });

  return {
    shipmentCount: importRecords.length,
    latestShipmentDate: latestRecord?.arrivalDate ?? null,
    searchProfile,
    destinationMarket,
    destinationPort,
    destinationCity,
    destinationState,
    destinationZip,
    originCountry,
    originPort,
    foreignPort,
    shipFromPort,
    placeOfReceipt,
    productDescription,
    hsCode,
    sourceRole,
    companyMatchName,
    carrier,
    vessel,
    voyage,
    containerCount,
    totalTeu,
    shipmentWeight,
    totalQuantity,
    activity: importRecords.map((record) => ({
      arrivalDate: record.arrivalDate,
      teu: readNumericRawValue(asObject(record.rawJson), ["teu"]),
      containerCount: readNumericRawValue(asObject(record.rawJson), [
        "containerCount",
        "container_count",
        "containers",
        "shipmentVolume"
      ]),
      shipmentWeight: readNumericRawValue(asObject(record.rawJson), ["weight", "weightKg", "shipmentWeight"])
    })),
    profileFit,
    importedScoreReasoning: readImportedScoreReasoning(latestRawJson)
  };
}

export function scoreCandidate({
  companyPriorityScore,
  candidateStatus,
  alreadyInPipeline,
  evidence,
  config = DEFAULT_TRADEMINING_SCORING_SETTINGS
}: {
  companyPriorityScore: number;
  candidateStatus: CandidateStatus;
  alreadyInPipeline: boolean;
  evidence: ReturnType<typeof summarizeTradeMiningEvidence>;
  config?: CandidateScoringConfig;
}) {
  const normalizedConfig = normalizeScoringConfig(config);
  const momentumScore = scoreMomentum(evidence, normalizedConfig);
  const marketFitScore = scoreMarketFit(evidence, normalizedConfig);
  const industryFitScore = scoreIndustryFit(evidence, normalizedConfig);
  const companySizeScore = scoreCompanySize(evidence, normalizedConfig);
  const roleScore = scaleScore(scoreRole(evidence.sourceRole), 14, normalizedConfig.roleWeight);
  const confidenceScore = scoreConfidence(evidence, normalizedConfig);
  const workflowScore = scoreWorkflow({
    companyPriorityScore,
    alreadyInPipeline,
    weight: normalizedConfig.workflowWeight
  });
  const rejectedPenalty =
    candidateStatus === CandidateStatus.REJECTED || candidateStatus === CandidateStatus.DISQUALIFIED ? -100 : 0;
  const rawScore =
    momentumScore +
    marketFitScore +
    industryFitScore +
    companySizeScore +
    roleScore +
    confidenceScore +
    workflowScore +
    rejectedPenalty;
  const score = clamp(rawScore, 0, 100);

  const reasoning = [
    describeMomentum(evidence, normalizedConfig),
    describeMarketFit(evidence, normalizedConfig),
    describeIndustryFit(evidence, normalizedConfig),
    describeCompanySize(evidence, normalizedConfig),
    evidence.sourceRole ? `${formatSourceRole(evidence.sourceRole)} role` : "no source role",
    `${Math.round(confidenceScore)}/${normalizedConfig.confidenceWeight} data confidence`,
    alreadyInPipeline ? "already in pipeline; deprioritized" : "not yet in pipeline"
  ].join("; ");

  const breakdown = {
    total: score,
    matchedSearchProfileName: evidence.searchProfile?.name ?? "No matched profile",
    sourceRole: evidence.sourceRole ? formatSourceRole(evidence.sourceRole) : "No source role",
    importedScoreReasoning: evidence.importedScoreReasoning,
    components: [
      {
        key: "momentum",
        label: "Momentum",
        points: momentumScore,
        maxPoints: normalizedConfig.momentumWeight,
        detail: describeMomentum(evidence, normalizedConfig)
      },
      {
        key: "market_fit",
        label: "Market fit",
        points: marketFitScore,
        maxPoints: normalizedConfig.marketFitWeight,
        detail: describeMarketFit(evidence, normalizedConfig)
      },
      {
        key: "industry_fit",
        label: "Industry fit",
        points: industryFitScore,
        maxPoints: normalizedConfig.industryFitWeight,
        detail: describeIndustryFit(evidence, normalizedConfig)
      },
      {
        key: "company_size",
        label: "Company size",
        points: companySizeScore,
        maxPoints: normalizedConfig.companySizeWeight,
        detail: describeCompanySize(evidence, normalizedConfig)
      },
      {
        key: "role",
        label: "Company identity role",
        points: roleScore,
        maxPoints: normalizedConfig.roleWeight,
        detail: evidence.sourceRole ? `${formatSourceRole(evidence.sourceRole)} role matched` : "No company identity role matched"
      },
      {
        key: "confidence",
        label: "Data confidence",
        points: confidenceScore,
        maxPoints: normalizedConfig.confidenceWeight,
        detail: `${[
          evidence.destinationMarket,
          evidence.destinationPort,
          evidence.originCountry,
          evidence.originPort,
          evidence.productDescription,
          evidence.hsCode,
          evidence.sourceRole,
          evidence.companyMatchName
        ].filter(Boolean).length}/8 key signals present`
      },
      {
        key: "workflow",
        label: "Workflow signal",
        points: workflowScore,
        maxPoints: normalizedConfig.workflowWeight,
        detail: alreadyInPipeline
          ? "Already in pipeline, so workflow score is reduced"
          : `Base company signal ${companyPriorityScore} contributes here`
      }
    ],
    settingsSnapshot: {
      recentWindowDays: normalizedConfig.recentWindowDays,
      comparisonWindowDays: normalizedConfig.comparisonWindowDays,
      momentumWeight: normalizedConfig.momentumWeight,
      marketFitWeight: normalizedConfig.marketFitWeight,
      industryFitWeight: normalizedConfig.industryFitWeight,
      companySizeWeight: normalizedConfig.companySizeWeight,
      roleWeight: normalizedConfig.roleWeight,
      confidenceWeight: normalizedConfig.confidenceWeight,
      workflowWeight: normalizedConfig.workflowWeight
    }
  };

  return {
    score,
    reasoning,
    breakdown
  };
}

function scoreCompanyFromEvidence({
  companyPriorityScore,
  candidateStatus,
  alreadyInPipeline,
  evidence,
  config
}: {
  companyPriorityScore: number;
  candidateStatus: CandidateStatus;
  alreadyInPipeline: boolean;
  evidence: ReturnType<typeof summarizeTradeMiningEvidence>;
  config: CandidateScoringConfig;
}) {
  return scoreCandidate({
    companyPriorityScore,
    candidateStatus,
    alreadyInPipeline,
    evidence,
    config
  });
}

function matchesFoundCompanyQuery(
  candidate: {
    companyName: string;
    normalizedName: string;
    domain: string | null;
    source: string | null;
    matchedSearchProfileName: string;
    destinationMarket: string | null;
    destinationPort: string | null;
    originCountry: string | null;
    originPort: string | null;
    shipFromPort: string | null;
    productDescription: string | null;
    hsCode: string | null;
    primaryIndustry: string | null;
    secondaryIndustry: string | null;
  },
  query: string | undefined
) {
  const normalizedQuery = query?.trim().toLowerCase();

  if (!normalizedQuery) {
    return true;
  }

  return [
    candidate.companyName,
    candidate.normalizedName,
    candidate.domain,
    candidate.source,
    candidate.matchedSearchProfileName,
    candidate.destinationMarket,
    candidate.destinationPort,
    candidate.originCountry,
    candidate.originPort,
    candidate.shipFromPort,
    candidate.productDescription,
    candidate.hsCode,
    candidate.primaryIndustry,
    candidate.secondaryIndustry
  ]
    .filter((value): value is string => Boolean(value))
    .some((value) => value.toLowerCase().includes(normalizedQuery));
}

function resolveCompanyIndustry({
  companyName,
  domain,
  primaryIndustry,
  secondaryIndustry,
  industryConfidence,
  industrySource,
  importRecords
}: {
  companyName: string;
  domain: string | null;
  primaryIndustry: string | null;
  secondaryIndustry: string | null;
  industryConfidence: number | null;
  industrySource: string | null;
  importRecords: Array<{
    productDescription: string | null;
    rawJson: unknown;
  }>;
}) {
  if (primaryIndustry) {
    return {
      primaryIndustry,
      secondaryIndustry,
      confidence: industryConfidence ?? 0,
      source: industrySource
    };
  }

  const classified = classifyTradeMiningIndustryFromRecords(
    importRecords.map((record) => {
      const rawJson = asObject(record.rawJson);
      return {
        productDescription: record.productDescription ?? readString(rawJson, "productDescription"),
        hsCode: readString(rawJson, "hsCode"),
        companyName,
        domain
      };
    })
  );

  return {
    primaryIndustry: classified.primaryIndustry,
    secondaryIndustry: classified.secondaryIndustry,
    confidence: classified.confidence,
    source: classified.source === "UNKNOWN" ? null : classified.source
  };
}

function sortCandidates<T extends { candidateScore: number; updatedAt: Date; shipmentCount: number; latestShipmentDate: Date | null }>(
  candidates: T[],
  sort: CandidateFeedSort
) {
  return candidates.sort((left, right) => {
    if (sort === "score_asc") {
      return left.candidateScore - right.candidateScore || right.updatedAt.getTime() - left.updatedAt.getTime();
    }

    if (sort === "shipment_count_desc") {
      return right.shipmentCount - left.shipmentCount || right.candidateScore - left.candidateScore;
    }

    if (sort === "latest_shipment_desc") {
      return (
        (right.latestShipmentDate?.getTime() ?? 0) - (left.latestShipmentDate?.getTime() ?? 0) ||
        right.candidateScore - left.candidateScore
      );
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

function readSearchProfileIdFromJson(value: unknown) {
  const object = asObject(value);
  const field = object.searchProfileId;
  return typeof field === "string" && field.trim().length > 0 ? field : null;
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

function readNumericRawValue(value: JsonObject, keys: string[]) {
  return keys.reduce((total, key) => total + readNumber(value, key), 0);
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
    return total + readNumericRawValue(rawJson, keys);
  }, 0);
}

function scoreProfileFit({
  destinationMarket,
  destinationPort,
  destinationCity,
  destinationState,
  originCountry,
  originPort,
  foreignPort,
  shipFromPort,
  placeOfReceipt,
  productDescription,
  hsCode,
  searchProfile
}: {
  destinationMarket: string | null;
  destinationPort: string | null;
  destinationCity: string | null;
  destinationState: string | null;
  originCountry: string | null;
  originPort: string | null;
  foreignPort: string | null;
  shipFromPort: string | null;
  placeOfReceipt: string | null;
  productDescription: string | null;
  hsCode: string | null;
  searchProfile: SearchProfileSummary | null;
}) {
  if (!searchProfile) {
    return {
      destination: destinationMarket || destinationPort ? 4 : 0,
      origin: originCountry || originPort || foreignPort || shipFromPort || placeOfReceipt ? 3 : 0,
      product: productDescription || hsCode ? 3 : 0
    };
  }

  const destinationSignals = [destinationMarket, destinationPort, destinationCity, destinationState].filter(
    (value): value is string => Boolean(value)
  );
  const originSignals = [originCountry, originPort, foreignPort, shipFromPort, placeOfReceipt].filter(
    (value): value is string => Boolean(value)
  );
  const destinationMatched = destinationSignals.some(
    (signal) =>
      matchesProfileValue(searchProfile.destinationMarkets, signal) ||
      matchesProfileValue(searchProfile.destinationPorts, signal)
  );
  const originMatched = originSignals.some(
    (signal) =>
      matchesProfileValue(searchProfile.originCountries, signal) ||
      matchesProfileValue(searchProfile.originPorts, signal) ||
      matchesProfileValue(searchProfile.shipFromPorts, signal)
  );
  const productMatched =
    (hsCode ? matchesHsCode(searchProfile.hsCodes, hsCode) : false) ||
    (productDescription ? matchesKeyword(searchProfile.productKeywords, productDescription) : false);

  return {
    destination: destinationMatched ? 12 : destinationSignals.length > 0 ? 4 : 0,
    origin: originMatched ? 8 : originSignals.length > 0 ? 3 : 0,
    product: productMatched ? 10 : productDescription || hsCode ? 3 : 0
  };
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

function scoreRole(sourceRole: string | null) {
  switch (sourceRole) {
    case "consignee_name":
      return 14;
    case "importer_name":
      return 12;
    case "notify_party":
      return 11;
    case "master_consignee_name":
      return 9;
    case "shipper_name":
      return 4;
    case "master_shipper_name":
      return 2;
    default:
      return 0;
  }
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

async function loadTradeMiningScoringConfig(tenant: Pick<TenantContext, "tenantId">) {
  const tradeMiningScoringClient = prisma as TradeMiningScoringQueryClient;

  try {
    const config =
      (await tradeMiningScoringClient.tradeMiningScoringConfig?.findUnique({
        where: {
          tenantId: tenant.tenantId
        }
      })) ?? null;

    if (!config) {
      return normalizeScoringConfig(DEFAULT_TRADEMINING_SCORING_SETTINGS);
    }

    return normalizeScoringConfig(config);
  } catch (error) {
    if (isMissingSearchProfileTableError(error)) {
      return normalizeScoringConfig(DEFAULT_TRADEMINING_SCORING_SETTINGS);
    }

    throw error;
  }
}

function normalizeScoringConfig(
  config:
    | CandidateScoringConfig
    | {
        recentWindowDays: number;
        comparisonWindowDays: number;
        lookbackWindowDays: number;
        momentumWeight: number;
        marketFitWeight: number;
        industryFitWeight: number;
        companySizeWeight: number;
        roleWeight: number;
        confidenceWeight: number;
        workflowWeight: number;
        preferredOriginCountries: unknown;
        penalizedOriginCountries: unknown;
        preferredOriginPorts: unknown;
        penalizedOriginPorts: unknown;
        preferredDestinationMarkets: unknown;
        penalizedDestinationMarkets: unknown;
        preferredIndustryKeywords: unknown;
        penalizedIndustryKeywords: unknown;
        preferredHsCodePrefixes: unknown;
        penalizedHsCodePrefixes: unknown;
        oversizeTeuThreshold: { toString(): string } | string | null;
        oversizeShipmentCount30dThreshold: number | null;
        oversizePenalty: number;
        midMarketTeuMin: { toString(): string } | string | null;
        midMarketTeuMax: { toString(): string } | string | null;
        midMarketBoost: number;
        contactDecisionMakerWeight: number;
        contactManagerWeight: number;
        contactLogisticsDepartmentWeight: number;
        contactWeakFunctionPenalty: number;
        contactCompanyContextWeight: number;
        contactEmailWeight: number;
        contactLinkedinWeight: number;
        contactPhoneWeight: number;
        contactPrimaryContactBoost: number;
        contactApprovedStatusBoost: number;
        contactReviewingStatusBoost: number;
        contactTier1Threshold: number;
        contactTier2Threshold: number;
        contactTier3Threshold: number;
        preferredContactTitleKeywords: unknown;
        penalizedContactTitleKeywords: unknown;
        preferredContactDepartments: unknown;
        penalizedContactDepartments: unknown;
        aiClassificationEnabled: boolean;
        aiModel: string | null;
      }
) {
  return {
    recentWindowDays: config.recentWindowDays,
    comparisonWindowDays: config.comparisonWindowDays,
    lookbackWindowDays: config.lookbackWindowDays,
    momentumWeight: config.momentumWeight,
    marketFitWeight: config.marketFitWeight,
    industryFitWeight: config.industryFitWeight,
    companySizeWeight: config.companySizeWeight,
    roleWeight: config.roleWeight,
    confidenceWeight: config.confidenceWeight,
    workflowWeight: config.workflowWeight,
    preferredOriginCountries: normalizeStringArray(config.preferredOriginCountries),
    penalizedOriginCountries: normalizeStringArray(config.penalizedOriginCountries),
    preferredOriginPorts: normalizeStringArray(config.preferredOriginPorts),
    penalizedOriginPorts: normalizeStringArray(config.penalizedOriginPorts),
    preferredDestinationMarkets: normalizeStringArray(config.preferredDestinationMarkets),
    penalizedDestinationMarkets: normalizeStringArray(config.penalizedDestinationMarkets),
    preferredIndustryKeywords: normalizeStringArray(config.preferredIndustryKeywords),
    penalizedIndustryKeywords: normalizeStringArray(config.penalizedIndustryKeywords),
    preferredHsCodePrefixes: normalizeStringArray(config.preferredHsCodePrefixes),
    penalizedHsCodePrefixes: normalizeStringArray(config.penalizedHsCodePrefixes),
    oversizeTeuThreshold: normalizeOptionalString(config.oversizeTeuThreshold),
    oversizeShipmentCount30dThreshold: config.oversizeShipmentCount30dThreshold,
    oversizePenalty: config.oversizePenalty,
    midMarketTeuMin: normalizeOptionalString(config.midMarketTeuMin),
    midMarketTeuMax: normalizeOptionalString(config.midMarketTeuMax),
    midMarketBoost: config.midMarketBoost,
    contactDecisionMakerWeight: config.contactDecisionMakerWeight,
    contactManagerWeight: config.contactManagerWeight,
    contactLogisticsDepartmentWeight: config.contactLogisticsDepartmentWeight,
    contactWeakFunctionPenalty: config.contactWeakFunctionPenalty,
    contactCompanyContextWeight: config.contactCompanyContextWeight,
    contactEmailWeight: config.contactEmailWeight,
    contactLinkedinWeight: config.contactLinkedinWeight,
    contactPhoneWeight: config.contactPhoneWeight,
    contactPrimaryContactBoost: config.contactPrimaryContactBoost,
    contactApprovedStatusBoost: config.contactApprovedStatusBoost,
    contactReviewingStatusBoost: config.contactReviewingStatusBoost,
    contactTier1Threshold: config.contactTier1Threshold,
    contactTier2Threshold: config.contactTier2Threshold,
    contactTier3Threshold: config.contactTier3Threshold,
    preferredContactTitleKeywords: normalizeStringArray(config.preferredContactTitleKeywords),
    penalizedContactTitleKeywords: normalizeStringArray(config.penalizedContactTitleKeywords),
    preferredContactDepartments: normalizeStringArray(config.preferredContactDepartments),
    penalizedContactDepartments: normalizeStringArray(config.penalizedContactDepartments),
    aiClassificationEnabled: config.aiClassificationEnabled,
    aiModel: config.aiModel
  } satisfies CandidateScoringConfig;
}

function normalizeStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean)
    : [];
}

function normalizeOptionalString(value: { toString(): string } | string | null) {
  if (value === null) {
    return null;
  }

  const normalized = value.toString().trim();
  return normalized.length > 0 ? normalized : null;
}

function scoreMomentum(evidence: ReturnType<typeof summarizeTradeMiningEvidence>, config: CandidateScoringConfig) {
  const recent = summarizeWindowActivity(evidence, 0, config.recentWindowDays);
  const previous = summarizeWindowActivity(
    evidence,
    config.recentWindowDays,
    config.recentWindowDays + config.comparisonWindowDays
  );
  const recentShipmentRatio = clamp(recent.shipmentCount / 8, 0, 1);
  const repeatActivityRatio = clamp((recent.shipmentCount - 1) / 3, 0, 1);
  const growthEvidenceRatio = clamp((recent.shipmentCount + previous.shipmentCount) / 5, 0, 1);
  const growthRatio = previous.shipmentCount > 0
    ? clamp((recent.shipmentCount - previous.shipmentCount) / previous.shipmentCount, -1, 1)
    : recent.shipmentCount > 0
      ? 1
      : 0;
  const teuGrowthRatio = previous.totalTeu > 0
    ? clamp((recent.totalTeu - previous.totalTeu) / previous.totalTeu, -1, 1)
    : recent.totalTeu > 0
      ? 1
      : 0;
  const recencyRatio = scoreRecency(evidence.latestShipmentDate) / 20;
  const shipmentGrowthSignal = ((growthRatio + 1) / 2) * (0.35 + growthEvidenceRatio * 0.65);
  const teuGrowthSignal = ((teuGrowthRatio + 1) / 2) * (0.35 + growthEvidenceRatio * 0.65);
  const normalized = clamp(
    recentShipmentRatio * 0.25 +
      repeatActivityRatio * 0.25 +
      shipmentGrowthSignal * 0.25 +
      teuGrowthSignal * 0.15 +
      recencyRatio * 0.1,
    0,
    1
  );

  return Math.round(normalized * config.momentumWeight);
}

function scoreMarketFit(evidence: ReturnType<typeof summarizeTradeMiningEvidence>, config: CandidateScoringConfig) {
  const destinationRatio = evidence.profileFit.destination / 12;
  const originRatio = evidence.profileFit.origin / 8;
  const productRatio = evidence.profileFit.product / 10;
  const profilePriorityRatio = (evidence.searchProfile?.priorityWeight ?? 40) / 100;
  const routePriorityRatio = scoreRoutePriority(evidence, config);
  const normalized = clamp(
    destinationRatio * 0.3 +
      originRatio * 0.2 +
      productRatio * 0.2 +
      profilePriorityRatio * 0.15 +
      routePriorityRatio * 0.15,
    0,
    1
  );

  return Math.round(normalized * config.marketFitWeight);
}

function scoreRoutePriority(evidence: ReturnType<typeof summarizeTradeMiningEvidence>, config: CandidateScoringConfig) {
  const destinationMarket = normalizeComparableValue(evidence.destinationMarket ?? "");
  const originCountry = normalizeComparableValue(evidence.originCountry ?? "");
  const originPort = normalizeComparableValue(evidence.originPort ?? "");

  const preferredMatches = [
    matchesComparableList(config.preferredDestinationMarkets, destinationMarket),
    matchesComparableList(config.preferredOriginCountries, originCountry),
    matchesComparableList(config.preferredOriginPorts, originPort)
  ].filter(Boolean).length;

  const penalizedMatches = [
    matchesComparableList(config.penalizedDestinationMarkets, destinationMarket),
    matchesComparableList(config.penalizedOriginCountries, originCountry),
    matchesComparableList(config.penalizedOriginPorts, originPort)
  ].filter(Boolean).length;

  return clamp(0.5 + preferredMatches * 0.2 - penalizedMatches * 0.25, 0, 1);
}

function matchesComparableList(values: string[], signal: string) {
  if (!signal) {
    return false;
  }

  return values.some((value) => signal.includes(normalizeComparableValue(value)));
}

function scoreIndustryFit(evidence: ReturnType<typeof summarizeTradeMiningEvidence>, config: CandidateScoringConfig) {
  const productText = normalizeComparableValue(evidence.productDescription ?? "");
  const hsCode = (evidence.hsCode ?? "").replace(/[^0-9]/g, "");
  const preferredKeywordMatch = config.preferredIndustryKeywords.some((keyword) => productText.includes(normalizeComparableValue(keyword)));
  const penalizedKeywordMatch = config.penalizedIndustryKeywords.some((keyword) => productText.includes(normalizeComparableValue(keyword)));
  const preferredHsMatch = config.preferredHsCodePrefixes.some((prefix) => hsCode.startsWith(prefix.replace(/[^0-9]/g, "")));
  const penalizedHsMatch = config.penalizedHsCodePrefixes.some((prefix) => hsCode.startsWith(prefix.replace(/[^0-9]/g, "")));
  const positive = (preferredKeywordMatch ? 0.6 : 0) + (preferredHsMatch ? 0.4 : 0);
  const negative = (penalizedKeywordMatch ? 0.7 : 0) + (penalizedHsMatch ? 0.3 : 0);
  const normalized = clamp(positive - negative, -1, 1);

  return Math.round(normalized * config.industryFitWeight);
}

function scoreCompanySize(evidence: ReturnType<typeof summarizeTradeMiningEvidence>, config: CandidateScoringConfig) {
  const recent = summarizeWindowActivity(evidence, 0, config.recentWindowDays);
  const oversizeTeuThreshold = readOptionalNumericSetting(config.oversizeTeuThreshold);
  const midMarketTeuMin = readOptionalNumericSetting(config.midMarketTeuMin);
  const midMarketTeuMax = readOptionalNumericSetting(config.midMarketTeuMax);
  let score = 0;

  if (
    midMarketTeuMin !== null &&
    midMarketTeuMax !== null &&
    recent.totalTeu >= midMarketTeuMin &&
    recent.totalTeu <= midMarketTeuMax
  ) {
    score += Math.min(config.companySizeWeight, config.midMarketBoost);
  }

  if (
    (oversizeTeuThreshold !== null && recent.totalTeu >= oversizeTeuThreshold) ||
    (config.oversizeShipmentCount30dThreshold !== null &&
      recent.shipmentCount >= config.oversizeShipmentCount30dThreshold)
  ) {
    score -= Math.min(config.companySizeWeight, config.oversizePenalty);
  }

  return clamp(score, -config.companySizeWeight, config.companySizeWeight);
}

function scoreConfidence(evidence: ReturnType<typeof summarizeTradeMiningEvidence>, config: CandidateScoringConfig) {
  const presentSignals = [
    evidence.destinationMarket,
    evidence.destinationPort,
    evidence.originCountry,
    evidence.originPort,
    evidence.productDescription,
    evidence.hsCode,
    evidence.sourceRole,
    evidence.companyMatchName
  ].filter(Boolean).length;
  const normalized = clamp(presentSignals / 8, 0, 1);

  return Math.round(normalized * config.confidenceWeight);
}

function scoreWorkflow({
  companyPriorityScore,
  alreadyInPipeline,
  weight
}: {
  companyPriorityScore: number;
  alreadyInPipeline: boolean;
  weight: number;
}) {
  const baseScore = Math.round(clamp(companyPriorityScore / 100, 0, 1) * weight);
  return alreadyInPipeline ? -weight : baseScore;
}

function scaleScore(value: number, maxValue: number, weight: number) {
  if (maxValue <= 0 || weight <= 0) {
    return 0;
  }

  return Math.round(clamp(value / maxValue, 0, 1) * weight);
}

function summarizeWindowActivity(
  evidence: ReturnType<typeof summarizeTradeMiningEvidence>,
  minAgeDays: number,
  maxAgeDays: number
) {
  const now = Date.now();
  const activity = evidence.activity.filter((record) => {
    if (!record.arrivalDate) {
      return false;
    }

    const ageInDays = (now - record.arrivalDate.getTime()) / 86_400_000;
    return ageInDays >= minAgeDays && ageInDays < maxAgeDays;
  });

  return {
    shipmentCount: activity.length,
    totalTeu: activity.reduce((sum, record) => sum + record.teu, 0),
    totalContainers: activity.reduce((sum, record) => sum + record.containerCount, 0)
  };
}

function readOptionalNumericSetting(value: string | null) {
  if (!value) {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function describeMomentum(evidence: ReturnType<typeof summarizeTradeMiningEvidence>, config: CandidateScoringConfig) {
  const recent = summarizeWindowActivity(evidence, 0, config.recentWindowDays);
  const previous = summarizeWindowActivity(
    evidence,
    config.recentWindowDays,
    config.recentWindowDays + config.comparisonWindowDays
  );

  if (recent.shipmentCount > previous.shipmentCount) {
    return `shipment activity rising (${recent.shipmentCount} recent vs ${previous.shipmentCount} prior)`;
  }

  if (recent.shipmentCount < previous.shipmentCount) {
    return `shipment activity softening (${recent.shipmentCount} recent vs ${previous.shipmentCount} prior)`;
  }

  return `${evidence.shipmentCount} shipment${evidence.shipmentCount === 1 ? "" : "s"} in lookback`;
}

function describeMarketFit(
  evidence: ReturnType<typeof summarizeTradeMiningEvidence>,
  config: CandidateScoringConfig
) {
  const parts = [
    evidence.profileFit.destination > 0 ? "destination fit matched profile" : "destination fit missing",
    evidence.profileFit.origin > 0 ? "origin fit matched profile" : "origin fit missing",
    evidence.profileFit.product > 0 ? "product/HS fit matched profile" : "product/HS fit missing"
  ];

  const routeBias: string[] = [];
  if (matchesComparableList(config.preferredDestinationMarkets, normalizeComparableValue(evidence.destinationMarket ?? ""))) {
    routeBias.push("preferred destination market");
  }
  if (matchesComparableList(config.preferredOriginCountries, normalizeComparableValue(evidence.originCountry ?? ""))) {
    routeBias.push("preferred origin country");
  }
  if (matchesComparableList(config.preferredOriginPorts, normalizeComparableValue(evidence.originPort ?? ""))) {
    routeBias.push("preferred origin port");
  }
  if (matchesComparableList(config.penalizedOriginCountries, normalizeComparableValue(evidence.originCountry ?? ""))) {
    routeBias.push("deprioritized origin country");
  }

  if (evidence.searchProfile) {
    parts.push(`${evidence.searchProfile.name} profile priority`);
  }

  if (routeBias.length > 0) {
    parts.push(routeBias.join(", "));
  }

  return parts.join(", ");
}

function describeIndustryFit(evidence: ReturnType<typeof summarizeTradeMiningEvidence>, config: CandidateScoringConfig) {
  const productText = evidence.productDescription ?? "";
  const hsCode = evidence.hsCode ?? "";

  if (
    config.preferredIndustryKeywords.some((keyword) => matchesKeyword([keyword], productText)) ||
    config.preferredHsCodePrefixes.some((prefix) => hsCode.replace(/[^0-9]/g, "").startsWith(prefix.replace(/[^0-9]/g, "")))
  ) {
    return "industry signals match preferred categories";
  }

  if (
    config.penalizedIndustryKeywords.some((keyword) => matchesKeyword([keyword], productText)) ||
    config.penalizedHsCodePrefixes.some((prefix) => hsCode.replace(/[^0-9]/g, "").startsWith(prefix.replace(/[^0-9]/g, "")))
  ) {
    return "industry signals hit a deprioritized category";
  }

  return "industry preference neutral";
}

function describeCompanySize(evidence: ReturnType<typeof summarizeTradeMiningEvidence>, config: CandidateScoringConfig) {
  const recent = summarizeWindowActivity(evidence, 0, config.recentWindowDays);
  const oversizeTeuThreshold = readOptionalNumericSetting(config.oversizeTeuThreshold);
  const midMarketTeuMin = readOptionalNumericSetting(config.midMarketTeuMin);
  const midMarketTeuMax = readOptionalNumericSetting(config.midMarketTeuMax);

  if (
    (oversizeTeuThreshold !== null && recent.totalTeu >= oversizeTeuThreshold) ||
    (config.oversizeShipmentCount30dThreshold !== null &&
      recent.shipmentCount >= config.oversizeShipmentCount30dThreshold)
  ) {
    return "large importer profile; score reduced";
  }

  if (
    midMarketTeuMin !== null &&
    midMarketTeuMax !== null &&
    recent.totalTeu >= midMarketTeuMin &&
    recent.totalTeu <= midMarketTeuMax
  ) {
    return "mid-market importer profile";
  }

  return "company size neutral";
}

function formatDestination(rawJson: JsonObject, fallbackCity: string | null, fallbackState: string | null) {
  const city = readString(rawJson, "destinationCity") ?? fallbackCity;
  const state = readString(rawJson, "destinationState") ?? fallbackState;

  if (city && state) {
    return `${city}, ${state}`;
  }

  return city ?? state ?? null;
}

function formatSourceRole(sourceRole: string) {
  return sourceRole.replace(/_/g, " ");
}

function matchesProfileValue(values: string[], candidate: string) {
  const normalizedCandidate = normalizeComparableValue(candidate);
  return values.some((value) => {
    const normalizedValue = normalizeComparableValue(value);
    return normalizedValue === normalizedCandidate || normalizedValue.includes(normalizedCandidate) || normalizedCandidate.includes(normalizedValue);
  });
}

function matchesKeyword(values: string[], candidate: string) {
  const normalizedCandidate = normalizeComparableValue(candidate);
  return values.some((value) => normalizedCandidate.includes(normalizeComparableValue(value)));
}

function matchesHsCode(values: string[], candidate: string) {
  const normalizedCandidate = candidate.replace(/[^0-9]/g, "");
  return values.some((value) => value.replace(/[^0-9]/g, "") === normalizedCandidate);
}

function normalizeComparableValue(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
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
