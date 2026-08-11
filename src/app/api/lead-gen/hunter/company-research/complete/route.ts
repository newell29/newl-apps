import { NextResponse } from "next/server";

import { completeHunterCompanyResearchRun } from "@/modules/lead-gen/hunter-company-research";
import { authenticateIngestionRequest, IngestionAuthError } from "@/server/ingestion-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const tenant = await authenticateIngestionRequest(request);
    const body = await request.json() as { runId?: unknown; completion?: unknown };
    if (typeof body.runId !== "string" || !body.runId.trim()) {
      return NextResponse.json({ error: "Hunter company-research runId is required." }, { status: 400 });
    }
    const result = await completeHunterCompanyResearchRun({
      tenantId: tenant.tenantId,
      runId: body.runId.trim(),
      completion: body.completion
    });
    return NextResponse.json({ data: result });
  } catch (error) {
    const status = error instanceof IngestionAuthError
      ? error.status
      : error instanceof SyntaxError
        ? 400
        : 422;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Hunter company-research completion failed." },
      { status }
    );
  }
}
