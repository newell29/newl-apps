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
  computeNextAssistantAutomationRunAt,
  normalizeAssistantAutomationTime,
  parseAssistantAutomationSchedule
} from "@/modules/assistant/automations";
import { syncAssistantKnowledge } from "@/modules/assistant/knowledge";
import { syncMicrosoftGraphAssistantKnowledge } from "@/modules/assistant/microsoft-graph-sync";
import {
  executeAssistantAutomation,
  runAssistantPrompt
} from "@/modules/assistant/runtime";
import { requireModule, requireMutationAccess } from "@/server/auth/authorization";
import { prisma } from "@/server/db";
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

  const [localKnowledgeResult, microsoftKnowledgeResult] = await Promise.all([
    syncAssistantKnowledge(context),
    syncMicrosoftGraphAssistantKnowledge(context)
  ]);

  await prisma.auditLog.create({
    data: {
      tenantId: context.tenantId,
      actorUserId: context.userId,
      action: "assistant.knowledge.sync",
      entityType: "Tenant",
      entityId: context.tenantId,
      after: {
        scope: "assistant-knowledge",
        localDocumentCount: localKnowledgeResult.documentCount,
        microsoftDocumentCount: microsoftKnowledgeResult.documentCount,
        microsoftSkipped: microsoftKnowledgeResult.skipped,
        microsoftReason: microsoftKnowledgeResult.reason
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
  const nextRunAt = computeNextAssistantAutomationRunAt(scheduleType, scheduleTime, scheduleTimezone, new Date());

  await prisma.assistantAutomation.create({
    data: {
      tenantId: context.tenantId,
      userId: context.userId,
      name,
      prompt,
      scheduleType,
      scheduleTime,
      scheduleTimezone,
      nextRunAt
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

  await executeAssistantAutomation(context, automation.id, "manual");

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
      status: true,
      scheduleType: true,
      scheduleTime: true,
      scheduleTimezone: true
    }
  });

  if (!automation) {
    throw new Error("Saved assistant agent not found.");
  }

  const nextStatus = automation.status === "ACTIVE" ? "PAUSED" : "ACTIVE";
  const nextRunAt =
    nextStatus === "ACTIVE"
      ? computeNextAssistantAutomationRunAt(
          parseAssistantAutomationSchedule(automation.scheduleType),
          automation.scheduleTime,
          automation.scheduleTimezone,
          new Date()
        )
      : null;

  await prisma.assistantAutomation.update({
    where: {
      id: automation.id
    },
    data: {
      status: nextStatus,
      nextRunAt
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
