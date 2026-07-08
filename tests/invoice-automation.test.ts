import { AccountingInvoiceType, QuickBooksDirectoryEntityType } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { extractInvoiceFileNumber, defaultServiceMapping } from "@/modules/invoice-automation/parsing";
import { suggestQuickBooksEntity } from "@/modules/invoice-automation/matching";
import { approvalIssues } from "@/modules/invoice-automation/validation";
import { buildProfitability, buildRisks } from "@/modules/invoice-automation/queries";
import { parseInvoiceReviewFormData, parseManualQuickBooksDirectoryFormData } from "@/modules/invoice-automation/form-data";

describe("invoice automation parsing and mapping", () => {
  it.each(["OE1765N71", "OI1765N97", "AE180N5", "AI532N2", "TR102N276", "DR222N1"])("extracts supported file number %s", (fileNumber) => {
    expect(extractInvoiceFileNumber(`invoice-${fileNumber}.pdf`)).toBe(fileNumber);
  });
  it("maps default customer and vendor services including DR review", () => {
    expect(defaultServiceMapping(AccountingInvoiceType.CUSTOMER_INVOICE, "OE")).toMatchObject({ itemName: "Ocean Freight" });
    expect(defaultServiceMapping(AccountingInvoiceType.VENDOR_INVOICE, "TR")).toMatchObject({ accountName: "5015 Trucking Rate" });
    expect(defaultServiceMapping(AccountingInvoiceType.VENDOR_INVOICE, "DR")).toMatchObject({ accountName: "5015 Trucking Rate", issue: "DR_MAPPING_NEEDS_FINANCE_CONFIRMATION" });
  });

  it("flags duplicate invoice numbers by type/entity/invoice number", () => {
    const risks = buildRisks([
      { shipmentFileNumber: "OE1", status: "NEEDS_REVIEW", invoiceType: "CUSTOMER_INVOICE", invoiceNumber: "INV-1", normalizedEntityName: "acme", issues: [] },
      { shipmentFileNumber: "OE2", status: "NEEDS_REVIEW", invoiceType: "CUSTOMER_INVOICE", invoiceNumber: "INV-1", normalizedEntityName: "acme", issues: [] }
    ]);
    expect(risks.map((risk) => risk.code)).toContain("DUPLICATE_INVOICE");
  });

  it("flags approved invoices that are not assigned to a batch", () => {
    const risks = buildRisks([
      { shipmentFileNumber: "OE1", status: "APPROVED", invoiceType: "CUSTOMER_INVOICE", invoiceNumber: "INV-1", total: 100, currency: "CAD", postingStatus: "READY_TO_POST", issues: [], batchId: null }
    ]);
    expect(risks.map((risk) => risk.code)).toContain("APPROVED_UNBATCHED");
  });
});

describe("invoice automation QuickBooks matching", () => {
  const base = { entityType: QuickBooksDirectoryEntityType.CUSTOMER, legalEntity: "NEWL_WORLDWIDE" };
  it("flags CAD/USD ambiguity instead of guessing", () => {
    const result = suggestQuickBooksEntity({ normalizedName: "acme", currency: "USD", invoiceType: AccountingInvoiceType.CUSTOMER_INVOICE, candidates: [
      { ...base, id: "1", quickBooksId: "1", displayName: "Acme CAD", normalizedName: "acme", currency: "CAD" },
      { ...base, id: "2", quickBooksId: "2", displayName: "Acme USD", normalizedName: "acme", currency: "USD" }
    ] });
    expect(result.selected).toBeNull();
    expect(result.issues).toContain("AMBIGUOUS_QB_MATCH");
  });
  it("flags USD invoice against only CAD profile", () => {
    const result = suggestQuickBooksEntity({ normalizedName: "acme", currency: "USD", invoiceType: AccountingInvoiceType.CUSTOMER_INVOICE, candidates: [{ ...base, id: "1", quickBooksId: "1", displayName: "Acme CAD", normalizedName: "acme", currency: "CAD" }] });
    expect(result.issues).toContain("CURRENCY_PROFILE_MISMATCH");
  });
});

describe("invoice automation review and manual directory forms", () => {
  it("parses save review edits for all key editable fields", () => {
    const formData = new FormData();
    formData.set("invoiceType", "CUSTOMER_INVOICE");
    formData.set("legalEntity", "NEWL_WORLDWIDE");
    formData.set("shipmentFileNumber", "OE1765N71");
    formData.set("rawEntityName", "Acme Inc - USD");
    formData.set("invoiceNumber", "INV-100");
    formData.set("invoiceDate", "2026-07-08");
    formData.set("dueDate", "2026-08-08");
    formData.set("currency", "USD");
    formData.set("subtotal", "100.25");
    formData.set("tax", "13.03");
    formData.set("total", "113.28");
    formData.set("exchangeRateToCad", "1.370000");
    formData.set("fxOverrideReason", "Finance supplied rate");
    formData.set("qbEntityId", "qb-customer-1");
    formData.set("qbItemId", "qb-item-1");
    formData.set("qbExpenseAccountId", "qb-account-1");
    formData.set("reviewNotes", "Reviewed manually");

    const parsed = parseInvoiceReviewFormData(formData, { entityType: QuickBooksDirectoryEntityType.CUSTOMER, displayName: "Acme USD" });

    expect(parsed).toMatchObject({
      invoiceType: AccountingInvoiceType.CUSTOMER_INVOICE,
      legalEntity: "NEWL_WORLDWIDE",
      shipmentFileNumber: "OE1765N71",
      rawEntityName: "Acme Inc - USD",
      normalizedEntityName: "acme-inc",
      invoiceNumber: "INV-100",
      currency: "USD",
      fxOverrideReason: "Finance supplied rate",
      qbEntityId: "qb-customer-1",
      qbEntityDisplayName: "Acme USD",
      qbItemId: "qb-item-1",
      qbExpenseAccountId: "qb-account-1",
      reviewNotes: "Reviewed manually"
    });
    expect(parsed.invoiceDate?.toISOString()).toContain("2026-07-08");
    expect(parsed.dueDate?.toISOString()).toContain("2026-08-08");
    expect(parsed.subtotal?.toString()).toBe("100.25");
    expect(parsed.tax?.toString()).toBe("13.03");
    expect(parsed.total?.toString()).toBe("113.28");
    expect(parsed.exchangeRateToCad?.toString()).toBe("1.37");
  });

  it("parses manual QuickBooks directory cache rows", () => {
    const formData = new FormData();
    formData.set("displayName", "Acme Inc USD");
    formData.set("quickBooksId", "123");
    formData.set("entityType", "CUSTOMER");
    formData.set("legalEntity", "NEWL_USA");
    formData.set("currency", "usd");
    formData.set("active", "on");

    expect(parseManualQuickBooksDirectoryFormData(formData)).toMatchObject({
      displayName: "Acme Inc USD",
      quickBooksId: "123",
      entityType: QuickBooksDirectoryEntityType.CUSTOMER,
      legalEntity: "NEWL_USA",
      currency: "USD",
      active: true,
      normalizedName: "acme-inc"
    });
  });
});

describe("invoice automation approval/profitability/risk", () => {
  it("blocks approval when posting-critical fields are missing", () => {
    expect(approvalIssues({ invoiceType: AccountingInvoiceType.CUSTOMER_INVOICE, currency: "USD", total: 100 }, true)).toEqual(expect.arrayContaining(["MISSING_LEGAL_ENTITY", "MISSING_INVOICE_NUMBER", "MISSING_PRODUCT_SERVICE", "MISSING_QB_MATCH", "FX_MISSING"]));
  });
  it("groups approved profitability and flags FX/negative profit risks", () => {
    const invoices = [
      { shipmentFileNumber: "OE1", status: "APPROVED", invoiceType: "CUSTOMER_INVOICE", total: 100, currency: "CAD", postingStatus: "READY_TO_POST", issues: [], batchId: "batch-1" },
      { shipmentFileNumber: "OE1", status: "APPROVED", invoiceType: "VENDOR_INVOICE", total: 120, currency: "USD", postingStatus: "READY_TO_POST", issues: [], batchId: "batch-1" }
    ];
    const rows = buildProfitability(invoices);
    expect(rows[0]).toMatchObject({ shipmentFileNumber: "OE1", revenue: 100, cost: 120, grossProfit: -20, fxNeeded: true });
    expect(buildRisks(invoices).map((r) => r.code)).toEqual(expect.arrayContaining(["NEGATIVE_GROSS_PROFIT", "FX_NEEDED", "APPROVED_NOT_POSTED_PLACEHOLDER"]));
  });
});
