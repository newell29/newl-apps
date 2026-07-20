import { readFile } from "node:fs/promises";
import path from "node:path";

import { buildGarlandTeamshipReview, parseGarlandShippingOrderPages } from "@/modules/shipment-documents/teamship-review";
import type { GarlandPdfShippingOrder } from "@/modules/shipment-documents/teamship-review-types";
import { fetchTeamshipShippingOrdersForReview } from "@/server/integrations/teamship";

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

type CliOptions = {
  pdfPath: string;
  shipmentDate: string | null;
  pdfOnly: boolean;
  json: boolean;
};

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const pdfOrders = await extractOrdersFromPdf(options.pdfPath);

  if (options.pdfOnly) {
    writeResult(
      {
        mode: "pdf-only",
        pdfPath: options.pdfPath,
        orderCount: pdfOrders.length,
        orders: summarizePdfOrders(pdfOrders)
      },
      options.json
    );
    return;
  }

  const email = process.env.TEAMSHIP_EMAIL?.trim();
  const password = process.env.TEAMSHIP_PASSWORD?.trim();

  if (!email || !password) {
    throw new Error(
      [
        "TEAMSHIP_EMAIL and TEAMSHIP_PASSWORD are required for live Teamship verification.",
        "Run with env vars in your shell, for example:",
        "TEAMSHIP_EMAIL='name@example.com' TEAMSHIP_PASSWORD='...' npm run verify:garland-teamship -- --pdf '/path/to/orders.pdf'"
      ].join("\n")
    );
  }

  const teamshipOrders = await fetchTeamshipShippingOrdersForReview({
    shipmentDate: options.shipmentDate,
    srNumbers: pdfOrders.map((order) => order.srNumber),
    credentials: { email, password }
  });
  const review = buildGarlandTeamshipReview(pdfOrders, teamshipOrders);

  writeResult(
    {
      mode: "live-teamship-read-only",
      pdfPath: options.pdfPath,
      shipmentDate: options.shipmentDate,
      summary: {
        ...review.summary,
        fetchedTeamshipCount: teamshipOrders.length
      },
      orders: review.reviews.map((order) => ({
        psNumber: order.psNumber,
        srNumber: order.srNumber,
        pageNumbers: order.pageNumbers,
        status: order.status,
        issueCount: order.issueCount,
        issues: order.fields
          .filter((field) => field.status === "DISCREPANCY" || field.status === "MISSING")
          .map((field) => ({
            key: field.key,
            label: field.label,
            status: field.status,
            message: field.message,
            pdfValue: field.pdfValue,
            teamshipValue: field.teamshipValue
          }))
      }))
    },
    options.json
  );
}

async function extractOrdersFromPdf(pdfPath: string) {
  const pdfjs = (await import("pdfjs-dist/legacy/build/pdf.mjs")) as PdfJsLegacyModule;
  const data = new Uint8Array(await readFile(pdfPath));
  const pdf = await pdfjs.getDocument({ data, disableWorker: true }).promise;
  const pages: Array<{ pageNumber: number; text: string }> = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    pages.push({ pageNumber, text: await extractPageText(page) });
  }

  return parseGarlandShippingOrderPages(pages);
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

function summarizePdfOrders(orders: GarlandPdfShippingOrder[]) {
  return orders.map((order) => ({
    psNumber: order.psNumber,
    srNumber: order.srNumber,
    pageNumbers: order.pageNumbers,
    shipVia: order.shipVia,
    shipToName: order.shipToName,
    city: order.shipToCity,
    state: order.shipToState,
    shipToPo: order.shipToPo,
    items: order.items.map((item) => ({
      sku: item.sku,
      serialNumbers: item.serialNumbers
    }))
  }));
}

function parseArgs(args: string[]): CliOptions {
  let pdfPath = process.env.GARLAND_TEAMSHIP_PDF_PATH?.trim() ?? "";
  let shipmentDate = process.env.GARLAND_TEAMSHIP_SHIPMENT_DATE?.trim() || null;
  let pdfOnly = false;
  let json = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--pdf") {
      pdfPath = args[index + 1] ?? "";
      index += 1;
      continue;
    }

    if (arg === "--shipment-date") {
      shipmentDate = args[index + 1] ?? null;
      index += 1;
      continue;
    }

    if (arg === "--pdf-only") {
      pdfOnly = true;
      continue;
    }

    if (arg === "--json") {
      json = true;
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!pdfPath) {
    throw new Error("Provide a Garland PDF with --pdf '/path/to/orders.pdf' or GARLAND_TEAMSHIP_PDF_PATH.");
  }

  return {
    pdfPath: path.resolve(pdfPath),
    shipmentDate,
    pdfOnly,
    json
  };
}

function writeResult(value: unknown, json: boolean) {
  if (json) {
    console.log(JSON.stringify(value, null, 2));
    return;
  }

  console.log(JSON.stringify(value, null, 2));
}

function printHelp() {
  console.log(`Verify Garland PDF extraction and optional live Teamship read-only comparison.

Usage:
  npm run verify:garland-teamship -- --pdf '/path/to/orders.pdf' --pdf-only
  TEAMSHIP_EMAIL='name@example.com' TEAMSHIP_PASSWORD='...' npm run verify:garland-teamship -- --pdf '/path/to/orders.pdf'

Options:
  --pdf <path>             Garland daily shipping-order PDF.
  --shipment-date <date>   Optional YYYY-MM-DD date passed to the Teamship list filter.
  --pdf-only               Parse the PDF only; do not call Teamship.
  --json                   Print JSON output. Currently the default output is also JSON for auditability.
`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Garland Teamship verification failed.");
  process.exit(1);
});
