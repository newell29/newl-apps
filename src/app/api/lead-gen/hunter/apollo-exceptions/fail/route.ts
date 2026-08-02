import { NextResponse } from "next/server";

import { failApolloExceptionResolution } from "@/modules/lead-gen/apollo-exception-autopilot";
import { authenticateIngestionRequest, IngestionAuthError } from "@/server/ingestion-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(request: Request) {
  try {
    const tenant = await authenticateIngestionRequest(request);
    const body = await request.json() as {
      runId?: unknown;
      errorMessage?: unknown;
    };
    if (typeof body.runId !== "string" || !body.runId.trim()) {
      return NextResponse.json(
        { error: "Apollo exception runId is required." },
        { status: 400 }
      );
    }
    const result = await failApolloExceptionResolution({
      tenantId: tenant.tenantId,
      runId: body.runId.trim(),
      errorMessage:
        typeof body.errorMessage === "string" && body.errorMessage.trim()
          ? body.errorMessage.trim()
          : "Apollo exception worker failed without a message."
    });
    return NextResponse.json({ data: result });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error
          ? error.message
          : "Apollo exception failure callback failed."
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
