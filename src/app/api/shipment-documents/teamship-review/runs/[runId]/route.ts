import { ModuleKey } from "@prisma/client";
import { NextResponse } from "next/server";

import { deleteTeamshipReviewRun, getTeamshipReviewHistory } from "@/modules/shipment-documents/teamship-review-history";
import { requireAdmin, requireModule } from "@/server/auth/authorization";
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
