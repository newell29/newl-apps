import { describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { buildInvoiceReviewPacketPdf } from "@/modules/invoice-automation/review-packet";

describe("invoice automation review packet", () => {
  it("builds a consolidated PDF with a cover, invoice separators, and original invoice pages", async () => {
    const firstPdf = await createSourcePdf("Invoice A");
    const secondPdf = await createSourcePdf("Invoice B");

    const packetBytes = await buildInvoiceReviewPacketPdf([
      {
        id: "invoice-1",
        batchNumber: "IA-1",
        invoiceType: "CUSTOMER",
        status: "ACCOUNTING_REVIEW",
        fileName: "invoice-a.pdf",
        shipmentFileNumber: "OI913N26",
        entityNameRaw: "Test Customer",
        quickBooksEntityDisplayName: "Test Customer - USD",
        invoiceNumber: "TEST-C-USD-003",
        invoiceDate: new Date("2026-07-10T00:00:00.000Z"),
        dueDate: new Date("2026-08-09T00:00:00.000Z"),
        currency: "USD",
        subtotalAmount: 732.1,
        taxAmount: 0,
        totalAmount: 732.1,
        pdfBytes: firstPdf
      },
      {
        id: "invoice-2",
        batchNumber: "IA-1",
        invoiceType: "VENDOR",
        status: "APPROVED_FOR_POSTING",
        fileName: "invoice-b.pdf",
        shipmentFileNumber: "TR916N26",
        entityNameRaw: "Test Vendor",
        quickBooksEntityDisplayName: "Test Vendor CAD",
        invoiceNumber: "TEST-V-CAD-BC-006",
        invoiceDate: new Date("2026-07-10T00:00:00.000Z"),
        dueDate: new Date("2026-08-09T00:00:00.000Z"),
        currency: "CAD",
        subtotalAmount: 800,
        taxAmount: 96,
        totalAmount: 896,
        pdfBytes: secondPdf
      }
    ]);

    expect(Buffer.from(packetBytes).toString("utf8", 0, 4)).toBe("%PDF");
    const packet = await PDFDocument.load(packetBytes);
    expect(packet.getPageCount()).toBe(5);
  });
});

async function createSourcePdf(label: string) {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  const page = document.addPage([300, 200]);
  page.drawText(label, {
    x: 24,
    y: 150,
    size: 14,
    font
  });
  return new Uint8Array(await document.save());
}
