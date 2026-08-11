import { NextResponse } from "next/server";

import { processNextHunterOutreachHandoff } from "@/modules/lead-gen/hunter-outreach-handoff";
import { authenticateIngestionRequest, IngestionAuthError } from "@/server/ingestion-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    const tenant = await authenticateIngestionRequest(request);
    const body = await request.json().catch(() => ({})) as { runId?: unknown };
    const runId = typeof body.runId === "string" && body.runId.trim()
      ? body.runId.trim()
      : undefined;
    const result = await processNextHunterOutreachHandoff({
      tenantId: tenant.tenantId,
      runId
    });
    return NextResponse.json({ data: result });
  } catch (error) {
    const status = error instanceof IngestionAuthError
      ? error.status
      : error instanceof SyntaxError
        ? 400
        : 422;
    return NextResponse.json(
      {
        error: error instanceof Error
          ? error.message
          : "Hunter outreach handoff processing failed."
      },
      { status }
    );
  }
}
