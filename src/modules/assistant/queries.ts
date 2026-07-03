import {
  AssistantMemoryKind,
  AssistantMessageRole,
  AssistantSourceKind,
  IntegrationProvider,
  LeadPipelineStage
} from "@prisma/client";

import { summarizeAssistantAutomationSchedule } from "@/modules/assistant/automations";
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
  IntegrationProvider.APOLLO,
  IntegrationProvider.LOCAL_LLM,
  IntegrationProvider.OPENAI,
  IntegrationProvider.MICROSOFT_GRAPH,
  IntegrationProvider.UPS,
  IntegrationProvider.SEVEN_L,
  IntegrationProvider.TMS,
  IntegrationProvider.WMS
];

const MANAGER_SIGNAL_KINDS = [
  AssistantMemoryKind.OPERATIONAL_RISK,
  AssistantMemoryKind.SALES_OPPORTUNITY,
  AssistantMemoryKind.CUSTOMER_PROFILE,
  AssistantMemoryKind.SERVICE_CAPABILITY
];

export type AssistantIntent =
  | "RATE_REQUEST"
  | "CUSTOMER_CONTEXT"
  | "SALES_OPPORTUNITY"
  | "OPERATIONAL_RISK"
  | "EMAIL_DRAFT"
  | "GENERAL_INSIGHT";

export async function getAssistantWorkspace(
  tenant: TenantContext,
  query?: string,
  threadId?: string,
  userId?: string
) {
  const [
    companyCount,
    contactCount,
    openLeadCount,
    importRecordCount,
    knowledgeDocumentCount,
    memoryCount,
    knowledgeCoverage,
    recentMemories,
    managerSignalCounts,
    managerSignalMemories,
    personalAutomations,
    automationInbox,
    integrations,
    topCompanies,
    openLeads,
    recentRateJobs,
    recentMicrosoftEmails,
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
    prisma.assistantKnowledgeDocument.groupBy({
      by: ["sourceKind"],
      where: tenantWhere(tenant),
      _count: {
        _all: true
      }
    }),
    prisma.assistantMemory.findMany({
      where: tenantWhere(tenant, { status: "ACTIVE" }),
      orderBy: [{ confidence: "desc" }, { updatedAt: "desc" }],
      take: 8,
      select: {
        id: true,
        kind: true,
        subjectType: true,
        subjectId: true,
        title: true,
        summary: true,
        confidence: true,
        lastObservedAt: true,
        sourceDocument: {
          select: {
            sourceKind: true,
            externalId: true,
            title: true
          }
        }
      }
    }),
    prisma.assistantMemory.groupBy({
      by: ["kind"],
      where: tenantWhere(tenant, {
        status: "ACTIVE",
        kind: {
          in: MANAGER_SIGNAL_KINDS
        }
      }),
      _count: {
        _all: true
      }
    }),
    prisma.assistantMemory.findMany({
      where: tenantWhere(tenant, {
        status: "ACTIVE",
        kind: {
          in: MANAGER_SIGNAL_KINDS
        }
      }),
      orderBy: [{ lastObservedAt: "desc" }, { confidence: "desc" }, { updatedAt: "desc" }],
      take: 16,
      select: {
        id: true,
        kind: true,
        subjectType: true,
        subjectId: true,
        title: true,
        summary: true,
        confidence: true,
        lastObservedAt: true
      }
    }),
    userId
      ? prisma.assistantAutomation.findMany({
          where: tenantWhere(tenant, {
            userId
          }),
          orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
          take: 8,
          select: {
            id: true,
            name: true,
            prompt: true,
            scheduleType: true,
            scheduleTime: true,
            scheduleTimezone: true,
            status: true,
            lastRunAt: true,
            nextRunAt: true,
            lastResultSummary: true,
            runs: {
              orderBy: {
                startedAt: "desc"
              },
              take: 3,
              select: {
                id: true,
                status: true,
                responseText: true,
                sourceCount: true,
                startedAt: true,
                finishedAt: true
              }
            }
          }
        })
      : Promise.resolve([]),
    userId
      ? prisma.assistantAutomationRun.findMany({
          where: tenantWhere(tenant, {
            userId
          }),
          orderBy: [{ startedAt: "desc" }, { createdAt: "desc" }],
          take: 8,
          select: {
            id: true,
            status: true,
            responseText: true,
            sourceCount: true,
            startedAt: true,
            finishedAt: true,
            automation: {
              select: {
                id: true,
                name: true
              }
            }
          }
        })
      : Promise.resolve([]),
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
    prisma.assistantKnowledgeDocument.findMany({
      where: tenantWhere(tenant, {
        sourceSystem: "MICROSOFT_GRAPH_MAIL"
      }),
      orderBy: [{ sourceUpdatedAt: "desc" }, { indexedAt: "desc" }],
      take: 50,
      select: {
        id: true,
        title: true,
        sourceUpdatedAt: true,
        indexedAt: true,
        metadata: true
      }
    }),
    prisma.assistantChatThread.findMany({
      where: tenantWhere(tenant, {
        status: "ACTIVE",
        ...(userId ? { userId } : {})
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
            id: threadId,
            ...(userId ? { userId } : {})
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
                messageId: true,
                intent: true,
                status: true,
                provider: true,
                model: true,
                startedAt: true,
                metadata: true,
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
    knowledgeCoverage: knowledgeCoverage.map((entry) => ({
      sourceKind: entry.sourceKind,
      count: entry._count._all
    })),
    managerSummary: buildAssistantManagerSummary(
      managerSignalMemories.map((memory) => ({
        id: memory.id,
        kind: memory.kind,
        subjectType: memory.subjectType,
        subjectId: memory.subjectId,
        title: memory.title,
        summary: memory.summary,
        confidence: memory.confidence,
        lastObservedAt: memory.lastObservedAt
      })),
      managerSignalCounts
    ),
    recentMemories: recentMemories.map((memory) => ({
      id: memory.id,
      kind: memory.kind,
      subjectType: memory.subjectType,
      subjectId: memory.subjectId,
      title: memory.title,
      summary: memory.summary,
      confidence: memory.confidence,
      lastObservedAt: memory.lastObservedAt,
      sourceDocument: memory.sourceDocument
        ? {
            sourceKind: memory.sourceDocument.sourceKind,
            sourceId: memory.sourceDocument.externalId,
            title: memory.sourceDocument.title
          }
        : null
    })),
    personalAutomations: personalAutomations.map((automation) => ({
      id: automation.id,
      name: automation.name,
      prompt: automation.prompt,
      scheduleType: automation.scheduleType,
      scheduleTime: automation.scheduleTime,
      scheduleTimezone: automation.scheduleTimezone,
      scheduleSummary: summarizeAssistantAutomationSchedule(
        automation.scheduleType as "DAILY" | "WEEKDAYS" | "MONDAYS",
        automation.scheduleTime,
        automation.scheduleTimezone
      ),
      status: automation.status,
      lastRunAt: automation.lastRunAt,
      nextRunAt: automation.nextRunAt,
      lastResultSummary: automation.lastResultSummary,
      recentRuns: automation.runs.map((run) => ({
        id: run.id,
        status: run.status,
        responseText: run.responseText,
        sourceCount: run.sourceCount,
        startedAt: run.startedAt,
        finishedAt: run.finishedAt
      }))
    })),
    automationInbox: automationInbox.map((run) => ({
      id: run.id,
      status: run.status,
      responseText: run.responseText,
      sourceCount: run.sourceCount,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      automation: {
        id: run.automation.id,
        name: run.automation.name
      }
    })),
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
    microsoftEmailCoverage: buildMicrosoftEmailCoverage(recentMicrosoftEmails),
    recentMicrosoftEmails: recentMicrosoftEmails.slice(0, 12).map((document) => {
      const metadata = readJsonObject(document.metadata);

      return {
        id: document.id,
        title: document.title,
        mailboxAddress: readMetadataString(metadata, "mailboxAddress"),
        fromName: readMetadataString(metadata, "fromName"),
        fromAddress: readMetadataString(metadata, "fromAddress"),
        receivedAt: document.sourceUpdatedAt,
        indexedAt: document.indexedAt
      };
    }),
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
          conversationSummary:
            activeThread.runs
              .map((run) => readRunMetadataString(run.metadata, "conversationSummary"))
              .find((summary): summary is string => Boolean(summary)) ?? null,
          messages: activeThread.messages.map((message) => ({
            id: message.id,
            role: message.role,
            content: message.content,
            createdAt: message.createdAt
          })),
          recentRuns: activeThread.runs.map((run) => ({
            id: run.id,
            messageId: run.messageId,
            intent: run.intent,
            status: run.status,
            provider: run.provider,
            model: run.model,
            startedAt: run.startedAt,
            deterministic: readRunMetadataBoolean(run.metadata, "deterministic"),
            liveReplyAttempted: readRunMetadataBoolean(run.metadata, "liveReplyAttempted"),
            liveReplySkipped: readRunMetadataBoolean(run.metadata, "liveReplySkipped"),
            liveReplySkipReason: readRunMetadataString(run.metadata, "liveReplySkipReason"),
            providerFallback: readRunMetadataBoolean(run.metadata, "providerFallback"),
            liveReplyError: readRunMetadataString(run.metadata, "liveReplyError"),
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

  for (const memory of workspace.recentMemories.slice(0, 3)) {
    sources.push({
      sourceKind: memory.sourceDocument?.sourceKind ?? AssistantSourceKind.OTHER,
      sourceId: memory.sourceDocument?.sourceId ?? memory.subjectId ?? null,
      title: memory.title,
      excerpt: memory.summary,
      metadata: {
        memoryKind: memory.kind,
        confidence: memory.confidence,
        subjectType: memory.subjectType
      }
    });
  }

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

export function buildAssistantManagerSummary(
  memories: Array<{
    id: string;
    kind: AssistantMemoryKind;
    subjectType: string;
    subjectId: string | null;
    title: string;
    summary: string;
    confidence: number;
    lastObservedAt: Date | null;
  }>,
  counts: Array<{
    kind: AssistantMemoryKind;
    _count: {
      _all: number;
    };
  }>
) {
  const countsByKind = new Map(counts.map((entry) => [entry.kind, entry._count._all]));
  const topRisks = selectTopManagerSignals(memories, AssistantMemoryKind.OPERATIONAL_RISK, 3);
  const topOpportunities = selectTopManagerSignals(memories, AssistantMemoryKind.SALES_OPPORTUNITY, 3);
  const topCustomers = selectTopManagerSignals(memories, AssistantMemoryKind.CUSTOMER_PROFILE, 3);
  const topServices = selectTopManagerSignals(memories, AssistantMemoryKind.SERVICE_CAPABILITY, 3);

  return {
    counts: {
      risks: countsByKind.get(AssistantMemoryKind.OPERATIONAL_RISK) ?? 0,
      opportunities: countsByKind.get(AssistantMemoryKind.SALES_OPPORTUNITY) ?? 0,
      customers: countsByKind.get(AssistantMemoryKind.CUSTOMER_PROFILE) ?? 0,
      services: countsByKind.get(AssistantMemoryKind.SERVICE_CAPABILITY) ?? 0
    },
    topRisks,
    topOpportunities,
    topCustomers,
    topServices
  };
}

function selectTopManagerSignals(
  memories: Array<{
    id: string;
    kind: AssistantMemoryKind;
    subjectType: string;
    subjectId: string | null;
    title: string;
    summary: string;
    confidence: number;
    lastObservedAt: Date | null;
  }>,
  kind: AssistantMemoryKind,
  take: number
) {
  return memories
    .filter((memory) => memory.kind === kind)
    .sort((left, right) => {
      const leftTime = left.lastObservedAt?.getTime() ?? 0;
      const rightTime = right.lastObservedAt?.getTime() ?? 0;
      if (rightTime !== leftTime) {
        return rightTime - leftTime;
      }
      return right.confidence - left.confidence;
    })
    .slice(0, take)
    .map((memory) => ({
      id: memory.id,
      title: memory.title,
      summary: memory.summary,
      confidence: memory.confidence,
      subjectType: memory.subjectType,
      subjectId: memory.subjectId,
      lastObservedAt: memory.lastObservedAt
    }));
}

function buildMicrosoftEmailCoverage(
  documents: Array<{
    metadata: unknown;
    sourceUpdatedAt: Date | null;
    indexedAt: Date | null;
  }>
) {
  const coverage = new Map<
    string,
    {
      mailboxAddress: string;
      recentIndexedCount: number;
      latestReceivedAt: Date | null;
      latestIndexedAt: Date | null;
    }
  >();

  for (const document of documents) {
    const metadata = readJsonObject(document.metadata);
    const mailboxAddress = readMetadataString(metadata, "mailboxAddress") ?? "Signed-in mailbox";
    const current =
      coverage.get(mailboxAddress) ??
      {
        mailboxAddress,
        recentIndexedCount: 0,
        latestReceivedAt: null,
        latestIndexedAt: null
      };

    current.recentIndexedCount += 1;
    current.latestReceivedAt = maxDate(current.latestReceivedAt, document.sourceUpdatedAt);
    current.latestIndexedAt = maxDate(current.latestIndexedAt, document.indexedAt);
    coverage.set(mailboxAddress, current);
  }

  return Array.from(coverage.values()).sort((left, right) => {
    const leftTime = left.latestReceivedAt?.getTime() ?? 0;
    const rightTime = right.latestReceivedAt?.getTime() ?? 0;
    return rightTime - leftTime;
  });
}

function maxDate(left: Date | null, right: Date | null) {
  if (!left) return right;
  if (!right) return left;
  return left.getTime() >= right.getTime() ? left : right;
}

function readMetadataString(metadata: Record<string, unknown>, key: string) {
  const value = metadata[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function readJsonObject(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
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
        "Rate requests should be routed through the assistant as a structured collection flow: origin, destination, ZIP or postal codes, package or pallet details, service level, accessorials, and account context.",
        `Today it can see ${context.rateJobCount} recent UPS/LTL quote job(s). Complete LTL shipment details can now be handed to the tenant's 7L configuration for live quoting.`
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

function readRunMetadataString(metadata: unknown, key: string) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return null;
  }

  const value = (metadata as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function readRunMetadataBoolean(metadata: unknown, key: string) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return false;
  }

  return (metadata as Record<string, unknown>)[key] === true;
}
