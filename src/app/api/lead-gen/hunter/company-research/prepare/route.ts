import { NextResponse } from "next/server";

import { prepareHunterCompanyResearchRun } from "@/modules/lead-gen/hunter-company-research";
import { authenticateIngestionRequest, IngestionAuthError } from "@/server/ingestion-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(request: Request) {
  try {
    const tenant = await authenticateIngestionRequest(request);
    const body = await request.json().catch(() => ({})) as {
      force?: unknown;
      companyKeys?: unknown;
      recoveryOfRunId?: unknown;
    };
    const force = body.force === true;
    const companyKeys = body.companyKeys === undefined
      ? undefined
      : Array.isArray(body.companyKeys)
        ? body.companyKeys.map(String)
        : null;
    if (companyKeys === null) {
      return NextResponse.json({ error: "Hunter companyKeys must be an array." }, { status: 400 });
    }
    const recoveryOfRunId = body.recoveryOfRunId === undefined
      ? undefined
      : typeof body.recoveryOfRunId === "string" && body.recoveryOfRunId.trim()
        ? body.recoveryOfRunId.trim()
        : null;
    if (recoveryOfRunId === null) {
      return NextResponse.json({ error: "Hunter recoveryOfRunId must be a non-empty string." }, { status: 400 });
    }
    const result = await prepareHunterCompanyResearchRun({
      tenantId: tenant.tenantId,
      force,
      companyKeys,
      recoveryOfRunId
    });
    return NextResponse.json({ data: result });
  } catch (error) {
    const status = error instanceof IngestionAuthError
      ? error.status
      : error instanceof SyntaxError
        ? 400
        : 502;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Hunter company-research preparation failed." },
      { status }
    );
  }
}
