import { ModuleKey } from "@prisma/client";
import { NextResponse } from "next/server";

import {
  decideDevelopmentSuggestion,
  OperationalMemoryError,
  resolveDevelopmentSuggestion,
  retryRivetDevelopmentSuggestion
} from "@/modules/assistant/operational-memory";
import { RivetDevelopmentJobError } from "@/modules/assistant/rivet-development-jobs";
import { requireAdmin, requireModule, requireMutationAccess } from "@/server/auth/authorization";
import { getAuthenticatedContext } from "@/server/tenant-context";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ suggestionId: string }> }
) {
  try {
    const context = await getAuthenticatedContext();
    await requireModule(context, ModuleKey.SHIPMENT_DOCUMENTS);
    await requireMutationAccess(context);
    requireAdmin(context);
    const { suggestionId } = await params;
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    if (body.action === "retry") {
      return NextResponse.json({
        data: await retryRivetDevelopmentSuggestion(context, suggestionId)
      });
    }
    if (body.action === "resolve_deployed") {
      return NextResponse.json({
        data: await resolveDevelopmentSuggestion(context, suggestionId)
      });
    }
    const suggestion = await decideDevelopmentSuggestion(context, suggestionId, {
      status: typeof body.status === "string" ? body.status : "",
      decisionNotes: typeof body.decisionNotes === "string" ? body.decisionNotes : null
    });
    return NextResponse.json({ data: suggestion });
  } catch (error) {
    if (error instanceof OperationalMemoryError || error instanceof RivetDevelopmentJobError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
