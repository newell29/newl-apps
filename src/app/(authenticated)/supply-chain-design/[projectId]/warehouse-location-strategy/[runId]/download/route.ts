import { NextResponse } from "next/server";

import { requireSupplyChainDesignStudioAccess } from "@/modules/supply-chain-design/access";
import {
  exportWarehouseLocationStrategyCsv,
  WAREHOUSE_LOCATION_STRATEGY_RESULT_VERSION,
  type WarehouseLocationStrategyResultSummary
} from "@/modules/supply-chain-design/warehouse-location-strategy";
import { prisma } from "@/server/db";
import { getAuthenticatedContext } from "@/server/tenant-context";

type RouteContext = {
  params: Promise<{
    projectId: string;
    runId: string;
  }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const auth = await getAuthenticatedContext();
  await requireSupplyChainDesignStudioAccess(auth);
  const { projectId, runId } = await context.params;
  const run = await prisma.supplyChainDesignModelRun.findUnique({
    where: {
      tenantId_id: {
        tenantId: auth.tenantId,
        id: runId
      }
    },
    select: {
      projectId: true,
      resultSummary: true
    }
  });
  const result = run?.resultSummary as Partial<WarehouseLocationStrategyResultSummary> | null | undefined;
  if (!run || run.projectId !== projectId || result?.resultVersion !== WAREHOUSE_LOCATION_STRATEGY_RESULT_VERSION) {
    return new NextResponse("Warehouse Location Strategy run was not found.", { status: 404 });
  }
  const csv = exportWarehouseLocationStrategyCsv(result as WarehouseLocationStrategyResultSummary);
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="warehouse-location-strategy-${runId}.csv"`
    }
  });
}
