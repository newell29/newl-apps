import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";

import {
  buildTmgCombinedOrderPdf,
  parseTmgPackingSlipPage,
  parseTmgPicklistPage,
  prepareTmgEmailBatch
} from "@/modules/shipment-documents/tmg-pdf-intake";

describe("TMG PDF intake", () => {
  it("uses the packing slip as the primary order source and keeps delivery notes separate", () => {
    const order = parseTmgPackingSlipPage({
      pageNumber: 1,
      width: 612,
      height: 792,
      text: [
        "TMG INDUSTRIAL USA Order #US19999",
        "August 18, 2026",
        "SHIP TO BILL TO",
        "ITEMS QUANTITY",
        "Synthetic equipment TMG-EXAMPLE-1 2 of 2",
        "TMG-EXAMPLE-1",
        "NOTES",
        "Appointment required for the trucking company",
        "Thank you for shopping with us!"
      ].join("\n"),
      words: [
        word("SHIP TO", 80, 700),
        word("BILL TO", 300, 700),
        word("Synthetic Recipient", 80, 680),
        word("Synthetic Company", 80, 660),
        word("123 Example Way", 80, 640),
        word("Example City NY 12345", 80, 620),
        word("United States", 80, 600),
        word("+1 212-555-0100", 80, 580),
        word("ITEMS", 80, 500)
      ]
    }, { sourceId: "packing", fileName: "packing-slips.pdf" });

    expect(order).toMatchObject({
      customerReference: "US19999",
      orderDate: "2026-08-18",
      shipTo: {
        name: "Synthetic Recipient",
        address: "123 Example Way",
        city: "Example City",
        state: "NY",
        postalCode: "12345",
        countryCode: "US",
        phone: "+1 212-555-0100"
      },
      items: [{ sku: "TMG-EXAMPLE-1", quantity: 2 }],
      deliveryNotes: "Appointment required for the trucking company"
    });
  });

  it("assigns picklist notes to the nearest order row and ignores page headers", () => {
    const orders = parseTmgPicklistPage({
      pageNumber: 1,
      width: 612,
      height: 792,
      text: "Order Number SKU Shipping Name Ship City State Tracking number Notes",
      words: [
        word("NC", 475, 750),
        word("Notes", 475, 700),
        word("US19999", 60, 650),
        word("TMG-EXAMPLE-1", 105, 650),
        word("2", 190, 650),
        word("010-1234567", 365, 650),
        word("US18888", 60, 600),
        word("TMG-EXAMPLE-2", 105, 600),
        word("1", 190, 600),
        word("010-7654321", 365, 600),
        word("5", 430, 600),
        word("layers", 445, 600),
        word("shrink", 480, 600),
        word("wrap", 520, 600)
      ]
    });

    expect(orders).toEqual([
      {
        customerReference: "US19999",
        fulfillmentType: "FREIGHT",
        sku: "TMG-EXAMPLE-1",
        quantity: 2,
        trackingNumber: "010-1234567",
        warehouseInstructions: null,
        sourceAttachmentId: "unknown",
        sourceFileName: "unknown.pdf",
        sourcePageNumber: 1
      },
      {
        customerReference: "US18888",
        fulfillmentType: "FREIGHT",
        sku: "TMG-EXAMPLE-2",
        quantity: 1,
        trackingNumber: "010-7654321",
        warehouseInstructions: "5 layers shrink wrap",
        sourceAttachmentId: "unknown",
        sourceFileName: "unknown.pdf",
        sourcePageNumber: 1
      }
    ]);
  });

  it("builds the consolidated packet in packing-slip, BOL, label order", async () => {
    const packing = await pdfWithPageWidths([100, 101]);
    const bol = await pdfWithPageWidths([200]);
    const label = await pdfWithPageWidths([300]);
    const packetBytes = await buildTmgCombinedOrderPdf({
      packingSlipPdf: packing,
      packingSlipPageNumber: 2,
      bolPdf: bol,
      labelPdf: label
    });
    const packet = await PDFDocument.load(packetBytes);

    expect(packet.getPages().map((page) => page.getWidth())).toEqual([101, 200, 300]);
  });

  it("accepts an explicit self-pickup packet without a BOL, label, or PRO number", async () => {
    const pickupPacket = await selfPickupPacketPdf("US19999");
    const picklist = await picklistPdf({ reference: "US19999", selfPickup: true });
    const prepared = await prepareTmgEmailBatch([
      { sourceId: "picklist", fileName: "picklist.pdf", contentType: "application/pdf", bytes: picklist },
      { sourceId: "pickup", fileName: "self-pickup US19999.pdf", contentType: "application/pdf", bytes: pickupPacket }
    ]);

    expect(prepared.orders).toHaveLength(1);
    expect(prepared.orders[0]).toMatchObject({
      customerReference: "US19999",
      fulfillmentType: "SELF_PICKUP",
      bol: null,
      label: null,
      validationIssues: [],
      readyForApproval: true,
      combinedPdfFileName: "TMG US19999.pdf"
    });
    expect(prepared.orders[0]!.combinedPdfBytes).toEqual(pickupPacket);
    expect((await PDFDocument.load(prepared.orders[0]!.combinedPdfBytes!)).getPageCount()).toBe(3);
  });

  it("keeps an ordinary freight order blocked when its BOL and label are missing", async () => {
    const packingSlip = await packingSlipPdf("US19999");
    const picklist = await picklistPdf({ reference: "US19999", selfPickup: false });
    const prepared = await prepareTmgEmailBatch([
      { sourceId: "picklist", fileName: "picklist.pdf", contentType: "application/pdf", bytes: picklist },
      { sourceId: "packing", fileName: "order.pdf", contentType: "application/pdf", bytes: packingSlip }
    ]);

    expect(prepared.orders[0]).toMatchObject({ fulfillmentType: "FREIGHT", readyForApproval: false });
    expect(prepared.orders[0]!.validationIssues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      "MISSING_BOL",
      "MISSING_LABEL"
    ]));
  });
});

function word(text: string, x: number, y: number) {
  return { text, x, y };
}

async function pdfWithPageWidths(widths: number[]) {
  const pdf = await PDFDocument.create();
  for (const width of widths) pdf.addPage([width, 400]);
  return new Uint8Array(await pdf.save());
}

async function selfPickupPacketPdf(reference: string) {
  const pdf = await PDFDocument.create();
  pdf.addPage([612, 792]).drawText(`Self-pickup (NC) Order Numbers: #${reference}`, { x: 60, y: 700 });
  pdf.addPage([612, 792]).drawText(`Customer Self Pickup Form Order Number #${reference}`, { x: 60, y: 700 });
  drawPackingSlip(pdf.addPage([612, 792]), reference);
  return new Uint8Array(await pdf.save());
}

async function packingSlipPdf(reference: string) {
  const pdf = await PDFDocument.create();
  drawPackingSlip(pdf.addPage([612, 792]), reference);
  return new Uint8Array(await pdf.save());
}

function drawPackingSlip(page: ReturnType<PDFDocument["addPage"]>, reference: string) {
  page.drawText("TMG INDUSTRIAL USA", { x: 60, y: 740 });
  page.drawText(`Order #${reference}`, { x: 350, y: 740 });
  page.drawText("August 18, 2026", { x: 350, y: 720 });
  page.drawText("SHIP TO", { x: 60, y: 700 });
  page.drawText("BILL TO", { x: 320, y: 700 });
  page.drawText("Synthetic Recipient", { x: 60, y: 680 });
  page.drawText("123 Example Way", { x: 60, y: 660 });
  page.drawText("Example City NY 12345", { x: 60, y: 640 });
  page.drawText("United States", { x: 60, y: 620 });
  page.drawText("+1 212-555-0100", { x: 60, y: 600 });
  page.drawText("ITEMS", { x: 60, y: 540 });
  page.drawText("TMG-EXAMPLE-1 1 of 1", { x: 60, y: 500 });
  page.drawText("NOTES Pickup from Charlotte NC", { x: 60, y: 460 });
  page.drawText("Thank you for shopping with us!", { x: 60, y: 440 });
}

async function picklistPdf({ reference, selfPickup }: { reference: string; selfPickup: boolean }) {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([612, 792]);
  page.drawText("Order Number", { x: 40, y: 720 });
  page.drawText("SKU", { x: 120, y: 720 });
  page.drawText("Unit Qty", { x: 230, y: 720 });
  page.drawText("Tracking number", { x: 380, y: 720 });
  page.drawText("Notes", { x: 520, y: 720 });
  if (selfPickup) page.drawText("Self-pickup:", { x: 40, y: 690 });
  page.drawText(reference, { x: 40, y: 650 });
  page.drawText("TMG-EXAMPLE-1", { x: 120, y: 650 });
  page.drawText("1", { x: 230, y: 650 });
  return new Uint8Array(await pdf.save());
}
