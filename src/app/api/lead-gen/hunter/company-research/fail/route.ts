import { NextResponse } from "next/server";

import { failHunterCompanyResearchRun } from "@/modules/lead-gen/hunter-company-research";
import { authenticateIngestionRequest, IngestionAuthError } from "@/server/ingestion-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(request: Request) {
  try {
    const tenant = await authenticateIngestionRequest(request);
    const body = await request.json() as {
      runId?: unknown;
      errorMessage?: unknown;
      retryable?: unknown;
      retryScheduled?: unknown;
      checkpointStage?: unknown;
    };
    if (typeof body.runId !== "string" || !body.runId.trim()) {
      return NextResponse.json({ error: "Hunter company-research runId is required." }, { status: 400 });
    }
    if (typeof body.errorMessage !== "string" || !body.errorMessage.trim()) {
      return NextResponse.json({ error: "Hunter company-research errorMessage is required." }, { status: 400 });
    }
    const result = await failHunterCompanyResearchRun({
      tenantId: tenant.tenantId,
      runId: body.runId.trim(),
      errorMessage: body.errorMessage,
      retryable: body.retryable === true,
      retryScheduled: body.retryScheduled === true,
      checkpointStage:
        body.checkpointStage === "RETRIEVAL_COMPLETE" || body.checkpointStage === "SYNTHESIS_COMPLETE"
          ? body.checkpointStage
          : null
    });
    return NextResponse.json({ data: result });
  } catch (error) {
    const status = error instanceof IngestionAuthError
      ? error.status
      : error instanceof SyntaxError
        ? 400
        : 422;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Hunter company-research failure report failed." },
      { status }
    );
  }
}
