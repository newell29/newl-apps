import { NextResponse } from "next/server";

import {
  prepareWebsiteGrowthDirectoryAccount
} from "@/modules/website-growth/directory-accounts";
import { prisma } from "@/server/db";
import {
  authenticateWebsiteGrowthBacklinkExecutorRequest,
  WebsiteGrowthBacklinkExecutorAuthError
} from "@/server/website-growth-backlink-executor-auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const { tenantSlug } =
      authenticateWebsiteGrowthBacklinkExecutorRequest(request);
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
    const body = await request.json() as Record<string, unknown>;
    if (
      typeof body.opportunityId !== "string" ||
      !body.opportunityId.trim()
    ) {
      return NextResponse.json(
        { error: "Backlink opportunityId is required." },
        { status: 400 }
      );
    }
    const data = await prepareWebsiteGrowthDirectoryAccount({
      tenantId: tenant.id,
      opportunityId: body.opportunityId.trim()
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
            : "Directory credential preparation failed."
      },
      { status }
    );
  }
}
