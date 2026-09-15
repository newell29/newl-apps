import { NextResponse } from "next/server";

import { requireSupplyChainDesignStudioAccess } from "@/modules/supply-chain-design/access";
import { getNetworkScenarioComparisonRun } from "@/modules/supply-chain-design/network-scenario-comparison-persistence";
import {
  exportNetworkScenarioComparisonCsv,
  networkScenarioComparisonExportFilename,
  type NetworkScenarioComparisonExportType
} from "@/modules/supply-chain-design/network-scenario-comparison-reporting";
import { getAuthenticatedContext } from "@/server/tenant-context";

type RouteContext = {
  params: Promise<{
    projectId: string;
    runId: string;
    exportType: string;
  }>;
};

const EXPORT_TYPES = new Set(["results", "summary", "facility-summary", "delivery-assignments", "alternative-audit"]);

export async function GET(_request: Request, context: RouteContext) {
  const auth = await getAuthenticatedContext();
  await requireSupplyChainDesignStudioAccess(auth);
  const { projectId, runId, exportType } = await context.params;
  if (!EXPORT_TYPES.has(exportType)) {
    return new NextResponse("Network Scenario Comparison export type was not found.", { status: 404 });
  }
  const run = await getNetworkScenarioComparisonRun(auth, projectId, runId);
  if (!run) {
    return new NextResponse("Network Scenario Comparison run was not found.", { status: 404 });
  }
  if (!run.resultSummary) {
    return new NextResponse("Network Scenario Comparison result is not available.", { status: 409 });
  }
  const typedExportType = exportType as NetworkScenarioComparisonExportType;
  return new NextResponse(exportNetworkScenarioComparisonCsv(run, typedExportType), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${networkScenarioComparisonExportFilename(run, typedExportType)}"`
    }
  });
}
