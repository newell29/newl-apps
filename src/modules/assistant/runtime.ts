import { AssistantSourceKind, IntegrationProvider, JobStatus, type Prisma } from "@prisma/client";

import { parseApolloActivityPrompt } from "@/modules/assistant/apollo-activity";
import { searchAssistantKnowledge } from "@/modules/assistant/knowledge";
import {
  computeNextAssistantAutomationRunAt,
  summarizeAutomationResult,
  type AssistantAutomationSchedule
} from "@/modules/assistant/automations";
import {
  buildAssistantAnswerForPrompt,
  buildAssistantSources,
  getAssistantWorkspace
} from "@/modules/assistant/queries";
import { prisma } from "@/server/db";
import {
  fetchApolloConversationsForUser,
  fetchApolloEmailerMessagesForUser,
  fetchApolloPhoneCallsForUser,
  fetchApolloRepDirectory
} from "@/server/integrations/apollo";
import {
  ASSISTANT_PROVIDER_CREDENTIAL_NAME,
  generateAssistantReply,
  parseAssistantProviderSettings
} from "@/server/integrations/assistant-provider";
import type { TenantContext } from "@/server/tenant-context";

export type AssistantRuntimeContext = TenantContext & {
  userId: string;
};

export async function runAssistantPrompt(
  context: AssistantRuntimeContext,
  prompt: string,
  existingThreadId?: string
) {
  const apolloActivityPrompt = parseApolloActivityPrompt(prompt);
  const workspace = await getAssistantWorkspace(context, prompt, existingThreadId, context.userId);
  if (apolloActivityPrompt) {
    const apolloCredential = await prisma.integrationCredential.findFirst({
      where: {
        tenantId: context.tenantId,
        provider: IntegrationProvider.APOLLO
      },
      select: {
        id: true
      }
    });

    if (apolloCredential) {
      try {
        const liveApolloReply = await buildApolloActivityAnswer(apolloActivityPrompt);
        return liveApolloReply;
      } catch (error) {
        return {
          answer:
            error instanceof Error
              ? `Apollo activity lookup failed: ${error.message}`
              : "Apollo activity lookup failed.",
          intent: "SALES_OPPORTUNITY" as const,
          provider: "APOLLO_ACTIVITY",
          model: "apollo-task-search-v1",
          messageMetadata: {
            deterministic: true,
            apolloActivityFallback: true
          },
          runMetadata: {
            deterministic: true,
            apolloActivityError: error instanceof Error ? error.message : "Unknown Apollo activity error"
          },
          sources: []
        };
      }
    }
  }

  const indexedSources = await searchAssistantKnowledge(context, prompt);
  const sources = indexedSources.length > 0 ? indexedSources : buildAssistantSources(workspace);
  const providerCredential = await prisma.integrationCredential.findFirst({
    where: {
      tenantId: context.tenantId,
      name: ASSISTANT_PROVIDER_CREDENTIAL_NAME
    },
    select: {
      provider: true,
      status: true,
      publicConfig: true
    }
  });
  const providerSettings = parseAssistantProviderSettings(providerCredential);
  const deterministic = buildAssistantAnswerForPrompt(prompt, {
    companyCount: workspace.stats.companyCount,
    contactCount: workspace.stats.contactCount,
    openLeadCount: workspace.stats.openLeadCount,
    importRecordCount: workspace.stats.importRecordCount,
    knowledgeDocumentCount: workspace.stats.knowledgeDocumentCount,
    memoryCount: workspace.stats.memoryCount,
    topCompanyName: workspace.topCompanies[0]?.name ?? null,
    topCompanyScore: workspace.topCompanies[0]?.priorityScore ?? null,
    hasOpenAi: workspace.integrations.some((integration) => integration.provider === "OPENAI" && integration.activeCount > 0),
    hasLocalLlm: workspace.integrations.some((integration) => integration.provider === "LOCAL_LLM" && integration.activeCount > 0),
    rateJobCount: workspace.recentRateJobs.length
  });

  let answer = deterministic.answer.join("\n\n");
  let provider = "NEWL_DETERMINISTIC";
  let model = "assistant-foundation-v1";
  let messageMetadata: Record<string, unknown> = {
    deterministic: true,
    intent: deterministic.intent
  };
  let runMetadata: Record<string, unknown> = {
    deterministic: true,
    intent: deterministic.intent,
    providerSettings
  };

  if (providerSettings.liveResponsesEnabled && providerSettings.runtimeReady) {
    try {
      const liveReply = await generateAssistantReply({
        tenantName: context.tenantName,
        prompt,
        intent: deterministic.intent,
        sources: sources.map((source) => ({
          title: source.title,
          excerpt: source.excerpt
        })),
        settings: providerSettings
      });

      answer = liveReply.content;
      provider = liveReply.provider;
      model = liveReply.model;
      messageMetadata = {
        deterministic: false,
        intent: deterministic.intent,
        provider,
        model,
        usedFallbackModel: liveReply.usedFallbackModel
      };
      runMetadata = {
        deterministic: false,
        intent: deterministic.intent,
        usedFallbackModel: liveReply.usedFallbackModel,
        rawResponse: liveReply.rawResponse
      };
    } catch (error) {
      messageMetadata = {
        deterministic: true,
        intent: deterministic.intent,
        providerFallback: true
      };
      runMetadata = {
        deterministic: true,
        intent: deterministic.intent,
        providerSettings,
        liveReplyError: error instanceof Error ? error.message : "Unknown provider error"
      };
    }
  }

  return {
    answer,
    intent: deterministic.intent,
    provider,
    model,
    messageMetadata,
    runMetadata,
    sources
  };
}

async function buildApolloActivityAnswer(request: NonNullable<ReturnType<typeof parseApolloActivityPrompt>>) {
  const repDirectory = await fetchApolloRepDirectory();
  const normalizedTarget = normalizeApolloRepName(request.repName);
  const rep =
    repDirectory.find((entry) => normalizeApolloRepName(entry.sequenceOwnerName) === normalizedTarget) ??
    repDirectory.find((entry) => normalizeApolloRepName(entry.sequenceOwnerName).includes(normalizedTarget));

  if (!rep) {
    throw new Error(`No Apollo teammate match was found for "${request.repName}".`);
  }

  const { answer, metricLabel, count } = await buildApolloMetricAnswer(rep.apolloUserId, rep.sequenceOwnerName, request);

  return {
    answer,
    intent: "SALES_OPPORTUNITY" as const,
    provider: "APOLLO_ACTIVITY",
    model: "apollo-task-search-v1",
    messageMetadata: {
      deterministic: true,
      apolloActivity: true,
      metric: request.metric
    },
    runMetadata: {
      deterministic: true,
      apolloActivity: {
        repName: rep.sequenceOwnerName,
        apolloUserId: rep.apolloUserId,
        metric: request.metric,
        windowKind: request.window.kind,
        windowLabel: request.window.label,
        timezone: request.window.timezone,
        count
      }
    },
    sources: [
      {
        sourceKind: AssistantSourceKind.INTEGRATION,
        sourceId: rep.apolloUserId,
        title: `Apollo ${metricLabel} for ${rep.sequenceOwnerName}`,
        excerpt:
          request.window.kind === "day"
            ? `${metricLabel}: ${count} on ${request.window.exactDateLabel} (${request.window.timezone}).`
            : `${metricLabel}: ${count} over ${request.window.label} (${request.window.timezone}).`,
        metadata: {
          provider: "APOLLO",
          metric: request.metric,
          timezone: request.window.timezone
        }
      }
    ]
  };
}

async function buildApolloMetricAnswer(
  apolloUserId: string,
  repName: string,
  request: NonNullable<ReturnType<typeof parseApolloActivityPrompt>>
) {
  if (request.metric === "calls") {
    const calls = await fetchApolloPhoneCallsForUser(apolloUserId);
    const matching = calls.filter((call) => matchesDateWindow(call.startTime, request.window));
    return {
      count: matching.length,
      metricLabel: "calls logged",
      answer: formatApolloMetricAnswer(repName, "calls logged", matching.length, request)
    };
  }

  if (request.metric === "connected_calls") {
    const conversations = await fetchApolloConversationsForUser(apolloUserId);
    const matching = conversations.filter(
      (conversation) =>
        conversation.conversationType === "phone_call" &&
        matchesDateWindow(conversation.startTime, request.window)
    );
    return {
      count: matching.length,
      metricLabel: "connected calls",
      answer: formatApolloMetricAnswer(repName, "connected calls", matching.length, request)
    };
  }

  if (request.metric === "emails") {
    const emails = await fetchApolloEmailerMessagesForUser(apolloUserId);
    const matching = emails.filter(
      (email) =>
        email.status === "completed" &&
        matchesDateWindow(email.completedAt ?? email.createdAt, request.window)
    );
    return {
      count: matching.length,
      metricLabel: "emails sent",
      answer: formatApolloMetricAnswer(repName, "emails sent", matching.length, request)
    };
  }

  if (request.metric === "replies") {
    const emails = await fetchApolloEmailerMessagesForUser(apolloUserId);
    const matching = emails.filter(
      (email) =>
        (email.replied === true || Boolean(email.replyClass)) &&
        matchesDateWindow(email.completedAt ?? email.createdAt, request.window)
    );
    return {
      count: matching.length,
      metricLabel: "reply signals",
      answer: formatApolloMetricAnswer(repName, "reply signals", matching.length, request)
    };
  }

  throw new Error(`Unsupported Apollo metric: ${request.metric}`);
}

function matchesDateWindow(date: Date | null, window: NonNullable<ReturnType<typeof parseApolloActivityPrompt>>["window"]) {
  if (!date) {
    return false;
  }

  return date >= window.start && date <= window.end;
}

function formatApolloMetricAnswer(
  repName: string,
  metricLabel: string,
  count: number,
  request: NonNullable<ReturnType<typeof parseApolloActivityPrompt>>
) {
  return request.window.kind === "day"
    ? `Apollo ${metricLabel} for ${repName} on ${request.window.exactDateLabel} (${request.window.timezone}): ${count}.`
    : `Apollo ${metricLabel} for ${repName} over ${request.window.label} (${request.window.timezone}), from ${request.window.start.toISOString().slice(0, 10)} to ${request.window.end.toISOString().slice(0, 10)}: ${count}.`;
}

function normalizeApolloRepName(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export async function executeAssistantAutomation(
  context: AssistantRuntimeContext,
  automationId: string,
  trigger: "manual" | "scheduled"
) {
  const automation = await prisma.assistantAutomation.findFirst({
    where: {
      tenantId: context.tenantId,
      userId: context.userId,
      id: automationId
    },
    select: {
      id: true,
      name: true,
      prompt: true,
      scheduleType: true,
      scheduleTime: true,
      scheduleTimezone: true
    }
  });

  if (!automation) {
    throw new Error("Saved assistant agent not found.");
  }

  const now = new Date();
  const response = await runAssistantPrompt(context, automation.prompt);
  const nextRunAt = computeNextAssistantAutomationRunAt(
    automation.scheduleType as AssistantAutomationSchedule,
    automation.scheduleTime,
    automation.scheduleTimezone,
    now
  );

  await prisma.$transaction(async (tx) => {
    const assistantRun = await tx.assistantRun.create({
      data: {
        tenantId: context.tenantId,
        userId: context.userId,
        provider: response.provider,
        model: response.model,
        status: JobStatus.SUCCESS,
        intent: response.intent,
        startedAt: now,
        finishedAt: now,
        metadata: {
          sourceCount: response.sources.length,
          automationId: automation.id,
          automationName: automation.name,
          trigger,
          ...response.runMetadata
        } as Prisma.InputJsonValue
      },
      select: {
        id: true
      }
    });

    if (response.sources.length > 0) {
      await tx.assistantRetrievedSource.createMany({
        data: response.sources.map((source) => ({
          tenantId: context.tenantId,
          runId: assistantRun.id,
          sourceKind: source.sourceKind,
          sourceId: source.sourceId,
          title: source.title,
          excerpt: source.excerpt,
          metadata: source.metadata as Prisma.InputJsonValue | undefined
        }))
      });
    }

    await tx.assistantAutomationRun.create({
      data: {
        tenantId: context.tenantId,
        automationId: automation.id,
        userId: context.userId,
        status: JobStatus.SUCCESS,
        promptSnapshot: automation.prompt,
        responseText: response.answer,
        sourceCount: response.sources.length,
        metadata: {
          provider: response.provider,
          model: response.model,
          assistantRunId: assistantRun.id,
          trigger
        } as Prisma.InputJsonValue,
        startedAt: now,
        finishedAt: now
      }
    });

    await tx.assistantAutomation.update({
      where: {
        id: automation.id
      },
      data: {
        lastRunAt: now,
        nextRunAt,
        lastResultSummary: summarizeAutomationResult(response.answer)
      }
    });

    await tx.auditLog.create({
      data: {
        tenantId: context.tenantId,
        actorUserId: context.userId,
        action: "assistant.automation.run",
        entityType: "AssistantAutomation",
        entityId: automation.id,
        after: {
          automationName: automation.name,
          sourceCount: response.sources.length,
          provider: response.provider,
          model: response.model,
          trigger
        } as Prisma.InputJsonValue
      }
    });
  });

  return {
    automationId: automation.id,
    name: automation.name,
    sourceCount: response.sources.length,
    provider: response.provider,
    model: response.model,
    nextRunAt
  };
}

export async function runDueAssistantAutomationsForTenant(tenant: TenantContext, now = new Date()) {
  const dueAutomations = await prisma.assistantAutomation.findMany({
    where: {
      tenantId: tenant.tenantId,
      status: "ACTIVE",
      nextRunAt: {
        lte: now
      }
    },
    orderBy: {
      nextRunAt: "asc"
    },
    take: 25,
    select: {
      id: true,
      userId: true
    }
  });

  const results = [];

  for (const automation of dueAutomations) {
    const result = await executeAssistantAutomation(
      {
        tenantId: tenant.tenantId,
        tenantSlug: tenant.tenantSlug,
        tenantName: tenant.tenantName,
        userId: automation.userId
      },
      automation.id,
      "scheduled"
    );

    results.push(result);
  }

  return {
    processedCount: results.length,
    results
  };
}
