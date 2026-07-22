import { NextResponse } from "next/server";

import { produceWebsiteGrowthDraft } from "@/modules/website-growth/producer";
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
    const tenant = await prisma.tenant.findUnique({ where: { slug: tenantSlug }, select: { id: true } });
    if (!tenant) return NextResponse.json({ error: "Website Growth Scout tenant was not found." }, { status: 404 });
    const draft = await produceWebsiteGrowthDraft({ tenantId: tenant.id, actorUserId: null, source: "openclaw-scout" });
    return NextResponse.json({
      data: draft ? { produced: true, draftId: draft.id, opportunityId: draft.opportunityId } : { produced: false, reason: "NO_REVIEWING_OPPORTUNITY_WITHOUT_DRAFT" }
    });
  } catch (error) {
    const status = error instanceof WebsiteGrowthScoutAuthError ? error.status : 502;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Website Growth Scout could not produce a draft." }, { status });
  }
}
