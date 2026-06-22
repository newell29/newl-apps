import { NextResponse } from "next/server";
import { JobStatus, ModuleKey } from "@prisma/client";
import { getUpsQuote, UpsRateLimitError } from "@/server/integrations/ups";
import { requireModule } from "@/server/auth/authorization";
import { getAuthenticatedContext } from "@/server/tenant-context";
import { getUpsToolsShell } from "@/modules/ups-tools/queries";
import { inferCountryFromPostalCode } from "@/modules/ups-tools/engine";
import { createUpsBulkQuoteJob } from "@/modules/ups-tools/bulk-jobs";
import type { QuoteRequest, QuoteResult, UpsInputRow, UpsServiceName } from "@/modules/ups-tools/types";
import { getShipmentReference } from "@/modules/ups-tools/upload";

export const dynamic = "force-dynamic";
const UPS_BULK_ROW_CHUNK_SIZE = 25;
const UPS_BULK_REQUEST_CONCURRENCY = 4;
const UPS_BULK_CHUNK_DELAY_MS = 400;

export async function POST(request: Request) {
  let context:
    | Awaited<ReturnType<typeof getAuthenticatedContext>>
    | null = null;
  let shell:
    | Awaited<ReturnType<typeof getUpsToolsShell>>
    | null = null;
  let body: {
    name?: string;
    accountIds?: string[];
    services?: UpsServiceName[];
    isResidential?: boolean;
    rows?: UpsInputRow[];
  } | null = null;
  let selectedAccounts: Awaited<ReturnType<typeof getUpsToolsShell>>["accounts"] = [];
  const quotes: QuoteResult[] = [];

  try {
    context = await getAuthenticatedContext();
    await requireModule(context, ModuleKey.UPS_TOOLS);
    shell = await getUpsToolsShell(context);
    body = (await request.json()) as {
      name?: string;
      accountIds?: string[];
      services?: UpsServiceName[];
      isResidential?: boolean;
      rows?: UpsInputRow[];
    };

    const accountIds = body.accountIds ?? [];
    const services = body.services ?? [];
    const rows = body.rows ?? [];
    const isResidential = Boolean(body.isResidential);
    selectedAccounts = shell.accounts.filter((account) => accountIds.includes(account.id));

    if (selectedAccounts.length === 0) {
      return NextResponse.json({ error: "Select at least one account." }, { status: 400 });
    }

    if (services.length === 0) {
      return NextResponse.json({ error: "Select at least one service." }, { status: 400 });
    }

    if (rows.length === 0) {
      return NextResponse.json({ error: "Upload or load shipment rows first." }, { status: 400 });
    }

    const validRows = rows.filter((row) => {
      const destinationPostalCode = (row.DestinationZIP ?? "").trim();
      const weight = Number.parseFloat(row.Weight ?? "0");
      return destinationPostalCode.length > 0 && !Number.isNaN(weight);
    });

    if (validRows.length === 0) {
      return NextResponse.json({ error: "No valid shipment rows were found in the upload." }, { status: 400 });
    }

    const chunkCount = Math.ceil(validRows.length / UPS_BULK_ROW_CHUNK_SIZE);

    for (const account of selectedAccounts) {
      for (let start = 0; start < validRows.length; start += UPS_BULK_ROW_CHUNK_SIZE) {
        const chunk = validRows.slice(start, start + UPS_BULK_ROW_CHUNK_SIZE);
        const chunkRequests = chunk.flatMap((row) =>
          services.map((service) => ({
            row,
            service
          }))
        );

        await mapWithConcurrency(chunkRequests, UPS_BULK_REQUEST_CONCURRENCY, async ({ row, service }) => {
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

          quotes.push(await getUpsQuote(account, quoteRequest));
        });

        const hasAnotherChunk = start + UPS_BULK_ROW_CHUNK_SIZE < validRows.length;
        if (hasAnotherChunk) {
          await sleep(UPS_BULK_CHUNK_DELAY_MS);
        }
      }
    }

    const job = await createUpsBulkQuoteJob(
      {
        tenantId: context.tenantId,
        userId: context.userId
      },
      {
        name: body.name,
        accounts: selectedAccounts,
        services,
        rows,
        isResidential,
        results: quotes
      }
    );

    return NextResponse.json({
      data: quotes,
      job,
      batching: {
        validRowCount: validRows.length,
        chunkSize: UPS_BULK_ROW_CHUNK_SIZE,
        chunkCount,
        requestConcurrency: UPS_BULK_REQUEST_CONCURRENCY
      }
    });
  } catch (error) {
    console.error(error);

    if (error instanceof UpsRateLimitError && context && body) {
      const job = await createUpsBulkQuoteJob(
        {
          tenantId: context.tenantId,
          userId: context.userId
        },
        {
          name: body.name,
          accounts: selectedAccounts,
          services: body.services ?? [],
          rows: body.rows ?? [],
          isResidential: Boolean(body.isResidential),
          results: quotes,
          status: JobStatus.ERROR,
          errorMessage: error.message
        }
      );

      return NextResponse.json(
        {
          error: `${error.message} The run has been saved so you can reopen it after splitting the file or retrying later.`,
          job,
          partialCount: quotes.length
        },
        { status: 429 }
      );
    }

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unexpected UPS quote error."
      },
      { status: 500 }
    );
  }
}

function sleep(timeoutMs: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, timeoutMs);
  });
}

async function mapWithConcurrency<T>(
  values: T[],
  concurrency: number,
  worker: (value: T, index: number) => Promise<void>
) {
  let nextIndex = 0;

  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, async () => {
      while (nextIndex < values.length) {
        const currentIndex = nextIndex;
        nextIndex += 1;
        await worker(values[currentIndex], currentIndex);
      }
    })
  );
}
