import { ModuleKey } from "@prisma/client";
import { NextResponse } from "next/server";

import {
  createOperationalFeedback,
  explainGarlandCheck,
  generateDevelopmentSuggestions,
  listDevelopmentSuggestions,
  OperationalMemoryError
} from "@/modules/assistant/operational-memory";
import { listOpenClawUnresolvedTurns } from "@/modules/assistant/openclaw-unresolved-turns";
import {
  AuthorizationError,
  requireAdmin,
  requireModule,
  requireMutationAccess
} from "@/server/auth/authorization";
import {
  authenticateOpenClawAssistantRequest,
  OpenClawAssistantAuthError
} from "@/server/openclaw-assistant-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(request: Request) {
  try {
    const context = await authenticateOpenClawAssistantRequest(request);
    await requireModule(context, ModuleKey.SHIPMENT_DOCUMENTS);
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    const action = typeof body?.action === "string" ? body.action.trim().toLowerCase() : "";

    if (action === "explain") {
      const reference = typeof body?.reference === "string" ? body.reference : "";
      return NextResponse.json({ data: await explainGarlandCheck(context.tenantId, reference) });
    }

    if (action === "feedback") {
      await requireMutationAccess(context);
      return NextResponse.json(
        {
          data: await createOperationalFeedback(context, {
            subjectType: typeof body?.subjectType === "string" ? body.subjectType : "GARLAND_CHECK",
            subjectId: stringOrNull(body?.subjectId),
            teamshipReviewRunId: stringOrNull(body?.teamshipReviewRunId),
            teamshipReviewOrderId: stringOrNull(body?.teamshipReviewOrderId),
            artifactId: stringOrNull(body?.artifactId),
            reporterStatement: typeof body?.reporterStatement === "string" ? body.reporterStatement : "",
            expectedOutcome: stringOrNull(body?.expectedOutcome),
            observedOutcome: stringOrNull(body?.observedOutcome),
            classification: stringOrNull(body?.classification),
            evidence: body?.evidence as never
          })
        },
        { status: 201 }
      );
    }

    if (action === "suggestion_digest") {
      requireAdmin(context);
      await requireMutationAccess(context);
      await generateDevelopmentSuggestions(context);
      const suggestions = await listDevelopmentSuggestions(context, 50);
      const unresolvedQueries = await listOpenClawUnresolvedTurns(context, {
        limit: 50,
        staleAfterSeconds: 600
      });
      return NextResponse.json({
        data: {
          awaitingApproval: suggestions.filter((item) => item.status === "AWAITING_APPROVAL"),
          unresolvedQueries,
          safety: "No development, branch, pull request, merge, deployment, Teamship write, or printing action was started."
        }
      });
    }

    throw new OperationalMemoryError("Unsupported Garland assistant action.");
  } catch (error) {
    const known =
      error instanceof OperationalMemoryError ||
      error instanceof OpenClawAssistantAuthError ||
      error instanceof AuthorizationError;
    const status = known && "status" in error ? error.status : 500;
    return NextResponse.json(
      { error: status === 500 ? "The Garland assistant request failed." : error instanceof Error ? error.message : "Request failed." },
      { status }
    );
  }
}

function stringOrNull(value: unknown) {
  return typeof value === "string" ? value : null;
}
