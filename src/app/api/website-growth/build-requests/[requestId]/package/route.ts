import { NextResponse } from "next/server";

import { getWebsiteGrowthBuildRequestPackage } from "@/modules/website-growth/build-requests";
import {
  authenticateWebsiteGrowthBuildWorkerRequest,
  WebsiteGrowthBuildWorkerAuthError
} from "@/server/website-growth-build-worker-auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ requestId: string }> }) {
  try {
    const { tenantSlug } = authenticateWebsiteGrowthBuildWorkerRequest(request);
    const { requestId } = await params;
    const buildRequest = await getWebsiteGrowthBuildRequestPackage(requestId, tenantSlug);
    if (!buildRequest) return NextResponse.json({ error: "Website Growth build request was not found." }, { status: 404 });
    return NextResponse.json({ data: { buildRequest } });
  } catch (error) {
    const status = error instanceof WebsiteGrowthBuildWorkerAuthError ? error.status : 500;
    return NextResponse.json({ error: status === 500 ? "Unable to load Website Growth build request." : error instanceof Error ? error.message : "Unable to load Website Growth build request." }, { status });
  }
}
