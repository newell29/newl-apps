import { PDFDocument, StandardFonts } from "pdf-lib";
import { afterEach, describe, expect, it } from "vitest";

import { extractGarlandShippingOrdersFromPdfBytes } from "@/modules/shipment-documents/garland-pdf-server-extraction";

describe("Garland server PDF extraction", () => {
  const originalDomMatrix = globalThis.DOMMatrix;
  const originalDomPoint = globalThis.DOMPoint;
  const originalDomRect = globalThis.DOMRect;

  afterEach(() => {
    globalThis.DOMMatrix = originalDomMatrix;
    globalThis.DOMPoint = originalDomPoint;
    globalThis.DOMRect = originalDomRect;
  });

  it("installs Node geometry globals before parsing PDFs", async () => {
    globalThis.DOMMatrix = undefined as unknown as typeof globalThis.DOMMatrix;
    globalThis.DOMPoint = undefined as unknown as typeof globalThis.DOMPoint;
    globalThis.DOMRect = undefined as unknown as typeof globalThis.DOMRect;

    const pdf = await PDFDocument.create();
    const page = pdf.addPage([300, 150]);
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    page.drawText("BILL OF LADING PS210346 SR811111", { x: 20, y: 100, font, size: 12 });

    const extraction = await extractGarlandShippingOrdersFromPdfBytes(await pdf.save());

    expect(extraction.pageCount).toBe(1);
    expect(globalThis.DOMMatrix).toBeDefined();
  });
});
