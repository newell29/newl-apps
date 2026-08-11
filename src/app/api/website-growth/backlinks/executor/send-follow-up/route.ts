import { NextResponse } from "next/server";

import { sendWebsiteGrowthOutreachFollowUp } from "@/modules/website-growth/backlink-outreach";
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
    const body = (await request.json()) as Record<string, unknown>;
    const data = await sendWebsiteGrowthOutreachFollowUp({
      tenantId: tenant.id,
      opportunityId: readString(body.opportunityId, "opportunityId"),
      subject: readString(body.subject, "subject"),
      body: readString(body.body, "body")
    });
    return NextResponse.json({ data });
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
          error instanceof Error
            ? error.message
            : "Backlink outreach follow-up failed."
      },
      { status }
    );
  }
}

function readString(value: unknown, name: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${name} is required.`);
  }
  return value.trim();
}
