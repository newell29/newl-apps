import { JobStatus, ModuleKey, type Prisma } from "@prisma/client";

import { syncAssistantKnowledge } from "@/modules/assistant/knowledge";
import { syncMicrosoftGraphAssistantKnowledge } from "@/modules/assistant/microsoft-graph-sync";
import { requireModule, requireMutationAccess } from "@/server/auth/authorization";
import { prisma } from "@/server/db";
import type { AuthenticatedContext } from "@/server/tenant-context";

export type AssistantKnowledgeSyncSummary = {
  status: "success" | "partial";
  localDocumentCount: number;
  microsoftDocumentCount: number;
  microsoftMailCount: number;
  microsoftFileCount: number;
  localReason: string | null;
  microsoftReason: string | null;
};

export async function runAssistantKnowledgeSync(context: AuthenticatedContext): Promise<AssistantKnowledgeSyncSummary> {
  await requireModule(context, ModuleKey.ASSISTANT);
  await requireMutationAccess(context);

  const startedAt = new Date();
  await prisma.auditLog.create({
    data: {
      tenantId: context.tenantId,
      actorUserId: context.userId,
      action: "assistant.knowledge.sync.started",
      entityType: "Tenant",
      entityId: context.tenantId,
      after: {
        scope: "assistant-knowledge",
        startedAt: startedAt.toISOString()
      } as Prisma.InputJsonValue
    }
  });

  const [localKnowledgeResult, microsoftKnowledgeResult] = await Promise.all([
    syncAssistantKnowledgeSafely(context),
    syncMicrosoftGraphAssistantKnowledge(context)
  ]);
  const finishedAt = new Date();
  const status = localKnowledgeResult.skipped || microsoftKnowledgeResult.skipped ? "partial" : "success";

  await prisma.auditLog.create({
    data: {
      tenantId: context.tenantId,
      actorUserId: context.userId,
      action: "assistant.knowledge.sync",
      entityType: "Tenant",
      entityId: context.tenantId,
      after: {
        scope: "assistant-knowledge",
        status: status === "success" ? JobStatus.SUCCESS : JobStatus.ERROR,
        startedAt: startedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
        durationMs: finishedAt.getTime() - startedAt.getTime(),
        localDocumentCount: localKnowledgeResult.documentCount,
        localSkipped: localKnowledgeResult.skipped,
        localReason: localKnowledgeResult.reason,
        microsoftDocumentCount: microsoftKnowledgeResult.documentCount,
        microsoftMailCount: microsoftKnowledgeResult.mailCount,
        microsoftFileCount: microsoftKnowledgeResult.fileCount,
        microsoftSkipped: microsoftKnowledgeResult.skipped,
        microsoftReason: microsoftKnowledgeResult.reason
      } as Prisma.InputJsonValue
    }
  });

  return {
    status,
    localDocumentCount: localKnowledgeResult.documentCount,
    microsoftDocumentCount: microsoftKnowledgeResult.documentCount,
    microsoftMailCount: microsoftKnowledgeResult.mailCount,
    microsoftFileCount: microsoftKnowledgeResult.fileCount,
    localReason: localKnowledgeResult.reason,
    microsoftReason: microsoftKnowledgeResult.reason
  };
}

async function syncAssistantKnowledgeSafely(context: AuthenticatedContext) {
  try {
    const result = await syncAssistantKnowledge(context);
    return {
      documentCount: result.documentCount,
      skipped: false,
      reason: null
    };
  } catch (error) {
    return {
      documentCount: 0,
      skipped: true,
      reason: error instanceof Error ? error.message : "Local assistant knowledge sync failed for an unknown reason."
    };
  }
}
