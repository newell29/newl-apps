import { NextResponse } from "next/server";

import { completeTmgExecutionJob, TmgExecutionError } from "@/modules/shipment-documents/tmg-execution-jobs";
import { authenticateIngestionRequest, IngestionAuthError } from "@/server/ingestion-auth";

export async function POST(request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  try {
    const context = await authenticateIngestionRequest(request);
    const workerId = request.headers.get("x-newl-agent-id")?.trim() || "tmg-teamship-worker";
    const { jobId } = await params;
    return NextResponse.json({ result: await completeTmgExecutionJob(context, { jobId, workerId }) });
  } catch (error) {
    const status = error instanceof IngestionAuthError || error instanceof TmgExecutionError ? error.status : 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to complete a TMG worker job." }, { status });
  }
}
