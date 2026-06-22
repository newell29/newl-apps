import { NextResponse } from "next/server";
import { JobStatus, ModuleKey } from "@prisma/client";
import {
  createUpsBulkQuoteJob,
  deleteUpsBulkQuoteJob,
  getRecentUpsBulkQuoteJobs,
  getUpsBulkQuoteJobDetail,
  getUpsBulkQuoteJobSummaryForTenant,
  runUpsBulkQuoteJob
} from "@/modules/ups-tools/bulk-jobs";
import { inferCountryFromPostalCode } from "@/modules/ups-tools/engine";
import { getUpsToolsShell } from "@/modules/ups-tools/queries";
import type { QuoteRequest, UpsInputRow, UpsServiceName } from "@/modules/ups-tools/types";
import { getShipmentReference } from "@/modules/ups-tools/upload";
import { getUpsQuote } from "@/server/integrations/ups";
import { requireModule, requireMutationAccess } from "@/server/auth/authorization";
import { getAuthenticatedContext } from "@/server/tenant-context";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const context = await getAuthenticatedContext();
    await requireModule(context, ModuleKey.UPS_TOOLS);
    requireMutationAccess(context);

    const shell = await getUpsToolsShell(context);
    const body = (await request.json()) as {
      name?: string;
      accountIds?: string[];
      services?: UpsServiceName[];
      isResidential?: boolean;
      rows?: UpsInputRow[];
    };

    const accountIds = Array.isArray(body.accountIds) ? body.accountIds : [];
    const services = Array.isArray(body.services) ? body.services : [];
    const rows = Array.isArray(body.rows) ? body.rows : [];
    const selectedAccounts = shell.accounts.filter((account) => accountIds.includes(account.id));
    const validRows = rows.filter((row) => {
      const destinationPostalCode = (row.DestinationZIP ?? "").trim();
      const weight = Number.parseFloat(row.Weight ?? "0");
      return destinationPostalCode.length > 0 && !Number.isNaN(weight);
    });

    if (selectedAccounts.length === 0) {
      return NextResponse.json({ error: "Select at least one account." }, { status: 400 });
    }

    if (services.length === 0) {
      return NextResponse.json({ error: "Select at least one service." }, { status: 400 });
    }

    if (rows.length === 0) {
      return NextResponse.json({ error: "Upload or load shipment rows first." }, { status: 400 });
    }

    if (validRows.length === 0) {
      return NextResponse.json({ error: "No valid shipment rows were found in the upload." }, { status: 400 });
    }

    const job = await createUpsBulkQuoteJob(context, {
      name: body.name,
      accounts: selectedAccounts,
      services,
      rows,
      isResidential: Boolean(body.isResidential),
      results: [],
      rowCount: validRows.length,
      processedRequestCount: 0,
      status: JobStatus.QUEUED
    });

    queueMicrotask(() => {
      void runUpsBulkQuoteJob(
        {
          tenantId: context.tenantId,
          userId: context.userId
        },
        job.id,
        {
          accounts: selectedAccounts,
          services,
          rows,
          isResidential: Boolean(body.isResidential)
        },
        async (account, row, service, isResidential) => {
          const destinationPostalCode = (row.DestinationZIP ?? "").trim();
          const originPostalCode = (row.OriginZIP ?? account.originPostalCode).trim();
          const weight = Number.parseFloat(row.Weight ?? "0");
          const length = Number.parseFloat(row.Length ?? "0") || 0;
          const width = Number.parseFloat(row.Width ?? "0") || 0;
          const height = Number.parseFloat(row.Height ?? "0") || 0;

          const quoteRequest: QuoteRequest = {
            shipmentReference: getShipmentReference(row),
            originPostalCode,
            originCountryCode: inferCountryFromPostalCode(originPostalCode),
            destinationPostalCode,
            destinationCountryCode: inferCountryFromPostalCode(destinationPostalCode),
            weight,
            length,
            width,
            height,
            service,
            isResidential
          };

          return getUpsQuote(account, quoteRequest);
        }
      );
    });

    return NextResponse.json({ job }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to start UPS bulk quote job."
      },
      { status: 500 }
    );
  }
}

export async function GET(request: Request) {
  try {
    const context = await getAuthenticatedContext();
    await requireModule(context, ModuleKey.UPS_TOOLS);
    const { searchParams } = new URL(request.url);
    const jobId = searchParams.get("jobId");
    const includeResults = searchParams.get("includeResults") === "1";

    if (jobId) {
      if (!includeResults) {
        const job = await getUpsBulkQuoteJobSummaryForTenant(context, jobId);
        return NextResponse.json({ job });
      }

      const detail = await getUpsBulkQuoteJobDetail(context, jobId);
      return NextResponse.json(detail);
    }

    const jobs = await getRecentUpsBulkQuoteJobs(context);
    return NextResponse.json({ jobs });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to load UPS bulk quote jobs."
      },
      { status: 500 }
    );
  }
}

export async function DELETE(request: Request) {
  try {
    const context = await getAuthenticatedContext();
    await requireModule(context, ModuleKey.UPS_TOOLS);
    requireMutationAccess(context);

    const { searchParams } = new URL(request.url);
    const jobId = searchParams.get("jobId");
    if (!jobId) {
      return NextResponse.json({ error: "jobId is required." }, { status: 400 });
    }

    await deleteUpsBulkQuoteJob(
      {
        tenantId: context.tenantId,
        userId: context.userId
      },
      jobId
    );

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to delete UPS bulk quote job."
      },
      { status: 500 }
    );
  }
}
