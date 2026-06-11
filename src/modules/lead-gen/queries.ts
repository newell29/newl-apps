import { prisma } from "@/server/db";
import { tenantWhere } from "@/server/tenant-query";
import type { TenantContext } from "@/server/tenant-context";

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
  const profiles = await prisma.tradeMiningSearchProfile.findMany({
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

  return profiles.map((profile) => ({
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
  }));
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
