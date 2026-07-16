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
  await ensurePdfJsNodeGeometryGlobals();
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

async function ensurePdfJsNodeGeometryGlobals() {
  if (typeof globalThis.DOMMatrix !== "undefined") {
    return;
  }

  const globals = globalThis as typeof globalThis & {
    DOMMatrix?: typeof globalThis.DOMMatrix;
    DOMPoint?: typeof globalThis.DOMPoint;
    DOMRect?: typeof globalThis.DOMRect;
  };

  globals.DOMMatrix = PdfJsDomMatrixShim as unknown as typeof globalThis.DOMMatrix;
  globals.DOMPoint = PdfJsDomPointShim as unknown as typeof globalThis.DOMPoint;
  globals.DOMRect = PdfJsDomRectShim as unknown as typeof globalThis.DOMRect;
}

class PdfJsDomMatrixShim {
  a = 1;
  b = 0;
  c = 0;
  d = 1;
  e = 0;
  f = 0;

  constructor(init?: number[] | { a?: number; b?: number; c?: number; d?: number; e?: number; f?: number }) {
    if (Array.isArray(init)) {
      [this.a, this.b, this.c, this.d, this.e, this.f] = [
        Number(init[0] ?? 1),
        Number(init[1] ?? 0),
        Number(init[2] ?? 0),
        Number(init[3] ?? 1),
        Number(init[4] ?? 0),
        Number(init[5] ?? 0)
      ];
      return;
    }

    if (init) {
      this.a = Number(init.a ?? this.a);
      this.b = Number(init.b ?? this.b);
      this.c = Number(init.c ?? this.c);
      this.d = Number(init.d ?? this.d);
      this.e = Number(init.e ?? this.e);
      this.f = Number(init.f ?? this.f);
    }
  }

  multiplySelf(other: PdfJsDomMatrixShim) {
    const next = new PdfJsDomMatrixShim([
      this.a * other.a + this.c * other.b,
      this.b * other.a + this.d * other.b,
      this.a * other.c + this.c * other.d,
      this.b * other.c + this.d * other.d,
      this.a * other.e + this.c * other.f + this.e,
      this.b * other.e + this.d * other.f + this.f
    ]);
    Object.assign(this, next);
    return this;
  }

  preMultiplySelf(other: PdfJsDomMatrixShim) {
    const next = new PdfJsDomMatrixShim(other);
    next.multiplySelf(this);
    Object.assign(this, next);
    return this;
  }

  translate(x = 0, y = 0) {
    return new PdfJsDomMatrixShim(this).multiplySelf(new PdfJsDomMatrixShim([1, 0, 0, 1, x, y]));
  }

  scale(scaleX = 1, scaleY = scaleX) {
    return new PdfJsDomMatrixShim(this).multiplySelf(new PdfJsDomMatrixShim([scaleX, 0, 0, scaleY, 0, 0]));
  }

  invertSelf() {
    const determinant = this.a * this.d - this.b * this.c || 1;
    const next = new PdfJsDomMatrixShim([
      this.d / determinant,
      -this.b / determinant,
      -this.c / determinant,
      this.a / determinant,
      (this.c * this.f - this.d * this.e) / determinant,
      (this.b * this.e - this.a * this.f) / determinant
    ]);
    Object.assign(this, next);
    return this;
  }
}

class PdfJsDomPointShim {
  constructor(
    public x = 0,
    public y = 0,
    public z = 0,
    public w = 1
  ) {}
}

class PdfJsDomRectShim {
  constructor(
    public x = 0,
    public y = 0,
    public width = 0,
    public height = 0
  ) {}
}
