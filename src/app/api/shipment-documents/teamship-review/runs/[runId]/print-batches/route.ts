import { NextResponse } from "next/server";

import {
  approveTeamshipPrintBatch,
  createTeamshipPrintBatchPlan,
  getTeamshipPrintBatch,
  TeamshipPrintBatchError
} from "@/modules/teamship/print-batches";
import { TeamshipPrintJobError } from "@/modules/teamship/print-jobs";
import { getAuthenticatedContext } from "@/server/tenant-context";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ runId: string }> }) {
  try {
    const context = await getAuthenticatedContext();
    const { runId } = await params;
    const batchId = new URL(request.url).searchParams.get("batchId") ?? "";
    const batch = await getTeamshipPrintBatch(context, batchId);
    if (batch.reviewRunId !== runId) {
      return NextResponse.json({ error: "The print batch does not belong to this saved review." }, { status: 404 });
    }
    return NextResponse.json({ batch });
  } catch (error) {
    return printBatchErrorResponse(error, "Unable to load the print batch.");
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ runId: string }> }) {
  try {
    const context = await getAuthenticatedContext();
    const { runId } = await params;
    const body = (await request.json().catch(() => null)) as {
      selections?: Array<{ orderId?: unknown; manualCorrectionConfirmed?: unknown }>;
      requestKey?: unknown;
    } | null;
    const batch = await createTeamshipPrintBatchPlan(context, {
      runId,
      selections: Array.isArray(body?.selections)
        ? body.selections.map((selection) => ({
            orderId: typeof selection.orderId === "string" ? selection.orderId : "",
            manualCorrectionConfirmed: selection.manualCorrectionConfirmed === true
          }))
        : [],
      requestKey: typeof body?.requestKey === "string" ? body.requestKey : ""
    });
    return NextResponse.json({ batch }, { status: 201 });
  } catch (error) {
    return printBatchErrorResponse(error, "Unable to prepare the print batch.");
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ runId: string }> }) {
  try {
    const context = await getAuthenticatedContext();
    const { runId } = await params;
    const body = (await request.json().catch(() => null)) as {
      action?: unknown;
      batchId?: unknown;
      confirmed?: unknown;
    } | null;
    if (body?.action !== "approve") {
      return NextResponse.json({ error: "Unsupported print batch action." }, { status: 400 });
    }
    const batch = await approveTeamshipPrintBatch(context, {
      batchId: typeof body.batchId === "string" ? body.batchId : "",
      runId,
      confirmed: body.confirmed === true
    });
    return NextResponse.json({ batch });
  } catch (error) {
    return printBatchErrorResponse(error, "Unable to approve the print batch.");
  }
}

function printBatchErrorResponse(error: unknown, fallback: string) {
  console.error(error);
  const status = error instanceof TeamshipPrintBatchError || error instanceof TeamshipPrintJobError
    ? error.status
    : 500;
  return NextResponse.json(
    { error: error instanceof Error ? error.message : fallback },
    { status }
  );
}
