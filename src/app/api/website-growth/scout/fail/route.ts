import { NextResponse } from "next/server";

import { failWebsiteGrowthScoutRun } from "@/modules/website-growth/scout-run";
import { prisma } from "@/server/db";
import {
  authenticateWebsiteGrowthScoutRequest,
  WebsiteGrowthScoutAuthError
} from "@/server/website-growth-scout-auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const { tenantSlug } = authenticateWebsiteGrowthScoutRequest(request);
    const tenant = await prisma.tenant.findUnique({ where: { slug: tenantSlug }, select: { id: true } });
    if (!tenant) return NextResponse.json({ error: "Website Growth Scout tenant was not found." }, { status: 404 });
    const body = await request.json() as { runId?: unknown; message?: unknown };
    if (typeof body.runId !== "string" || typeof body.message !== "string") {
      return NextResponse.json({ error: "Website Growth Scout runId and message are required." }, { status: 400 });
    }

    const updated = await failWebsiteGrowthScoutRun({
      tenantId: tenant.id,
      runId: body.runId.trim(),
      message: body.message
    });
    return NextResponse.json({ data: { updated } });
  } catch (error) {
    const status = error instanceof WebsiteGrowthScoutAuthError ? error.status : 422;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Website Growth Scout failure callback failed." },
      { status }
    );
  }
}
