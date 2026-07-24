import { NextResponse } from "next/server";

import { runWebsiteGrowthScoutWeekdayCheckIn } from "@/modules/website-growth/scout-run";
import { prisma } from "@/server/db";
import {
  authenticateWebsiteGrowthScoutRequest,
  WebsiteGrowthScoutAuthError
} from "@/server/website-growth-scout-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(request: Request) {
  try {
    const { tenantSlug } = authenticateWebsiteGrowthScoutRequest(request);
    const tenant = await prisma.tenant.findUnique({
      where: { slug: tenantSlug },
      select: { id: true }
    });
    if (!tenant) {
      return NextResponse.json(
        { error: "Website Growth Scout tenant was not found." },
        { status: 404 }
      );
    }

    const result = await runWebsiteGrowthScoutWeekdayCheckIn({
      tenantId: tenant.id,
      reviewBaseUrl: new URL(request.url).origin
    });
    return NextResponse.json({ data: result });
  } catch (error) {
    const status = error instanceof WebsiteGrowthScoutAuthError ? error.status : 502;
    return NextResponse.json(
      {
        error: error instanceof Error
          ? error.message
          : "Website Growth Scout weekday check-in failed."
      },
      { status }
    );
  }
}
