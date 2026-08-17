import { readFile } from "node:fs/promises";
import path from "node:path";

import { NextResponse } from "next/server";

import { requireSupplyChainDesignStudioAccess } from "@/modules/supply-chain-design/access";
import { getAuthenticatedContext } from "@/server/tenant-context";

const CUSTOMER_TEMPLATE_FILES = new Set([
  "current-facilities-and-costs-template.csv",
  "historical-shipments-template.csv",
  "candidate-warehouses-and-costs-template.csv"
]);

const CUSTOMER_SAMPLE_FILES = new Set([
  "current-facilities-and-costs-sample.csv",
  "historical-shipments-sample.csv",
  "candidate-warehouses-and-costs-sample.csv"
]);

export async function GET(_request: Request, { params }: { params: Promise<{ template: string }> }) {
  const context = await getAuthenticatedContext();
  await requireSupplyChainDesignStudioAccess(context);

  const { template } = await params;
  if (!CUSTOMER_TEMPLATE_FILES.has(template) && !CUSTOMER_SAMPLE_FILES.has(template)) {
    return new NextResponse("Template not found.", { status: 404 });
  }

  const folder = CUSTOMER_SAMPLE_FILES.has(template) ? "sample-data" : "templates";
  const templatePath = path.join(process.cwd(), "docs", "modules", "supply-chain-design", folder, template);
  const isZip = template.endsWith(".zip");
  const body = await readFile(templatePath, isZip ? undefined : "utf8");

  return new NextResponse(body, {
    headers: {
      "Content-Type": isZip
        ? "application/zip"
        : template.endsWith(".md")
          ? "text/markdown; charset=utf-8"
          : "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${template}"`
    }
  });
}
