import { NextResponse } from "next/server";

import { jsonError } from "@/app/api/integrations/trademining/response";
import { getActiveTradeMiningProfilesForWorker } from "@/modules/trademining/ingestion";
import { authenticateIngestionRequest } from "@/server/ingestion-auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const tenant = await authenticateIngestionRequest(request);
    const profiles = await getActiveTradeMiningProfilesForWorker(tenant);

    return NextResponse.json({
      data: {
        tenant: {
          slug: tenant.tenantSlug,
          name: tenant.tenantName
        },
        profiles
      }
    });
  } catch (error) {
    return jsonError(error);
  }
}
