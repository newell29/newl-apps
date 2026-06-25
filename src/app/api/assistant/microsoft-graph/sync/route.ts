import { NextResponse } from "next/server";

import { syncTenantMicrosoftGraphAssistantKnowledge } from "@/modules/assistant/microsoft-graph-sync";
import { authenticateIngestionRequest, IngestionAuthError } from "@/server/ingestion-auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const tenant = await authenticateIngestionRequest(request);
    const result = await syncTenantMicrosoftGraphAssistantKnowledge(tenant);

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

    const message = error instanceof Error ? error.message : "Unknown Microsoft Graph sync error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
