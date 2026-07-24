import { NextResponse } from "next/server";

import {
  parseWebsiteGrowthBacklinkExecutionStatus,
  reportWebsiteGrowthBacklinkExecution
} from "@/modules/website-growth/backlink-executor";
import { prisma } from "@/server/db";
import {
  authenticateWebsiteGrowthBacklinkExecutorRequest,
  WebsiteGrowthBacklinkExecutorAuthError
} from "@/server/website-growth-backlink-executor-auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const { tenantSlug } = authenticateWebsiteGrowthBacklinkExecutorRequest(request);
    const tenant = await prisma.tenant.findUnique({ where: { slug: tenantSlug }, select: { id: true } });
    if (!tenant) return NextResponse.json({ error: "Backlink executor tenant was not found." }, { status: 404 });
    const body = await request.json() as Record<string, unknown>;
    if (typeof body.opportunityId !== "string" || !body.opportunityId.trim()) {
      return NextResponse.json({ error: "Backlink opportunityId is required." }, { status: 400 });
    }
    await reportWebsiteGrowthBacklinkExecution({
      tenantId: tenant.id,
      opportunityId: body.opportunityId.trim(),
      status: parseWebsiteGrowthBacklinkExecutionStatus(body.status),
      notes: typeof body.notes === "string" ? body.notes : null,
      liveUrl: typeof body.liveUrl === "string" ? body.liveUrl : null
    });
    return NextResponse.json({ data: { updated: true } });
  } catch (error) {
    const status = error instanceof WebsiteGrowthBacklinkExecutorAuthError
      ? error.status
      : error instanceof SyntaxError
        ? 400
        : 422;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Backlink execution report failed." },
      { status }
    );
  }
}
