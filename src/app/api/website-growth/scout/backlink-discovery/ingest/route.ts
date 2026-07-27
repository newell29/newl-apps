import { NextResponse } from "next/server";

import { ingestWebsiteGrowthBacklinkDiscoveryResults } from "@/modules/website-growth/backlink-discovery";
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
    if (!tenant) return NextResponse.json({ error: "Website Growth Scout tenant was not found." }, { status: 404 });
    const body = await request.json() as {
      runId?: unknown;
      queries?: unknown;
      results?: unknown;
    };
    if (typeof body.runId !== "string" || !body.runId.trim()) {
      return NextResponse.json({ error: "Website Growth Scout runId is required." }, { status: 400 });
    }
    const data = await ingestWebsiteGrowthBacklinkDiscoveryResults({
      tenantId: tenant.id,
      runId: body.runId.trim(),
      queries: body.queries,
      results: body.results
    });
    return NextResponse.json({ data });
  } catch (error) {
    const status = error instanceof WebsiteGrowthScoutAuthError
      ? error.status
      : error instanceof SyntaxError
        ? 400
        : 422;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Backlink discovery ingest failed." },
      { status }
    );
  }
}
