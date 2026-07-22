import { NextResponse } from "next/server";

import { claimNextTeamshipPrintJob } from "@/modules/teamship/print-jobs";
import { authenticateTeamshipPrintWorkerRequest, TeamshipPrintWorkerAuthError } from "@/server/teamship-print-worker-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(request: Request) {
  try {
    const { workerId, tenantSlug } = authenticateTeamshipPrintWorkerRequest(request);
    return NextResponse.json({ data: { job: await claimNextTeamshipPrintJob(workerId, tenantSlug) } });
  } catch (error) {
    const status = error instanceof TeamshipPrintWorkerAuthError ? error.status : 500;
    return NextResponse.json(
      { error: status === 500 ? "Unable to claim Teamship print job." : error instanceof Error ? error.message : "Unable to claim Teamship print job." },
      { status }
    );
  }
}
