import { ModuleKey } from "@prisma/client";
import { NextResponse } from "next/server";

import {
  approveFeedbackAsLesson,
  OperationalMemoryError,
  reviewOperationalFeedback,
  updateOperationalFeedbackReviewFields
} from "@/modules/assistant/operational-memory";
import { requireAdmin, requireModule, requireMutationAccess } from "@/server/auth/authorization";
import { getAuthenticatedContext } from "@/server/tenant-context";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ feedbackId: string }> }
) {
  const context = await getAuthenticatedContext();
  await requireModule(context, ModuleKey.SHIPMENT_DOCUMENTS);
  await requireMutationAccess(context);
  requireAdmin(context);
  const { feedbackId } = await params;
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const action = typeof body.action === "string" ? body.action : "review";

  if (action === "approve_lesson") {
    const lesson = await approveFeedbackAsLesson(context, feedbackId, {
      title: typeof body.title === "string" ? body.title : "",
      ruleText: typeof body.ruleText === "string" ? body.ruleText : "",
      confidence: typeof body.confidence === "number" ? body.confidence : undefined
    });
    return NextResponse.json({ data: lesson });
  }
  if (action === "update_review_fields") {
    const feedback = await updateOperationalFeedbackReviewFields(context, feedbackId, {
      expectedOutcome: optionalString(body.expectedOutcome),
      observedOutcome: optionalString(body.observedOutcome)
    });
    return NextResponse.json({ data: feedback });
  }
  if (action !== "review") throw new OperationalMemoryError("Unsupported feedback action.");

  const feedback = await reviewOperationalFeedback(context, feedbackId, {
    status: typeof body.status === "string" ? body.status : "",
    resolutionNotes: typeof body.resolutionNotes === "string" ? body.resolutionNotes : null,
    expectedOutcome: optionalString(body.expectedOutcome),
    observedOutcome: optionalString(body.observedOutcome)
  });
  return NextResponse.json({ data: feedback });
}

function optionalString(value: unknown) {
  return typeof value === "string" ? value : value === null ? null : undefined;
}
