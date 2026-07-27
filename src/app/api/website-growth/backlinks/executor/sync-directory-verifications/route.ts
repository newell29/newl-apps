import { NextResponse } from "next/server";

import {
  syncWebsiteGrowthDirectoryAccountVerifications
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
    const data =
      await syncWebsiteGrowthDirectoryAccountVerifications({
        tenantId: tenant.id
      });
    return NextResponse.json({ data });
  } catch (error) {
    const status =
      error instanceof WebsiteGrowthBacklinkExecutorAuthError
        ? error.status
        : 422;
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Directory verification sync failed."
      },
      { status }
    );
  }
}
