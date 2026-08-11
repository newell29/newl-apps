import { NextResponse } from "next/server";

import { requireSupplyChainDesignStudioAccess } from "@/modules/supply-chain-design/access";
import { exportSupplyChainDesignShipmentComparisonCsv } from "@/modules/supply-chain-design/ltl-rate-batches";
import { getAuthenticatedContext } from "@/server/tenant-context";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ projectId: string; batchId: string }> }
) {
  const context = await getAuthenticatedContext();
  await requireSupplyChainDesignStudioAccess(context);
  const { projectId, batchId } = await params;
  const csv = await exportSupplyChainDesignShipmentComparisonCsv(context, projectId, batchId);

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="network-design-shipment-comparison-${batchId}.csv"`
    }
  });
}
