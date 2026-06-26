import { JobStatus, PlatformRole, type Prisma } from "@prisma/client";

import { searchAssistantKnowledge } from "@/modules/assistant/knowledge";
import { maybeRunAssistantRateRequest } from "@/modules/assistant/rate-workflow";
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
  ASSISTANT_PROVIDER_CREDENTIAL_NAME,
  generateAssistantReply,
  parseAssistantProviderSettings
} from "@/server/integrations/assistant-provider";
import type { AuthenticatedContext, TenantContext } from "@/server/tenant-context";

export type AssistantRuntimeContext = AuthenticatedContext;

export async function runAssistantPrompt(
  context: AssistantRuntimeContext,
  prompt: string,
  existingThreadId?: string
) {
  const workspace = await getAssistantWorkspace(context, prompt, existingThreadId, context.userId);
  const indexedSources = await searchAssistantKnowledge(context, prompt);
  const sources = indexedSources.length > 0 ? indexedSources : buildAssistantSources(workspace);
  const providerCredential = await prisma.integrationCredential.findFirst({
    where: {
      tenantId: context.tenantId,
      name: ASSISTANT_PROVIDER_CREDENTIAL_NAME
    },
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
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

  if (deterministic.intent === "RATE_REQUEST") {
    const rateResponse = await maybeRunAssistantRateRequest(context, prompt);

    if (rateResponse) {
      return {
        answer: rateResponse.answer,
        intent: deterministic.intent,
        provider: "NEWL_RATE_WORKFLOW",
        model: "assistant-rate-workflow-v1",
        messageMetadata: {
          deterministic: true,
          intent: deterministic.intent,
          ...rateResponse.metadata
        },
        runMetadata: {
          deterministic: true,
          intent: deterministic.intent,
          ...rateResponse.metadata
        },
        sources: rateResponse.sources
      };
    }
  }

  let answer = deterministic.answer.join("\n\n");
  let provider = "NEWL_DETERMINISTIC";
  let model = "assistant-foundation-v1";
  let messageMetadata: Record<string, unknown> = {
    deterministic: true,
    intent: deterministic.intent,
    liveReplyAttempted: false
  };
  let runMetadata: Record<string, unknown> = {
    deterministic: true,
    intent: deterministic.intent,
    providerSettings,
    liveReplyAttempted: false
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
        usedFallbackModel: liveReply.usedFallbackModel,
        liveReplyAttempted: true
      };
      runMetadata = {
        deterministic: false,
        intent: deterministic.intent,
        usedFallbackModel: liveReply.usedFallbackModel,
        rawResponse: liveReply.rawResponse,
        liveReplyAttempted: true
      };
    } catch (error) {
      messageMetadata = {
        deterministic: true,
        intent: deterministic.intent,
        providerFallback: true,
        liveReplyAttempted: true
      };
      runMetadata = {
        deterministic: true,
        intent: deterministic.intent,
        providerFallback: true,
        providerSettings,
        liveReplyAttempted: true,
        liveReplyError: error instanceof Error ? error.message : "Unknown provider error"
      };
    }
  } else {
    const skipReason = !providerSettings.liveResponsesEnabled
      ? "Live assistant replies are disabled in Settings."
      : !providerSettings.runtimeReady
        ? "Live assistant runtime is not ready. OPENAI_API_KEY is likely missing in the running server environment."
        : "Live assistant reply was skipped before provider execution.";

    messageMetadata = {
      deterministic: true,
      intent: deterministic.intent,
      liveReplyAttempted: false,
      liveReplySkipped: true
    };
    runMetadata = {
      deterministic: true,
      intent: deterministic.intent,
      providerSettings,
      liveReplyAttempted: false,
      liveReplySkipped: true,
      liveReplySkipReason: skipReason
    };
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
      userId: true,
      user: {
        select: {
          email: true,
          name: true,
          memberships: {
            where: {
              tenantId: tenant.tenantId
            },
            select: {
              role: true
            },
            take: 1
          }
        }
      }
    }
  });

  const results = [];

  for (const automation of dueAutomations) {
    const result = await executeAssistantAutomation(
      {
        tenantId: tenant.tenantId,
        tenantSlug: tenant.tenantSlug,
        tenantName: tenant.tenantName,
        userId: automation.userId,
        userEmail: automation.user.email,
        userName: automation.user.name,
        role: automation.user.memberships[0]?.role ?? PlatformRole.READ_ONLY
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
