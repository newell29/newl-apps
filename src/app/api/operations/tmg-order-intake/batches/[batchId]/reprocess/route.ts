import { ModuleKey } from "@prisma/client";
import { NextResponse } from "next/server";

import {
  reprocessTmgOrderIntakeBatch,
  TmgIntakeError
} from "@/modules/shipment-documents/tmg-email-intake";
import { requireModule, requireMutationAccess } from "@/server/auth/authorization";
import { getAuthenticatedContext } from "@/server/tenant-context";

export async function POST(_request: Request, { params }: { params: Promise<{ batchId: string }> }) {
  try {
    const context = await getAuthenticatedContext();
    await requireModule(context, ModuleKey.SHIPMENT_DOCUMENTS);
    await requireMutationAccess(context);
    const { batchId } = await params;
    const batch = await reprocessTmgOrderIntakeBatch(context, batchId);
    return NextResponse.json({ batch: JSON.parse(JSON.stringify(batch)) });
  } catch (error) {
    const status = error instanceof TmgIntakeError ? error.status : 500;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to reprocess the TMG order batch." },
      { status }
    );
  }
}
