import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

export type VendorInvoiceApprovalStamp = {
  tmsFileNumber: string;
  approvedByName: string;
  approvedAt: Date;
};

export async function stampVendorInvoicePdf(pdfBytes: Uint8Array, stamp: VendorInvoiceApprovalStamp) {
  const pdf = await PDFDocument.load(pdfBytes);
  const pages = pdf.getPages();
  const firstPage = pages[0];
  if (!firstPage) {
    throw new Error("The uploaded PDF package had no pages to stamp.");
  }

  const regularFont = await pdf.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdf.embedFont(StandardFonts.HelveticaBold);
  const { width, height } = firstPage.getSize();
  const layout = getApprovalStampLayout(width, height);

  firstPage.drawRectangle({
    x: layout.x,
    y: layout.y,
    width: layout.width,
    height: layout.height,
    borderColor: rgb(0.8, 0.08, 0.18),
    borderWidth: layout.borderWidth,
    color: rgb(1, 0.94, 0.95),
    opacity: layout.backgroundOpacity
  });
  firstPage.drawText("APPROVED", {
    x: layout.x + 12,
    y: layout.y + layout.height - 22,
    size: 13,
    font: boldFont,
    color: rgb(0.8, 0.08, 0.18)
  });

  const lines = [
    `TMS file: ${stamp.tmsFileNumber}`,
    `Approved by: ${stamp.approvedByName}`,
    `Approved at: ${formatApprovalTimestamp(stamp.approvedAt)}`
  ];

  lines.forEach((line, index) => {
    firstPage.drawText(truncate(line, 46), {
      x: layout.x + 12,
      y: layout.y + layout.height - 42 - index * 15,
      size: 9,
      font: regularFont,
      color: rgb(0.1, 0.12, 0.18)
    });
  });

  return pdf.save();
}

export function getApprovalStampLayout(pageWidth: number, pageHeight: number) {
  const margin = 24;
  const width = Math.max(120, Math.min(260, pageWidth - margin * 2));
  const height = Math.min(86, Math.max(60, pageHeight - margin * 2));
  return {
    x: margin,
    y: margin,
    width,
    height,
    borderWidth: 0.75,
    backgroundOpacity: 0.24
  };
}

export function formatApprovalTimestamp(value: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Toronto",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit",
    hour12: true
  }).formatToParts(value);
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
  const dayPeriod = part("dayPeriod").toUpperCase().replace(/\./g, "");
  return `${part("year")}-${part("month")}-${part("day")} ${part("hour")}:${part("minute")} ${dayPeriod} EST`;
}

function truncate(value: string, maxLength: number) {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}...`;
}
