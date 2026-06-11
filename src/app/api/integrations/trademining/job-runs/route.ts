import { NextResponse } from "next/server";

import { jsonError, readJson } from "@/app/api/integrations/trademining/response";
import { createTradeMiningJobRun } from "@/modules/trademining/ingestion";
import { authenticateIngestionRequest } from "@/server/ingestion-auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const tenant = await authenticateIngestionRequest(request);
    const body = await readJson(request);
    const result = await createTradeMiningJobRun(tenant, body);

    return NextResponse.json({ data: result }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
