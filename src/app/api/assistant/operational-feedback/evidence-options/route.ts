import { ModuleKey } from "@prisma/client";
import { NextResponse } from "next/server";

import {
  listGarlandFeedbackEvidenceOptions,
  OperationalFeedbackEvidenceError
} from "@/modules/assistant/operational-feedback-evidence";
import { requireAdmin, requireModule } from "@/server/auth/authorization";
import { getAuthenticatedContext } from "@/server/tenant-context";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const context = await getAuthenticatedContext();
    await requireModule(context, ModuleKey.SHIPMENT_DOCUMENTS);
    requireAdmin(context);
    const reference = new URL(request.url).searchParams.get("reference") ?? "";
    return NextResponse.json({
      data: await listGarlandFeedbackEvidenceOptions(context, reference)
    });
  } catch (error) {
    const status = error instanceof OperationalFeedbackEvidenceError ? error.status : 500;
    return NextResponse.json(
      { error: status === 500 ? "Unable to find saved Garland evidence." : error instanceof Error ? error.message : "Unable to find saved Garland evidence." },
      { status }
    );
  }
}
