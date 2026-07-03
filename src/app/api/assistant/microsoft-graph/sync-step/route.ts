import { NextResponse } from "next/server";
import { ModuleKey } from "@prisma/client";

import { runTenantMicrosoftGraphMailboxSyncStep } from "@/modules/assistant/microsoft-graph-sync";
import { AuthorizationError, requireModule, requireMutationAccess } from "@/server/auth/authorization";
import { getAuthenticatedContext } from "@/server/tenant-context";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST() {
  try {
    const context = await getAuthenticatedContext();
    await requireModule(context, ModuleKey.ASSISTANT);
    await requireMutationAccess(context);

    const result = await runTenantMicrosoftGraphMailboxSyncStep(context);

    return NextResponse.json({
      data: result
    });
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    const message = error instanceof Error ? error.message : "Microsoft mailbox sync worker failed for an unknown reason.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
