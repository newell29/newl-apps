import { ModuleKey } from "@prisma/client";
import { NextResponse } from "next/server";

import {
  createOperationalFeedback,
  listOperationalFeedback
} from "@/modules/assistant/operational-memory";
import { requireModule, requireMutationAccess } from "@/server/auth/authorization";
import { getAuthenticatedContext } from "@/server/tenant-context";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const context = await getAuthenticatedContext();
  await requireModule(context, ModuleKey.SHIPMENT_DOCUMENTS);
  const url = new URL(request.url);
  const feedback = await listOperationalFeedback(context, {
    status: url.searchParams.get("status"),
    limit: Number(url.searchParams.get("limit")) || 100
  });
  return NextResponse.json({ data: feedback });
}

export async function POST(request: Request) {
  const context = await getAuthenticatedContext();
  await requireModule(context, ModuleKey.SHIPMENT_DOCUMENTS);
  await requireMutationAccess(context);
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const feedback = await createOperationalFeedback(context, {
    subjectType: typeof body.subjectType === "string" ? body.subjectType : "GENERAL_WORKFLOW",
    subjectId: stringOrNull(body.subjectId),
    workflowKey: stringOrNull(body.workflowKey) ?? undefined,
    teamshipReviewRunId: stringOrNull(body.teamshipReviewRunId),
    teamshipReviewOrderId: stringOrNull(body.teamshipReviewOrderId),
    artifactId: stringOrNull(body.artifactId),
    reporterStatement: typeof body.reporterStatement === "string" ? body.reporterStatement : "",
    expectedOutcome: stringOrNull(body.expectedOutcome),
    observedOutcome: stringOrNull(body.observedOutcome),
    classification: stringOrNull(body.classification),
    evidence: body.evidence as never
  });
  return NextResponse.json({ data: feedback }, { status: 201 });
}

function stringOrNull(value: unknown) {
  return typeof value === "string" ? value : null;
}
