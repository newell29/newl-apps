import { ModuleKey } from "@prisma/client";
import { NextResponse } from "next/server";
import { exportLtlBulkQuoteJobCsv } from "@/modules/ltl-rate-portal/bulk-jobs";
import { requireModule } from "@/server/auth/authorization";
import { getAuthenticatedContext } from "@/server/tenant-context";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  try {
    const context = await getAuthenticatedContext();
    await requireModule(context, ModuleKey.LTL_RATE_PORTAL);

    const { jobId } = await params;
    const csv = await exportLtlBulkQuoteJobCsv(context, jobId);

    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="ltl_bulk_quote_${jobId}.csv"`
      }
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unexpected LTL bulk export error."
      },
      { status: 500 }
    );
  }
}
