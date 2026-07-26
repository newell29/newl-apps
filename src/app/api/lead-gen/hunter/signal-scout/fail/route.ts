import { NextResponse } from "next/server";

import { failHunterSignalScoutRun } from "@/modules/lead-gen/hunter-signal-scout";
import { authenticateIngestionRequest, IngestionAuthError } from "@/server/ingestion-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(request: Request) {
  try {
    const tenant = await authenticateIngestionRequest(request);
    const body = await request.json() as { runId?: unknown; errorMessage?: unknown };
    if (typeof body.runId !== "string" || !body.runId.trim()) {
      return NextResponse.json({ error: "Hunter signal scout runId is required." }, { status: 400 });
    }
    if (typeof body.errorMessage !== "string" || !body.errorMessage.trim()) {
      return NextResponse.json({ error: "Hunter signal scout errorMessage is required." }, { status: 400 });
    }
    const result = await failHunterSignalScoutRun({
      tenantId: tenant.tenantId,
      runId: body.runId.trim(),
      errorMessage: body.errorMessage
    });
    return NextResponse.json({ data: result });
  } catch (error) {
    const status = error instanceof IngestionAuthError
      ? error.status
      : error instanceof SyntaxError
        ? 400
        : 422;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Hunter signal scout failure report failed." },
      { status }
    );
  }
}
