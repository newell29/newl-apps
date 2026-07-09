import { afterEach, describe, expect, it, vi } from "vitest";
import {
  attachPdfToQuickBooksTransaction,
  buildQuickBooksSalesInvoicePayload,
  buildQuickBooksVendorBillPayload,
  createQuickBooksInvoiceAutomationTransaction,
  fetchQuickBooksExchangeRate,
  fetchQuickBooksPostingMappings,
  findExistingQuickBooksTransaction,
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
  afterEach(() => {
    vi.unstubAllGlobals();
  });

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
      GlobalTaxCalculation: "TaxExcluded",
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
      GlobalTaxCalculation: "TaxExcluded",
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

  it("marks taxable CAD vendor bills as tax excluded so QuickBooks applies the line tax code", () => {
    const payload = buildQuickBooksVendorBillPayload(
      invoiceRow({
        invoiceType: "VENDOR",
        quickBooksEntityId: "quickbooks:9130351993486396:VENDOR:test-cad",
        quickBooksEntityDisplayName: "Test Company - DO NOT PROCESS",
        entityNameRaw: "Test Company - DO NOT PROCESS",
        invoiceNumber: "TEST-V-CAD-001",
        invoiceDate: "2026-07-09",
        dueDate: "2026-08-08",
        shipmentFileNumber: "TR900N26",
        currency: "CAD",
        subtotalAmount: 100,
        taxAmount: 13,
        totalAmount: 113,
        productOrAccountName: "5015 Trucking Rate"
      }),
      mappings
    );

    expect(payload.GlobalTaxCalculation).toBe("TaxExcluded");
    expect(payload.Line[0]?.Amount).toBe(100);
    expect(payload.Line[0]?.AccountBasedExpenseLineDetail.TaxCodeRef).toEqual({
      value: "H",
      name: "HST"
    });
  });

  it("includes QuickBooks exchange rates for foreign-currency transactions when provided", () => {
    const payload = buildQuickBooksVendorBillPayload(
      invoiceRow({
        invoiceType: "VENDOR",
        quickBooksEntityId: "quickbooks:9130351993486396:VENDOR:vendor-usd",
        quickBooksEntityDisplayName: "Test Company - DO NOT PROCESS - USD",
        entityNameRaw: "Test Company - DO NOT PROCESS - USD",
        invoiceNumber: "TEST-V-USD-001",
        invoiceDate: "2026-07-09",
        dueDate: "2026-08-08",
        shipmentFileNumber: "OI901N26",
        currency: "USD",
        subtotalAmount: 250,
        taxAmount: 0,
        totalAmount: 250,
        productOrAccountName: "5020 Ocean Freight Rate"
      }),
      mappings,
      { exchangeRate: 1.3725 }
    );

    expect(payload.ExchangeRate).toBe(1.3725);
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

  it("fetches QuickBooks item/account/tax mappings for posting", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(input.toString());
      const query = url.searchParams.get("query") ?? "";
      if (query.includes("from Item")) {
        return jsonResponse({
          QueryResponse: {
            Item: [
              {
                Id: "item-ocean-freight",
                Name: "Ocean Freight",
                FullyQualifiedName: "Ocean Freight"
              }
            ]
          }
        });
      }
      if (query.includes("from Account")) {
        return jsonResponse({
          QueryResponse: {
            Account: [
              {
                Id: "acct-5015",
                Name: "Trucking Rate",
                FullyQualifiedName: "5015 Trucking Rate",
                AcctNum: "5015"
              }
            ]
          }
        });
      }
      return jsonResponse({
        QueryResponse: {
          TaxCode: [
            {
              Id: "E",
              Name: "E"
            },
            {
              Id: "H",
              Name: "H"
            }
          ]
        }
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const fetchedMappings = await fetchQuickBooksPostingMappings({
      realmId: "realm-1",
      accessToken: "token-1"
    });

    expect(fetchedMappings.productServices.oceanfreight).toEqual({
      value: "item-ocean-freight",
      name: "Ocean Freight"
    });
    expect(fetchedMappings.expenseAccounts["5015truckingrate"]).toEqual({
      value: "acct-5015",
      name: "5015 Trucking Rate"
    });
    expect(fetchedMappings.taxCodes.exempt).toEqual({ value: "E", name: "E" });
    expect(fetchedMappings.taxCodes.taxable).toEqual({ value: "H", name: "H" });
  });

  it("queries for duplicate QuickBooks document numbers before creating transactions", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(input.toString());
      expect(url.searchParams.get("query")).toContain("from Invoice where DocNumber = '7488'");
      return jsonResponse({
        QueryResponse: {
          Invoice: [
            {
              Id: "qb-invoice-1",
              DocNumber: "7488"
            }
          ]
        }
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      findExistingQuickBooksTransaction({
        realmId: "realm-1",
        accessToken: "token-1",
        invoiceType: "CUSTOMER",
        docNumber: "7488"
      })
    ).resolves.toEqual({
      Id: "qb-invoice-1",
      DocNumber: "7488"
    });
  });

  it("fetches QuickBooks exchange rates for foreign-currency transactions", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(input.toString());
      expect(url.pathname).toBe("/v3/company/realm-1/exchangerate");
      expect(url.searchParams.get("sourcecurrencycode")).toBe("USD");
      expect(url.searchParams.get("asofdate")).toBe("2026-07-09");
      return jsonResponse({
        ExchangeRate: {
          Rate: "1.3725"
        }
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchQuickBooksExchangeRate({
        realmId: "realm-1",
        accessToken: "token-1",
        sourceCurrencyCode: "usd",
        asOfDate: "2026-07-09"
      })
    ).resolves.toBe(1.3725);
  });

  it("blocks posting when QuickBooks does not return a usable exchange rate", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ ExchangeRate: { Rate: null } })));

    await expect(
      fetchQuickBooksExchangeRate({
        realmId: "realm-1",
        accessToken: "token-1",
        sourceCurrencyCode: "USD",
        asOfDate: "2026-07-09"
      })
    ).rejects.toThrow("QuickBooks did not return a valid exchange rate for USD on 2026-07-09.");
  });

  it("posts customer invoices to the QuickBooks invoice endpoint", async () => {
    const payload = buildQuickBooksSalesInvoicePayload(
      invoiceRow({
        invoiceType: "CUSTOMER",
        quickBooksEntityId: "quickbooks:realm-1:CUSTOMER:customer-1"
      }),
      mappings
    );
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(input.toString()).toContain("/v3/company/realm-1/invoice");
      expect(init?.method).toBe("POST");
      expect(JSON.parse(String(init?.body))).toEqual(payload);
      return jsonResponse({
        Invoice: {
          Id: "qb-invoice-1",
          DocNumber: "INV-100"
        }
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      createQuickBooksInvoiceAutomationTransaction({
        realmId: "realm-1",
        accessToken: "token-1",
        invoiceType: "CUSTOMER",
        payload
      })
    ).resolves.toEqual({
      Invoice: {
        Id: "qb-invoice-1",
        DocNumber: "INV-100"
      }
    });
  });

  it("uploads and attaches the original PDF to the created QuickBooks transaction", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(input.toString()).toContain("/v3/company/realm-1/upload");
      expect(init?.method).toBe("POST");
      expect(init?.headers).toEqual({
        Authorization: "Bearer token-1",
        Accept: "application/json"
      });
      expect(init?.body).toBeInstanceOf(FormData);
      const keys = Array.from((init?.body as FormData).keys());
      expect(keys).toEqual(["file_metadata_01", "file_content_01"]);
      return jsonResponse({
        AttachableResponse: [
          {
            Attachable: {
              Id: "attach-1",
              FileName: "test-invoice.pdf"
            }
          }
        ]
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      attachPdfToQuickBooksTransaction({
        realmId: "realm-1",
        accessToken: "token-1",
        invoiceType: "CUSTOMER",
        transactionId: "qb-invoice-1",
        fileName: "test-invoice.pdf",
        contentType: "application/pdf",
        pdfBytes: new Uint8Array([37, 80, 68, 70])
      })
    ).resolves.toEqual({
      AttachableResponse: [
        {
          Attachable: {
            Id: "attach-1",
            FileName: "test-invoice.pdf"
          }
        }
      ]
    });
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

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      "content-type": "application/json"
    }
  });
}
