import { ModuleKey } from "@prisma/client";
import { NextResponse } from "next/server";

import {
  OPERATIONAL_FEEDBACK_EVIDENCE_MAX_BYTES,
  OperationalFeedbackEvidenceError,
  saveOperationalFeedbackEvidence
} from "@/modules/assistant/operational-feedback-evidence";
import { requireAdmin, requireModule, requireMutationAccess } from "@/server/auth/authorization";
import { getAuthenticatedContext } from "@/server/tenant-context";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ feedbackId: string }> }
) {
  try {
    const context = await getAuthenticatedContext();
    await requireModule(context, ModuleKey.SHIPMENT_DOCUMENTS);
    await requireMutationAccess(context);
    requireAdmin(context);
    const { feedbackId } = await params;
    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      throw new OperationalFeedbackEvidenceError("Choose a PDF, PNG, JPEG, or WebP evidence file.");
    }
    if (file.size > OPERATIONAL_FEEDBACK_EVIDENCE_MAX_BYTES) {
      throw new OperationalFeedbackEvidenceError(
        `Evidence files cannot exceed ${OPERATIONAL_FEEDBACK_EVIDENCE_MAX_BYTES} bytes.`
      );
    }
    const artifact = await saveOperationalFeedbackEvidence(context, feedbackId, {
      fileName: file.name,
      contentType: file.type,
      bytes: new Uint8Array(await file.arrayBuffer())
    });
    return NextResponse.json({ data: artifact }, { status: 201 });
  } catch (error) {
    const status = error instanceof OperationalFeedbackEvidenceError ? error.status : 500;
    return NextResponse.json(
      { error: status === 500 ? "Unable to attach feedback evidence." : error instanceof Error ? error.message : "Unable to attach feedback evidence." },
      { status }
    );
  }
}
