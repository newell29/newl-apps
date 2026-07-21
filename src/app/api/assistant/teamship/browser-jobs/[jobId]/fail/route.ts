import { NextResponse } from "next/server";

import { failTeamshipBrowserJob } from "@/modules/teamship/browser-read-jobs";
import {
  authenticateTeamshipBrowserWorkerRequest,
  TeamshipBrowserWorkerAuthError
} from "@/server/teamship-browser-worker-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

type Params = { params: Promise<{ jobId: string }> };

export async function POST(request: Request, { params }: Params) {
  try {
    const { workerId, tenantSlug } = authenticateTeamshipBrowserWorkerRequest(request);
    const { jobId } = await params;
    const body = await request.json().catch(() => null) as { errorCode?: unknown; errorMessage?: unknown } | null;
    const errorCode = typeof body?.errorCode === "string" && body.errorCode.trim() ? body.errorCode.trim() : "WORKER_ERROR";
    const errorMessage = typeof body?.errorMessage === "string" && body.errorMessage.trim() ? body.errorMessage.trim() : "Teamship browser worker failed.";

    const failed = await failTeamshipBrowserJob(jobId, workerId, tenantSlug, errorCode, errorMessage);
    if (!failed) {
      return NextResponse.json({ error: "Teamship browser job was not claimable by this worker." }, { status: 409 });
    }

    return NextResponse.json({ data: { failed: true } });
  } catch (error) {
    const status = error instanceof TeamshipBrowserWorkerAuthError ? error.status : 500;
    return NextResponse.json(
      { error: status === 500 ? "Unable to fail Teamship browser job." : error instanceof Error ? error.message : "Unable to fail Teamship browser job." },
      { status }
    );
  }
}
