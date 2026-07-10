import { randomUUID } from "crypto";
import { Prisma, type InvoiceAutomationType, type PrismaClient } from "@prisma/client";
import {
  buildInvoiceCorrectionMemoryCandidates,
  type InvoiceCorrectionMemoryCandidate
} from "@/modules/invoice-automation/correction-memory";
import type { InvoiceAutomationCorrectionMemoryHint } from "@/modules/invoice-automation/types";
import type { TenantContext } from "@/server/tenant-context";

type PrismaRawClient = Pick<PrismaClient, "$executeRaw" | "$queryRaw"> | Prisma.TransactionClient;

type LearnCorrectionMemoryInput = {
  tenantId: string;
  invoiceType: InvoiceAutomationType;
  entityNameRaw: string | null;
  quickBooksEntityId: string | null;
  quickBooksEntityDisplayName: string | null;
  shipmentFileNumber: string | null;
  currency: string | null;
  productOrAccountName: string | null;
  invoiceDate: string | Date | null;
  dueDate: string | Date | null;
  userId?: string | null;
};

export async function learnInvoiceAutomationCorrectionMemory(db: PrismaRawClient, input: LearnCorrectionMemoryInput) {
  const candidates = buildInvoiceCorrectionMemoryCandidates(input);
  for (const candidate of candidates) {
    await upsertCorrectionMemory(db, candidate);
  }
}

export async function getInvoiceAutomationCorrectionMemoryHints(
  db: PrismaRawClient,
  tenant: TenantContext
): Promise<InvoiceAutomationCorrectionMemoryHint[]> {
  return db.$queryRaw<InvoiceAutomationCorrectionMemoryHint[]>`
    SELECT
      "invoiceType",
      "fieldName",
      "normalizedEntityName",
      "quickBooksEntityId",
      "quickBooksEntityDisplayName",
      "shipmentPrefix",
      "currency",
      "learnedValue",
      "usageCount"
    FROM "InvoiceAutomationCorrectionMemory"
    WHERE "tenantId" = ${tenant.tenantId}
    ORDER BY "lastUsedAt" DESC, "usageCount" DESC
    LIMIT 500
  `;
}

async function upsertCorrectionMemory(db: PrismaRawClient, candidate: InvoiceCorrectionMemoryCandidate) {
  await db.$executeRaw`
    INSERT INTO "InvoiceAutomationCorrectionMemory" (
      "id",
      "memoryKey",
      "tenantId",
      "invoiceType",
      "fieldName",
      "normalizedEntityName",
      "quickBooksEntityId",
      "quickBooksEntityDisplayName",
      "shipmentPrefix",
      "currency",
      "learnedValue",
      "sourceValue",
      "createdByUserId",
      "lastUsedAt",
      "usageCount",
      "createdAt",
      "updatedAt"
    )
    VALUES (
      ${cryptoRandomId()},
      ${candidate.memoryKey},
      ${candidate.tenantId},
      ${candidate.invoiceType}::"InvoiceAutomationType",
      ${candidate.fieldName},
      ${candidate.normalizedEntityName},
      ${candidate.quickBooksEntityId},
      ${candidate.quickBooksEntityDisplayName},
      ${candidate.shipmentPrefix},
      ${candidate.currency},
      ${candidate.learnedValue},
      ${candidate.sourceValue},
      ${candidate.createdByUserId},
      NOW(),
      1,
      NOW(),
      NOW()
    )
    ON CONFLICT ("memoryKey") DO UPDATE SET
      "quickBooksEntityDisplayName" = EXCLUDED."quickBooksEntityDisplayName",
      "currency" = EXCLUDED."currency",
      "learnedValue" = EXCLUDED."learnedValue",
      "sourceValue" = EXCLUDED."sourceValue",
      "lastUsedAt" = NOW(),
      "usageCount" = "InvoiceAutomationCorrectionMemory"."usageCount" + 1,
      "updatedAt" = NOW()
  `;
}

function cryptoRandomId() {
  return `cmem_${randomUUID().replace(/-/g, "")}`;
}
