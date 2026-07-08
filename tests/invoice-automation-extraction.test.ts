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
});
