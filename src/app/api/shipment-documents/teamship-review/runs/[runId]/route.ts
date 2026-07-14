import { ModuleKey } from "@prisma/client";
import { NextResponse } from "next/server";

import {
  deleteTeamshipReviewRun,
  getTeamshipReviewHistory,
  getTeamshipReviewRunWorkspace,
  updateTeamshipReviewOrderWorkflow,
  updateTeamshipReviewRunReview
} from "@/modules/shipment-documents/teamship-review-history";
import type { GarlandTeamshipReviewResponse } from "@/modules/shipment-documents/teamship-review-types";
import { requireAdmin, requireModule, requireMutationAccess } from "@/server/auth/authorization";
import { getAuthenticatedContext } from "@/server/tenant-context";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ runId: string }> }) {
  try {
    const context = await getAuthenticatedContext();
    await requireModule(context, ModuleKey.SHIPMENT_DOCUMENTS);
    const { runId } = await params;
    const workspace = await getTeamshipReviewRunWorkspace(context, runId);

    return NextResponse.json(workspace);
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to load Teamship review run." },
      { status: 500 }
    );
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ runId: string }> }) {
  try {
    const context = await getAuthenticatedContext();
    await requireModule(context, ModuleKey.SHIPMENT_DOCUMENTS);
    requireAdmin(context);
    const { runId } = await params;

    await deleteTeamshipReviewRun(context, runId);

    const history = await getTeamshipReviewHistory(context);
    return NextResponse.json(history);
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to delete Teamship review run." },
      { status: 500 }
    );
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ runId: string }> }) {
  try {
    const context = await getAuthenticatedContext();
    await requireModule(context, ModuleKey.SHIPMENT_DOCUMENTS);
    requireMutationAccess(context);
    const { runId } = await params;
    const body = (await request.json().catch(() => null)) as { action?: string; orderId?: string; review?: unknown } | null;
    const action = body?.action;

    if (action === "updateReview") {
      const review = readReviewResponse(body?.review);

      await updateTeamshipReviewRunReview({
        context,
        runId,
        review
      });

      return NextResponse.json({ ok: true });
    }

    const orderId = body?.orderId?.trim();

    if (!orderId) {
      return NextResponse.json({ error: "Select a saved Teamship review order to update." }, { status: 400 });
    }

    if (action !== "markBolPrinted" && action !== "clearBolPrinted" && action !== "markOrderComplete" && action !== "clearOrderComplete") {
      return NextResponse.json({ error: "Unsupported Teamship review history action." }, { status: 400 });
    }

    await updateTeamshipReviewOrderWorkflow({
      context,
      runId,
      orderId,
      action
    });

    const history = await getTeamshipReviewHistory(context);
    return NextResponse.json(history);
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to update Teamship review order." },
      { status: 500 }
    );
  }
}

function readReviewResponse(value: unknown): GarlandTeamshipReviewResponse {
  if (
    !value ||
    typeof value !== "object" ||
    !("summary" in value) ||
    !("pdfOrders" in value) ||
    !Array.isArray((value as GarlandTeamshipReviewResponse).pdfOrders) ||
    !("reviews" in value) ||
    !Array.isArray((value as GarlandTeamshipReviewResponse).reviews)
  ) {
    throw new Error("A completed Teamship review response is required before autosaving edits.");
  }

  return value as GarlandTeamshipReviewResponse;
}
