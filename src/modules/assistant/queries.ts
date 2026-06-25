import {
  AssistantMessageRole,
  AssistantSourceKind,
  IntegrationProvider,
  LeadPipelineStage
} from "@prisma/client";

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
  IntegrationProvider.LOCAL_LLM,
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

export async function getAssistantWorkspace(tenant: TenantContext, query?: string, threadId?: string) {
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
    recentRateJobs,
    recentThreads,
    activeThread
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
    }),
    prisma.assistantChatThread.findMany({
      where: tenantWhere(tenant, {
        status: "ACTIVE"
      }),
      orderBy: [{ lastMessageAt: "desc" }, { updatedAt: "desc" }],
      take: 8,
      select: {
        id: true,
        title: true,
        updatedAt: true,
        lastMessageAt: true,
        _count: {
          select: {
            messages: true
          }
        }
      }
    }),
    threadId
      ? prisma.assistantChatThread.findFirst({
          where: tenantWhere(tenant, {
            id: threadId
          }),
          select: {
            id: true,
            title: true,
            updatedAt: true,
            lastMessageAt: true,
            messages: {
              orderBy: {
                createdAt: "asc"
              },
              select: {
                id: true,
                role: true,
                content: true,
                createdAt: true
              }
            },
            runs: {
              orderBy: {
                startedAt: "desc"
              },
              take: 3,
              select: {
                id: true,
                intent: true,
                status: true,
                provider: true,
                model: true,
                startedAt: true,
                retrievedSources: {
                  orderBy: {
                    createdAt: "asc"
                  },
                  select: {
                    id: true,
                    sourceKind: true,
                    sourceId: true,
                    title: true,
                    excerpt: true
                  }
                }
              }
            }
          }
        })
      : Promise.resolve(null)
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
      hasLocalLlm: integrations.some((integration) => integration.provider === IntegrationProvider.LOCAL_LLM),
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
    recentRateJobs,
    recentThreads: recentThreads.map((thread) => ({
      id: thread.id,
      title: thread.title,
      updatedAt: thread.updatedAt,
      lastMessageAt: thread.lastMessageAt,
      messageCount: thread._count.messages
    })),
    activeThread: activeThread
      ? {
          id: activeThread.id,
          title: activeThread.title,
          updatedAt: activeThread.updatedAt,
          lastMessageAt: activeThread.lastMessageAt,
          messages: activeThread.messages.map((message) => ({
            id: message.id,
            role: message.role,
            content: message.content,
            createdAt: message.createdAt
          })),
          recentRuns: activeThread.runs.map((run) => ({
            id: run.id,
            intent: run.intent,
            status: run.status,
            provider: run.provider,
            model: run.model,
            startedAt: run.startedAt,
            retrievedSources: run.retrievedSources.map((source) => ({
              id: source.id,
              sourceKind: source.sourceKind,
              sourceId: source.sourceId,
              title: source.title,
              excerpt: source.excerpt
            }))
          }))
        }
      : null
  };
}

export function buildAssistantAnswerForPrompt(
  prompt: string,
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
    hasLocalLlm: boolean;
    rateJobCount: number;
  }
) {
  const intent = classifyAssistantIntent(prompt);

  return {
    intent,
    answer: buildDeterministicAnswer(intent, context)
  };
}

export function buildAssistantSources(workspace: Awaited<ReturnType<typeof getAssistantWorkspace>>) {
  const sources: Array<{
    sourceKind: AssistantSourceKind;
    sourceId: string | null;
    title: string;
    excerpt: string;
    metadata?: Record<string, unknown>;
  }> = [];

  for (const company of workspace.topCompanies.slice(0, 3)) {
    sources.push({
      sourceKind: AssistantSourceKind.COMPANY,
      sourceId: company.id,
      title: company.name,
      excerpt: `${company.importRecordCount} imports, ${company.contactCount} contacts, priority score ${company.priorityScore}.`,
      metadata: {
        candidateStatus: company.candidateStatus,
        primaryIndustry: company.primaryIndustry
      }
    });
  }

  for (const lead of workspace.openLeads.slice(0, 3)) {
    sources.push({
      sourceKind: AssistantSourceKind.LEAD,
      sourceId: lead.id,
      title: `${lead.company.name} lead`,
      excerpt: `Stage ${lead.stage}, score ${lead.score}${lead.contact ? `, contact ${lead.contact.fullName}` : ""}.`,
      metadata: {
        companyId: lead.company.id,
        stage: lead.stage
      }
    });
  }

  for (const job of workspace.recentRateJobs.slice(0, 2)) {
    sources.push({
      sourceKind: AssistantSourceKind.RATE_TOOL,
      sourceId: job.id,
      title: job.jobType,
      excerpt: `Rate job ${job.status} at ${job.startedAt.toISOString()}.`,
      metadata: {
        status: job.status,
        finishedAt: job.finishedAt?.toISOString() ?? null
      }
    });
  }

  return sources;
}

export function formatAssistantRole(role: AssistantMessageRole) {
  if (role === AssistantMessageRole.USER) return "You";
  if (role === AssistantMessageRole.ASSISTANT) return "Assistant";
  if (role === AssistantMessageRole.TOOL) return "Tool";
  return "System";
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
    hasLocalLlm: boolean;
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
        context.hasLocalLlm
          ? "A local LLM provider exists for this tenant. This should become the preferred long-term assistant runtime once quality and latency are proven."
          : context.hasOpenAi
          ? "An OpenAI credential exists for this tenant and can be wired behind a provider adapter."
          : "No tenant model provider is active yet; this page is using deterministic app data. The interim target is a cost-effective OpenAI model, with a local server-hosted model as the long-term goal."
      ];
  }
}

function matchesAny(value: string, needles: string[]) {
  return needles.some((needle) => value.includes(needle));
}
