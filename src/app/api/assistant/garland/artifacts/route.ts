import { ModuleKey } from "@prisma/client";
import { NextResponse } from "next/server";

import {
  createGarlandArtifact,
  GarlandArtifactError
} from "@/modules/assistant/garland-artifacts";
import { AuthorizationError, requireModule, requireMutationAccess } from "@/server/auth/authorization";
import {
  authenticateOpenClawAssistantRequest,
  OpenClawAssistantAuthError
} from "@/server/openclaw-assistant-auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const context = await authenticateOpenClawAssistantRequest(request);
    await requireModule(context, ModuleKey.SHIPMENT_DOCUMENTS);
    await requireMutationAccess(context);
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!body) throw new GarlandArtifactError("Request body must be valid JSON.");

    const artifact = await createGarlandArtifact(context, {
      fileName: readString(body.fileName),
      contentType: readString(body.contentType),
      sizeBytes: readNumber(body.sizeBytes),
      chunkCount: readNumber(body.chunkCount),
      sourceChannel: "TEAMS",
      externalMessageId: readOptionalString(body.externalMessageId),
      externalConversationId: readOptionalString(body.externalConversationId)
    });
    return NextResponse.json({ data: artifact }, { status: 201 });
  } catch (error) {
    return errorResponse(error, "Unable to create the Garland upload.");
  }
}

function readString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function readOptionalString(value: unknown) {
  return typeof value === "string" ? value : null;
}

function readNumber(value: unknown) {
  return typeof value === "number" ? value : Number.NaN;
}

function errorResponse(error: unknown, fallback: string) {
  const known =
    error instanceof GarlandArtifactError ||
    error instanceof OpenClawAssistantAuthError ||
    error instanceof AuthorizationError;
  const status = known && "status" in error ? error.status : 500;
  return NextResponse.json(
    { error: status === 500 ? fallback : error instanceof Error ? error.message : fallback },
    { status }
  );
}
