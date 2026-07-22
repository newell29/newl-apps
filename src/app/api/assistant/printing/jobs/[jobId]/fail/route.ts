import { NextResponse } from "next/server";

import { failTeamshipPrintJob } from "@/modules/teamship/print-jobs";
import { authenticateTeamshipPrintWorkerRequest, TeamshipPrintWorkerAuthError } from "@/server/teamship-print-worker-auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  try {
    const { workerId, tenantSlug } = authenticateTeamshipPrintWorkerRequest(request);
    const { jobId } = await params;
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    const failed = await failTeamshipPrintJob(jobId, workerId, tenantSlug, {
      errorCode: typeof body?.errorCode === "string" ? body.errorCode : "PRINT_FAILED",
      errorMessage: typeof body?.errorMessage === "string" ? body.errorMessage : "Print worker failed.",
      result: body?.result
    });
    if (!failed) return NextResponse.json({ error: "The claimed print job was not found." }, { status: 409 });
    return NextResponse.json({ data: { failed: true } });
  } catch (error) {
    const status = error instanceof TeamshipPrintWorkerAuthError ? error.status : 400;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to fail Teamship print job." }, { status });
  }
}
