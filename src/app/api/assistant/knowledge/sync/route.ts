import { NextResponse } from "next/server";

import { runAssistantKnowledgeSync } from "@/modules/assistant/knowledge-sync";
import { AuthorizationError } from "@/server/auth/authorization";
import { getAuthenticatedContext } from "@/server/tenant-context";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST() {
  try {
    const context = await getAuthenticatedContext();
    const result = await runAssistantKnowledgeSync(context);

    return NextResponse.json({
      data: result
    });
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    const message = error instanceof Error ? error.message : "Assistant knowledge sync failed for an unknown reason.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
