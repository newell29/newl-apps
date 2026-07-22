import { ModuleKey } from "@prisma/client";
import { NextResponse } from "next/server";

import {
  approveGarlandArtifactUpdate,
  GarlandArtifactError
} from "@/modules/assistant/garland-artifacts";
import {
  AuthorizationError,
  requireModule,
  requireMutationAccess
} from "@/server/auth/authorization";
import {
  authenticateOpenClawAssistantRequest,
  OpenClawAssistantAuthError
} from "@/server/openclaw-assistant-auth";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ artifactId: string }> }
) {
  try {
    const context = await authenticateOpenClawAssistantRequest(request);
    await requireModule(context, ModuleKey.SHIPMENT_DOCUMENTS);
    await requireMutationAccess(context);
    const { artifactId } = await params;
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    return NextResponse.json({
      data: await approveGarlandArtifactUpdate(context, artifactId, {
        jobId: typeof body?.jobId === "string" ? body.jobId : "",
        targetReference: typeof body?.targetReference === "string" ? body.targetReference : "",
        confirmation: typeof body?.confirmation === "string" ? body.confirmation : ""
      })
    });
  } catch (error) {
    const known =
      error instanceof GarlandArtifactError ||
      error instanceof OpenClawAssistantAuthError ||
      error instanceof AuthorizationError;
    const status = known && "status" in error ? error.status : 500;
    return NextResponse.json(
      {
        error: status === 500
          ? "The Garland Teamship update approval failed."
          : error instanceof Error
            ? error.message
            : "Request failed."
      },
      { status }
    );
  }
}
