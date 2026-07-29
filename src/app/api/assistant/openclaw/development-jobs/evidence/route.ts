import { ModuleKey, PlatformRole } from "@prisma/client";
import { NextResponse } from "next/server";

import {
  getRivetDevelopmentEvidence,
  RivetDevelopmentJobError
} from "@/modules/assistant/rivet-development-jobs";
import { requireModule, requireRole } from "@/server/auth/authorization";
import {
  authenticateOpenClawAssistantRequest,
  OpenClawAssistantAuthError
} from "@/server/openclaw-assistant-auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const context = await authenticateOpenClawAssistantRequest(request);
    requireRole(context, [PlatformRole.ADMIN]);
    await requireModule(context, ModuleKey.SHIPMENT_DOCUMENTS);
    const url = new URL(request.url);
    const evidence = await getRivetDevelopmentEvidence(context, {
      jobId: readRequired(url.searchParams.get("jobId"), "jobId"),
      feedbackId: readRequired(url.searchParams.get("feedbackId"), "feedbackId"),
      artifactId: readRequired(url.searchParams.get("artifactId"), "artifactId"),
      leaseToken: readRequired(request.headers.get("x-newl-rivet-lease-token"), "lease token")
    });
    return new Response(Buffer.from(evidence.bytes), {
      status: 200,
      headers: {
        "cache-control": "no-store",
        "content-type": evidence.contentType,
        "content-disposition": `attachment; filename="${evidence.fileName}"`,
        "x-newl-content-hash": evidence.contentHash,
        "x-content-type-options": "nosniff"
      }
    });
  } catch (error) {
    const status = error instanceof RivetDevelopmentJobError ||
      error instanceof OpenClawAssistantAuthError
      ? error.status
      : 500;
    return NextResponse.json(
      { error: status >= 500 ? "The Rivet evidence request failed." : error instanceof Error ? error.message : "The Rivet evidence request failed." },
      { status }
    );
  }
}

function readRequired(value: string | null, field: string) {
  const normalized = value?.trim();
  if (!normalized || normalized.length > 200) {
    throw new RivetDevelopmentJobError(`${field} is required.`);
  }
  return normalized;
}
