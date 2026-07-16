import { createHash } from "node:crypto";

import { parseGarlandShippingOrderPages } from "@/modules/shipment-documents/teamship-review";

type TextItemLike = {
  str?: string;
  transform?: unknown[];
};

type PdfPageLike = {
  getTextContent: () => Promise<{ items: TextItemLike[] }>;
};

type PdfDocumentLike = {
  numPages: number;
  getPage: (pageNumber: number) => Promise<PdfPageLike>;
};

type PdfJsLegacyModule = {
  getDocument: (options: { data: Uint8Array; disableWorker: boolean }) => { promise: Promise<PdfDocumentLike> };
};

export async function extractGarlandShippingOrdersFromPdfBytes(fileBytes: Uint8Array) {
  const pdfjs = (await import("pdfjs-dist/legacy/build/pdf.mjs")) as PdfJsLegacyModule;
  const pdf = await pdfjs.getDocument({ data: cloneBytes(fileBytes), disableWorker: true }).promise;
  const pages: Array<{ pageNumber: number; text: string }> = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    pages.push({ pageNumber, text: await extractPageText(page) });
  }

  const orders = parseGarlandShippingOrderPages(pages);

  return {
    contentHash: createHash("sha256").update(fileBytes).digest("hex"),
    pageCount: pdf.numPages,
    pages,
    orders,
    psNumbers: [...new Set(orders.map((order) => order.psNumber).filter(Boolean))],
    srNumbers: [...new Set(orders.map((order) => order.srNumber).filter(Boolean))]
  };
}

async function extractPageText(page: PdfPageLike) {
  const textContent = await page.getTextContent();
  const items = textContent.items
    .map((item) => {
      if (!item.str?.trim()) {
        return null;
      }

      const transform = Array.isArray(item.transform) ? item.transform : [];
      return {
        text: item.str,
        x: Number(transform[4] ?? 0),
        y: Number(transform[5] ?? 0)
      };
    })
    .filter((item): item is { text: string; x: number; y: number } => Boolean(item))
    .sort((left, right) => {
      const yDiff = right.y - left.y;
      return Math.abs(yDiff) > 3 ? yDiff : left.x - right.x;
    });
  const lines: Array<{ y: number; parts: string[] }> = [];

  for (const item of items) {
    const line = lines.find((candidate) => Math.abs(candidate.y - item.y) <= 3);

    if (line) {
      line.parts.push(item.text);
      continue;
    }

    lines.push({ y: item.y, parts: [item.text] });
  }

  return lines.map((line) => line.parts.join(" ").replace(/\s+/g, " ").trim()).join("\n");
}

function cloneBytes(bytes: Uint8Array) {
  return new Uint8Array(bytes);
}
