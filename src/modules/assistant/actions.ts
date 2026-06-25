"use server";

import {
  AssistantMessageRole,
  JobStatus,
  ModuleKey,
  type Prisma
} from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  buildAssistantSources,
  buildAssistantAnswerForPrompt,
  getAssistantWorkspace
} from "@/modules/assistant/queries";
import { searchAssistantKnowledge, syncAssistantKnowledge } from "@/modules/assistant/knowledge";
import {
  normalizeAssistantAutomationTime,
  parseAssistantAutomationSchedule,
  summarizeAutomationResult
} from "@/modules/assistant/automations";
import { requireModule, requireMutationAccess } from "@/server/auth/authorization";
import { prisma } from "@/server/db";
import {
  generateAssistantReply,
  parseAssistantProviderSettings,
  ASSISTANT_PROVIDER_CREDENTIAL_NAME
} from "@/server/integrations/assistant-provider";
import { getAuthenticatedContext } from "@/server/tenant-context";

const MAX_PROMPT_LENGTH = 4000;

export async function askAssistantAction(formData: FormData) {
  const context = await getAuthenticatedContext();
  await requireModule(context, ModuleKey.ASSISTANT);
  await requireMutationAccess(context);

  const prompt = readPrompt(formData);
  const existingThreadId = readOptional(formData, "threadId");
  const response = await runAssistantPrompt(context, prompt, existingThreadId);
  const now = new Date();

  const thread = await prisma.$transaction(async (tx) => {
    const assistantThread = existingThreadId
      ? await tx.assistantChatThread.findFirst({
          where: {
            tenantId: context.tenantId,
            id: existingThreadId,
            userId: context.userId
          },
          select: {
            id: true,
            title: true
          }
        })
      : null;

    const threadRecord =
      assistantThread ??
      (await tx.assistantChatThread.create({
        data: {
          tenantId: context.tenantId,
          userId: context.userId,
          title: buildThreadTitle(prompt),
          lastMessageAt: now
        },
        select: {
          id: true,
          title: true
        }
      }));

    const userMessage = await tx.assistantChatMessage.create({
      data: {
        tenantId: context.tenantId,
        threadId: threadRecord.id,
        role: AssistantMessageRole.USER,
        content: prompt,
        metadata: {
          source: "assistant.form"
        }
      },
      select: {
        id: true
      }
    });

    const assistantMessage = await tx.assistantChatMessage.create({
      data: {
        tenantId: context.tenantId,
        threadId: threadRecord.id,
        role: AssistantMessageRole.ASSISTANT,
        content: response.answer,
        metadata: response.messageMetadata as Prisma.InputJsonValue
      },
      select: {
        id: true
      }
    });

    const run = await tx.assistantRun.create({
      data: {
        tenantId: context.tenantId,
        threadId: threadRecord.id,
        messageId: assistantMessage.id,
        userId: context.userId,
        provider: response.provider,
        model: response.model,
        status: JobStatus.SUCCESS,
        intent: response.intent,
        startedAt: now,
        finishedAt: now,
        metadata: {
          userMessageId: userMessage.id,
          sourceCount: response.sources.length,
          promptLength: prompt.length,
          ...response.runMetadata
        }
      },
      select: {
        id: true
      }
    });

    if (response.sources.length > 0) {
      await tx.assistantRetrievedSource.createMany({
        data: response.sources.map((source) => ({
          tenantId: context.tenantId,
          runId: run.id,
          sourceKind: source.sourceKind,
          sourceId: source.sourceId,
          title: source.title,
          excerpt: source.excerpt,
          metadata: source.metadata as Prisma.InputJsonValue | undefined
        }))
      });
    }

    await tx.assistantChatThread.update({
      where: {
        id: threadRecord.id
      },
      data: {
        lastMessageAt: now
      }
    });

    await tx.auditLog.create({
      data: {
        tenantId: context.tenantId,
        actorUserId: context.userId,
        action: "assistant.ask",
        entityType: "AssistantChatThread",
        entityId: threadRecord.id,
        after: {
          prompt,
          intent: response.intent,
          runId: run.id,
          assistantMessageId: assistantMessage.id,
          sourceCount: response.sources.length,
          provider: response.provider,
          model: response.model
        } as Prisma.InputJsonValue
      }
    });

    return threadRecord;
  });

  revalidatePath("/assistant");
  redirect(`/assistant?thread=${encodeURIComponent(thread.id)}`);
}

export async function syncAssistantKnowledgeAction() {
  const context = await getAuthenticatedContext();
  await requireModule(context, ModuleKey.ASSISTANT);
  await requireMutationAccess(context);

  await syncAssistantKnowledge(context);

  await prisma.auditLog.create({
    data: {
      tenantId: context.tenantId,
      actorUserId: context.userId,
      action: "assistant.knowledge.sync",
      entityType: "Tenant",
      entityId: context.tenantId,
      after: {
        scope: "assistant-knowledge"
      } as Prisma.InputJsonValue
    }
  });

  revalidatePath("/assistant");
}

export async function saveAssistantAutomationAction(formData: FormData) {
  const context = await getAuthenticatedContext();
  await requireModule(context, ModuleKey.ASSISTANT);
  await requireMutationAccess(context);

  const name = readRequiredText(formData, "name", 80);
  const prompt = readPromptField(formData, "automationPrompt", 4000);
  const scheduleType = parseAssistantAutomationSchedule(readOptional(formData, "scheduleType"));
  const scheduleTime = normalizeAssistantAutomationTime(readOptional(formData, "scheduleTime"));
  const scheduleTimezone = readOptional(formData, "scheduleTimezone") ?? "America/Toronto";

  await prisma.assistantAutomation.create({
    data: {
      tenantId: context.tenantId,
      userId: context.userId,
      name,
      prompt,
      scheduleType,
      scheduleTime,
      scheduleTimezone
    }
  });

  await prisma.auditLog.create({
    data: {
      tenantId: context.tenantId,
      actorUserId: context.userId,
      action: "assistant.automation.create",
      entityType: "AssistantAutomation",
      entityId: name,
      after: {
        name,
        scheduleType,
        scheduleTime,
        scheduleTimezone
      } as Prisma.InputJsonValue
    }
  });

  revalidatePath("/assistant");
}

export async function runAssistantAutomationAction(formData: FormData) {
  const context = await getAuthenticatedContext();
  await requireModule(context, ModuleKey.ASSISTANT);
  await requireMutationAccess(context);

  const automationId = readRequiredText(formData, "automationId", 100);
  const automation = await prisma.assistantAutomation.findFirst({
    where: {
      tenantId: context.tenantId,
      userId: context.userId,
      id: automationId
    },
    select: {
      id: true,
      name: true,
      prompt: true
    }
  });

  if (!automation) {
    throw new Error("Saved assistant agent not found.");
  }

  const now = new Date();
  const response = await runAssistantPrompt(context, automation.prompt);

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
          trigger: "manual",
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
          assistantRunId: assistantRun.id
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
          model: response.model
        } as Prisma.InputJsonValue
      }
    });
  });

  revalidatePath("/assistant");
}

export async function toggleAssistantAutomationStatusAction(formData: FormData) {
  const context = await getAuthenticatedContext();
  await requireModule(context, ModuleKey.ASSISTANT);
  await requireMutationAccess(context);

  const automationId = readRequiredText(formData, "automationId", 100);
  const automation = await prisma.assistantAutomation.findFirst({
    where: {
      tenantId: context.tenantId,
      userId: context.userId,
      id: automationId
    },
    select: {
      id: true,
      status: true
    }
  });

  if (!automation) {
    throw new Error("Saved assistant agent not found.");
  }

  const nextStatus = automation.status === "ACTIVE" ? "PAUSED" : "ACTIVE";

  await prisma.assistantAutomation.update({
    where: {
      id: automation.id
    },
    data: {
      status: nextStatus
    }
  });

  revalidatePath("/assistant");
}

function readPrompt(formData: FormData) {
  return readPromptField(formData, "prompt", MAX_PROMPT_LENGTH);
}

function readOptional(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readPromptField(formData: FormData, name: string, maxLength: number) {
  const value = formData.get(name);

  if (typeof value !== "string") {
    throw new Error("Assistant prompt is required.");
  }

  const prompt = value.trim();

  if (!prompt) {
    throw new Error("Assistant prompt is required.");
  }

  if (prompt.length > maxLength) {
    throw new Error(`Assistant prompt must be ${maxLength} characters or fewer.`);
  }

  return prompt;
}

function readRequiredText(formData: FormData, name: string, maxLength: number) {
  const value = readOptional(formData, name);

  if (!value) {
    throw new Error(`${name} is required.`);
  }

  if (value.length > maxLength) {
    throw new Error(`${name} must be ${maxLength} characters or fewer.`);
  }

  return value;
}

function buildThreadTitle(prompt: string) {
  const normalized = prompt.replace(/\s+/g, " ").trim();
  return normalized.length > 72 ? `${normalized.slice(0, 69)}...` : normalized;
}

async function runAssistantPrompt(
  context: Awaited<ReturnType<typeof getAuthenticatedContext>>,
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
