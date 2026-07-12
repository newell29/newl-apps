import { readFile } from "node:fs/promises";
import path from "node:path";

import { buildTeamshipPhase2DryRunPlan } from "@/modules/shipment-documents/teamship-phase2-dry-run";
import { buildGarlandTeamshipReview, parseGarlandShippingOrderPages } from "@/modules/shipment-documents/teamship-review";
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
  json: boolean;
  allowBlocked: boolean;
};

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const pdfOrders = await extractOrdersFromPdf(options.pdfPath);
  const credentials = readTeamshipCredentials();
  const teamshipOrders = await fetchTeamshipShippingOrdersForReview({
    shipmentDate: options.shipmentDate,
    srNumbers: pdfOrders.map((order) => order.srNumber),
    credentials
  });
  const review = buildGarlandTeamshipReview(pdfOrders, teamshipOrders);
  const plan = buildTeamshipPhase2DryRunPlan(review);
  const result = {
    mode: "teamship-phase2-dry-run-validation",
    pdfPath: options.pdfPath,
    shipmentDate: options.shipmentDate,
    extractedPdfOrderCount: pdfOrders.length,
    fetchedTeamshipOrderCount: teamshipOrders.length,
    plan
  };

  writeResult(result, options.json);

  if (!options.allowBlocked && plan.summary.blockedCount > 0) {
    throw new Error(`Phase 2 dry-run validation blocked ${plan.summary.blockedCount} order(s).`);
  }
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

function readTeamshipCredentials() {
  const email = process.env.TEAMSHIP_EMAIL?.trim();
  const password = process.env.TEAMSHIP_PASSWORD?.trim();
  const apiBaseUrl = process.env.TEAMSHIP_API_BASE_URL?.trim() || null;

  if (!email || !password) {
    throw new Error(
      [
        "TEAMSHIP_EMAIL and TEAMSHIP_PASSWORD are required for the Phase 2 dry-run validation.",
        "This script only performs read-only Teamship API calls and writes no Teamship updates."
      ].join("\n")
    );
  }

  return { email, password, apiBaseUrl };
}

function parseArgs(args: string[]): CliOptions {
  let pdfPath = process.env.GARLAND_TEAMSHIP_PDF_PATH?.trim() ?? "";
  let shipmentDate = process.env.GARLAND_TEAMSHIP_SHIPMENT_DATE?.trim() || null;
  let json = false;
  let allowBlocked = false;

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

    if (arg === "--json") {
      json = true;
      continue;
    }

    if (arg === "--allow-blocked") {
      allowBlocked = true;
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
    json,
    allowBlocked
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
  console.log(`Run Garland Teamship Phase 2 dry-run validation.

This script reads Garland PDF orders, fetches matching Teamship order details read-only,
builds the structured Phase 2 update payload, and validates it without saving anything
to Teamship.

Usage:
  TEAMSHIP_EMAIL='name@example.com' TEAMSHIP_PASSWORD='...' npm run verify:garland-teamship-phase2 -- --pdf '/path/to/orders.pdf' --shipment-date 2026-07-11

Options:
  --pdf <path>             Garland daily shipping-order PDF.
  --shipment-date <date>   Optional YYYY-MM-DD date passed to the Teamship list filter.
  --json                   Print JSON output. Currently the default output is also JSON for auditability.
  --allow-blocked          Exit 0 even when some orders are blocked by missing dimensions or missing Teamship data.
`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Garland Teamship Phase 2 dry-run validation failed.");
  process.exit(1);
});
