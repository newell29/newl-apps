import { NextResponse } from "next/server";

import { completeTeamshipUpdateJobFromAgent } from "@/modules/shipment-documents/teamship-update-jobs";
import { authenticateIngestionRequest, IngestionAuthError } from "@/server/ingestion-auth";

export const dynamic = "force-dynamic";

type CompleteJobPayload = {
  status?: unknown;
  result?: unknown;
};

export async function PATCH(request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  try {
    const context = await authenticateIngestionRequest(request);
    const { jobId } = await params;
    const body = (await request.json().catch(() => null)) as CompleteJobPayload | null;
    const status = readAgentStatus(body?.status);
    const job = await completeTeamshipUpdateJobFromAgent({
      context,
      jobId,
      status,
      agentResult: body?.result ?? null
    });

    return NextResponse.json({ job });
  } catch (error) {
    console.error(error);
    const status = error instanceof IngestionAuthError ? error.status : 500;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to complete Teamship update job." },
      { status }
    );
  }
}

function readAgentStatus(value: unknown) {
  if (value === "SUCCESS" || value === "FAILED" || value === "NEEDS_REVIEW") {
    return value;
  }

  throw new Error("Agent completion status must be SUCCESS, FAILED, or NEEDS_REVIEW.");
}
