import { NextResponse } from "next/server";

import { claimNextTmgExecutionJob, TmgExecutionError } from "@/modules/shipment-documents/tmg-execution-jobs";
import { authenticateIngestionRequest, IngestionAuthError } from "@/server/ingestion-auth";
import { resolveTenantTeamshipCredentials } from "@/server/integrations/teamship-settings";

export async function POST(request: Request) {
  try {
    const context = await authenticateIngestionRequest(request);
    const workerId = request.headers.get("x-newl-agent-id")?.trim() || "tmg-teamship-worker";
    const credentials = await resolveTenantTeamshipCredentials(context);
    if (!credentials) return NextResponse.json({ error: "Teamship credentials are not configured for this tenant." }, { status: 503 });
    const job = await claimNextTmgExecutionJob(context, workerId);
    return NextResponse.json({ job, teamshipCredentials: job ? credentials : null });
  } catch (error) {
    const status = error instanceof IngestionAuthError || error instanceof TmgExecutionError ? error.status : 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to claim a TMG worker job." }, { status });
  }
}
