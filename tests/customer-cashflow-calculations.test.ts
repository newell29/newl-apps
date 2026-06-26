import { describe, expect, it } from "vitest";
import {
  businessDaysBetween,
  calculateAvailableCredit,
  calculateCustomerExposure,
  calculateDaysToCollect,
  calculateEstimatedCashGap,
  calculateGrossMarginPercent,
  calculateGrossProfit,
  calculatePercentCreditUsed,
  calculateTrueCashGap,
  classifyRiskTier,
  deriveFileStatus,
  deriveQueuePriority
} from "@/modules/customer-cashflow/calculations";

describe("customer cashflow calculations", () => {
  it("calculates profitability and margin", () => {
    const profit = calculateGrossProfit(12500, 10000);

    expect(profit).toBe(2500);
    expect(calculateGrossMarginPercent(profit, 12500)).toBe(20);
  });

  it("keeps high-profit bad-cash customers out of tier A", () => {
    const tier = classifyRiskTier({
      openAr: 300000,
      unbilledRevenue: 200000,
      vendorCostsNotBilled: 150000,
      vendorCostsPaidNotCollected: 125000,
      activeShipmentExposure: 75000,
      creditLimit: 750000,
      grossMarginPercent: 22,
      averageDaysToCollect: 55,
      customerTermsDays: 30
    });

    expect(tier).toBe("B");
  });

  it("marks missing customer or file matching for review", () => {
    const tier = classifyRiskTier({
      openAr: 0,
      unbilledRevenue: 0,
      vendorCostsNotBilled: 0,
      vendorCostsPaidNotCollected: 0,
      activeShipmentExposure: 0,
      creditLimit: 100000,
      grossMarginPercent: 20,
      averageDaysToCollect: 20,
      customerTermsDays: 30,
      hasMappingIssues: true
    });

    expect(tier).toBe("REVIEW");
  });

  it("calculates exposure, available credit, and percent credit used", () => {
    const exposure = calculateCustomerExposure({
      openAr: 100000,
      unbilledRevenue: 50000,
      vendorCostsNotBilled: 25000,
      vendorCostsPaidNotCollected: 10000,
      activeShipmentExposure: 15000
    });

    expect(exposure).toBe(200000);
    expect(calculateAvailableCredit(250000, exposure)).toBe(50000);
    expect(calculatePercentCreditUsed(exposure, 250000)).toBe(80);
  });

  it("calculates true and estimated cash gaps", () => {
    expect(
      calculateTrueCashGap(new Date("2026-03-31T12:00:00Z"), new Date("2026-02-15T12:00:00Z"))
    ).toBe(44);
    expect(calculateEstimatedCashGap({
      customerTermsDays: 30,
      vendorInvoiceDate: new Date("2026-02-15T12:00:00Z"),
      customerInvoiceDate: new Date("2026-03-01T12:00:00Z")
    })).toBe(44);
    expect(calculateDaysToCollect(new Date("2026-03-01"), new Date("2026-03-31"))).toBe(30);
  });

  it("counts weekday lag for billing alerts", () => {
    expect(businessDaysBetween(new Date("2026-06-19"), new Date("2026-06-23"))).toBe(2);
  });

  it("derives file cash statuses", () => {
    expect(
      deriveFileStatus({
        vendorCost: 4200,
        actualRevenue: 0,
        vendorInvoiceDate: new Date("2026-04-10")
      })
    ).toBe("VENDOR_COST_RECEIVED_NOT_CUSTOMER_BILLED");

    expect(
      deriveFileStatus({
        vendorCost: 4200,
        actualRevenue: 6000,
        customerInvoiceDate: new Date("2026-04-15"),
        vendorPaymentDate: new Date("2026-04-16")
      })
    ).toBe("VENDOR_PAID_CUSTOMER_NOT_COLLECTED");
  });

  it("prioritizes work queue risks", () => {
    expect(
      deriveQueuePriority({
        percentCreditUsed: 105,
        activeFilesExist: true,
        vendorCostPaidNotInvoiced: false,
        invoiceOverdue: false,
        vendorCostExistsNotInvoicedBusinessDays: 0,
        deliveredNotInvoicedBusinessDays: 0,
        daysPastDue: 0
      })
    ).toBe("CRITICAL");

    expect(
      deriveQueuePriority({
        percentCreditUsed: 60,
        activeFilesExist: false,
        vendorCostPaidNotInvoiced: false,
        invoiceOverdue: false,
        vendorCostExistsNotInvoicedBusinessDays: 3,
        deliveredNotInvoicedBusinessDays: 0,
        daysPastDue: 0
      })
    ).toBe("HIGH");
  });
});
