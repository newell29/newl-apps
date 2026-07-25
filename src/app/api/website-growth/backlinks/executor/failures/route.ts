import { NextResponse } from "next/server";

import {
  recordWebsiteGrowthBacklinkFailure,
  type WebsiteGrowthBacklinkFailureInput
} from "@/modules/website-growth/backlink-failure-manager";
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
    const body = (await request.json()) as WebsiteGrowthBacklinkFailureInput;
    const result = await recordWebsiteGrowthBacklinkFailure({
      tenantId: tenant.id,
      input: body
    });
    return NextResponse.json({ data: result });
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
            : "Backlink failure reporting failed."
      },
      { status }
    );
  }
}
