import { IntegrationProvider, LeadPipelineStage } from "@prisma/client";

import { prisma } from "@/server/db";
import type { TenantContext } from "@/server/tenant-context";
import { tenantWhere } from "@/server/tenant-query";

const LTL_BULK_JOB_TYPE = "ltl-rate-portal.bulk-quote";
const UPS_BULK_JOB_TYPE = "ups-tools.bulk-rate-quote";
const CLOSED_LEAD_STAGES = [
  LeadPipelineStage.WON,
  LeadPipelineStage.LOST,
  LeadPipelineStage.DISQUALIFIED
];

const ASSISTANT_INTEGRATION_PROVIDERS = [
  IntegrationProvider.OPENAI,
  IntegrationProvider.MICROSOFT_GRAPH,
  IntegrationProvider.UPS,
  IntegrationProvider.SEVEN_L,
  IntegrationProvider.TMS,
  IntegrationProvider.WMS
];

export type AssistantIntent =
  | "RATE_REQUEST"
  | "CUSTOMER_CONTEXT"
  | "SALES_OPPORTUNITY"
  | "OPERATIONAL_RISK"
  | "EMAIL_DRAFT"
  | "GENERAL_INSIGHT";

export async function getAssistantWorkspace(tenant: TenantContext, query?: string) {
  const [
    companyCount,
    contactCount,
    openLeadCount,
    importRecordCount,
    knowledgeDocumentCount,
    memoryCount,
    integrations,
    topCompanies,
    openLeads,
    recentRateJobs
  ] = await Promise.all([
    prisma.company.count({ where: tenantWhere(tenant) }),
    prisma.contact.count({ where: tenantWhere(tenant) }),
    prisma.lead.count({
      where: tenantWhere(tenant, {
        stage: {
          notIn: CLOSED_LEAD_STAGES
        }
      })
    }),
    prisma.tradeMiningImportRecord.count({ where: tenantWhere(tenant) }),
    prisma.assistantKnowledgeDocument.count({ where: tenantWhere(tenant) }),
    prisma.assistantMemory.count({ where: tenantWhere(tenant, { status: "ACTIVE" }) }),
    prisma.integrationCredential.findMany({
      where: tenantWhere(tenant, {
        provider: {
          in: ASSISTANT_INTEGRATION_PROVIDERS
        }
      }),
      orderBy: [{ provider: "asc" }, { name: "asc" }]
    }),
    prisma.company.findMany({
      where: tenantWhere(tenant),
      orderBy: [{ priorityScore: "desc" }, { updatedAt: "desc" }],
      take: 6,
      select: {
        id: true,
        name: true,
        normalizedName: true,
        primaryIndustry: true,
        priorityScore: true,
        candidateStatus: true,
        updatedAt: true,
        _count: {
          select: {
            contacts: true,
            leads: true,
            importRecords: true
          }
        }
      }
    }),
    prisma.lead.findMany({
      where: tenantWhere(tenant, {
        stage: {
          notIn: CLOSED_LEAD_STAGES
        }
      }),
      orderBy: [{ score: "desc" }, { updatedAt: "desc" }],
      take: 6,
      select: {
        id: true,
        stage: true,
        score: true,
        notes: true,
        updatedAt: true,
        company: {
          select: {
            id: true,
            name: true,
            primaryIndustry: true,
            priorityScore: true
          }
        },
        contact: {
          select: {
            fullName: true,
            title: true,
            email: true
          }
        }
      }
    }),
    prisma.automationJobRun.findMany({
      where: tenantWhere(tenant, {
        jobType: {
          in: [UPS_BULK_JOB_TYPE, LTL_BULK_JOB_TYPE]
        }
      }),
      orderBy: {
        startedAt: "desc"
      },
      take: 5,
      select: {
        id: true,
        jobType: true,
        status: true,
        startedAt: true,
        finishedAt: true,
        errorMessage: true
      }
    })
  ]);

  const intent = classifyAssistantIntent(query);

  return {
    intent,
    answer: buildDeterministicAnswer(intent, {
      companyCount,
      contactCount,
      openLeadCount,
      importRecordCount,
      knowledgeDocumentCount,
      memoryCount,
      topCompanyName: topCompanies[0]?.name ?? null,
      topCompanyScore: topCompanies[0]?.priorityScore ?? null,
      hasOpenAi: integrations.some((integration) => integration.provider === IntegrationProvider.OPENAI),
      rateJobCount: recentRateJobs.length
    }),
    stats: {
      companyCount,
      contactCount,
      openLeadCount,
      importRecordCount,
      knowledgeDocumentCount,
      memoryCount
    },
    integrations: ASSISTANT_INTEGRATION_PROVIDERS.map((provider) => {
      const matching = integrations.filter((integration) => integration.provider === provider);

      return {
        provider,
        configuredCount: matching.length,
        activeCount: matching.filter((integration) => integration.status === "ACTIVE").length,
        statuses: matching.map((integration) => ({
          id: integration.id,
          name: integration.name,
          status: integration.status
        }))
      };
    }),
    topCompanies: topCompanies.map((company) => ({
      id: company.id,
      name: company.name,
      normalizedName: company.normalizedName,
      primaryIndustry: company.primaryIndustry,
      priorityScore: company.priorityScore,
      candidateStatus: company.candidateStatus,
      contactCount: company._count.contacts,
      leadCount: company._count.leads,
      importRecordCount: company._count.importRecords,
      updatedAt: company.updatedAt
    })),
    openLeads: openLeads.map((lead) => ({
      id: lead.id,
      stage: lead.stage,
      score: lead.score,
      notes: lead.notes,
      updatedAt: lead.updatedAt,
      company: lead.company,
      contact: lead.contact
    })),
    recentRateJobs
  };
}

export function classifyAssistantIntent(query?: string): AssistantIntent {
  const normalized = query?.toLowerCase().trim() ?? "";

  if (!normalized) {
    return "GENERAL_INSIGHT";
  }

  if (matchesAny(normalized, ["rate", "quote", "freight", "ups", "ltl", "7l", "seven l", "carrier"])) {
    return "RATE_REQUEST";
  }

  if (matchesAny(normalized, ["email", "reply", "draft", "follow up", "follow-up"])) {
    return "EMAIL_DRAFT";
  }

  if (matchesAny(normalized, ["problem", "risk", "issue", "late", "delay", "complaint", "watch"])) {
    return "OPERATIONAL_RISK";
  }

  if (matchesAny(normalized, ["opportunity", "prospect", "lead", "sell", "sales", "pipeline"])) {
    return "SALES_OPPORTUNITY";
  }

  if (matchesAny(normalized, ["customer", "company", "account", "details", "profile", "know about"])) {
    return "CUSTOMER_CONTEXT";
  }

  return "GENERAL_INSIGHT";
}

function buildDeterministicAnswer(
  intent: AssistantIntent,
  context: {
    companyCount: number;
    contactCount: number;
    openLeadCount: number;
    importRecordCount: number;
    knowledgeDocumentCount: number;
    memoryCount: number;
    topCompanyName: string | null;
    topCompanyScore: number | null;
    hasOpenAi: boolean;
    rateJobCount: number;
  }
) {
  switch (intent) {
    case "RATE_REQUEST":
      return [
        "Rate requests should be routed through the assistant as a structured collection flow: origin, destination, package or pallet details, service level, accessorials, and account/customer context.",
        `Today it can see ${context.rateJobCount} recent UPS/LTL quote job(s) and should hand off to UPS Tools or the LTL Rate Portal until live tool-calling is added.`
      ];
    case "CUSTOMER_CONTEXT":
      return [
        `The assistant can currently ground customer answers in ${context.companyCount} companies, ${context.contactCount} contacts, and ${context.importRecordCount} TradeMining records.`,
        context.topCompanyName
          ? `The highest-priority visible company is ${context.topCompanyName} with score ${context.topCompanyScore}.`
          : "No tenant companies are available yet."
      ];
    case "SALES_OPPORTUNITY":
      return [
        `There are ${context.openLeadCount} open lead(s) available for opportunity review.`,
        "The next step is to combine app pipeline state with email/TMS/WMS signals so the assistant can explain why an account is heating up or cooling down."
      ];
    case "OPERATIONAL_RISK":
      return [
        "Risk detection should come from delayed shipments, quote failures, billing exceptions, stale follow-ups, and negative email signals.",
        "This foundation stores risk memories separately from source documents so managers can review and correct them."
      ];
    case "EMAIL_DRAFT":
      return [
        "Email drafting should use retrieved customer context, contact role, service fit, recent activity, and approved tone rules.",
        "The assistant should draft only; sending should remain a human-approved action until permissions and audit flows are mature."
      ];
    default:
      return [
        `The assistant workspace has ${context.knowledgeDocumentCount} indexed knowledge document(s) and ${context.memoryCount} active memory item(s).`,
        context.hasOpenAi
          ? "An OpenAI credential exists for this tenant and can be wired behind a provider adapter."
          : "No tenant OpenAI credential is active yet; this page is using deterministic app data."
      ];
  }
}

function matchesAny(value: string, needles: string[]) {
  return needles.some((needle) => value.includes(needle));
}
