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
  getAssistantWorkspace
} from "@/modules/assistant/queries";
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
  const workspace = await getAssistantWorkspace(context, prompt, existingThreadId);
  const answer = workspace.answer.join("\n\n");
  const sources = buildAssistantSources(workspace);
  const now = new Date();

  const thread = await prisma.$transaction(async (tx) => {
    const assistantThread = existingThreadId
      ? await tx.assistantChatThread.findFirst({
          where: {
            tenantId: context.tenantId,
            id: existingThreadId
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
        content: answer,
        metadata: {
          deterministic: true,
          intent: workspace.intent
        }
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
        provider: "NEWL_DETERMINISTIC",
        model: "assistant-foundation-v1",
        status: JobStatus.SUCCESS,
        intent: workspace.intent,
        startedAt: now,
        finishedAt: now,
        metadata: {
          userMessageId: userMessage.id,
          sourceCount: sources.length,
          promptLength: prompt.length
        }
      },
      select: {
        id: true
      }
    });

    if (sources.length > 0) {
      await tx.assistantRetrievedSource.createMany({
        data: sources.map((source) => ({
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
          intent: workspace.intent,
          runId: run.id,
          assistantMessageId: assistantMessage.id,
          sourceCount: sources.length
        }
      }
    });

    return threadRecord;
  });

  revalidatePath("/assistant");
  redirect(`/assistant?thread=${encodeURIComponent(thread.id)}`);
}

function readPrompt(formData: FormData) {
  const value = formData.get("prompt");

  if (typeof value !== "string") {
    throw new Error("Assistant prompt is required.");
  }

  const prompt = value.trim();

  if (!prompt) {
    throw new Error("Assistant prompt is required.");
  }

  if (prompt.length > MAX_PROMPT_LENGTH) {
    throw new Error(`Assistant prompt must be ${MAX_PROMPT_LENGTH} characters or fewer.`);
  }

  return prompt;
}

function readOptional(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function buildThreadTitle(prompt: string) {
  const normalized = prompt.replace(/\s+/g, " ").trim();
  return normalized.length > 72 ? `${normalized.slice(0, 69)}...` : normalized;
}
