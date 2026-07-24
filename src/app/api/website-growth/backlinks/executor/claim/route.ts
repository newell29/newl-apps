import { NextResponse } from "next/server";

import { claimApprovedWebsiteGrowthBacklinks } from "@/modules/website-growth/backlink-executor";
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
    const body = await readOptionalJson(request);
    const limit = typeof body.limit === "number" ? body.limit : 5;
    const opportunities = await claimApprovedWebsiteGrowthBacklinks({ tenantId: tenant.id, limit });
    return NextResponse.json({ data: { opportunities } });
  } catch (error) {
    const status = error instanceof WebsiteGrowthBacklinkExecutorAuthError ? error.status : 422;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Backlink claim failed." },
      { status }
    );
  }
}

async function readOptionalJson(request: Request): Promise<Record<string, unknown>> {
  const text = await request.text();
  if (!text.trim()) return {};
  const value = JSON.parse(text) as unknown;
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}
