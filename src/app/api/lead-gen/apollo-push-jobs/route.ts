import { ModuleKey } from "@prisma/client";
import { NextResponse } from "next/server";
import {
  getApolloPushJobForTenant,
  getRecentApolloPushJobs
} from "@/modules/lead-gen/apollo-push-jobs";
import { requireModule } from "@/server/auth/authorization";
import { getAuthenticatedContext } from "@/server/tenant-context";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const context = await getAuthenticatedContext();
    await requireModule(context, ModuleKey.LEAD_GEN);

    const url = new URL(request.url);
    const jobId = url.searchParams.get("jobId");

    if (jobId) {
      const job = await getApolloPushJobForTenant(context, jobId);
      return NextResponse.json({ job });
    }

    const jobs = await getRecentApolloPushJobs(context);
    return NextResponse.json({ jobs });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to load Apollo push jobs."
      },
      { status: 500 }
    );
  }
}
