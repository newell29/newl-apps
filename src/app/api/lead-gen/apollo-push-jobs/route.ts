import { ModuleKey } from "@prisma/client";
import { NextResponse } from "next/server";
import {
  getApolloPushJobRecordForTenant,
  getApolloPushJobForTenant,
  getRecentApolloPushJobs,
  parseApolloPushJobInput
} from "@/modules/lead-gen/apollo-push-jobs";
import { reconcileApolloPushJobPendingResults, runApolloPushJob } from "@/modules/lead-gen/actions";
import { requireModule, requireMutationAccess } from "@/server/auth/authorization";
import { getAuthenticatedContext } from "@/server/tenant-context";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const context = await getAuthenticatedContext();
    await requireModule(context, ModuleKey.LEAD_GEN);

    const url = new URL(request.url);
    const jobId = url.searchParams.get("jobId");

    if (jobId) {
      await reconcileApolloPushJobPendingResults({
        tenantId: context.tenantId,
        jobRunId: jobId
      });
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

export async function POST(request: Request) {
  try {
    const context = await getAuthenticatedContext();
    await requireModule(context, ModuleKey.LEAD_GEN);
    await requireMutationAccess(context);

    const payload = (await request.json()) as { jobId?: string };
    const jobId = typeof payload.jobId === "string" ? payload.jobId : "";

    if (!jobId) {
      return NextResponse.json({ error: "jobId is required." }, { status: 400 });
    }

    const job = await getApolloPushJobRecordForTenant(context, jobId);
    if (!job) {
      return NextResponse.json({ error: "Apollo push job not found for this tenant." }, { status: 404 });
    }

    const input = parseApolloPushJobInput(job.input);
    if (!input || input.contactIds.length === 0) {
      return NextResponse.json({ error: "Apollo push job is missing contact input." }, { status: 400 });
    }

    const canStartQueuedJob = job.status === "QUEUED";
    const canResumeStalledRunningJob =
      job.status === "RUNNING" &&
      job.finishedAt === null &&
      job.errorMessage === null &&
      ((typeof job.output === "object" &&
        job.output !== null &&
        !Array.isArray(job.output) &&
        typeof (job.output as { processedContacts?: unknown }).processedContacts === "number" &&
        ((job.output as { processedContacts?: number }).processedContacts ?? 0) === 0) ||
        job.output == null);

    if (!canStartQueuedJob && !canResumeStalledRunningJob) {
      const summary = await getApolloPushJobForTenant(context, jobId);
      return NextResponse.json({ started: false, job: summary });
    }

    await runApolloPushJob({
      tenantId: context.tenantId,
      userId: context.userId,
      jobRunId: job.id,
      contactIds: input.contactIds
    });

    const summary = await getApolloPushJobForTenant(context, jobId);
    return NextResponse.json({ started: true, job: summary });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to start Apollo push job."
      },
      { status: 500 }
    );
  }
}
