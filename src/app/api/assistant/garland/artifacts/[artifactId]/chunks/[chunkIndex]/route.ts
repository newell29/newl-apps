import { ModuleKey } from "@prisma/client";
import { NextResponse } from "next/server";

import {
  GarlandArtifactError,
  saveGarlandArtifactChunk,
  WORKFLOW_ARTIFACT_CHUNK_BYTES
} from "@/modules/assistant/garland-artifacts";
import { AuthorizationError, requireModule, requireMutationAccess } from "@/server/auth/authorization";
import {
  authenticateOpenClawAssistantRequest,
  OpenClawAssistantAuthError
} from "@/server/openclaw-assistant-auth";

export const dynamic = "force-dynamic";

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ artifactId: string; chunkIndex: string }> }
) {
  try {
    const context = await authenticateOpenClawAssistantRequest(request);
    await requireModule(context, ModuleKey.SHIPMENT_DOCUMENTS);
    await requireMutationAccess(context);
    const { artifactId, chunkIndex: chunkIndexValue } = await params;
    const contentLength = Number(request.headers.get("content-length"));
    if (!Number.isFinite(contentLength) || contentLength < 1 || contentLength > WORKFLOW_ARTIFACT_CHUNK_BYTES) {
      throw new GarlandArtifactError("A content-length between 1 byte and 3 MB is required.");
    }
    const bytes = new Uint8Array(await request.arrayBuffer());
    if (bytes.byteLength !== contentLength) {
      throw new GarlandArtifactError("The uploaded chunk size does not match content-length.");
    }

    const result = await saveGarlandArtifactChunk(
      context,
      artifactId,
      Number(chunkIndexValue),
      bytes,
      request.headers.get("x-newl-content-sha256")
    );
    return NextResponse.json({ data: result });
  } catch (error) {
    const known =
      error instanceof GarlandArtifactError ||
      error instanceof OpenClawAssistantAuthError ||
      error instanceof AuthorizationError;
    const status = known && "status" in error ? error.status : 500;
    return NextResponse.json(
      { error: status === 500 ? "Unable to save the Garland PDF chunk." : error instanceof Error ? error.message : "Upload failed." },
      { status }
    );
  }
}
