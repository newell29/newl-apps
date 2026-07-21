import { NextResponse } from "next/server";

import { claimNextTeamshipBrowserJob } from "@/modules/teamship/browser-read-jobs";
import {
  authenticateTeamshipBrowserWorkerRequest,
  TeamshipBrowserWorkerAuthError
} from "@/server/teamship-browser-worker-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(request: Request) {
  try {
    const { workerId, tenantSlug } = authenticateTeamshipBrowserWorkerRequest(request);
    const job = await claimNextTeamshipBrowserJob(workerId, tenantSlug);
    if (!job) {
      return NextResponse.json({ data: { job: null } });
    }

    return NextResponse.json({
      data: {
        job: {
          id: job.id,
          operation: job.operation,
          input: job.input,
          scope: job.scope,
          credentials: job.credentials
        }
      }
    });
  } catch (error) {
    const status = error instanceof TeamshipBrowserWorkerAuthError ? error.status : 500;
    return NextResponse.json(
      { error: status === 500 ? "Unable to claim Teamship browser job." : error instanceof Error ? error.message : "Unable to claim Teamship browser job." },
      { status }
    );
  }
}
