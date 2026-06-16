import { NextResponse } from "next/server";

import { jsonError, readJson } from "@/app/api/integrations/trademining/response";
import { getTradeMiningJobRunReadback, updateTradeMiningJobRunStatus } from "@/modules/trademining/ingestion";
import { authenticateIngestionRequest } from "@/server/ingestion-auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const tenant = await authenticateIngestionRequest(request);
    const { id } = await context.params;
    const result = await getTradeMiningJobRunReadback(tenant, id);

    return NextResponse.json({ data: result });
  } catch (error) {
    return jsonError(error);
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const tenant = await authenticateIngestionRequest(request);
    const body = await readJson(request);
    const { id } = await context.params;
    const result = await updateTradeMiningJobRunStatus(tenant, id, body);

    return NextResponse.json({ data: result });
  } catch (error) {
    return jsonError(error);
  }
}
