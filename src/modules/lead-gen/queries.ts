import { prisma } from "@/server/db";
import { tenantWhere } from "@/server/tenant-query";
import type { TenantContext } from "@/server/tenant-context";

type SearchProfileDelegate = typeof prisma.tradeMiningSearchProfile;

type SearchProfileClient = typeof prisma & {
  tradeMiningSearchProfile?: SearchProfileDelegate;
};

export async function getCandidateFeed(tenant: TenantContext) {
  const companies = await prisma.company.findMany({
    where: tenantWhere(tenant, {
      doNotProspect: false
    }),
    include: {
      leads: {
        where: tenantWhere(tenant),
        orderBy: {
          updatedAt: "desc"
        },
        take: 1
      }
    },
    orderBy: [
      {
        priorityScore: "desc"
      },
      {
        updatedAt: "desc"
      }
    ]
  });

  return companies.map((company) => ({
    id: company.id,
    companyName: company.name,
    domain: company.domain,
    priorityScore: company.priorityScore,
    source: company.source,
    stage: company.leads[0]?.stage ?? "NEW"
  }));
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

export async function getLeadPipeline(tenant: TenantContext) {
  const leads = await prisma.lead.findMany({
    where: tenantWhere(tenant),
    include: {
      company: true,
      contact: true
    },
    orderBy: [
      {
        updatedAt: "desc"
      },
      {
        score: "desc"
      }
    ]
  });

  return leads.map((lead) => ({
    id: lead.id,
    companyName: lead.company.name,
    contactName: lead.contact?.fullName,
    stage: lead.stage,
    score: lead.score,
    notes: lead.notes,
    updatedAt: lead.updatedAt
  }));
}

function asStringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function isMissingSearchProfileTableError(error: unknown) {
  if (!error || typeof error !== "object") {
    return false;
  }

  const code = "code" in error ? error.code : undefined;
  return code === "P2021" || code === "P2022";
}
