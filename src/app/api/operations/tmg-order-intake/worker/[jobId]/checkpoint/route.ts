import { NextResponse } from "next/server";

import { checkpointTmgExecutionJob, TmgExecutionError, type TmgWorkerCheckpoint } from "@/modules/shipment-documents/tmg-execution-jobs";
import { authenticateIngestionRequest, IngestionAuthError } from "@/server/ingestion-auth";

export async function POST(request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  try {
    const context = await authenticateIngestionRequest(request);
    const workerId = request.headers.get("x-newl-agent-id")?.trim() || "tmg-teamship-worker";
    const checkpoint = await request.json() as TmgWorkerCheckpoint;
    const { jobId } = await params;
    const order = await checkpointTmgExecutionJob(context, { jobId, workerId, checkpoint });
    return NextResponse.json({ order: JSON.parse(JSON.stringify(order)) });
  } catch (error) {
    const status = error instanceof IngestionAuthError || error instanceof TmgExecutionError ? error.status : 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to checkpoint a TMG worker job." }, { status });
  }
}
