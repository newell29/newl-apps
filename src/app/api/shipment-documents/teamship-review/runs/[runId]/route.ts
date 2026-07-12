import { ModuleKey } from "@prisma/client";
import { NextResponse } from "next/server";

import {
  deleteTeamshipReviewRun,
  getTeamshipReviewHistory,
  markTeamshipReviewOrderBolPrinted
} from "@/modules/shipment-documents/teamship-review-history";
import { requireAdmin, requireModule, requireMutationAccess } from "@/server/auth/authorization";
import { getAuthenticatedContext } from "@/server/tenant-context";

export const dynamic = "force-dynamic";

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
    const body = (await request.json().catch(() => null)) as { action?: string; orderId?: string } | null;
    const orderId = body?.orderId?.trim();

    if (!orderId) {
      return NextResponse.json({ error: "Select a saved Teamship review order to update." }, { status: 400 });
    }

    if (body?.action !== "markBolPrinted" && body?.action !== "clearBolPrinted") {
      return NextResponse.json({ error: "Unsupported Teamship review history action." }, { status: 400 });
    }

    await markTeamshipReviewOrderBolPrinted({
      context,
      runId,
      orderId,
      printed: body.action === "markBolPrinted"
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
