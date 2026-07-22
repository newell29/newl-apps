import { NextResponse } from "next/server";

import { updateWebsiteGrowthBuildRequestFromWorker } from "@/modules/website-growth/build-requests";
import {
  authenticateWebsiteGrowthBuildWorkerRequest,
  WebsiteGrowthBuildWorkerAuthError
} from "@/server/website-growth-build-worker-auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ requestId: string }> }) {
  try {
    const { tenantSlug } = authenticateWebsiteGrowthBuildWorkerRequest(request);
    const { requestId } = await params;
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    const status = body?.status;
    if (status !== "RUNNING" && status !== "PR_OPEN" && status !== "PREVIEW_READY" && status !== "FAILED") {
      return NextResponse.json({ error: "Website Growth build status is invalid." }, { status: 400 });
    }
    const updated = await updateWebsiteGrowthBuildRequestFromWorker({
      requestId,
      tenantSlug,
      update: {
        status,
        githubRunUrl: readString(body, "githubRunUrl"),
        pullRequestUrl: readString(body, "pullRequestUrl"),
        pullRequestNumber: readPositiveInteger(body?.pullRequestNumber),
        previewUrl: readString(body, "previewUrl"),
        commitSha: readString(body, "commitSha"),
        errorCode: readString(body, "errorCode"),
        errorMessage: readString(body, "errorMessage")
      }
    });
    if (!updated) return NextResponse.json({ error: "Website Growth build request was not found." }, { status: 404 });
    return NextResponse.json({ data: { updated: true } });
  } catch (error) {
    const status = error instanceof WebsiteGrowthBuildWorkerAuthError ? error.status : 409;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to update Website Growth build request." }, { status });
  }
}

function readString(body: Record<string, unknown> | null, key: string) {
  const value = body?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readPositiveInteger(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}
