import { NextResponse } from "next/server";

import { jsonError } from "@/app/api/integrations/trademining/response";
import { getTradeMiningRunRequestsForWorker } from "@/modules/trademining/ingestion";
import { authenticateIngestionRequest } from "@/server/ingestion-auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const tenant = await authenticateIngestionRequest(request);
    const requests = await getTradeMiningRunRequestsForWorker(tenant);

    return NextResponse.json({
      data: {
        tenant: {
          slug: tenant.tenantSlug,
          name: tenant.tenantName
        },
        requests
      }
    });
  } catch (error) {
    return jsonError(error);
  }
}
