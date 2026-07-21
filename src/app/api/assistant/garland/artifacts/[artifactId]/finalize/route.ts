import { ModuleKey } from "@prisma/client";
import { NextResponse } from "next/server";

import { finalizeGarlandArtifact, GarlandArtifactError } from "@/modules/assistant/garland-artifacts";
import { AuthorizationError, requireModule, requireMutationAccess } from "@/server/auth/authorization";
import {
  authenticateOpenClawAssistantRequest,
  OpenClawAssistantAuthError
} from "@/server/openclaw-assistant-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ artifactId: string }> }
) {
  try {
    const context = await authenticateOpenClawAssistantRequest(request);
    await requireModule(context, ModuleKey.SHIPMENT_DOCUMENTS);
    await requireMutationAccess(context);
    const { artifactId } = await params;
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const result = await finalizeGarlandArtifact(context, artifactId, {
      shipmentDate: typeof body.shipmentDate === "string" ? body.shipmentDate : null
    });
    return NextResponse.json({ data: result });
  } catch (error) {
    const known =
      error instanceof GarlandArtifactError ||
      error instanceof OpenClawAssistantAuthError ||
      error instanceof AuthorizationError;
    const status = known && "status" in error ? error.status : 500;
    return NextResponse.json(
      { error: status === 500 ? "Unable to finalize the Garland PDF review." : error instanceof Error ? error.message : "Review failed." },
      { status }
    );
  }
}
