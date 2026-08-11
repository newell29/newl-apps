import { NextResponse } from "next/server";

import { completeApolloExceptionResolution } from "@/modules/lead-gen/apollo-exception-autopilot";
import { authenticateIngestionRequest, IngestionAuthError } from "@/server/ingestion-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 180;

export async function POST(request: Request) {
  try {
    const tenant = await authenticateIngestionRequest(request);
    const body = await request.json() as {
      runId?: unknown;
      publicEvidence?: unknown;
    };
    if (typeof body.runId !== "string" || !body.runId.trim()) {
      return NextResponse.json(
        { error: "Apollo exception runId is required." },
        { status: 400 }
      );
    }
    const result = await completeApolloExceptionResolution({
      tenantId: tenant.tenantId,
      runId: body.runId.trim(),
      publicEvidence: body.publicEvidence
    });
    return NextResponse.json({ data: result });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error
          ? error.message
          : "Apollo exception completion failed."
      },
      {
        status: error instanceof IngestionAuthError
          ? error.status
          : error instanceof SyntaxError
            ? 400
            : 422
      }
    );
  }
}
