import { NextResponse } from "next/server";

import { claimNextTeamshipUpdateJobForAgent } from "@/modules/shipment-documents/teamship-update-jobs";
import { authenticateIngestionRequest, IngestionAuthError } from "@/server/ingestion-auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const context = await authenticateIngestionRequest(request);
    const agentId = request.headers.get("x-newl-agent-id")?.trim() || "teamship-vm-agent";
    const claimed = await claimNextTeamshipUpdateJobForAgent(context, agentId);

    if (!claimed) {
      return NextResponse.json({ job: null, executionPayload: null });
    }

    return NextResponse.json(claimed);
  } catch (error) {
    console.error(error);
    const status = error instanceof IngestionAuthError ? error.status : 500;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to claim a Teamship update job." },
      { status }
    );
  }
}
