import { NextResponse } from "next/server";

import { runPaidCampaignWeeklyReview } from "@/modules/website-growth/paid-scout";
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
      data: await runPaidCampaignWeeklyReview({ tenantId: tenant.tenantId }),
      note: "The weekly paid review was recorded for human review. No advertising settings were changed."
    });
  } catch (error) {
    const status = error instanceof IngestionAuthError ? error.status : 502;
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Weekly paid campaign review failed."
      },
      { status }
    );
  }
}
