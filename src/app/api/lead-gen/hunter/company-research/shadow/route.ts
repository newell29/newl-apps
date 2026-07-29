import { NextResponse } from "next/server";

import { runHunterResearchLunaShadowBatch } from "@/modules/lead-gen/hunter-company-research-shadow";
import { authenticateIngestionRequest, IngestionAuthError } from "@/server/ingestion-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(request: Request) {
  try {
    const tenant = await authenticateIngestionRequest(request);
    const body = await request.json() as {
      runId?: unknown;
      packets?: unknown;
      finalBatch?: unknown;
    };
    if (typeof body.runId !== "string" || !body.runId.trim()) {
      return NextResponse.json(
        { error: "Hunter Luna shadow runId is required." },
        { status: 400 }
      );
    }
    if (!Array.isArray(body.packets)) {
      return NextResponse.json(
        { error: "Hunter Luna shadow packets must be an array." },
        { status: 400 }
      );
    }
    const result = await runHunterResearchLunaShadowBatch({
      tenantId: tenant.tenantId,
      runId: body.runId.trim(),
      packets: body.packets,
      finalBatch: body.finalBatch === true
    });
    return NextResponse.json({ data: result });
  } catch (error) {
    const status = error instanceof IngestionAuthError
      ? error.status
      : error instanceof SyntaxError
        ? 400
        : 422;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Hunter Luna shadow evaluation failed." },
      { status }
    );
  }
}
