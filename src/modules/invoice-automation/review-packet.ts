import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { InvoiceAutomationStatus, InvoiceAutomationType } from "@prisma/client";

export type InvoiceReviewPacketItem = {
  id: string;
  batchNumber: string;
  invoiceType: InvoiceAutomationType;
  status: InvoiceAutomationStatus;
  fileName: string;
  shipmentFileNumber: string | null;
  entityNameRaw: string | null;
  quickBooksEntityDisplayName: string | null;
  invoiceNumber: string | null;
  invoiceDate: Date | string | null;
  dueDate: Date | string | null;
  currency: string | null;
  subtotalAmount: number | string | { toString(): string } | null;
  taxAmount: number | string | { toString(): string } | null;
  totalAmount: number | string | { toString(): string } | null;
  pdfBytes: Uint8Array;
};

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN = 44;

export async function buildInvoiceReviewPacketPdf(items: InvoiceReviewPacketItem[]) {
  const packet = await PDFDocument.create();
  const regularFont = await packet.embedFont(StandardFonts.Helvetica);
  const boldFont = await packet.embedFont(StandardFonts.HelveticaBold);

  addCoverPage(packet, items, regularFont, boldFont);

  for (const [index, item] of items.entries()) {
    addSeparatorPage(packet, item, index + 1, regularFont, boldFont);
    const source = await PDFDocument.load(item.pdfBytes);
    const sourcePages = await packet.copyPages(source, source.getPageIndices());
    for (const page of sourcePages) {
      packet.addPage(page);
    }
  }

  return new Uint8Array(await packet.save());
}

function addCoverPage(
  packet: PDFDocument,
  items: InvoiceReviewPacketItem[],
  regularFont: Awaited<ReturnType<PDFDocument["embedFont"]>>,
  boldFont: Awaited<ReturnType<PDFDocument["embedFont"]>>
) {
  const page = packet.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let y = PAGE_HEIGHT - MARGIN;
  page.drawText("Invoice Review Packet", {
    x: MARGIN,
    y,
    size: 20,
    font: boldFont,
    color: rgb(0.1, 0.13, 0.18)
  });
  y -= 24;
  page.drawText(`${items.length} invoice${items.length === 1 ? "" : "s"} selected for accounting review`, {
    x: MARGIN,
    y,
    size: 11,
    font: regularFont,
    color: rgb(0.31, 0.36, 0.45)
  });
  y -= 28;

  const headers = ["#", "File", "Entity", "Invoice", "Date", "Total"];
  const xPositions = [MARGIN, 72, 202, 342, 430, 500];
  headers.forEach((header, index) => {
    page.drawText(header, {
      x: xPositions[index],
      y,
      size: 8,
      font: boldFont,
      color: rgb(0.31, 0.36, 0.45)
    });
  });
  y -= 14;

  for (const [index, item] of items.entries()) {
    if (y < 70) {
      drawFooter(page, regularFont);
      y = PAGE_HEIGHT - MARGIN;
    }

    const fields = [
      String(index + 1),
      item.shipmentFileNumber ?? "Missing",
      item.quickBooksEntityDisplayName ?? item.entityNameRaw ?? "Missing",
      item.invoiceNumber ?? "Missing",
      formatDate(item.invoiceDate),
      formatMoney(item.totalAmount, item.currency)
    ];

    fields.forEach((field, fieldIndex) => {
      page.drawText(truncate(field, fieldIndex === 2 ? 24 : 18), {
        x: xPositions[fieldIndex],
        y,
        size: 8,
        font: regularFont,
        color: rgb(0.1, 0.13, 0.18)
      });
    });
    y -= 13;
  }

  drawFooter(page, regularFont);
}

function addSeparatorPage(
  packet: PDFDocument,
  item: InvoiceReviewPacketItem,
  itemNumber: number,
  regularFont: Awaited<ReturnType<PDFDocument["embedFont"]>>,
  boldFont: Awaited<ReturnType<PDFDocument["embedFont"]>>
) {
  const page = packet.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let y = PAGE_HEIGHT - MARGIN;
  page.drawText(`Invoice ${itemNumber}`, {
    x: MARGIN,
    y,
    size: 18,
    font: boldFont,
    color: rgb(0.1, 0.13, 0.18)
  });
  y -= 30;

  const rows = [
    ["Batch", item.batchNumber],
    ["Status", formatEnum(item.status)],
    ["Type", formatEnum(item.invoiceType)],
    ["File #", item.shipmentFileNumber ?? "Missing"],
    ["Customer/Vendor", item.quickBooksEntityDisplayName ?? item.entityNameRaw ?? "Missing"],
    ["Invoice #", item.invoiceNumber ?? "Missing"],
    ["Invoice date", formatDate(item.invoiceDate)],
    ["Due date", formatDate(item.dueDate)],
    ["Currency", item.currency ?? "Missing"],
    ["Subtotal", formatMoney(item.subtotalAmount, item.currency)],
    ["Tax", formatMoney(item.taxAmount, item.currency)],
    ["Total", formatMoney(item.totalAmount, item.currency)]
  ];

  for (const [label, value] of rows) {
    page.drawText(label, {
      x: MARGIN,
      y,
      size: 9,
      font: boldFont,
      color: rgb(0.31, 0.36, 0.45)
    });
    page.drawText(truncate(value, 68), {
      x: 160,
      y,
      size: 10,
      font: regularFont,
      color: rgb(0.1, 0.13, 0.18)
    });
    y -= 18;
  }

  y -= 18;
  page.drawText("Original invoice PDF follows this separator page.", {
    x: MARGIN,
    y,
    size: 10,
    font: regularFont,
    color: rgb(0.31, 0.36, 0.45)
  });

  drawFooter(page, regularFont);
}

function drawFooter(page: ReturnType<PDFDocument["addPage"]>, font: Awaited<ReturnType<PDFDocument["embedFont"]>>) {
  page.drawText("Generated by Newl Apps Invoice Automation", {
    x: MARGIN,
    y: 28,
    size: 8,
    font,
    color: rgb(0.46, 0.51, 0.6)
  });
}

function formatEnum(value: string) {
  return value
    .toLowerCase()
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function formatDate(value: Date | string | null) {
  if (!value) return "Missing";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return value.slice(0, 10);
}

function formatMoney(value: InvoiceReviewPacketItem["totalAmount"], currency: string | null) {
  const amount = readNumber(value);
  if (amount === null) return "Missing";

  return amount.toLocaleString("en-US", {
    style: "currency",
    currency: currency || "CAD",
    maximumFractionDigits: 2
  });
}

function readNumber(value: InvoiceReviewPacketItem["totalAmount"]) {
  if (value === null) return null;
  const numberValue = typeof value === "number" ? value : Number(value.toString());
  return Number.isFinite(numberValue) ? numberValue : null;
}

function truncate(value: string, maxLength: number) {
  return value.length > maxLength ? `${value.slice(0, maxLength - 3)}...` : value;
}
