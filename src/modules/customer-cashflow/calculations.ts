export type CashflowThresholds = {
  goodGrossMarginPercent: number;
  lowMarginWarningPercent: number;
  negativeMarginCriticalPercent: number;
  collectionWarningDaysBeyondTerms: number;
  highExposureWarningPercent: number;
  creditBreachPercent: number;
  costNotBilledBusinessDays: number;
  deliveredNotBilledBusinessDays: number;
};

export const DEFAULT_CASHFLOW_THRESHOLDS: CashflowThresholds = {
  goodGrossMarginPercent: 15,
  lowMarginWarningPercent: 10,
  negativeMarginCriticalPercent: 0,
  collectionWarningDaysBeyondTerms: 10,
  highExposureWarningPercent: 80,
  creditBreachPercent: 100,
  costNotBilledBusinessDays: 2,
  deliveredNotBilledBusinessDays: 1
};

export type CashflowRiskTier = "A" | "B" | "C" | "D" | "REVIEW";
export type CashflowPriority = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
export type CashflowFileStatus =
  | "NO_VENDOR_COST_NO_REVENUE"
  | "VENDOR_COST_RECEIVED_NOT_CUSTOMER_BILLED"
  | "CUSTOMER_BILLED_NOT_COLLECTED"
  | "VENDOR_PAID_CUSTOMER_NOT_COLLECTED"
  | "CUSTOMER_COLLECTED_VENDOR_UNPAID"
  | "FILE_CLOSED"
  | "MARGIN_EXCEPTION"
  | "BILLING_BLOCKED"
  | "NEEDS_ACCOUNTING_REVIEW";

export type CashflowExposureInput = {
  openAr: number;
  unbilledRevenue: number;
  vendorCostsNotBilled: number;
  vendorCostsPaidNotCollected: number;
  activeShipmentExposure: number;
};

export type CashflowRiskInput = CashflowExposureInput & {
  creditLimit: number;
  grossMarginPercent: number | null;
  averageDaysToCollect: number | null;
  customerTermsDays: number;
  hasMissingData?: boolean;
  hasMappingIssues?: boolean;
};

export type FileStatusInput = {
  vendorCost: number;
  actualRevenue: number;
  customerInvoiceDate?: Date | null;
  customerPaymentDate?: Date | null;
  vendorInvoiceDate?: Date | null;
  vendorPaymentDate?: Date | null;
  grossMarginPercent?: number | null;
  billingBlockReason?: string | null;
  missingMapping?: boolean;
  thresholds?: CashflowThresholds;
};

export type QueuePriorityInput = {
  percentCreditUsed: number;
  activeFilesExist: boolean;
  vendorCostPaidNotInvoiced: boolean;
  invoiceOverdue: boolean;
  vendorCostExistsNotInvoicedBusinessDays: number;
  deliveredNotInvoicedBusinessDays: number;
  daysPastDue: number;
  thresholds?: CashflowThresholds;
};

const MS_PER_DAY = 1000 * 60 * 60 * 24;

export function calculateGrossProfit(actualRevenue: number, vendorCost: number): number {
  return roundCurrency(actualRevenue - vendorCost);
}

export function calculateGrossMarginPercent(grossProfit: number, actualRevenue: number): number {
  if (actualRevenue <= 0) {
    return 0;
  }

  return roundPercent((grossProfit / actualRevenue) * 100);
}

export function daysBetween(start?: Date | null, end?: Date | null): number | null {
  if (!start || !end) {
    return null;
  }

  return Math.round((startOfDay(end).getTime() - startOfDay(start).getTime()) / MS_PER_DAY);
}

export function businessDaysBetween(start?: Date | null, end?: Date | null): number | null {
  if (!start || !end) {
    return null;
  }

  const from = startOfDay(start);
  const to = startOfDay(end);
  if (to <= from) {
    return 0;
  }

  let days = 0;
  const cursor = new Date(from);
  while (cursor < to) {
    cursor.setDate(cursor.getDate() + 1);
    const day = cursor.getDay();
    if (day !== 0 && day !== 6) {
      days += 1;
    }
  }

  return days;
}

export function calculateDaysToInvoice({
  customerInvoiceDate,
  deliveryDate,
  portArrivalDate
}: {
  customerInvoiceDate?: Date | null;
  deliveryDate?: Date | null;
  portArrivalDate?: Date | null;
}): number | null {
  return daysBetween(deliveryDate ?? portArrivalDate, customerInvoiceDate);
}

export function calculateDaysToCollect(customerInvoiceDate?: Date | null, customerPaymentDate?: Date | null): number | null {
  return daysBetween(customerInvoiceDate, customerPaymentDate);
}

export function calculateVendorToRevenueLag(vendorInvoiceDate?: Date | null, customerInvoiceDate?: Date | null): number | null {
  return daysBetween(customerInvoiceDate, vendorInvoiceDate);
}

export function calculateTrueCashGap(customerPaymentDate?: Date | null, vendorPaymentDate?: Date | null, vendorInvoiceDate?: Date | null): number | null {
  return daysBetween(vendorPaymentDate ?? vendorInvoiceDate, customerPaymentDate);
}

export function calculateEstimatedCashGap({
  customerTermsDays,
  vendorInvoiceDate,
  portArrivalDate,
  customerInvoiceDate
}: {
  customerTermsDays: number;
  vendorInvoiceDate?: Date | null;
  portArrivalDate?: Date | null;
  customerInvoiceDate?: Date | null;
}): number | null {
  const lag = daysBetween(vendorInvoiceDate ?? portArrivalDate, customerInvoiceDate);
  if (lag === null) {
    return null;
  }

  return customerTermsDays + lag;
}

export function calculateCustomerExposure(input: CashflowExposureInput): number {
  return roundCurrency(
    input.openAr +
      input.unbilledRevenue +
      input.vendorCostsNotBilled +
      input.vendorCostsPaidNotCollected +
      input.activeShipmentExposure
  );
}

export function calculateAvailableCredit(creditLimit: number, customerExposure: number): number {
  return roundCurrency(creditLimit - customerExposure);
}

export function calculatePercentCreditUsed(customerExposure: number, creditLimit: number): number {
  if (creditLimit <= 0) {
    return customerExposure > 0 ? 100 : 0;
  }

  return roundPercent((customerExposure / creditLimit) * 100);
}

export function classifyRiskTier(input: CashflowRiskInput, thresholds = DEFAULT_CASHFLOW_THRESHOLDS): CashflowRiskTier {
  if (input.hasMissingData || input.hasMappingIssues || input.grossMarginPercent === null) {
    return "REVIEW";
  }

  const exposure = calculateCustomerExposure(input);
  const percentCreditUsed = calculatePercentCreditUsed(exposure, input.creditLimit);
  const paysBeyondTerms =
    input.averageDaysToCollect !== null &&
    input.averageDaysToCollect > input.customerTermsDays + thresholds.collectionWarningDaysBeyondTerms;
  const goodMargin = input.grossMarginPercent >= thresholds.goodGrossMarginPercent;
  const lowMargin = input.grossMarginPercent < thresholds.lowMarginWarningPercent;
  const badExposure = percentCreditUsed >= thresholds.highExposureWarningPercent;

  if (goodMargin && !paysBeyondTerms && !badExposure) {
    return "A";
  }

  if (goodMargin && (paysBeyondTerms || badExposure)) {
    return "B";
  }

  if (lowMargin && !paysBeyondTerms && !badExposure) {
    return "C";
  }

  return "D";
}

export function deriveFileStatus(input: FileStatusInput): CashflowFileStatus {
  const thresholds = input.thresholds ?? DEFAULT_CASHFLOW_THRESHOLDS;
  if (input.missingMapping) {
    return "NEEDS_ACCOUNTING_REVIEW";
  }

  if (input.billingBlockReason) {
    return "BILLING_BLOCKED";
  }

  if (
    typeof input.grossMarginPercent === "number" &&
    input.grossMarginPercent < thresholds.lowMarginWarningPercent &&
    input.actualRevenue > 0
  ) {
    return "MARGIN_EXCEPTION";
  }

  const hasVendorCost = input.vendorCost > 0 || Boolean(input.vendorInvoiceDate);
  const hasCustomerInvoice = Boolean(input.customerInvoiceDate) || input.actualRevenue > 0;
  const vendorPaid = Boolean(input.vendorPaymentDate);
  const customerCollected = Boolean(input.customerPaymentDate);

  if (!hasVendorCost && !hasCustomerInvoice) {
    return "NO_VENDOR_COST_NO_REVENUE";
  }

  if (hasVendorCost && !hasCustomerInvoice) {
    return "VENDOR_COST_RECEIVED_NOT_CUSTOMER_BILLED";
  }

  if (vendorPaid && !customerCollected) {
    return "VENDOR_PAID_CUSTOMER_NOT_COLLECTED";
  }

  if (hasCustomerInvoice && !customerCollected) {
    return "CUSTOMER_BILLED_NOT_COLLECTED";
  }

  if (customerCollected && hasVendorCost && !vendorPaid) {
    return "CUSTOMER_COLLECTED_VENDOR_UNPAID";
  }

  return "FILE_CLOSED";
}

export function deriveQueuePriority(input: QueuePriorityInput): CashflowPriority {
  const thresholds = input.thresholds ?? DEFAULT_CASHFLOW_THRESHOLDS;

  if (
    (input.percentCreditUsed >= thresholds.creditBreachPercent && input.activeFilesExist) ||
    input.vendorCostPaidNotInvoiced ||
    (input.invoiceOverdue && input.activeFilesExist)
  ) {
    return "CRITICAL";
  }

  if (
    input.vendorCostExistsNotInvoicedBusinessDays > thresholds.costNotBilledBusinessDays ||
    input.deliveredNotInvoicedBusinessDays > thresholds.deliveredNotBilledBusinessDays ||
    input.percentCreditUsed >= thresholds.highExposureWarningPercent
  ) {
    return "HIGH";
  }

  if (input.daysPastDue > 0) {
    return "MEDIUM";
  }

  return "LOW";
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function roundCurrency(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function roundPercent(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
