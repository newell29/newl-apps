import { NextResponse } from "next/server";

import {
  getWebsiteGrowthScoutReport,
  type WebsiteGrowthReportName,
  verifyWebsiteGrowthReportDownload,
  WebsiteGrowthReportDownloadError
} from "@/modules/website-growth/report-download";
import { buildSpreadsheetWorkbook } from "@/server/spreadsheet";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ runId: string; reportName: string }> }
) {
  try {
    const { runId, reportName: rawReportName } = await params;
    const reportName = parseReportName(rawReportName);
    const url = new URL(request.url);
    const tenantId = requireQueryValue(url, "tenant");
    const signature = requireQueryValue(url, "signature");
    const expires = Number(requireQueryValue(url, "expires"));

    verifyWebsiteGrowthReportDownload({
      tenantId,
      runId,
      reportName,
      expires,
      signature
    });
    const report = await getWebsiteGrowthScoutReport({ tenantId, runId, reportName });
    const workbook = buildSpreadsheetWorkbook(report);

    return new NextResponse(new Uint8Array(workbook), {
      status: 200,
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Disposition": `attachment; filename="${report.filename}"`,
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "X-Content-Type-Options": "nosniff"
      }
    });
  } catch (error) {
    const status = error instanceof WebsiteGrowthReportDownloadError ? error.status : 500;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to download the Website Growth report." },
      { status, headers: { "Cache-Control": "no-store" } }
    );
  }
}

function parseReportName(value: string): WebsiteGrowthReportName {
  if (value === "seo-performance.xlsx" || value === "semrush-keywords.xlsx") {
    return value;
  }
  throw new WebsiteGrowthReportDownloadError("The requested Website Growth report is invalid.", 404);
}

function requireQueryValue(url: URL, key: string) {
  const value = url.searchParams.get(key)?.trim();
  if (!value) {
    throw new WebsiteGrowthReportDownloadError("The report download link is incomplete.", 403);
  }
  return value;
}
