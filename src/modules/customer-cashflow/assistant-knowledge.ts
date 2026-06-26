import {
  AssistantMemoryKind,
  AssistantSourceKind,
  CashflowAlertStatus
} from "@prisma/client";

import type { AssistantKnowledgeAdapterResult } from "@/modules/assistant/knowledge-registry";
import { getCashflowSummary } from "@/modules/customer-cashflow/queries";
import { prisma } from "@/server/db";
import type { TenantContext } from "@/server/tenant-context";
import { tenantWhere } from "@/server/tenant-query";

export async function getCustomerCashflowAssistantKnowledge(
  tenant: TenantContext
): Promise<AssistantKnowledgeAdapterResult> {
  const [summary, alerts] = await Promise.all([
    getCashflowSummary(tenant),
    prisma.cashflowAlert.findMany({
      where: tenantWhere(tenant, { status: CashflowAlertStatus.OPEN }),
      orderBy: [{ priority: "asc" }, { createdAt: "desc" }],
      take: 100,
      include: {
        customer: {
          select: {
            id: true,
            customerName: true
          }
        },
        file: {
          select: {
            id: true,
            fileNumber: true
          }
        },
        invoice: {
          select: {
            id: true,
            invoiceNumber: true
          }
        }
      }
    })
  ]);

  return {
    documents: [
      ...summary.customers.map((customer) => ({
        sourceKind: AssistantSourceKind.COMPANY,
        sourceSystem: "NEWL_CASHFLOW_CUSTOMER",
        externalId: customer.id,
        title: `${customer.customerName} cashflow`,
        sourceUpdatedAt: null,
        metadata: {
          customerName: customer.customerName,
          tier: customer.tier,
          openAr: customer.openAr,
          overdueAr: customer.overdueAr,
          totalExposure: customer.totalExposure,
          creditLimit: customer.creditLimit,
          percentCreditUsed: customer.percentCreditUsed,
          assignedSalesRep: customer.assignedSalesRep,
          assignedCollectionsOwner: customer.assignedCollectionsOwner
        },
        content: joinKnowledgeParts([
          `${customer.customerName} is a customer cashflow record in Newl Apps.`,
          `Risk tier: ${customer.tier}.`,
          `Open accounts receivable: ${formatMoney(customer.openAr)}.`,
          `Overdue accounts receivable: ${formatMoney(customer.overdueAr)}.`,
          `Unbilled revenue: ${formatMoney(customer.unbilledRevenue)}.`,
          `Vendor costs not billed: ${formatMoney(customer.vendorCostsNotBilled)}.`,
          `Vendor paid not collected: ${formatMoney(customer.vendorPaidNotCollected)}.`,
          `Total exposure: ${formatMoney(customer.totalExposure)} against credit limit ${formatMoney(customer.creditLimit)}.`,
          `Credit used: ${formatPercent(customer.percentCreditUsed)}.`,
          customer.averageDaysToCollect !== null ? `Average days to collect: ${customer.averageDaysToCollect.toFixed(1)}.` : null,
          customer.averageCashGapDays !== null ? `Average cash gap days: ${customer.averageCashGapDays.toFixed(1)}.` : null,
          customer.assignedSalesRep ? `Assigned sales rep: ${customer.assignedSalesRep}.` : null,
          customer.assignedCollectionsOwner ? `Assigned collections owner: ${customer.assignedCollectionsOwner}.` : null,
          `Recommended next action: ${customer.nextAction}.`
        ])
      })),
      ...alerts.map((alert) => ({
        sourceKind: AssistantSourceKind.OTHER,
        sourceSystem: "NEWL_CASHFLOW_ALERT",
        externalId: alert.id,
        title: alert.title,
        sourceUpdatedAt: alert.updatedAt,
        metadata: {
          priority: alert.priority,
          alertType: alert.alertType,
          customerId: alert.customer?.id ?? null,
          customerName: alert.customer?.customerName ?? null,
          fileNumber: alert.file?.fileNumber ?? null,
          invoiceNumber: alert.invoice?.invoiceNumber ?? null
        },
        content: joinKnowledgeParts([
          `Cashflow alert ${alert.title}.`,
          `Priority: ${alert.priority}.`,
          `Type: ${alert.alertType}.`,
          alert.customer?.customerName ? `Customer: ${alert.customer.customerName}.` : null,
          alert.file?.fileNumber ? `File number: ${alert.file.fileNumber}.` : null,
          alert.invoice?.invoiceNumber ? `Invoice number: ${alert.invoice.invoiceNumber}.` : null,
          `Message: ${alert.message}.`,
          alert.dueDate ? `Due date: ${alert.dueDate.toISOString()}.` : null
        ])
      }))
    ],
    memories: summary.customers
      .filter((customer) => customer.overdueAr > 0 || customer.percentCreditUsed >= 80 || customer.tier === "D" || customer.tier === "REVIEW")
      .map((customer) => ({
        kind: AssistantMemoryKind.OPERATIONAL_RISK,
        subjectType: "CashflowCustomer",
        subjectId: customer.id,
        title: `${customer.customerName} cashflow risk`,
        summary: joinKnowledgeParts([
          customer.overdueAr > 0 ? `Overdue AR ${formatMoney(customer.overdueAr)}` : null,
          customer.percentCreditUsed >= 80 ? `credit used ${formatPercent(customer.percentCreditUsed)}` : null,
          `risk tier ${customer.tier}`,
          `next action ${customer.nextAction}`
        ]),
        confidence: Math.min(95, Math.max(60, Math.round(customer.percentCreditUsed))),
        sourceRef: {
          sourceSystem: "NEWL_CASHFLOW_CUSTOMER",
          externalId: customer.id
        }
      }))
  };
}

function joinKnowledgeParts(parts: Array<string | null>) {
  return parts.filter((part): part is string => Boolean(part)).join(" ");
}

function formatMoney(value: number) {
  return `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatPercent(value: number) {
  return `${value.toFixed(1)}%`;
}
