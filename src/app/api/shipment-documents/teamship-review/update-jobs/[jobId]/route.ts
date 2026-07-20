import { ModuleKey } from "@prisma/client";
import { NextResponse } from "next/server";

import {
  approveTeamshipUpdateJob,
  cancelTeamshipUpdateJob,
  getTeamshipUpdateJobs,
  rescanTeamshipUpdateJob
} from "@/modules/shipment-documents/teamship-update-jobs";
import { requireModule, requireMutationAccess } from "@/server/auth/authorization";
import { getAuthenticatedContext } from "@/server/tenant-context";

export const dynamic = "force-dynamic";

type UpdateJobActionPayload = {
  action?: unknown;
};

export async function PATCH(request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  try {
    const context = await getAuthenticatedContext();
    await requireModule(context, ModuleKey.SHIPMENT_DOCUMENTS);
    await requireMutationAccess(context);
    const { jobId } = await params;
    const body = (await request.json().catch(() => null)) as UpdateJobActionPayload | null;
    const action = typeof body?.action === "string" ? body.action : "";

    if (action === "approve") {
      await approveTeamshipUpdateJob(context, jobId);
    } else if (action === "cancel") {
      await cancelTeamshipUpdateJob(context, jobId);
    } else if (action === "rescan") {
      await rescanTeamshipUpdateJob(context, jobId);
    } else {
      return NextResponse.json({ error: "Unsupported Teamship update job action." }, { status: 400 });
    }

    return NextResponse.json(await getTeamshipUpdateJobs(context));
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to update Teamship update job." },
      { status: 500 }
    );
  }
}
