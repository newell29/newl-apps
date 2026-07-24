import { NextResponse } from "next/server";

import { getWebsiteGrowthBacklinkVerificationQueue } from "@/modules/website-growth/backlink-executor";
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
    const text = await request.text();
    const body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    const limit = typeof body.limit === "number" ? body.limit : 5;
    const opportunities = await getWebsiteGrowthBacklinkVerificationQueue({
      tenantId: tenant.id,
      limit
    });
    return NextResponse.json({ data: { opportunities } });
  } catch (error) {
    const status =
      error instanceof WebsiteGrowthBacklinkExecutorAuthError
        ? error.status
        : error instanceof SyntaxError
          ? 400
          : 422;
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Backlink verification lookup failed."
      },
      { status }
    );
  }
}
