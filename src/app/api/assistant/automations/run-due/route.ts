import { NextResponse } from "next/server";

import { runDueAssistantAutomationsForTenant } from "@/modules/assistant/runtime";
import { authenticateIngestionRequest, IngestionAuthError } from "@/server/ingestion-auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const tenant = await authenticateIngestionRequest(request);
    const result = await runDueAssistantAutomationsForTenant(tenant);

    return NextResponse.json({
      data: {
        tenant: {
          slug: tenant.tenantSlug,
          name: tenant.tenantName
        },
        ...result
      }
    });
  } catch (error) {
    if (error instanceof IngestionAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    const message = error instanceof Error ? error.message : "Unknown assistant automation error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
