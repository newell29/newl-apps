import { ModuleKey } from "@prisma/client";
import { NextResponse } from "next/server";
import {
  LTL_BULK_LANE_CONCURRENCY,
  LTL_BULK_CHUNK_SIZE,
  createLtlBulkQuoteJob,
  deleteLtlBulkQuoteJob,
  getLtlBulkQuoteJobSummaryForTenant,
  getLtlBulkQuoteJobDetail,
  runLtlBulkQuoteJob
} from "@/modules/ltl-rate-portal/bulk-jobs";
import type { LtlBulkQuoteCreateRequestPayload } from "@/modules/ltl-rate-portal/types";
import { getLtlRatePortalShell } from "@/modules/ltl-rate-portal/queries";
import { requireModule, requireMutationAccess } from "@/server/auth/authorization";
import { getAuthenticatedContext } from "@/server/tenant-context";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const context = await getAuthenticatedContext();
    await requireModule(context, ModuleKey.LTL_RATE_PORTAL);
    await requireMutationAccess(context);

    const shell = await getLtlRatePortalShell(context);
    const body = (await request.json()) as Partial<LtlBulkQuoteCreateRequestPayload>;
    const accountId = typeof body.accountId === "string" ? body.accountId : "";
    const name = typeof body.name === "string" && body.name.trim().length > 0 ? body.name.trim() : undefined;
    const carrierHashes = Array.isArray(body.carrierHashes)
      ? body.carrierHashes.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      : [];
    const rows = Array.isArray(body.rows) ? body.rows : [];

    if (!accountId) {
      return NextResponse.json({ error: "Select a 7L account." }, { status: 400 });
    }

    if (rows.length === 0) {
      return NextResponse.json({ error: "Upload at least one valid lane." }, { status: 400 });
    }

    if (carrierHashes.length === 0) {
      return NextResponse.json({ error: "Select at least one carrier for this pull." }, { status: 400 });
    }

    const account = shell.accounts.find((candidate) => candidate.id === accountId);
    if (!account) {
      return NextResponse.json({ error: "The selected 7L account is not available for this tenant." }, { status: 404 });
    }

    const payload = {
      name,
      accountId,
      carrierHashes,
      rows
    };

    const job = await createLtlBulkQuoteJob(context, account, payload);

    // Fire-and-forget local processor. This uses the same server process today;
    // the DB-backed job shape leaves room for a dedicated worker later.
    queueMicrotask(() => {
      void runLtlBulkQuoteJob(
        {
          tenantId: context.tenantId,
          userId: context.userId
        },
        job.id,
        account,
        payload
      );
    });

    return NextResponse.json(
      {
        job,
        processing: {
          chunkSize: LTL_BULK_CHUNK_SIZE,
          laneConcurrency: LTL_BULK_LANE_CONCURRENCY
        }
      },
      { status: 201 }
    );
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unexpected LTL bulk quote error."
      },
      { status: 500 }
    );
  }
}

export async function GET(request: Request) {
  try {
    const context = await getAuthenticatedContext();
    await requireModule(context, ModuleKey.LTL_RATE_PORTAL);

    const url = new URL(request.url);
    const jobId = url.searchParams.get("jobId");
    const includeLanes = url.searchParams.get("includeLanes") === "1";
    if (!jobId) {
      return NextResponse.json({ error: "jobId is required." }, { status: 400 });
    }

    if (!includeLanes) {
      const job = await getLtlBulkQuoteJobSummaryForTenant(context, jobId);
      return NextResponse.json({ job, lanes: [] });
    }

    const detail = await getLtlBulkQuoteJobDetail(context, jobId);
    return NextResponse.json(detail);
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unexpected LTL bulk quote lookup error."
      },
      { status: 500 }
    );
  }
}

export async function DELETE(request: Request) {
  try {
    const context = await getAuthenticatedContext();
    await requireModule(context, ModuleKey.LTL_RATE_PORTAL);
    await requireMutationAccess(context);

    const url = new URL(request.url);
    const jobId = url.searchParams.get("jobId");
    if (!jobId) {
      return NextResponse.json({ error: "jobId is required." }, { status: 400 });
    }

    const deleted = await deleteLtlBulkQuoteJob(
      {
        tenantId: context.tenantId,
        userId: context.userId
      },
      jobId
    );

    return NextResponse.json({ deleted }, { status: 200 });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unexpected LTL bulk quote delete error."
      },
      { status: 500 }
    );
  }
}
