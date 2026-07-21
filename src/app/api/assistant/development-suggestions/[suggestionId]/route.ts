import { ModuleKey } from "@prisma/client";
import { NextResponse } from "next/server";

import { decideDevelopmentSuggestion } from "@/modules/assistant/operational-memory";
import { requireAdmin, requireModule, requireMutationAccess } from "@/server/auth/authorization";
import { getAuthenticatedContext } from "@/server/tenant-context";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ suggestionId: string }> }
) {
  const context = await getAuthenticatedContext();
  await requireModule(context, ModuleKey.SHIPMENT_DOCUMENTS);
  await requireMutationAccess(context);
  requireAdmin(context);
  const { suggestionId } = await params;
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const suggestion = await decideDevelopmentSuggestion(context, suggestionId, {
    status: typeof body.status === "string" ? body.status : "",
    decisionNotes: typeof body.decisionNotes === "string" ? body.decisionNotes : null
  });
  return NextResponse.json({ data: suggestion });
}
