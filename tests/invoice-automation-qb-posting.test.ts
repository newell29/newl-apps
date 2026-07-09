import { describe, expect, it } from "vitest";
import {
  buildQuickBooksSalesInvoicePayload,
  buildQuickBooksVendorBillPayload,
  parseQuickBooksEntityOptionId,
  QuickBooksPostingMappingError,
  type QuickBooksPostingMappings
} from "@/modules/invoice-automation/quickbooks-posting";
import type { InvoiceAutomationRow } from "@/modules/invoice-automation/types";

const mappings: QuickBooksPostingMappings = {
  productServices: {
    OceanFreight: { value: "item-ocean-freight", name: "Ocean Freight" },
    oceanfreight: { value: "item-ocean-freight", name: "Ocean Freight" },
    Trucking: { value: "item-trucking", name: "Trucking" }
  },
  expenseAccounts: {
    "5015 Trucking Rate": { value: "acct-5015", name: "5015 Trucking Rate" },
    "5015truckingrate": { value: "acct-5015", name: "5015 Trucking Rate" },
    "5020 Ocean Freight Rate": { value: "acct-5020", name: "5020 Ocean Freight Rate" }
  },
  taxCodes: {
    exempt: { value: "E", name: "E" },
    taxable: { value: "H", name: "HST" }
  }
};

describe("invoice automation QuickBooks posting mapping", () => {
  it("builds a vendor Bill payload matching the category details example", () => {
    const payload = buildQuickBooksVendorBillPayload(
      invoiceRow({
        invoiceType: "VENDOR",
        quickBooksEntityId: "quickbooks:9130351993486396:VENDOR:vendor-transport-transtar",
        quickBooksEntityDisplayName: "Transport Transtar",
        entityNameRaw: "Transport Transtar",
        invoiceNumber: "81501",
        invoiceDate: "2026-02-23",
        dueDate: "2026-03-25",
        shipmentFileNumber: "OI580N5",
        currency: "CAD",
        subtotalAmount: 270.62,
        taxAmount: 0,
        totalAmount: 270.62,
        productOrAccountName: "5015 Trucking Rate"
      }),
      mappings
    );

    expect(payload).toEqual({
      VendorRef: {
        value: "vendor-transport-transtar",
        name: "Transport Transtar"
      },
      DocNumber: "81501",
      TxnDate: "2026-02-23",
      DueDate: "2026-03-25",
      CurrencyRef: {
        value: "CAD"
      },
      PrivateNote: "OI580N5",
      Line: [
        {
          DetailType: "AccountBasedExpenseLineDetail",
          Description: "OI580N5",
          Amount: 270.62,
          AccountBasedExpenseLineDetail: {
            AccountRef: {
              value: "acct-5015",
              name: "5015 Trucking Rate"
            },
            TaxCodeRef: {
              value: "E",
              name: "E"
            }
          }
        }
      ]
    });
  });

  it("builds a customer Invoice payload matching the product/service example", () => {
    const payload = buildQuickBooksSalesInvoicePayload(
      invoiceRow({
        invoiceType: "CUSTOMER",
        quickBooksEntityId: "quickbooks:9130351993486396:CUSTOMER:customer-axle-dearborn",
        quickBooksEntityDisplayName: "AXLE OF DEARBORN",
        entityNameRaw: "AXLE OF DEARBORN",
        invoiceNumber: "7488",
        invoiceDate: "2026-07-02",
        dueDate: "2026-08-01",
        shipmentFileNumber: "OI348N1244",
        currency: "USD",
        subtotalAmount: 7321,
        taxAmount: 0,
        totalAmount: 7321,
        productOrAccountName: "Ocean Freight"
      }),
      mappings
    );

    expect(payload).toEqual({
      CustomerRef: {
        value: "customer-axle-dearborn",
        name: "AXLE OF DEARBORN"
      },
      DocNumber: "7488",
      TxnDate: "2026-07-02",
      DueDate: "2026-08-01",
      CurrencyRef: {
        value: "USD"
      },
      PrivateNote: "OI348N1244",
      Line: [
        {
          DetailType: "SalesItemLineDetail",
          Description: "OI348N1244",
          Amount: 7321,
          SalesItemLineDetail: {
            ItemRef: {
              value: "item-ocean-freight",
              name: "Ocean Freight"
            },
            Qty: 1,
            UnitPrice: 7321,
            TaxCodeRef: {
              value: "E",
              name: "E"
            }
          }
        }
      ]
    });
  });

  it("requires explicit QuickBooks product/service and account mappings before posting", () => {
    expect(() =>
      buildQuickBooksSalesInvoicePayload(
        invoiceRow({
          invoiceType: "CUSTOMER",
          quickBooksEntityId: "quickbooks:realm:CUSTOMER:customer-1",
          productOrAccountName: "Unknown Revenue Item"
        }),
        mappings
      )
    ).toThrow(new QuickBooksPostingMappingError("Missing QuickBooks product/service mapping for Unknown Revenue Item."));

    expect(() =>
      buildQuickBooksVendorBillPayload(
        invoiceRow({
          invoiceType: "VENDOR",
          quickBooksEntityId: "quickbooks:realm:VENDOR:vendor-1",
          productOrAccountName: "Unknown Expense Account"
        }),
        mappings
      )
    ).toThrow(new QuickBooksPostingMappingError("Missing QuickBooks expense account mapping for Unknown Expense Account."));
  });

  it("parses composite QuickBooks dropdown IDs and catches customer/vendor mixups", () => {
    expect(parseQuickBooksEntityOptionId("quickbooks:realm-1:CUSTOMER:123", "CUSTOMER")).toEqual({
      realmId: "realm-1",
      entityType: "CUSTOMER",
      quickBooksId: "123"
    });
    expect(parseQuickBooksEntityOptionId("123", "VENDOR")).toEqual({
      realmId: null,
      entityType: "VENDOR",
      quickBooksId: "123"
    });
    expect(() => parseQuickBooksEntityOptionId("quickbooks:realm-1:CUSTOMER:123", "VENDOR")).toThrow(
      new QuickBooksPostingMappingError("QuickBooks entity type CUSTOMER does not match VENDOR.")
    );
  });
});

function invoiceRow(overrides: Partial<InvoiceAutomationRow>): InvoiceAutomationRow {
  return {
    id: "invoice-1",
    batchNumber: "IA-1",
    invoiceType: "CUSTOMER",
    status: "APPROVED_FOR_POSTING",
    fileName: "invoice.pdf",
    shipmentFileNumber: "OE12345",
    shipmentType: "OE",
    entityNameRaw: "Acme Logistics",
    quickBooksEntityId: "quickbooks:realm:CUSTOMER:customer-1",
    quickBooksEntityDisplayName: "Acme Logistics CAD",
    quickBooksMatchConfidence: 100,
    invoiceNumber: "INV-100",
    invoiceDate: "2026-07-01",
    dueDate: "2026-07-31",
    currency: "CAD",
    subtotalAmount: 100,
    taxAmount: 0,
    totalAmount: 100,
    productOrAccountName: "Ocean Freight",
    issueCodes: [],
    createdAt: "2026-07-01T00:00:00.000Z",
    sentToAccountingAt: "2026-07-01T00:00:00.000Z",
    sentToAccountingByName: "User",
    ...overrides
  };
}
