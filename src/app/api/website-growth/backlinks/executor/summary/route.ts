import { NextResponse } from "next/server";

import { buildWebsiteGrowthOutreachTeamsSummary } from "@/modules/website-growth/backlink-outreach";
import { prisma } from "@/server/db";
import {
  authenticateWebsiteGrowthBacklinkExecutorRequest,
  WebsiteGrowthBacklinkExecutorAuthError
} from "@/server/website-growth-backlink-executor-auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const { tenantSlug } = authenticateWebsiteGrowthBacklinkExecutorRequest(request);
    const tenant = await prisma.tenant.findUnique({
      where: { slug: tenantSlug },
      select: { id: true }
    });
    if (!tenant) {
      return NextResponse.json(
        { error: "Backlink executor tenant was not found." },
        { status: 404 }
      );
    }
    const baseUrl = new URL(request.url).origin;
    const summary = await buildWebsiteGrowthOutreachTeamsSummary({
      tenantId: tenant.id,
      baseUrl
    });
    return NextResponse.json({ data: summary });
  } catch (error) {
    const status =
      error instanceof WebsiteGrowthBacklinkExecutorAuthError
        ? error.status
        : 422;
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Backlink outreach summary failed."
      },
      { status }
    );
  }
}
