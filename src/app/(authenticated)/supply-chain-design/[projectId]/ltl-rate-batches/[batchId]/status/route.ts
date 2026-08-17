import { NextResponse } from "next/server";

import { requireSupplyChainDesignStudioAccess } from "@/modules/supply-chain-design/access";
import { getSupplyChainDesignLtlRateBatchById } from "@/modules/supply-chain-design/ltl-rate-batches";
import { getAuthenticatedContext } from "@/server/tenant-context";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ projectId: string; batchId: string }> }
) {
  const context = await getAuthenticatedContext();
  await requireSupplyChainDesignStudioAccess(context);
  const { projectId, batchId } = await params;
  const batch = await getSupplyChainDesignLtlRateBatchById(context, projectId, batchId);

  if (!batch) {
    return NextResponse.json({ error: "Network Design run was not found." }, { status: 404 });
  }

  return NextResponse.json({
    batchId: batch.id,
    status: batch.status,
    total: batch.requestsSubmitted,
    processed: batch.processedRequests,
    rated: batch.ratedSuccessfully + batch.manuallyRated,
    issues: batch.issueRequests,
    remaining: Math.max(0, batch.requestsSubmitted - batch.processedRequests),
    stage:
      batch.status === "QUEUED"
        ? "Preparing LTL requests"
        : batch.status === "RUNNING"
          ? batch.processedRequests >= batch.requestsSubmitted
            ? "Completing comparison"
            : "Requesting 7L rates"
          : batch.status === "SUCCESS"
            ? "Completing comparison"
            : "Rate run failed"
  });
}
