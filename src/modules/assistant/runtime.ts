import { AssistantSourceKind, JobStatus, PlatformRole, type Prisma } from "@prisma/client";

import { maybeRunAssistantApolloActivityRequest } from "@/modules/assistant/apollo-workflow";
import { searchAssistantKnowledge } from "@/modules/assistant/knowledge";
import { maybeRunAssistantRateRequest } from "@/modules/assistant/rate-tools";
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
  parseAssistantProviderAuth,
  parseAssistantProviderSettings,
  type AssistantConversationTurn
} from "@/server/integrations/assistant-provider";
import type { AuthenticatedContext, TenantContext } from "@/server/tenant-context";

export type AssistantRuntimeContext = AuthenticatedContext;

export async function runAssistantPrompt(
  context: AssistantRuntimeContext,
  prompt: string,
  existingThreadId?: string
) {
  const workspace = await getAssistantWorkspace(context, prompt, existingThreadId, context.userId);
  const priorConversationSummary = workspace.activeThread?.conversationSummary ?? null;
  const threadPromptContext = workspace.activeThread
    ? workspace.activeThread.messages
        .filter((message) => message.role === "USER")
        .slice(-4)
        .map((message) => message.content)
        .join("\n")
    : null;
  const conversationHistory: AssistantConversationTurn[] = workspace.activeThread
    ? workspace.activeThread.messages
        .filter(
          (message) =>
            message.role === "USER" || message.role === "ASSISTANT"
        )
        .slice(-8)
        .map((message) => ({
          role: message.role === "USER" ? "user" : "assistant",
          content: message.content
        }))
    : [];
  const memorySnapshot = workspace.recentMemories.slice(0, 6).map((memory) => ({
    kind: memory.kind,
    title: memory.title,
    summary: memory.summary
  }));
  const toolRateReply = await maybeRunAssistantRateRequest(context, prompt, threadPromptContext);
  if (toolRateReply) {
    return finalizeAssistantResponse(workspace, prompt, toolRateReply);
  }

  const directComputationReply = maybeBuildDirectComputationResponse(prompt);
  if (directComputationReply) {
    return finalizeAssistantResponse(workspace, prompt, directComputationReply);
  }

  const guidanceReply = maybeBuildAssistantGuidanceResponse(workspace, prompt);
  if (guidanceReply) {
    return finalizeAssistantResponse(workspace, prompt, guidanceReply);
  }

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
      publicConfig: true,
      secretRef: true
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

  const apolloActivityResponse = await maybeRunAssistantApolloActivityRequest(context, prompt);

  if (apolloActivityResponse) {
    return finalizeAssistantResponse(workspace, prompt, {
      answer: apolloActivityResponse.answer,
      intent: deterministic.intent,
      provider: "NEWL_APOLLO_WORKFLOW",
      model: "assistant-apollo-workflow-v1",
      messageMetadata: {
        deterministic: true,
        intent: deterministic.intent,
        ...apolloActivityResponse.metadata
      },
      runMetadata: {
        deterministic: true,
        intent: deterministic.intent,
        ...apolloActivityResponse.metadata
      },
      sources: apolloActivityResponse.sources
    });
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
      const providerAuth = parseAssistantProviderAuth(providerCredential?.secretRef);
      const liveReply = await generateAssistantReply(
        {
          tenantName: context.tenantName,
          prompt,
          intent: deterministic.intent,
          sources: sources.map((source) => ({
            title: source.title,
            excerpt: source.excerpt
          })),
          conversationHistory,
          memorySnapshot,
          workspaceSnapshot: {
            companyCount: workspace.stats.companyCount,
            contactCount: workspace.stats.contactCount,
            knowledgeDocumentCount: workspace.stats.knowledgeDocumentCount,
            memoryCount: workspace.stats.memoryCount,
            topCompanyNames: workspace.topCompanies.slice(0, 5).map((company) => company.name)
          },
          conversationSummary: priorConversationSummary,
          settings: providerSettings
        },
        providerAuth
      );

      if (!liveReply.content || !liveReply.content.trim()) {
        throw new Error("Assistant provider returned an empty response.");
      }

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

  return finalizeAssistantResponse(workspace, prompt, {
    answer,
    intent: deterministic.intent,
    provider,
    model,
    messageMetadata,
    runMetadata,
    sources
  });
}

function maybeBuildDirectComputationResponse(prompt: string) {
  const normalized = prompt.trim().toLowerCase();
  const match = normalized.match(
    /^(?:what(?:'s| is)?|calculate|compute)?\s*(-?\d+(?:\.\d+)?)\s*([+\-*/x×÷])\s*(-?\d+(?:\.\d+)?)\s*\??$/
  );

  if (!match) {
    return null;
  }

  const left = Number(match[1]);
  const operator = match[2];
  const right = Number(match[3]);

  if (!Number.isFinite(left) || !Number.isFinite(right)) {
    return null;
  }

  if ((operator === "/" || operator === "÷") && right === 0) {
    return {
      answer: "That calculation is undefined because it divides by zero.",
      intent: "GENERAL_INSIGHT",
      provider: "NEWL_DIRECT",
      model: "assistant-direct-v1",
      messageMetadata: {
        deterministic: true,
        intent: "GENERAL_INSIGHT",
        directComputation: true
      },
      runMetadata: {
        deterministic: true,
        intent: "GENERAL_INSIGHT",
        directComputation: true
      },
      sources: []
    };
  }

  const result = calculateSimpleBinaryExpression(left, operator, right);
  if (result === null) {
    return null;
  }

  return {
    answer: formatNumber(result),
    intent: "GENERAL_INSIGHT",
    provider: "NEWL_DIRECT",
    model: "assistant-direct-v1",
    messageMetadata: {
      deterministic: true,
      intent: "GENERAL_INSIGHT",
      directComputation: true
    },
    runMetadata: {
      deterministic: true,
      intent: "GENERAL_INSIGHT",
      directComputation: true
    },
    sources: []
  };
}

function calculateSimpleBinaryExpression(left: number, operator: string, right: number) {
  switch (operator) {
    case "+":
      return left + right;
    case "-":
      return left - right;
    case "*":
    case "x":
    case "×":
      return left * right;
    case "/":
    case "÷":
      return left / right;
    default:
      return null;
  }
}

function formatNumber(value: number) {
  if (Number.isInteger(value)) {
    return String(value);
  }

  return String(Number(value.toFixed(10)));
}

function maybeBuildAssistantGuidanceResponse(
  workspace: Awaited<ReturnType<typeof getAssistantWorkspace>>,
  prompt: string
) {
  const normalized = prompt.trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  if (/^(hi|hello|hey|good morning|good afternoon|good evening)\b[!.?]*$/.test(normalized)) {
    return {
      answer:
        "I’m here and working. You can ask me about customers, Apollo activity, rates, opportunities, risks, or email drafting. If you want inbox-based answers, make sure Microsoft 365 has been synced into assistant knowledge first.",
      intent: "GENERAL_INSIGHT",
      provider: "NEWL_GUIDANCE",
      model: "assistant-guidance-v1",
      messageMetadata: {
        deterministic: true,
        intent: "GENERAL_INSIGHT",
        greetingHandled: true
      },
      runMetadata: {
        deterministic: true,
        intent: "GENERAL_INSIGHT",
        greetingHandled: true
      },
      sources: []
    };
  }

  const apolloRequested =
    /\bapollo\b/.test(normalized) ||
    /\bhow many calls\b/.test(normalized) ||
    /\bconnected calls?\b/.test(normalized) ||
    /\breplies?\b/.test(normalized) ||
    /\bemails sent\b/.test(normalized);
  const emailRequested =
    /\bemail\b/.test(normalized) ||
    /\binbox\b/.test(normalized) ||
    /\boutlook\b/.test(normalized) ||
    /\bmailbox\b/.test(normalized) ||
    /\bshared inbox\b/.test(normalized);

  const apolloReady = workspace.integrations.some(
    (integration) => integration.provider === "APOLLO" && integration.activeCount > 0
  );
  const microsoftReady = workspace.integrations.some(
    (integration) => integration.provider === "MICROSOFT_GRAPH" && integration.activeCount > 0
  );
  const hasIndexedBusinessKnowledge =
    workspace.stats.knowledgeDocumentCount > 0 ||
    workspace.stats.memoryCount > 0 ||
    workspace.topCompanies.length > 0 ||
    workspace.openLeads.length > 0;

  if (apolloRequested && !apolloReady) {
    return {
      answer:
        "I can’t answer that from Apollo yet because the Apollo integration is not active for this tenant. Once Apollo is connected and rep mapping is synced, I can answer calls, connected calls, emails sent, replies, and new-lead questions.",
      intent: "GENERAL_INSIGHT",
      provider: "NEWL_GUIDANCE",
      model: "assistant-guidance-v1",
      messageMetadata: {
        deterministic: true,
        intent: "GENERAL_INSIGHT",
        blocked: "apollo-not-ready"
      },
      runMetadata: {
        deterministic: true,
        intent: "GENERAL_INSIGHT",
        blocked: "apollo-not-ready"
      },
      sources: []
    };
  }

  if (emailRequested && (!microsoftReady || !hasIndexedBusinessKnowledge)) {
    return {
      answer:
        "I can’t answer that from inbox content yet because Microsoft 365 knowledge is not fully available in the assistant. Connect Microsoft 365, save the mailbox targets you want, then run a knowledge sync so email and file content can be indexed into memory.",
      intent: "GENERAL_INSIGHT",
      provider: "NEWL_GUIDANCE",
      model: "assistant-guidance-v1",
      messageMetadata: {
        deterministic: true,
        intent: "GENERAL_INSIGHT",
        blocked: "microsoft-knowledge-not-ready"
      },
      runMetadata: {
        deterministic: true,
        intent: "GENERAL_INSIGHT",
        blocked: "microsoft-knowledge-not-ready"
      },
      sources: []
    };
  }

  if (!hasIndexedBusinessKnowledge && normalized.split(/\s+/).length >= 4) {
    return {
      answer:
        "I’m not ignoring the request; I just do not have enough indexed business knowledge yet to answer it well. Run assistant knowledge sync after connecting the relevant systems, or ask me something I can answer directly from Apollo, rate tools, or the current app data.",
      intent: "GENERAL_INSIGHT",
      provider: "NEWL_GUIDANCE",
      model: "assistant-guidance-v1",
      messageMetadata: {
        deterministic: true,
        intent: "GENERAL_INSIGHT",
        blocked: "knowledge-too-thin"
      },
      runMetadata: {
        deterministic: true,
        intent: "GENERAL_INSIGHT",
        blocked: "knowledge-too-thin"
      },
      sources: []
    };
  }

  return null;
}

function finalizeAssistantResponse(
  workspace: Awaited<ReturnType<typeof getAssistantWorkspace>>,
  prompt: string,
  response: {
    answer: string;
    intent: string;
    provider: string;
    model: string;
    messageMetadata: Record<string, unknown>;
    runMetadata: Record<string, unknown>;
    sources: Array<{
      sourceKind: AssistantSourceKind;
      sourceId: string | null;
      title: string;
      excerpt: string;
      metadata?: Record<string, unknown>;
    }>;
  }
) {
  const conversationSummary = buildConversationSummary({
    priorSummary: workspace.activeThread?.conversationSummary ?? null,
    recentMessages: workspace.activeThread?.messages ?? [],
    prompt,
    answer: response.answer
  });

  return {
    ...response,
    runMetadata: {
      ...response.runMetadata,
      conversationSummary
    }
  };
}

function buildConversationSummary({
  priorSummary,
  recentMessages,
  prompt,
  answer
}: {
  priorSummary: string | null;
  recentMessages: Array<{ role: string; content: string }>;
  prompt: string;
  answer: string;
}) {
  const recapLines = recentMessages
    .filter((message) => message.role === "USER" || message.role === "ASSISTANT")
    .slice(-4)
    .map((message) => `${message.role === "USER" ? "User" : "Assistant"}: ${compactText(message.content, 140)}`);

  const parts = [
    priorSummary ? `Earlier context: ${compactText(priorSummary, 420)}` : null,
    recapLines.length > 0 ? `Recent turns: ${recapLines.join(" | ")}` : null,
    `Latest user request: ${compactText(prompt, 180)}`,
    `Latest assistant response: ${compactText(answer, 220)}`
  ].filter((part): part is string => Boolean(part));

  return compactText(parts.join(" || "), 1200);
}

function compactText(value: string, maxLength: number) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
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
