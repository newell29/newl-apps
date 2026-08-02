import { NextResponse } from "next/server";

import { prepareNextApolloExceptionResolution } from "@/modules/lead-gen/apollo-exception-autopilot";
import { authenticateIngestionRequest, IngestionAuthError } from "@/server/ingestion-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(request: Request) {
  try {
    const tenant = await authenticateIngestionRequest(request);
    const result = await prepareNextApolloExceptionResolution({
      tenantId: tenant.tenantId
    });
    return NextResponse.json({ data: result });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error
          ? error.message
          : "Apollo exception preparation failed."
      },
      { status: error instanceof IngestionAuthError ? error.status : 422 }
    );
  }
}
