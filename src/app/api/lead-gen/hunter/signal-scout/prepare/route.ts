import { NextResponse } from "next/server";

import { prepareHunterSignalScoutRun } from "@/modules/lead-gen/hunter-signal-scout";
import { authenticateIngestionRequest, IngestionAuthError } from "@/server/ingestion-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(request: Request) {
  try {
    const tenant = await authenticateIngestionRequest(request);
    const result = await prepareHunterSignalScoutRun({
      tenantId: tenant.tenantId,
      force: request.headers.get("x-hunter-signal-scout-force")?.toLowerCase() === "true"
    });
    return NextResponse.json({ data: result });
  } catch (error) {
    const status = error instanceof IngestionAuthError ? error.status : 502;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Hunter signal scout preparation failed." },
      { status }
    );
  }
}
