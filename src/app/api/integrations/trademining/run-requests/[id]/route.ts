import { NextResponse } from "next/server";

import { jsonError, readJson } from "@/app/api/integrations/trademining/response";
import { updateTradeMiningRunRequestStatus } from "@/modules/trademining/ingestion";
import { authenticateIngestionRequest } from "@/server/ingestion-auth";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const tenant = await authenticateIngestionRequest(request);
    const body = await readJson(request);
    const { id } = await params;
    const result = await updateTradeMiningRunRequestStatus(tenant, id, body);

    return NextResponse.json({
      data: result
    });
  } catch (error) {
    return jsonError(error);
  }
}
