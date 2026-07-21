import { NextResponse } from "next/server";

import {
  completeTeamshipBrowserJob,
  TeamshipBrowserJobValidationError
} from "@/modules/teamship/browser-read-jobs";
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
    const body = await request.json().catch(() => null) as { result?: unknown } | null;
    if (!body?.result || typeof body.result !== "object") {
      return NextResponse.json({ error: "result is required." }, { status: 400 });
    }

    const completed = await completeTeamshipBrowserJob(jobId, workerId, tenantSlug, body.result);
    if (!completed) {
      return NextResponse.json({ error: "Teamship browser job was not claimable by this worker." }, { status: 409 });
    }

    return NextResponse.json({ data: { completed: true } });
  } catch (error) {
    const status = error instanceof TeamshipBrowserWorkerAuthError
      ? error.status
      : error instanceof TeamshipBrowserJobValidationError
        ? 400
        : 500;
    return NextResponse.json(
      { error: status === 500 ? "Unable to complete Teamship browser job." : error instanceof Error ? error.message : "Unable to complete Teamship browser job." },
      { status }
    );
  }
}
