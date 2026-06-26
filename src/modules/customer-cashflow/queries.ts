import {
  CashflowAlertStatus,
  CashflowBillingTrigger,
  CashflowFileStatus,
  CashflowFollowUpStatus,
  CashflowPriority,
  CashflowRiskTier
} from "@prisma/client";
import { prisma } from "@/server/db";
import { tenantWhere } from "@/server/tenant-query";
import type { TenantContext } from "@/server/tenant-context";
import {
  businessDaysBetween,
  calculateCustomerExposure,
  calculateDaysToCollect,
  calculateGrossMarginPercent,
  calculateGrossProfit,
  calculatePercentCreditUsed,
  calculateTrueCashGap,
  classifyRiskTier,
  DEFAULT_CASHFLOW_THRESHOLDS,
  deriveQueuePriority
} from "@/modules/customer-cashflow/calculations";

export type CashflowCustomerSummary = {
  id: string;
  customerName: string;
  tier: CashflowRiskTier;
  revenue: number;
  grossProfit: number;
  grossMarginPercent: number;
  openAr: number;
  overdueAr: number;
  unbilledRevenue: number;
  vendorCostsNotBilled: number;
  vendorPaidNotCollected: number;
  totalExposure: number;
  creditLimit: number;
  percentCreditUsed: number;
  averageDaysToCollect: number | null;
  averageCashGapDays: number | null;
  assignedSalesRep: string | null;
  assignedCollectionsOwner: string | null;
  nextAction: string;
};

export type CashflowFileQueueRow = {
  id: string;
  priority: CashflowPriority;
  customerName: string;
  fileNumber: string;
  shipmentType: string;
  portArrivalDate: Date | null;
  deliveryDate: Date | null;
  vendorInvoiceDate: Date | null;
  vendorCost: number;
  customerInvoiceDate: Date | null;
  customerRevenue: number;
  grossProfit: number;
  grossMarginPercent: number;
  cashGapDays: number | null;
  status: CashflowFileStatus;
  owner: string | null;
  actionRequired: string;
  notes: string | null;
};

export type CashflowCollectionsRow = {
  id: string;
  priority: CashflowPriority;
  customerId: string;
  customerName: string;
  invoiceNumber: string;
  fileNumber: string | null;
  invoiceDate: Date;
  dueDate: Date | null;
  amountOpen: number;
  daysPastDue: number;
  customerExposure: number;
  creditLimit: number;
  assignedOwner: string | null;
  lastFollowUpDate: Date | null;
  nextFollowUpDate: Date | null;
  followUpStatus: CashflowFollowUpStatus | null;
  notes: string | null;
};

type CustomerWithCashflow = Awaited<ReturnType<typeof getCashflowCustomers>>;

export async function getCashflowDashboard(tenant: TenantContext) {
  const [customers, openAlerts] = await Promise.all([
    getCashflowCustomers(tenant),
    prisma.cashflowAlert.findMany({
      where: tenantWhere(tenant, { status: CashflowAlertStatus.OPEN }),
      orderBy: [{ priority: "asc" }, { createdAt: "desc" }],
      take: 8,
      include: {
        customer: true,
        file: true,
        invoice: true
      }
    })
  ]);
  const summaries = buildCustomerSummaries(customers);
  const fileQueue = buildFileQueue(customers).slice(0, 10);

  return {
    kpis: {
      totalOpenAr: sum(summaries.map((customer) => customer.openAr)),
      totalOverdueAr: sum(summaries.map((customer) => customer.overdueAr)),
      totalUnbilledRevenue: sum(summaries.map((customer) => customer.unbilledRevenue)),
      vendorCostsNotBilled: sum(summaries.map((customer) => customer.vendorCostsNotBilled)),
      vendorPaidNotCollected: sum(summaries.map((customer) => customer.vendorPaidNotCollected)),
      totalCreditExposure: sum(summaries.map((customer) => customer.totalExposure)),
      customersOverCreditLimit: summaries.filter((customer) => customer.percentCreditUsed >= 100).length,
      customersAboveWarning: summaries.filter((customer) => customer.percentCreditUsed >= 80).length,
      filesWithVendorCostNoInvoice: fileQueue.filter(
        (file) => file.status === CashflowFileStatus.VENDOR_COST_RECEIVED_NOT_CUSTOMER_BILLED
      ).length,
      averageDaysToCollect: average(summaries.map((customer) => customer.averageDaysToCollect)),
      averageCashGapDays: average(summaries.map((customer) => customer.averageCashGapDays))
    },
    topExposure: [...summaries].sort((a, b) => b.totalExposure - a.totalExposure).slice(0, 10),
    topOverdueAr: [...summaries].sort((a, b) => b.overdueAr - a.overdueAr).slice(0, 10),
    topVendorCostsNotBilled: [...summaries].sort((a, b) => b.vendorCostsNotBilled - a.vendorCostsNotBilled).slice(0, 10),
    topCashGapDays: [...summaries]
      .filter((customer) => customer.averageCashGapDays !== null)
      .sort((a, b) => (b.averageCashGapDays ?? 0) - (a.averageCashGapDays ?? 0))
      .slice(0, 10),
    profitableHighCashUse: summaries
      .filter((customer) => customer.grossProfit > 0 && customer.percentCreditUsed >= 80)
      .sort((a, b) => b.totalExposure - a.totalExposure)
      .slice(0, 10),
    fileQueue,
    openAlerts: openAlerts.map((alert) => ({
      id: alert.id,
      priority: alert.priority,
      title: alert.title,
      message: alert.message,
      customerName: alert.customer?.customerName ?? null,
      fileNumber: alert.file?.fileNumber ?? null,
      invoiceNumber: alert.invoice?.invoiceNumber ?? null,
      createdAt: alert.createdAt
    }))
  };
}

export async function getCashflowSummary(tenant: TenantContext) {
  const customers = await getCashflowCustomers(tenant);
  return {
    customers: buildCustomerSummaries(customers),
    salesReps: unique(customers.map((customer) => customer.assignedSalesRep)),
    collectionsOwners: unique(customers.map((customer) => customer.assignedCollectionsOwner))
  };
}

export async function getCashflowCustomerDetail(tenant: TenantContext, customerId: string) {
  const customers = await getCashflowCustomers(tenant, customerId);
  const customer = customers[0];

  if (!customer) {
    return null;
  }

  const summary = buildCustomerSummaries([customer])[0];
  const openInvoices = customer.invoices
    .filter((invoice) => decimal(invoice.amountOpen) > 0)
    .sort((a, b) => decimal(b.amountOpen) - decimal(a.amountOpen));

  return {
    customer: {
      id: customer.id,
      customerName: customer.company.name,
      financeDisplayName: customer.customerName,
      accountingNameVariants: Array.isArray(customer.accountingNameVariants)
        ? customer.accountingNameVariants.map(String)
        : [],
      sourceAliases: customer.aliases.map((alias) => ({
        sourceSystem: alias.sourceSystem,
        sourceCustomerName: alias.sourceCustomerName,
        sourceCurrency: alias.sourceCurrency,
        sourceLabel: alias.sourceLabel
      })),
      customerTermsDays: customer.customerTermsDays,
      creditLimit: decimal(customer.creditLimit),
      alertThresholdPercent: decimal(customer.alertThresholdPercent),
      billingTrigger: customer.billingTrigger,
      vendorPaymentTrigger: customer.vendorPaymentTrigger,
      requiresApprovalOverLimit: customer.requiresApprovalOverLimit,
      assignedSalesRep: customer.assignedSalesRep,
      assignedCollectionsOwner: customer.assignedCollectionsOwner,
      notes: customer.notes
    },
    summary,
    arAging: buildArAging(customer.invoices),
    openInvoices: openInvoices.map((invoice) => ({
      id: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      fileNumber: invoice.file?.fileNumber ?? null,
      invoiceDate: invoice.invoiceDate,
      dueDate: invoice.dueDate,
      amountOpen: decimal(invoice.amountOpen),
      daysPastDue: invoice.daysPastDue ?? calculateDaysPastDue(invoice.dueDate)
    })),
    unbilledFiles: customer.files.filter((file) => !file.customerInvoiceDate && decimal(file.estimatedRevenue) > 0),
    vendorCostsNotBilled: customer.files.filter((file) => file.vendorInvoiceDate && !file.customerInvoiceDate),
    fileProfitability: customer.files.map((file) => mapFileQueueRow(customer, file, summary)),
    followUps: customer.followUps
      .slice()
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map((followUp) => ({
        id: followUp.id,
        status: followUp.status,
        note: followUp.note,
        nextFollowUpDate: followUp.nextFollowUpDate,
        promisedPaymentDate: followUp.promisedPaymentDate,
        createdAt: followUp.createdAt,
        invoiceNumber: followUp.invoice?.invoiceNumber ?? null,
        fileNumber: followUp.file?.fileNumber ?? null
      })),
    recommendedAction: summary.nextAction
  };
}

export async function getCashflowFileQueue(tenant: TenantContext) {
  const customers = await getCashflowCustomers(tenant);
  return buildFileQueue(customers);
}

export async function getCashflowCollectionsQueue(tenant: TenantContext) {
  const customers = await getCashflowCustomers(tenant);
  const summaries = new Map(buildCustomerSummaries(customers).map((summary) => [summary.id, summary]));
  const rows: CashflowCollectionsRow[] = [];

  for (const customer of customers) {
    const summary = summaries.get(customer.id);
    if (!summary) {
      continue;
    }

    for (const invoice of customer.invoices) {
      const amountOpen = decimal(invoice.amountOpen);
      if (amountOpen <= 0) {
        continue;
      }

      const daysPastDue = invoice.daysPastDue ?? calculateDaysPastDue(invoice.dueDate);
      const latestFollowUp = [...invoice.followUps].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
      const priority = deriveQueuePriority({
        percentCreditUsed: summary.percentCreditUsed,
        activeFilesExist: customer.files.some((file) => !file.customerPaymentDate),
        vendorCostPaidNotInvoiced: customer.files.some((file) => Boolean(file.vendorPaymentDate && !file.customerInvoiceDate)),
        invoiceOverdue: daysPastDue > 0,
        vendorCostExistsNotInvoicedBusinessDays: 0,
        deliveredNotInvoicedBusinessDays: 0,
        daysPastDue
      }) as CashflowPriority;

      rows.push({
        id: invoice.id,
        priority,
        customerId: customer.id,
        customerName: customer.customerName,
        invoiceNumber: invoice.invoiceNumber,
        fileNumber: invoice.file?.fileNumber ?? null,
        invoiceDate: invoice.invoiceDate,
        dueDate: invoice.dueDate,
        amountOpen,
        daysPastDue,
        customerExposure: summary.totalExposure,
        creditLimit: summary.creditLimit,
        assignedOwner: customer.assignedCollectionsOwner,
        lastFollowUpDate: latestFollowUp?.createdAt ?? null,
        nextFollowUpDate: latestFollowUp?.nextFollowUpDate ?? null,
        followUpStatus: latestFollowUp?.status ?? null,
        notes: latestFollowUp?.note ?? customer.notes
      });
    }
  }

  return rows.sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority) || b.amountOpen - a.amountOpen);
}

export async function getCashflowSettings(tenant: TenantContext) {
  const [settings, customers] = await Promise.all([
    prisma.cashflowSettings.upsert({
      where: { tenantId: tenant.tenantId },
      update: {},
      create: { tenantId: tenant.tenantId }
    }),
    prisma.cashflowCustomer.findMany({
      where: tenantWhere(tenant),
      orderBy: { customerName: "asc" }
    })
  ]);

  return {
    thresholds: {
      goodGrossMarginPercent: decimal(settings.goodGrossMarginPercent),
      lowMarginWarningPercent: decimal(settings.lowMarginWarningPercent),
      negativeMarginCriticalPercent: decimal(settings.negativeMarginCriticalPercent),
      collectionWarningDaysBeyondTerms: settings.collectionWarningDaysBeyondTerms,
      highExposureWarningPercent: decimal(settings.highExposureWarningPercent),
      creditBreachPercent: decimal(settings.creditBreachPercent),
      costNotBilledBusinessDays: settings.costNotBilledBusinessDays,
      deliveredNotBilledBusinessDays: settings.deliveredNotBilledBusinessDays,
      defaultBillingTrigger: settings.defaultBillingTrigger,
      notes: settings.notes
    },
    customers: customers.map((customer) => ({
      id: customer.id,
      customerName: customer.customerName,
      customerTermsDays: customer.customerTermsDays,
      creditLimit: decimal(customer.creditLimit),
      alertThresholdPercent: decimal(customer.alertThresholdPercent),
      billingTrigger: customer.billingTrigger,
      vendorPaymentTrigger: customer.vendorPaymentTrigger,
      requiresApprovalOverLimit: customer.requiresApprovalOverLimit,
      customerTier: customer.customerTier,
      assignedSalesRep: customer.assignedSalesRep,
      assignedCollectionsOwner: customer.assignedCollectionsOwner,
      notes: customer.notes
    })),
    billingTriggers: Object.values(CashflowBillingTrigger)
  };
}

async function getCashflowCustomers(tenant: TenantContext, customerId?: string) {
  return prisma.cashflowCustomer.findMany({
    where: tenantWhere(tenant, customerId ? { id: customerId } : {}),
    orderBy: { customerName: "asc" },
    include: {
      company: true,
      aliases: {
        orderBy: {
          sourceCustomerName: "asc"
        }
      },
      files: {
        orderBy: { updatedAt: "desc" },
        include: {
          invoices: true,
          vendorBills: true
        }
      },
      invoices: {
        orderBy: { invoiceDate: "desc" },
        include: {
          file: true,
          followUps: true
        }
      },
      vendorBills: true,
      followUps: {
        include: {
          invoice: true,
          file: true
        }
      }
    }
  });
}

function buildCustomerSummaries(customers: CustomerWithCashflow): CashflowCustomerSummary[] {
  return customers.map((customer) => {
    const revenue = sum(customer.files.map((file) => decimal(file.actualRevenue)));
    const vendorCost = sum(customer.files.map((file) => decimal(file.vendorCost)));
    const grossProfit = calculateGrossProfit(revenue, vendorCost);
    const grossMarginPercent = calculateGrossMarginPercent(grossProfit, revenue);
    const openAr = sum(customer.invoices.map((invoice) => decimal(invoice.amountOpen)));
    const overdueAr = sum(
      customer.invoices
        .filter((invoice) => (invoice.daysPastDue ?? calculateDaysPastDue(invoice.dueDate)) > 0)
        .map((invoice) => decimal(invoice.amountOpen))
    );
    const unbilledRevenue = sum(
      customer.files.filter((file) => !file.customerInvoiceDate).map((file) => decimal(file.estimatedRevenue))
    );
    const vendorCostsNotBilled = sum(
      customer.files
        .filter((file) => Boolean(file.vendorInvoiceDate && !file.customerInvoiceDate))
        .map((file) => decimal(file.vendorCost))
    );
    const vendorPaidNotCollected = sum(
      customer.files
        .filter((file) => Boolean(file.vendorPaymentDate && !file.customerPaymentDate))
        .map((file) => decimal(file.vendorCost))
    );
    const activeShipmentExposure = sum(
      customer.files
        .filter((file) => !file.customerPaymentDate)
        .map((file) => Math.max(decimal(file.estimatedRevenue), decimal(file.actualRevenue), decimal(file.vendorCost)))
    );
    const totalExposure = calculateCustomerExposure({
      openAr,
      unbilledRevenue,
      vendorCostsNotBilled,
      vendorCostsPaidNotCollected: vendorPaidNotCollected,
      activeShipmentExposure
    });
    const creditLimit = decimal(customer.creditLimit);
    const percentCreditUsed = calculatePercentCreditUsed(totalExposure, creditLimit);
    const collectionDays = customer.invoices
      .map((invoice) => invoice.daysToCollect ?? calculateDaysToCollect(invoice.invoiceDate, invoice.paymentDate))
      .filter(isNumber);
    const cashGapDays = customer.files
      .map((file) => file.cashGapDays ?? calculateTrueCashGap(file.customerPaymentDate, file.vendorPaymentDate, file.vendorInvoiceDate))
      .filter(isNumber);
    const averageDaysToCollect = average(collectionDays);
    const averageCashGapDays = average(cashGapDays);
    const tier = classifyRiskTier({
      openAr,
      unbilledRevenue,
      vendorCostsNotBilled,
      vendorCostsPaidNotCollected: vendorPaidNotCollected,
      activeShipmentExposure,
      creditLimit,
      grossMarginPercent,
      averageDaysToCollect,
      customerTermsDays: customer.customerTermsDays,
      hasMissingData: customer.files.length === 0,
      hasMappingIssues: customer.customerTier === "REVIEW"
    }) as CashflowRiskTier;

    return {
      id: customer.id,
      customerName: customer.company.name,
      tier,
      revenue,
      grossProfit,
      grossMarginPercent,
      openAr,
      overdueAr,
      unbilledRevenue,
      vendorCostsNotBilled,
      vendorPaidNotCollected,
      totalExposure,
      creditLimit,
      percentCreditUsed,
      averageDaysToCollect,
      averageCashGapDays,
      assignedSalesRep: customer.assignedSalesRep,
      assignedCollectionsOwner: customer.assignedCollectionsOwner,
      nextAction: recommendAction({
        percentCreditUsed,
        overdueAr,
        vendorCostsNotBilled,
        grossMarginPercent,
        tier
      })
    };
  });
}

function buildFileQueue(customers: CustomerWithCashflow): CashflowFileQueueRow[] {
  const summaries = new Map(buildCustomerSummaries(customers).map((summary) => [summary.id, summary]));
  return customers
    .flatMap((customer) =>
      customer.files.map((file) => mapFileQueueRow(customer, file, summaries.get(customer.id)!))
    )
    .filter((row) => row.priority !== CashflowPriority.LOW || row.status !== CashflowFileStatus.FILE_CLOSED)
    .sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority) || (b.cashGapDays ?? 0) - (a.cashGapDays ?? 0));
}

function mapFileQueueRow(
  customer: CustomerWithCashflow[number],
  file: CustomerWithCashflow[number]["files"][number],
  summary: CashflowCustomerSummary
): CashflowFileQueueRow {
  const now = new Date();
  const vendorCostBusinessDays = businessDaysBetween(file.vendorInvoiceDate, now) ?? 0;
  const deliveredBusinessDays = businessDaysBetween(file.deliveryDate, now) ?? 0;
  const daysPastDue = Math.max(...file.invoices.map((invoice) => invoice.daysPastDue ?? calculateDaysPastDue(invoice.dueDate)), 0);
  const priority = deriveQueuePriority({
    percentCreditUsed: summary.percentCreditUsed,
    activeFilesExist: !file.customerPaymentDate,
    vendorCostPaidNotInvoiced: Boolean(file.vendorPaymentDate && !file.customerInvoiceDate),
    invoiceOverdue: daysPastDue > 0,
    vendorCostExistsNotInvoicedBusinessDays: file.customerInvoiceDate ? 0 : vendorCostBusinessDays,
    deliveredNotInvoicedBusinessDays: file.customerInvoiceDate ? 0 : deliveredBusinessDays,
    daysPastDue
  }) as CashflowPriority;
  const cashGapDays = file.cashGapDays ?? calculateTrueCashGap(file.customerPaymentDate, file.vendorPaymentDate, file.vendorInvoiceDate);

  return {
    id: file.id,
    priority,
    customerName: customer.customerName,
    fileNumber: file.fileNumber,
    shipmentType: file.shipmentType,
    portArrivalDate: file.portArrivalDate,
    deliveryDate: file.deliveryDate,
    vendorInvoiceDate: file.vendorInvoiceDate,
    vendorCost: decimal(file.vendorCost),
    customerInvoiceDate: file.customerInvoiceDate,
    customerRevenue: decimal(file.actualRevenue),
    grossProfit: decimal(file.grossProfit),
    grossMarginPercent: decimal(file.grossMarginPercent),
    cashGapDays,
    status: file.fileStatus,
    owner: file.assignedOwner,
    actionRequired: describeFileAction(file.fileStatus, priority),
    notes: file.notes
  };
}

function buildArAging(invoices: CustomerWithCashflow[number]["invoices"]) {
  return {
    current: sum(invoices.filter((invoice) => (invoice.daysPastDue ?? calculateDaysPastDue(invoice.dueDate)) <= 0).map((invoice) => decimal(invoice.amountOpen))),
    days1to30: sum(invoices.filter((invoice) => inRange(invoice.daysPastDue ?? calculateDaysPastDue(invoice.dueDate), 1, 30)).map((invoice) => decimal(invoice.amountOpen))),
    days31to60: sum(invoices.filter((invoice) => inRange(invoice.daysPastDue ?? calculateDaysPastDue(invoice.dueDate), 31, 60)).map((invoice) => decimal(invoice.amountOpen))),
    days61plus: sum(invoices.filter((invoice) => (invoice.daysPastDue ?? calculateDaysPastDue(invoice.dueDate)) >= 61).map((invoice) => decimal(invoice.amountOpen)))
  };
}

function calculateDaysPastDue(dueDate?: Date | null): number {
  if (!dueDate) {
    return 0;
  }

  return Math.max(0, businessDaysBetween(dueDate, new Date()) ?? 0);
}

function recommendAction(input: {
  percentCreditUsed: number;
  overdueAr: number;
  vendorCostsNotBilled: number;
  grossMarginPercent: number;
  tier: CashflowRiskTier;
}) {
  if (input.tier === CashflowRiskTier.REVIEW) {
    return "Clean up customer/file mapping";
  }

  if (input.percentCreditUsed >= 100) {
    return "Management credit review";
  }

  if (input.vendorCostsNotBilled > 0) {
    return "Bill vendor-backed files";
  }

  if (input.overdueAr > 0) {
    return "Collections follow-up";
  }

  if (input.grossMarginPercent < DEFAULT_CASHFLOW_THRESHOLDS.lowMarginWarningPercent) {
    return "Review pricing/margin";
  }

  return "Monitor";
}

function describeFileAction(status: CashflowFileStatus, priority: CashflowPriority) {
  if (priority === CashflowPriority.CRITICAL) {
    return "Escalate today";
  }

  switch (status) {
    case CashflowFileStatus.VENDOR_COST_RECEIVED_NOT_CUSTOMER_BILLED:
      return "Create customer invoice";
    case CashflowFileStatus.CUSTOMER_BILLED_NOT_COLLECTED:
    case CashflowFileStatus.VENDOR_PAID_CUSTOMER_NOT_COLLECTED:
      return "Collections follow-up";
    case CashflowFileStatus.MARGIN_EXCEPTION:
      return "Review margin";
    case CashflowFileStatus.BILLING_BLOCKED:
      return "Resolve billing block";
    case CashflowFileStatus.NEEDS_ACCOUNTING_REVIEW:
      return "Fix mapping/data";
    default:
      return "Monitor";
  }
}

function priorityRank(priority: CashflowPriority) {
  return {
    [CashflowPriority.CRITICAL]: 0,
    [CashflowPriority.HIGH]: 1,
    [CashflowPriority.MEDIUM]: 2,
    [CashflowPriority.LOW]: 3
  }[priority];
}

function decimal(value: { toString(): string } | number | null | undefined) {
  if (value === null || value === undefined) {
    return 0;
  }

  return Number(value.toString());
}

function sum(values: number[]) {
  return values.reduce((total, value) => total + value, 0);
}

function average(values: Array<number | null>) {
  const numeric = values.filter(isNumber);
  if (numeric.length === 0) {
    return null;
  }

  return Math.round((sum(numeric) / numeric.length) * 10) / 10;
}

function isNumber(value: number | null): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function unique(values: Array<string | null>) {
  return [...new Set(values.filter((value): value is string => Boolean(value)))].sort();
}

function inRange(value: number, min: number, max: number) {
  return value >= min && value <= max;
}
