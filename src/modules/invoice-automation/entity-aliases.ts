import { type InvoiceAutomationType, type Prisma, type PrismaClient } from "@prisma/client";
import { normalizeInvoiceEntityName } from "@/modules/invoice-automation/extraction";

type AliasLearningInput = {
  tenantId: string;
  invoiceType: InvoiceAutomationType;
  aliasRawName: string | null;
  quickBooksEntityId: string | null;
  quickBooksEntityDisplayName: string | null;
  currency?: string | null;
  userId?: string | null;
};

type PrismaLike = Pick<PrismaClient, "invoiceAutomationEntityAlias"> | Prisma.TransactionClient;

export function buildInvoiceAutomationEntityAlias(input: AliasLearningInput) {
  const aliasRawName = input.aliasRawName?.trim() ?? "";
  const quickBooksEntityId = input.quickBooksEntityId?.trim() ?? "";
  const quickBooksEntityDisplayName = input.quickBooksEntityDisplayName?.trim() ?? "";
  const normalizedAlias = normalizeInvoiceEntityName(aliasRawName);
  const normalizedQuickBooksName = normalizeInvoiceEntityName(quickBooksEntityDisplayName);

  if (!aliasRawName || !quickBooksEntityId || !quickBooksEntityDisplayName || !normalizedAlias) {
    return null;
  }

  if (!/[a-z]/i.test(normalizedAlias) || normalizedAlias.length < 2) {
    return null;
  }

  if (normalizedAlias === normalizedQuickBooksName) {
    return null;
  }

  if (isUnsafeEntityAlias(aliasRawName, normalizedAlias)) {
    return null;
  }

  return {
    tenantId: input.tenantId,
    invoiceType: input.invoiceType,
    aliasRawName,
    normalizedAlias,
    quickBooksEntityId,
    quickBooksEntityDisplayName,
    currency: input.currency?.trim().toUpperCase() || null,
    createdByUserId: input.userId ?? null
  };
}

export async function learnInvoiceAutomationEntityAlias(db: PrismaLike, input: AliasLearningInput) {
  const alias = buildInvoiceAutomationEntityAlias(input);
  if (!alias) {
    return null;
  }

  const now = new Date();

  return db.invoiceAutomationEntityAlias.upsert({
    where: {
      tenantId_invoiceType_normalizedAlias: {
        tenantId: alias.tenantId,
        invoiceType: alias.invoiceType,
        normalizedAlias: alias.normalizedAlias
      }
    },
    update: {
      aliasRawName: alias.aliasRawName,
      quickBooksEntityId: alias.quickBooksEntityId,
      quickBooksEntityDisplayName: alias.quickBooksEntityDisplayName,
      currency: alias.currency,
      lastUsedAt: now,
      usageCount: {
        increment: 1
      }
    },
    create: {
      ...alias,
      lastUsedAt: now
    }
  });
}

function isUnsafeEntityAlias(aliasRawName: string, normalizedAlias: string) {
  if (/^\d+(?:\.\d+)?$/.test(normalizedAlias)) {
    return true;
  }

  if (/\b(invoice|amount|subtotal|total|tax|hst|gst|date|due|terms|page|shipper|consignee|address)\b/i.test(normalizedAlias)) {
    return true;
  }

  if (/\b\d{1,5}\s+(street|st|road|rd|avenue|ave|drive|dr|blvd|boulevard|way|lane|ln|court|ct)\b/i.test(aliasRawName)) {
    return true;
  }

  return false;
}
