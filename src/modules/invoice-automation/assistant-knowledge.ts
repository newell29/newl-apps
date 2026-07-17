import { AssistantMemoryKind, AssistantSourceKind } from "@prisma/client";

import type { AssistantKnowledgeAdapterResult } from "@/modules/assistant/knowledge-registry";
import { prisma } from "@/server/db";
import type { TenantContext } from "@/server/tenant-context";
import { tenantWhere } from "@/server/tenant-query";

export async function getInvoiceAutomationAssistantKnowledge(
  tenant: TenantContext
): Promise<AssistantKnowledgeAdapterResult> {
  const [invoiceStatusCounts, recentBatches, recentInvoices, failedPostings, correctionMemoryCount] = await Promise.all([
    prisma.invoiceAutomationInvoice.groupBy({
      by: ["invoiceType", "status"],
      where: tenantWhere(tenant),
      _count: { _all: true }
    }),
    prisma.invoiceAutomationBatch.findMany({
      where: tenantWhere(tenant),
      orderBy: [{ createdAt: "desc" }],
      take: 8,
      select: {
        id: true,
        batchNumber: true,
        invoiceType: true,
        status: true,
        sentToAccountingAt: true,
        notes: true,
        createdAt: true,
        _count: { select: { invoices: true } }
      }
    }),
    prisma.invoiceAutomationInvoice.findMany({
      where: tenantWhere(tenant),
      orderBy: [{ updatedAt: "desc" }],
      take: 12,
      select: {
        id: true,
        invoiceType: true,
        status: true,
        fileName: true,
        shipmentFileNumber: true,
        entityNameRaw: true,
        quickBooksEntityDisplayName: true,
        invoiceNumber: true,
        currency: true,
        totalAmount: true,
        issueCodes: true,
        reviewNotes: true,
        quickBooksPostingError: true,
        updatedAt: true
      }
    }),
    prisma.invoiceAutomationInvoice.findMany({
      where: tenantWhere(tenant, {
        quickBooksPostingError: { not: null }
      }),
      orderBy: [{ updatedAt: "desc" }],
      take: 8,
      select: {
        id: true,
        invoiceType: true,
        fileName: true,
        shipmentFileNumber: true,
        invoiceNumber: true,
        entityNameRaw: true,
        quickBooksPostingError: true,
        updatedAt: true
      }
    }),
    prisma.invoiceAutomationCorrectionMemory.count({ where: tenantWhere(tenant) })
  ]);

  return {
    documents: [
      {
        sourceKind: AssistantSourceKind.OTHER,
        sourceSystem: "NEWL_INVOICE_AUTOMATION",
        externalId: "invoice-automation-operational-summary",
        title: "Invoice automation assistant summary",
        sourceUpdatedAt: recentInvoices[0]?.updatedAt ?? recentBatches[0]?.createdAt ?? new Date(),
        metadata: {
          module: "INVOICE_AUTOMATION",
          recentBatchCount: recentBatches.length,
          recentInvoiceCount: recentInvoices.length,
          failedPostingCount: failedPostings.length,
          correctionMemoryCount
        },
        content: [
          "Invoice automation module capability: invoice verification, operations review, accounting approval, QuickBooks posting, entity aliasing, and correction memory.",
          `Learned invoice correction memories: ${correctionMemoryCount}.`,
          "Invoice counts by type and status:",
          ...invoiceStatusCounts.map((row) => `- ${row.invoiceType} ${row.status}: ${row._count._all}`),
          "Recent invoice batches:",
          ...recentBatches.map((batch) =>
            `- Batch ${batch.batchNumber} (${batch.invoiceType}): ${batch.status}, ${batch._count.invoices} invoices, created ${formatDateTime(batch.createdAt)}${batch.sentToAccountingAt ? `, sent to accounting ${formatDateTime(batch.sentToAccountingAt)}` : ""}${batch.notes ? `, notes: ${batch.notes}` : ""}.`
          ),
          "Recently updated invoices:",
          ...recentInvoices.map((invoice) =>
            `- ${invoice.fileName}: ${invoice.invoiceType} ${invoice.status}, shipment ${invoice.shipmentFileNumber ?? "unknown"}, invoice ${invoice.invoiceNumber ?? "unknown"}, entity ${invoice.quickBooksEntityDisplayName ?? invoice.entityNameRaw ?? "unknown"}, total ${invoice.totalAmount?.toString() ?? "unknown"} ${invoice.currency ?? ""}${invoice.issueCodes ? `, issue codes: ${JSON.stringify(invoice.issueCodes)}` : ""}${invoice.reviewNotes ? `, review notes: ${invoice.reviewNotes}` : ""}${invoice.quickBooksPostingError ? `, QuickBooks error: ${invoice.quickBooksPostingError}` : ""}.`
          ),
          "Recent QuickBooks posting errors:",
          ...failedPostings.map((invoice) =>
            `- ${invoice.fileName}: ${invoice.invoiceType}, shipment ${invoice.shipmentFileNumber ?? "unknown"}, invoice ${invoice.invoiceNumber ?? "unknown"}, entity ${invoice.entityNameRaw ?? "unknown"}, error: ${invoice.quickBooksPostingError}.`
          )
        ].join("\n")
      }
    ],
    memories: [
      {
        kind: AssistantMemoryKind.TENANT_FACT,
        subjectType: "Module",
        subjectId: "INVOICE_AUTOMATION",
        title: "Invoice automation assistant coverage",
        summary:
          "Invoice automation exposes batch status, invoice review queues, QuickBooks posting errors, entity matching, and correction-memory counts to the assistant when invoice or QuickBooks modules are enabled.",
        confidence: 95,
        lastObservedAt: new Date()
      }
    ]
  };
}

function formatDateTime(value: Date) {
  return value.toISOString();
}
