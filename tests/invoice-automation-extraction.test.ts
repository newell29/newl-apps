import { describe, expect, it } from "vitest";

import {
  buildInvoiceDraftFromText,
  extractInvoiceAmounts,
  extractShipmentFileNumber,
  getBusinessLineFromInvoiceFileNumber,
  getDefaultProductOrAccount,
  matchQuickBooksEntity
} from "@/modules/invoice-automation/extraction";
import type { InvoiceAutomationEntityOption } from "@/modules/invoice-automation/types";

const entityOptions: InvoiceAutomationEntityOption[] = [
  {
    id: "qb-customer-cad",
    entityType: "CUSTOMER",
    displayName: "Acme Logistics CAD",
    normalizedName: "acme logistics",
    currency: "CAD"
  },
  {
    id: "qb-vendor-usd",
    entityType: "VENDOR",
    displayName: "Fast Trucking USD",
    normalizedName: "fast trucking",
    currency: "USD"
  },
  {
    id: "qb-air-vendor",
    entityType: "VENDOR",
    displayName: "Air Freight Vendor",
    normalizedName: "air freight vendor",
    currency: "USD"
  }
];

describe("invoice automation extraction", () => {
  it("extracts shipment file numbers from OCR text and uploaded file names", () => {
    expect(extractShipmentFileNumber("Shipment file: OE-12345")).toBe("OE12345");
    expect(extractShipmentFileNumber("", "vendor-invoice_TR98765.pdf")).toBe("TR98765");
  });

  it("maps service prefixes to profitability business lines and QB posting defaults", () => {
    expect(getBusinessLineFromInvoiceFileNumber("OE12345")).toBe("OCEAN");
    expect(getBusinessLineFromInvoiceFileNumber("AE12345")).toBe("AIR");
    expect(getBusinessLineFromInvoiceFileNumber("DR12345")).toBe("TRUCKING");
    expect(getDefaultProductOrAccount("CUSTOMER", "OI12345")).toBe("Ocean Freight");
    expect(getDefaultProductOrAccount("VENDOR", "TR12345")).toBe("5015 Trucking Rate");
  });

  it("extracts subtotal, tax, and total amounts", () => {
    expect(
      extractInvoiceAmounts(`
        Subtotal: $1,000.00
        HST: $130.00
        Total Amount: CAD $1,130.00
      `)
    ).toEqual({
      subtotalAmount: 1000,
      taxAmount: 130,
      totalAmount: 1130
    });
  });

  it("matches OCR text to QuickBooks customer and vendor options", () => {
    expect(matchQuickBooksEntity("Bill To: Acme Logistics", "CUSTOMER", entityOptions)?.option.id).toBe(
      "qb-customer-cad"
    );
    expect(matchQuickBooksEntity("Vendor: Fast Trucking", "VENDOR", entityOptions)?.option.id).toBe("qb-vendor-usd");
  });

  it("does not match generic service words to a QuickBooks vendor", () => {
    expect(
      matchQuickBooksEntity("Freight bills assigned to RTS Financial for OE3124N2", "VENDOR", entityOptions)
    ).toBeNull();
  });

  it("builds a customer invoice draft with editable review fields", () => {
    const draft = buildInvoiceDraftFromText({
      clientId: "local-1",
      fileName: "customer-OE12345.pdf",
      contentType: "application/pdf",
      sizeBytes: 256,
      pdfBase64: "JVBERi0x",
      invoiceType: "CUSTOMER",
      entityOptions,
      text: `
        Invoice Number: INV-1001
        Invoice Date: 2026-07-01
        Due Date: 2026-07-31
        Bill To: Acme Logistics CAD
        File Number: OE12345
        Currency: CAD
        Subtotal: $2,000.00
        HST: $260.00
        Amount Due: $2,260.00
      `
    });

    expect(draft).toMatchObject({
      shipmentFileNumber: "OE12345",
      businessLine: "OCEAN",
      entityNameRaw: "Acme Logistics CAD",
      quickBooksEntityId: "qb-customer-cad",
      invoiceNumber: "INV-1001",
      invoiceDate: "2026-07-01",
      dueDate: "2026-07-31",
      currency: "CAD",
      subtotalAmount: 2000,
      taxAmount: 260,
      totalAmount: 2260,
      productOrAccountName: "Ocean Freight",
      issueCodes: []
    });
  });

  it("extracts factored trucking invoices to the actual carrier and defaults missing due dates to net 30", () => {
    const draft = buildInvoiceDraftFromText({
      clientId: "local-2",
      fileName: "373 cargo inc OE3124N2.pdf",
      contentType: "application/pdf",
      sizeBytes: 256,
      pdfBase64: "JVBERi0x",
      invoiceType: "VENDOR",
      entityOptions,
      text: `
        BILL TO:
        NEWELLS EXPRESS WORLDWIDE LOGISTICS LTD

        ALL BILLS PRESENTED ON THIS INVOICE HAVE BEEN
        SOLD & ASSIGNED TO AND ARE PAYABLE TO:
        RTS Financial Service, Inc.

        373 CARGO INCORPORATED
        INVOICE
        INV DATE INV # PO # INV AMOUNT
        6/18/2026 ONUR512 OE3124N2 2,500.00

        Invoice # ONUR512
        Invoice Date 6/18/2026
        Reference(Load or W/O) OE3124N2
        Assigned For:
        373 CARGO INCORPORATED
        RATES AND CHARGES
        (USD) Total Rate $2,500.00
      `
    });

    expect(draft).toMatchObject({
      shipmentFileNumber: "OE3124N2",
      businessLine: "OCEAN",
      entityNameRaw: "373 CARGO INCORPORATED",
      quickBooksEntityId: null,
      invoiceNumber: "ONUR512",
      invoiceDate: "2026-06-18",
      dueDate: "2026-07-18",
      currency: "USD",
      totalAmount: 2500,
      productOrAccountName: "5020 Ocean Freight Rate"
    });
    expect(draft.issueCodes).toContain("MISSING_QB_MATCH");
  });
});
