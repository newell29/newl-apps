import crypto from "node:crypto";

import {
  AssistantMemoryKind,
  AssistantSourceKind,
  ModuleKey,
  type Prisma
} from "@prisma/client";

import {
  getEnabledAssistantKnowledgeAdapters,
  type AssistantKnowledgeDocumentSeed,
  type AssistantMemorySeed
} from "@/modules/assistant/knowledge-registry";
import { prisma } from "@/server/db";
import type { TenantContext } from "@/server/tenant-context";
import { tenantWhere } from "@/server/tenant-query";

const MAX_CHUNK_LENGTH = 900;
const KNOWLEDGE_RESULT_LIMIT = 6;

type AssistantRetrievedKnowledgeSource = {
  sourceKind: AssistantSourceKind;
  sourceId: string | null;
  title: string;
  excerpt: string;
  metadata?: Record<string, unknown>;
};

export type AssistantKnowledgeDocumentInput = {
  sourceKind: AssistantSourceKind;
  sourceSystem: string;
  externalId: string;
  title: string;
  canonicalUrl?: string | null;
  sourceUpdatedAt?: Date | null;
  metadata?: Record<string, unknown>;
  content: string;
};

type AssistantKnowledgePersistenceClient = Pick<
  Prisma.TransactionClient,
  "assistantKnowledgeDocument" | "assistantKnowledgeChunk"
>;

export async function syncAssistantKnowledge(tenant: TenantContext) {
  const enabledModuleRows = await prisma.tenantModuleAccess.findMany({
    where: {
      tenantId: tenant.tenantId,
      enabled: true
    },
    select: {
      module: {
        select: {
          key: true
        }
      }
    }
  });

  const enabledModules = new Set<ModuleKey>([
    ModuleKey.ASSISTANT,
    ...enabledModuleRows.map((row) => row.module.key)
  ]);

  const adapterResults = await Promise.all(
    getEnabledAssistantKnowledgeAdapters(enabledModules).map((adapter) => adapter.collect(tenant))
  );
  const documents: AssistantKnowledgeDocumentInput[] = adapterResults.flatMap((result) => result.documents);
  const generatedMemories = adapterResults.flatMap((result) => result.memories ?? []);
  const now = new Date();

  await prisma.$transaction(async (tx) => {
    const persistedDocuments = await persistAssistantKnowledgeDocuments(tx, tenant, documents);
    const documentIdBySourceRef = new Map(
      persistedDocuments.map((document) => [`${document.sourceSystem}:${document.externalId}`, document.id] as const)
    );

    await tx.assistantMemory.deleteMany({
      where: {
        tenantId: tenant.tenantId,
        sourceRunId: null,
        kind: {
          in: [
            AssistantMemoryKind.CUSTOMER_PROFILE,
            AssistantMemoryKind.SALES_OPPORTUNITY,
            AssistantMemoryKind.OPERATIONAL_RISK,
            AssistantMemoryKind.TENANT_FACT
          ]
        }
      }
    });

    const memorySeeds: AssistantMemorySeed[] = [
      ...generatedMemories,
      {
        kind: AssistantMemoryKind.TENANT_FACT,
        subjectType: "Tenant",
        subjectId: tenant.tenantId,
        title: `${tenant.tenantName} assistant runtime strategy`,
        summary:
          "Use a cost-effective OpenAI model now through the provider adapter, and migrate to a Newl-hosted local model as the preferred long-term runtime.",
        confidence: 95,
        lastObservedAt: now
      }
    ];

    if (memorySeeds.length > 0) {
      await tx.assistantMemory.createMany({
        data: memorySeeds.map((memory) => ({
          tenantId: tenant.tenantId,
          kind: memory.kind,
          subjectType: memory.subjectType,
          subjectId: memory.subjectId,
          title: memory.title,
          summary: memory.summary,
          confidence: memory.confidence,
          status: memory.status ?? "ACTIVE",
          sourceDocumentId: memory.sourceRef
            ? documentIdBySourceRef.get(`${memory.sourceRef.sourceSystem}:${memory.sourceRef.externalId}`) ?? null
            : null,
          lastObservedAt: memory.lastObservedAt ?? now
        }))
      });
    }
  });

  return {
    documentCount: documents.length
  };
}

export async function persistAssistantKnowledgeDocuments(
  tx: AssistantKnowledgePersistenceClient,
  tenant: TenantContext,
  documents: AssistantKnowledgeDocumentInput[]
) {
  const now = new Date();
  const persistedRecords: Array<{
    id: string;
    sourceSystem: string;
    externalId: string;
    title: string;
  }> = [];

  for (const document of documents) {
    const record = await upsertKnowledgeDocument(tx, tenant, document, now);

    await tx.assistantKnowledgeChunk.deleteMany({
      where: {
        tenantId: tenant.tenantId,
        documentId: record.id
      }
    });

    const chunks = createKnowledgeChunks(document.content);
    if (chunks.length > 0) {
      await tx.assistantKnowledgeChunk.createMany({
        data: chunks.map((chunk, index) => ({
          tenantId: tenant.tenantId,
          documentId: record.id,
          chunkIndex: index,
          contentText: chunk,
          contentSummary: summarizeChunk(chunk),
          tokenCount: estimateTokenCount(chunk),
          metadata: (document.metadata ?? null) as Prisma.InputJsonValue
        }))
      });
    }

    persistedRecords.push({
      id: record.id,
      sourceSystem: document.sourceSystem,
      externalId: document.externalId,
      title: document.title
    });
  }

  return persistedRecords;
}

export async function searchAssistantKnowledge(
  tenant: TenantContext,
  prompt: string
): Promise<AssistantRetrievedKnowledgeSource[]> {
  const normalizedTerms = tokenizeForSearch(prompt);
  if (normalizedTerms.length === 0) {
    return [];
  }

  const chunks = await prisma.assistantKnowledgeChunk.findMany({
    where: tenantWhere(tenant),
    select: {
      id: true,
      documentId: true,
      chunkIndex: true,
      contentText: true,
      contentSummary: true,
      metadata: true,
      document: {
        select: {
          id: true,
          sourceKind: true,
          externalId: true,
          title: true,
          sourceSystem: true,
          metadata: true
        }
      }
    }
  });

  return chunks
    .map((chunk) => {
      const text = `${chunk.document.title} ${chunk.contentSummary ?? ""} ${chunk.contentText}`.toLowerCase();
      const score = normalizedTerms.reduce((total, term) => total + (text.includes(term) ? 1 : 0), 0);

      return {
        score,
        source: {
          sourceKind: chunk.document.sourceKind,
          sourceId: chunk.document.externalId,
          title: chunk.document.title,
          excerpt: chunk.contentSummary ?? summarizeChunk(chunk.contentText),
          metadata: {
            documentId: chunk.document.id,
            sourceSystem: chunk.document.sourceSystem,
            chunkIndex: chunk.chunkIndex,
            ...readJsonObject(chunk.document.metadata),
            ...readJsonObject(chunk.metadata)
          }
        }
      };
    })
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, KNOWLEDGE_RESULT_LIMIT)
    .map((item) => item.source);
}

export function createKnowledgeChunks(content: string) {
  const normalized = content.trim().replace(/\s+/g, " ");
  if (!normalized) {
    return [];
  }

  const sentences = normalized.split(/(?<=[.!?])\s+/);
  const chunks: string[] = [];
  let current = "";

  for (const sentence of sentences) {
    if (!current) {
      current = sentence;
      continue;
    }

    if (`${current} ${sentence}`.length <= MAX_CHUNK_LENGTH) {
      current = `${current} ${sentence}`;
      continue;
    }

    chunks.push(current);
    current = sentence;
  }

  if (current) {
    chunks.push(current);
  }

  return chunks;
}

export function summarizeChunk(content: string) {
  return content.length <= 220 ? content : `${content.slice(0, 217).trimEnd()}...`;
}

async function upsertKnowledgeDocument(
  tx: AssistantKnowledgePersistenceClient,
  tenant: TenantContext,
  document: AssistantKnowledgeDocumentInput | AssistantKnowledgeDocumentSeed,
  now: Date
) {
  return tx.assistantKnowledgeDocument.upsert({
    where: {
      tenantId_sourceSystem_externalId: {
        tenantId: tenant.tenantId,
        sourceSystem: document.sourceSystem,
        externalId: document.externalId
      }
    },
    create: {
      tenantId: tenant.tenantId,
      sourceKind: document.sourceKind,
      sourceSystem: document.sourceSystem,
      externalId: document.externalId,
      title: document.title,
      canonicalUrl: "canonicalUrl" in document ? document.canonicalUrl ?? null : null,
      contentHash: hashContent(document.content),
      sourceUpdatedAt: document.sourceUpdatedAt ?? null,
      indexedAt: now,
      metadata: (document.metadata ?? null) as Prisma.InputJsonValue
    },
    update: {
      sourceKind: document.sourceKind,
      title: document.title,
      canonicalUrl: "canonicalUrl" in document ? document.canonicalUrl ?? null : null,
      contentHash: hashContent(document.content),
      sourceUpdatedAt: document.sourceUpdatedAt ?? null,
      indexedAt: now,
      metadata: (document.metadata ?? null) as Prisma.InputJsonValue
    },
    select: {
      id: true
    }
  });
}

function hashContent(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function estimateTokenCount(value: string) {
  return Math.max(1, Math.ceil(value.length / 4));
}

function tokenizeForSearch(value: string) {
  return Array.from(
    new Set(
      value
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((token) => token.length >= 3)
    )
  );
}

function readJsonObject(value: Prisma.JsonValue | null | undefined) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, Prisma.JsonValue>;
}
