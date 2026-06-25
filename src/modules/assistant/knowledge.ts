import crypto from "node:crypto";

import {
  AssistantMemoryKind,
  AssistantSourceKind,
  LeadPipelineStage,
  type Prisma
} from "@prisma/client";

import { prisma } from "@/server/db";
import type { TenantContext } from "@/server/tenant-context";
import { tenantWhere } from "@/server/tenant-query";

const CLOSED_LEAD_STAGES: LeadPipelineStage[] = [
  LeadPipelineStage.WON,
  LeadPipelineStage.LOST,
  LeadPipelineStage.DISQUALIFIED
];

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

export async function syncAssistantKnowledge(tenant: TenantContext) {
  const [companies, contacts, leads, tradeMiningRecords, rateJobs] = await Promise.all([
    prisma.company.findMany({
      where: tenantWhere(tenant),
      orderBy: [{ priorityScore: "desc" }, { updatedAt: "desc" }],
      select: {
        id: true,
        name: true,
        normalizedName: true,
        domain: true,
        linkedinUrl: true,
        primaryIndustry: true,
        secondaryIndustry: true,
        priorityScore: true,
        candidateStatus: true,
        candidateStatusReason: true,
        doNotProspect: true,
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
    prisma.contact.findMany({
      where: tenantWhere(tenant),
      orderBy: [{ contactScore: "desc" }, { updatedAt: "desc" }],
      select: {
        id: true,
        fullName: true,
        title: true,
        department: true,
        seniority: true,
        email: true,
        phone: true,
        source: true,
        contactStatus: true,
        contactScore: true,
        contactTier: true,
        sequenceStatus: true,
        replyStatus: true,
        assignedRep: true,
        lastTouchAt: true,
        lastReplyAt: true,
        updatedAt: true,
        company: {
          select: {
            id: true,
            name: true
          }
        }
      }
    }),
    prisma.lead.findMany({
      where: tenantWhere(tenant),
      orderBy: [{ score: "desc" }, { updatedAt: "desc" }],
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
            priorityScore: true
          }
        },
        contact: {
          select: {
            id: true,
            fullName: true,
            title: true,
            email: true
          }
        }
      }
    }),
    prisma.tradeMiningImportRecord.findMany({
      where: tenantWhere(tenant),
      orderBy: [{ arrivalDate: "desc" }, { updatedAt: "desc" }],
      take: 300,
      select: {
        id: true,
        rawRecordKey: true,
        sourcePort: true,
        arrivalDate: true,
        importerName: true,
        consigneeName: true,
        shipperName: true,
        destinationCity: true,
        destinationState: true,
        originCountry: true,
        productDescription: true,
        updatedAt: true,
        company: {
          select: {
            id: true,
            name: true
          }
        }
      }
    }),
    prisma.automationJobRun.findMany({
      where: tenantWhere(tenant, {
        jobType: {
          in: ["ups-tools.bulk-rate-quote", "ltl-rate-portal.bulk-quote"]
        }
      }),
      orderBy: {
        startedAt: "desc"
      },
      take: 100,
      select: {
        id: true,
        jobType: true,
        status: true,
        startedAt: true,
        finishedAt: true,
        errorMessage: true
      }
    })
  ]);

  const documents = [
    ...companies.map((company) => {
      const content = joinKnowledgeParts([
        `${company.name} is a tenant company record in Newl Apps.`,
        company.normalizedName ? `Normalized company name: ${company.normalizedName}.` : null,
        company.domain ? `Website domain: ${company.domain}.` : null,
        company.linkedinUrl ? `LinkedIn URL: ${company.linkedinUrl}.` : null,
        company.primaryIndustry ? `Primary industry: ${company.primaryIndustry}.` : null,
        company.secondaryIndustry ? `Secondary industry: ${company.secondaryIndustry}.` : null,
        `Priority score: ${company.priorityScore}.`,
        `Candidate status: ${company.candidateStatus}.`,
        company.candidateStatusReason ? `Candidate status reason: ${company.candidateStatusReason}.` : null,
        company.doNotProspect ? "This company is marked do not prospect." : null,
        `Known counts: ${company._count.contacts} contacts, ${company._count.leads} leads, ${company._count.importRecords} TradeMining records.`
      ]);

      return {
        sourceKind: AssistantSourceKind.COMPANY,
        sourceSystem: "NEWL_COMPANY",
        externalId: company.id,
        title: company.name,
        sourceUpdatedAt: company.updatedAt,
        metadata: {
          priorityScore: company.priorityScore,
          candidateStatus: company.candidateStatus,
          primaryIndustry: company.primaryIndustry,
          domain: company.domain
        },
        content
      };
    }),
    ...contacts.map((contact) => {
      const content = joinKnowledgeParts([
        `${contact.fullName} is a contact at ${contact.company.name}.`,
        contact.title ? `Title: ${contact.title}.` : null,
        contact.department ? `Department: ${contact.department}.` : null,
        contact.seniority ? `Seniority: ${contact.seniority}.` : null,
        contact.email ? `Email: ${contact.email}.` : null,
        contact.phone ? `Phone: ${contact.phone}.` : null,
        `Contact status: ${contact.contactStatus}.`,
        `Contact score: ${contact.contactScore}.`,
        `Contact tier: ${contact.contactTier}.`,
        `Sequence status: ${contact.sequenceStatus}.`,
        `Reply status: ${contact.replyStatus}.`,
        contact.assignedRep ? `Assigned rep: ${contact.assignedRep}.` : null,
        contact.lastTouchAt ? `Last touch at: ${contact.lastTouchAt.toISOString()}.` : null,
        contact.lastReplyAt ? `Last reply at: ${contact.lastReplyAt.toISOString()}.` : null,
        `Source: ${contact.source}.`
      ]);

      return {
        sourceKind: AssistantSourceKind.CONTACT,
        sourceSystem: "NEWL_CONTACT",
        externalId: contact.id,
        title: `${contact.fullName} - ${contact.company.name}`,
        sourceUpdatedAt: contact.updatedAt,
        metadata: {
          companyId: contact.company.id,
          companyName: contact.company.name,
          contactScore: contact.contactScore,
          contactStatus: contact.contactStatus,
          email: contact.email
        },
        content
      };
    }),
    ...leads.map((lead) => {
      const content = joinKnowledgeParts([
        `Lead record for ${lead.company.name}.`,
        `Stage: ${lead.stage}.`,
        `Lead score: ${lead.score}.`,
        `Company priority score: ${lead.company.priorityScore}.`,
        lead.contact ? `Primary contact: ${lead.contact.fullName}${lead.contact.title ? `, ${lead.contact.title}` : ""}.` : null,
        lead.contact?.email ? `Contact email: ${lead.contact.email}.` : null,
        lead.notes ? `Notes: ${lead.notes}.` : null,
        CLOSED_LEAD_STAGES.includes(lead.stage) ? "This lead is closed." : "This lead is open."
      ]);

      return {
        sourceKind: AssistantSourceKind.LEAD,
        sourceSystem: "NEWL_LEAD",
        externalId: lead.id,
        title: `${lead.company.name} lead`,
        sourceUpdatedAt: lead.updatedAt,
        metadata: {
          companyId: lead.company.id,
          stage: lead.stage,
          score: lead.score,
          contactId: lead.contact?.id ?? null
        },
        content
      };
    }),
    ...tradeMiningRecords.map((record) => {
      const companyName = record.company?.name ?? record.importerName ?? record.consigneeName ?? "TradeMining record";
      const content = joinKnowledgeParts([
        `TradeMining import record associated with ${companyName}.`,
        record.company?.name ? `Linked company: ${record.company.name}.` : null,
        record.importerName ? `Importer: ${record.importerName}.` : null,
        record.consigneeName ? `Consignee: ${record.consigneeName}.` : null,
        record.shipperName ? `Shipper: ${record.shipperName}.` : null,
        record.sourcePort ? `Source port: ${record.sourcePort}.` : null,
        record.originCountry ? `Origin country: ${record.originCountry}.` : null,
        record.destinationCity || record.destinationState
          ? `Destination: ${[record.destinationCity, record.destinationState].filter(Boolean).join(", ")}.`
          : null,
        record.arrivalDate ? `Arrival date: ${record.arrivalDate.toISOString()}.` : null,
        record.productDescription ? `Product description: ${record.productDescription}.` : null,
        `Raw record key: ${record.rawRecordKey}.`
      ]);

      return {
        sourceKind: AssistantSourceKind.TRADEMINING_RECORD,
        sourceSystem: "NEWL_TRADEMINING_RECORD",
        externalId: record.id,
        title: `${companyName} import activity`,
        sourceUpdatedAt: record.updatedAt,
        metadata: {
          companyId: record.company?.id ?? null,
          companyName: record.company?.name ?? null,
          rawRecordKey: record.rawRecordKey,
          arrivalDate: record.arrivalDate?.toISOString() ?? null
        },
        content
      };
    }),
    ...rateJobs.map((job) => {
      const content = joinKnowledgeParts([
        `Rate tool job ${job.jobType}.`,
        `Status: ${job.status}.`,
        `Started at: ${job.startedAt.toISOString()}.`,
        job.finishedAt ? `Finished at: ${job.finishedAt.toISOString()}.` : "This job has not finished yet.",
        job.errorMessage ? `Error message: ${job.errorMessage}.` : null
      ]);

      return {
        sourceKind: AssistantSourceKind.RATE_TOOL,
        sourceSystem: "NEWL_RATE_JOB",
        externalId: job.id,
        title: `${job.jobType} ${job.startedAt.toISOString()}`,
        sourceUpdatedAt: job.finishedAt ?? job.startedAt,
        metadata: {
          jobType: job.jobType,
          status: job.status
        },
        content
      };
    })
  ];

  await prisma.$transaction(async (tx) => {
    await persistAssistantKnowledgeDocuments(tx, tenant, documents);

    await tx.assistantMemory.deleteMany({
      where: {
        tenantId: tenant.tenantId,
        sourceRunId: null,
        kind: {
          in: [
            AssistantMemoryKind.CUSTOMER_PROFILE,
            AssistantMemoryKind.SALES_OPPORTUNITY,
            AssistantMemoryKind.TENANT_FACT
          ]
        }
      }
    });

    const companyDocuments = await tx.assistantKnowledgeDocument.findMany({
      where: tenantWhere(tenant, {
        sourceSystem: "NEWL_COMPANY"
      }),
      select: {
        id: true,
        externalId: true,
        title: true,
        metadata: true,
        sourceUpdatedAt: true
      }
    });

    const leadDocuments = await tx.assistantKnowledgeDocument.findMany({
      where: tenantWhere(tenant, {
        sourceSystem: "NEWL_LEAD"
      }),
      select: {
        id: true,
        externalId: true,
        title: true,
        metadata: true,
        sourceUpdatedAt: true
      }
    });

    if (companyDocuments.length > 0) {
      await tx.assistantMemory.createMany({
        data: companyDocuments.map((document) => {
          const metadata = readJsonObject(document.metadata);
          return {
            tenantId: tenant.tenantId,
            kind: AssistantMemoryKind.CUSTOMER_PROFILE,
            subjectType: "Company",
            subjectId: document.externalId,
            title: document.title,
            summary: joinKnowledgeParts([
              metadata.primaryIndustry ? `Industry ${String(metadata.primaryIndustry)}` : null,
              metadata.priorityScore !== undefined ? `priority ${String(metadata.priorityScore)}` : null,
              metadata.candidateStatus ? `status ${String(metadata.candidateStatus)}` : null,
              metadata.domain ? `domain ${String(metadata.domain)}` : null
            ]),
            confidence: 70,
            status: "ACTIVE",
            sourceDocumentId: document.id,
            lastObservedAt: document.sourceUpdatedAt ?? now
          };
        })
      });
    }

    if (leadDocuments.length > 0) {
      await tx.assistantMemory.createMany({
        data: leadDocuments
          .map((document) => {
            const metadata = readJsonObject(document.metadata);
            const score = Number(metadata.score ?? 0);
            if (!metadata.stage || score < 60) {
              return null;
            }

            return {
              tenantId: tenant.tenantId,
              kind: AssistantMemoryKind.SALES_OPPORTUNITY,
              subjectType: "Lead",
              subjectId: document.externalId,
              title: document.title,
              summary: `Lead stage ${String(metadata.stage)} with score ${score}.`,
              confidence: Math.min(95, Math.max(55, score)),
              status: "ACTIVE",
              sourceDocumentId: document.id,
              lastObservedAt: document.sourceUpdatedAt ?? now
            };
          })
          .filter((value): value is NonNullable<typeof value> => value !== null)
      });
    }

    await tx.assistantMemory.create({
      data: {
        tenantId: tenant.tenantId,
        kind: AssistantMemoryKind.TENANT_FACT,
        subjectType: "Tenant",
        subjectId: tenant.tenantId,
        title: `${tenant.tenantName} assistant runtime strategy`,
        summary:
          "Use a cost-effective OpenAI model now through the provider adapter, and migrate to a Newl-hosted local model as the preferred long-term runtime.",
        confidence: 95,
        status: "ACTIVE",
        lastObservedAt: now
      }
    });
  });

  return {
    documentCount: documents.length
  };
}

export async function persistAssistantKnowledgeDocuments(
  tx: Prisma.TransactionClient,
  tenant: TenantContext,
  documents: AssistantKnowledgeDocumentInput[]
) {
  const now = new Date();

  for (const document of documents) {
    const record = await tx.assistantKnowledgeDocument.upsert({
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
        canonicalUrl: document.canonicalUrl ?? null,
        contentHash: hashContent(document.content),
        sourceUpdatedAt: document.sourceUpdatedAt ?? null,
        indexedAt: now,
        metadata: (document.metadata ?? null) as Prisma.InputJsonValue
      },
      update: {
        sourceKind: document.sourceKind,
        title: document.title,
        canonicalUrl: document.canonicalUrl ?? null,
        contentHash: hashContent(document.content),
        sourceUpdatedAt: document.sourceUpdatedAt ?? null,
        indexedAt: now,
        metadata: (document.metadata ?? null) as Prisma.InputJsonValue
      },
      select: {
        id: true
      }
    });

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
  }
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

function joinKnowledgeParts(parts: Array<string | null>) {
  return parts.filter((part): part is string => Boolean(part)).join(" ");
}

function readJsonObject(value: Prisma.JsonValue | null | undefined) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, Prisma.JsonValue>;
}
