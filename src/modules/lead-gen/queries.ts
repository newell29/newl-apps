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
