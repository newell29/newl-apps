import { NextResponse } from "next/server";

import { runPaidCampaignHealthCheck } from "@/modules/website-growth/paid-scout";
import {
  authenticateIngestionCronRequest,
  IngestionAuthError
} from "@/server/ingestion-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(request: Request) {
  try {
    const tenant = await authenticateIngestionCronRequest(request);
    return NextResponse.json({
      data: await runPaidCampaignHealthCheck({ tenantId: tenant.tenantId }),
      note: "Paid campaign health was evaluated. No advertising settings were changed."
    });
  } catch (error) {
    const status = error instanceof IngestionAuthError ? error.status : 502;
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Paid campaign health check failed."
      },
      { status }
    );
  }
}
