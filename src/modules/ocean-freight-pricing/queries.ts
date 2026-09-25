import { IntegrationProvider, JobStatus, ModuleKey, OceanEquipmentType, OceanExtractionStatus, OceanRateStatus, Prisma } from "@prisma/client";
import { OCEAN_FREIGHT_EMAIL_INGESTION_JOB_TYPE } from "@/modules/ocean-freight-pricing/ingestion";
import {
  OCEAN_FREIGHT_MICROSOFT_GRAPH_CREDENTIAL_NAME,
  parseOceanFreightMicrosoftGraphSettings
} from "@/modules/ocean-freight-pricing/microsoft-graph-settings";
import {
  getOceanFreightReviewDisposition,
  parseOceanFreightAutomationSettings
} from "@/modules/ocean-freight-pricing/automation-settings";
import { prisma } from "@/server/db";
import type { AuthenticatedContext } from "@/server/tenant-context";
import { requireModule } from "@/server/auth/authorization";

export type OceanRateView = Awaited<ReturnType<typeof getOceanFreightPricingShell>>["rates"][number];
export type OceanFreightPricingFilters = {
  status?: string;
  agentId?: string;
  origin?: string;
  originCountry?: string;
  destination?: string;
  destinationCountry?: string;
  equipmentType?: string;
  rateMin?: string;
  rateMax?: string;
  carrier?: string;
  validityFrom?: string;
  validityTo?: string;
  schedule?: string;
  agentRating?: string;
};
export type OceanFreightAgentFilters = {
  agentSearch?: string;
  agentCountry?: string;
  branchLocation?: string;
  agentRating?: string;
  activeOnly?: string;
};
export type OceanFreightSourceFilters = {
  detectedOnly?: string;
  sender?: string;
  mailbox?: string;
  receivedFrom?: string;
  receivedTo?: string;
  search?: string;
};
export type OceanFreightReviewFilters = {
  status?: string;
  search?: string;
};

export function getComputedOceanRateStatus(rate: { status: OceanRateStatus; validityStartDate: Date | null; validityEndDate: Date | null }, today = new Date()) {
  if (rate.status === OceanRateStatus.INACTIVE || rate.status === OceanRateStatus.SUPERSEDED) return rate.status;
  const day = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  if (!rate.validityEndDate) return "NEEDS_VALIDITY" as const;
  if (rate.validityStartDate && rate.validityStartDate > day) return "FUTURE" as const;
  if (rate.validityEndDate < day) return OceanRateStatus.EXPIRED;
  return OceanRateStatus.ACTIVE;
}

export async function getOceanFreightPricingShell(ctx: AuthenticatedContext, filters?: OceanFreightPricingFilters) {
  await requireModule(ctx, ModuleKey.OCEAN_FREIGHT_PRICING);
  const today = new Date();
  const where = buildRateWhere(ctx.tenantId, today, filters);
  const activeWhere = buildRateWhere(ctx.tenantId, today, { status: "active" });

  const [rates, agents, candidates, sources, jobs, activeRateCount] = await Promise.all([
    prisma.oceanFreightRate.findMany({
      where,
      orderBy: [{ agent: { name: "asc" } }, { originPort: "asc" }, { destinationPort: "asc" }, { validityEndDate: "asc" }],
      include: { agent: true, agentContact: true },
      take: 100
    }),
    prisma.oceanFreightAgent.findMany({
      where: { tenantId: ctx.tenantId },
      orderBy: [{ name: "asc" }],
      include: { contacts: { orderBy: { fullName: "asc" } } }
    }),
    prisma.oceanFreightRateCandidate.findMany({
      where: { tenantId: ctx.tenantId, status: { in: [OceanExtractionStatus.NEW, OceanExtractionStatus.NEEDS_REVIEW] } },
      orderBy: { createdAt: "desc" },
      take: 25
    }),
    prisma.oceanFreightSourceEmail.findMany({
      where: { tenantId: ctx.tenantId },
      orderBy: { receivedAt: "desc" },
      take: 25
    }),
    prisma.automationJobRun.findMany({
      where: { tenantId: ctx.tenantId, jobType: { startsWith: "ocean-freight-pricing." } },
      orderBy: { startedAt: "desc" },
      take: 10
    }),
    prisma.oceanFreightRate.count({ where: activeWhere })
  ]);

  return {
    rates: rates.map((rate) => ({ ...rate, computedStatus: getComputedOceanRateStatus(rate) })),
    agents,
    candidates,
    sources,
    jobs,
    summary: {
      activeRates: activeRateCount,
      agentCount: agents.length,
      reviewQueueCount: candidates.length,
      sourceCount: sources.length
    }
  };
}


export async function getOceanFreightSourcesShell(ctx: AuthenticatedContext, filters?: OceanFreightSourceFilters) {
  await requireModule(ctx, ModuleKey.OCEAN_FREIGHT_PRICING);
  const where = buildSourceWhere(ctx.tenantId, filters);
  const [sources, mailboxes, microsoftGraphCredential] = await Promise.all([
    prisma.oceanFreightSourceEmail.findMany({
      where,
      orderBy: { receivedAt: "desc" },
      take: 100,
      include: {
        attachments: { orderBy: { fileName: "asc" } },
        candidates: { orderBy: { createdAt: "desc" }, take: 1 }
      }
    }),
    prisma.oceanFreightSourceEmail.findMany({ where: { tenantId: ctx.tenantId }, distinct: ["mailboxAddress"], select: { mailboxAddress: true }, orderBy: { mailboxAddress: "asc" } }),
    prisma.integrationCredential.findFirst({
      where: {
        tenantId: ctx.tenantId,
        provider: IntegrationProvider.MICROSOFT_GRAPH,
        name: OCEAN_FREIGHT_MICROSOFT_GRAPH_CREDENTIAL_NAME
      },
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
      select: { provider: true, status: true, publicConfig: true }
    })
  ]);
  return {
    sources,
    mailboxes: mailboxes.map((item) => item.mailboxAddress),
    microsoftGraphSettings: parseOceanFreightMicrosoftGraphSettings(microsoftGraphCredential),
    automationSettings: parseOceanFreightAutomationSettings(microsoftGraphCredential)
  };
}

export async function getOceanFreightReviewShell(ctx: AuthenticatedContext, filters?: OceanFreightReviewFilters) {
  await requireModule(ctx, ModuleKey.OCEAN_FREIGHT_PRICING);
  const where = buildReviewWhere(ctx.tenantId, filters);
  const [candidates, agents, microsoftGraphCredential] = await Promise.all([
    prisma.oceanFreightRateCandidate.findMany({
      where,
      orderBy: [{ createdAt: "desc" }],
      take: 100,
      include: {
        sourceEmail: true,
        sourceAttachment: true,
        agent: true,
        agentContact: true
      }
    }),
    prisma.oceanFreightAgent.findMany({
      where: { tenantId: ctx.tenantId },
      orderBy: [{ name: "asc" }],
      include: { contacts: { orderBy: { fullName: "asc" } } }
    }),
    prisma.integrationCredential.findFirst({
      where: {
        tenantId: ctx.tenantId,
        provider: IntegrationProvider.MICROSOFT_GRAPH,
        name: OCEAN_FREIGHT_MICROSOFT_GRAPH_CREDENTIAL_NAME
      },
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
      select: { provider: true, status: true, publicConfig: true }
    })
  ]);
  const automationSettings = parseOceanFreightAutomationSettings(microsoftGraphCredential);
  const candidatesWithDisposition = candidates.map((candidate) => ({
    ...candidate,
    reviewDisposition: getOceanFreightReviewDisposition(candidate, automationSettings)
  }));
  const shouldShowWorkQueueOnly = (filters?.status || "workQueue") === "workQueue";
  const visibleCandidates = shouldShowWorkQueueOnly && automationSettings.exceptionOnlyReview
    ? candidatesWithDisposition.filter((candidate) => candidate.reviewDisposition.isHighConfidence || candidate.reviewDisposition.isException)
    : candidatesWithDisposition;

  return { candidates: visibleCandidates, agents, automationSettings };
}

export async function getOceanFreightJobsShell(ctx: AuthenticatedContext) {
  await requireModule(ctx, ModuleKey.OCEAN_FREIGHT_PRICING);
  await markStaleOceanFreightJobs(ctx.tenantId);
  const jobs = await prisma.automationJobRun.findMany({
    where: { tenantId: ctx.tenantId, jobType: OCEAN_FREIGHT_EMAIL_INGESTION_JOB_TYPE },
    orderBy: { startedAt: "desc" },
    take: 50
  });
  return { jobs };
}

async function markStaleOceanFreightJobs(tenantId: string) {
  const staleBefore = new Date(Date.now() - 5 * 60 * 1000);
  await prisma.automationJobRun.updateMany({
    where: {
      tenantId,
      jobType: OCEAN_FREIGHT_EMAIL_INGESTION_JOB_TYPE,
      status: JobStatus.RUNNING,
      startedAt: { lt: staleBefore },
      finishedAt: null
    },
    data: {
      status: JobStatus.ERROR,
      finishedAt: new Date(),
      errorMessage: "Ingestion appears to have timed out before completion. This can happen in preview/serverless environments for long Microsoft Graph syncs.",
      output: {
        error: "Stale RUNNING job marked failed after 5 minutes without completion."
      }
    }
  });
}

export async function getOceanFreightAgentsShell(ctx: AuthenticatedContext, filters?: OceanFreightAgentFilters) {
  await requireModule(ctx, ModuleKey.OCEAN_FREIGHT_PRICING);
  const where = buildAgentWhere(ctx.tenantId, filters);

  const agents = await prisma.oceanFreightAgent.findMany({
    where,
    orderBy: [{ name: "asc" }],
    include: {
      branches: { orderBy: [{ country: "asc" }, { city: "asc" }, { name: "asc" }] },
      contacts: { orderBy: { fullName: "asc" } }
    }
  });

  return { agents };
}


function buildSourceWhere(tenantId: string, filters?: OceanFreightSourceFilters): Prisma.OceanFreightSourceEmailWhereInput {
  const where: Prisma.OceanFreightSourceEmailWhereInput = { tenantId };
  if (filters?.detectedOnly === "true") where.rateDetected = true;
  if (filters?.sender?.trim()) where.fromAddress = { contains: filters.sender.trim(), mode: "insensitive" };
  if (filters?.mailbox?.trim()) where.mailboxAddress = filters.mailbox.trim().toLowerCase();
  const receivedFrom = readDate(filters?.receivedFrom);
  const receivedTo = readDate(filters?.receivedTo);
  if (receivedFrom || receivedTo) where.receivedAt = { ...(receivedFrom ? { gte: receivedFrom } : {}), ...(receivedTo ? { lte: receivedTo } : {}) };
  const search = filters?.search?.trim();
  if (search) {
    where.AND = appendSourceAnd(where.AND, {
      OR: [
        { subject: { contains: search, mode: "insensitive" } },
        { bodyPreview: { contains: search, mode: "insensitive" } },
        { normalizedBodyText: { contains: search, mode: "insensitive" } }
      ]
    });
  }
  return where;
}

function buildReviewWhere(tenantId: string, filters?: OceanFreightReviewFilters): Prisma.OceanFreightRateCandidateWhereInput {
  const where: Prisma.OceanFreightRateCandidateWhereInput = { tenantId };
  const status = filters?.status || "workQueue";
  if (status === "open" || status === "workQueue") {
    where.status = { in: [OceanExtractionStatus.NEW, OceanExtractionStatus.NEEDS_REVIEW] };
  } else if (Object.values(OceanExtractionStatus).includes(status as OceanExtractionStatus)) {
    where.status = status as OceanExtractionStatus;
  }

  const search = filters?.search?.trim();
  if (search) {
    where.AND = appendReviewAnd(where.AND, {
      OR: [
        { agentCompanyNameRaw: { contains: search, mode: "insensitive" } },
        { agentContactEmailRaw: { contains: search, mode: "insensitive" } },
        { originPort: { contains: search, mode: "insensitive" } },
        { destinationPort: { contains: search, mode: "insensitive" } },
        { shippingLine: { contains: search, mode: "insensitive" } },
        { notes: { contains: search, mode: "insensitive" } },
        { sourceEmail: { subject: { contains: search, mode: "insensitive" } } },
        { sourceEmail: { fromAddress: { contains: search, mode: "insensitive" } } },
        { sourceEmail: { fromName: { contains: search, mode: "insensitive" } } }
      ]
    });
  }
  return where;
}

function appendSourceAnd(current: Prisma.OceanFreightSourceEmailWhereInput["AND"], next: Prisma.OceanFreightSourceEmailWhereInput): Prisma.OceanFreightSourceEmailWhereInput["AND"] {
  return Array.isArray(current) ? [...current, next] : current ? [current, next] : [next];
}

function appendReviewAnd(current: Prisma.OceanFreightRateCandidateWhereInput["AND"], next: Prisma.OceanFreightRateCandidateWhereInput): Prisma.OceanFreightRateCandidateWhereInput["AND"] {
  return Array.isArray(current) ? [...current, next] : current ? [current, next] : [next];
}

function buildRateWhere(tenantId: string, today: Date, filters?: OceanFreightPricingFilters): Prisma.OceanFreightRateWhereInput {
  const where: Prisma.OceanFreightRateWhereInput = { tenantId };
  const status = filters?.status || "active";

  if (status === "active") {
    where.status = OceanRateStatus.ACTIVE;
    where.OR = [{ validityEndDate: null }, { validityEndDate: { gte: today } }];
  } else if (status === "expired") {
    where.OR = [
      { status: OceanRateStatus.EXPIRED },
      { status: OceanRateStatus.ACTIVE, validityEndDate: { lt: today } }
    ];
  } else if (status === "inactive") {
    where.status = OceanRateStatus.INACTIVE;
  } else if (status !== "all") {
    where.status = OceanRateStatus.ACTIVE;
    where.OR = [{ validityEndDate: null }, { validityEndDate: { gte: today } }];
  }

  if (filters?.agentId) {
    where.agentId = filters.agentId;
  }

  const origin = filters?.origin?.trim();
  if (origin) {
    where.AND = appendAnd(where.AND, {
      OR: [
        { originPort: { contains: origin, mode: "insensitive" } },
        { originCountry: { contains: origin, mode: "insensitive" } },
        { originRegion: { contains: origin, mode: "insensitive" } }
      ]
    });
  }

  const originCountry = filters?.originCountry?.trim();
  if (originCountry) {
    where.originCountry = { contains: normalizeCountrySuggestionValue(originCountry), mode: "insensitive" };
  }

  const destination = filters?.destination?.trim();
  if (destination) {
    where.AND = appendAnd(where.AND, {
      OR: [
        { destinationPort: { contains: destination, mode: "insensitive" } },
        { destinationCountry: { contains: destination, mode: "insensitive" } },
        { destinationRegion: { contains: destination, mode: "insensitive" } }
      ]
    });
  }

  const destinationCountry = filters?.destinationCountry?.trim();
  if (destinationCountry) {
    where.destinationCountry = { contains: normalizeCountrySuggestionValue(destinationCountry), mode: "insensitive" };
  }

  if (filters?.equipmentType && Object.values(OceanEquipmentType).includes(filters.equipmentType as OceanEquipmentType)) {
    where.equipmentType = filters.equipmentType as OceanEquipmentType;
  }

  const carrier = filters?.carrier?.trim();
  if (carrier) {
    where.shippingLine = { contains: carrier, mode: "insensitive" };
  }

  const schedule = filters?.schedule?.trim();
  if (schedule) {
    where.scheduleNotes = { contains: schedule, mode: "insensitive" };
  }

  const rateMin = readNumber(filters?.rateMin);
  const rateMax = readNumber(filters?.rateMax);
  if (rateMin !== null || rateMax !== null) {
    where.rateAmount = {
      ...(rateMin !== null ? { gte: rateMin } : {}),
      ...(rateMax !== null ? { lte: rateMax } : {})
    };
  }

  const validityFrom = readDate(filters?.validityFrom);
  const validityTo = readDate(filters?.validityTo);
  if (validityFrom || validityTo) {
    where.validityEndDate = {
      ...(validityFrom ? { gte: validityFrom } : {}),
      ...(validityTo ? { lte: validityTo } : {})
    };
  }

  const agentRating = readNumber(filters?.agentRating);
  if (agentRating !== null) {
    where.agent = {
      internalRating: agentRating
    };
  }

  return where;
}

function buildAgentWhere(tenantId: string, filters?: OceanFreightAgentFilters): Prisma.OceanFreightAgentWhereInput {
  const where: Prisma.OceanFreightAgentWhereInput = { tenantId };
  const search = filters?.agentSearch?.trim();

  if (search) {
    where.OR = [
      { name: { contains: search, mode: "insensitive" } },
      { website: { contains: search, mode: "insensitive" } },
      { primaryEmailDomain: { contains: search, mode: "insensitive" } },
      { primaryCountry: { contains: normalizeCountrySuggestionValue(search), mode: "insensitive" } },
      { reliabilityNotes: { contains: search, mode: "insensitive" } },
      { serviceNotes: { contains: search, mode: "insensitive" } },
      { internalNotes: { contains: search, mode: "insensitive" } },
      {
        branches: {
          some: {
            OR: [
              { name: { contains: search, mode: "insensitive" } },
              { country: { contains: normalizeCountrySuggestionValue(search), mode: "insensitive" } },
              { region: { contains: search, mode: "insensitive" } },
              { city: { contains: search, mode: "insensitive" } },
              { port: { contains: search, mode: "insensitive" } },
              { address: { contains: search, mode: "insensitive" } },
              { notes: { contains: search, mode: "insensitive" } }
            ]
          }
        }
      },
      {
        contacts: {
          some: {
            OR: [
              { fullName: { contains: search, mode: "insensitive" } },
              { email: { contains: search, mode: "insensitive" } },
              { phone: { contains: search, mode: "insensitive" } },
              { title: { contains: search, mode: "insensitive" } },
              { notes: { contains: search, mode: "insensitive" } }
            ]
          }
        }
      }
    ];
  }

  const country = filters?.agentCountry?.trim();
  if (country) {
    const normalizedCountry = normalizeCountrySuggestionValue(country);
    where.AND = appendAgentAnd(where.AND, {
      OR: [
        { primaryCountry: { contains: normalizedCountry, mode: "insensitive" } },
        { branches: { some: { country: { contains: normalizedCountry, mode: "insensitive" } } } }
      ]
    });
  }

  const branchLocation = filters?.branchLocation?.trim();
  if (branchLocation) {
    const normalizedBranchLocation = normalizeCountrySuggestionValue(branchLocation);
    where.AND = appendAgentAnd(where.AND, {
      branches: {
        some: {
          OR: [
            { name: { contains: branchLocation, mode: "insensitive" } },
            { country: { contains: normalizedBranchLocation, mode: "insensitive" } },
            { region: { contains: branchLocation, mode: "insensitive" } },
            { city: { contains: branchLocation, mode: "insensitive" } },
            { port: { contains: branchLocation, mode: "insensitive" } }
          ]
        }
      }
    });
  }

  const agentRating = readNumber(filters?.agentRating);
  if (agentRating !== null) {
    where.internalRating = agentRating;
  }

  if (filters?.activeOnly === "true") {
    where.activeRateCount = { gt: 0 };
  }

  return where;
}

function appendAgentAnd(
  current: Prisma.OceanFreightAgentWhereInput["AND"],
  next: Prisma.OceanFreightAgentWhereInput
): Prisma.OceanFreightAgentWhereInput["AND"] {
  const currentArray = Array.isArray(current) ? current : current ? [current] : [];
  return [...currentArray, next];
}

function appendAnd(
  current: Prisma.OceanFreightRateWhereInput["AND"],
  next: Prisma.OceanFreightRateWhereInput
): Prisma.OceanFreightRateWhereInput["AND"] {
  const currentArray = Array.isArray(current) ? current : current ? [current] : [];
  return [...currentArray, next];
}

function readNumber(value: string | null | undefined) {
  if (!value) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function readDate(value: string | null | undefined) {
  if (!value) {
    return null;
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function normalizeCountrySuggestionValue(value: string) {
  return value.replace(/\s+\([A-Z]{2,3}\)$/u, "").trim();
}
