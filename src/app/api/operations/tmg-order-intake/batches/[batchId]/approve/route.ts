import { ModuleKey } from "@prisma/client";
import { NextResponse } from "next/server";

import { approveTmgOrderBatch, TmgExecutionError } from "@/modules/shipment-documents/tmg-execution-jobs";
import { requireModule, requireMutationAccess } from "@/server/auth/authorization";
import { getAuthenticatedContext } from "@/server/tenant-context";

export async function POST(request: Request, { params }: { params: Promise<{ batchId: string }> }) {
  try {
    const context = await getAuthenticatedContext();
    await requireModule(context, ModuleKey.SHIPMENT_DOCUMENTS);
    await requireMutationAccess(context);
    const body = await request.json().catch(() => null) as { confirmed?: boolean } | null;
    const { batchId } = await params;
    const batch = await approveTmgOrderBatch(context, { batchId, confirmed: body?.confirmed === true });
    return NextResponse.json({ batch: JSON.parse(JSON.stringify(batch)) });
  } catch (error) {
    const status = error instanceof TmgExecutionError ? error.status : 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to approve the TMG order batch." }, { status });
  }
}
