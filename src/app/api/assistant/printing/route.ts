import { NextResponse } from "next/server";

import {
  approveTeamshipPrintPlan,
  createTeamshipPrintPlan,
  getTeamshipPrintJobForEmployee,
  TeamshipPrintJobError
} from "@/modules/teamship/print-jobs";
import { AuthorizationError } from "@/server/auth/authorization";
import { authenticateOpenClawPrintRequest, OpenClawPrintAuthError } from "@/server/openclaw-print-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(request: Request) {
  try {
    const context = await authenticateOpenClawPrintRequest(request);
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    const action = typeof body?.action === "string" ? body.action.trim().toLowerCase() : "";
    if (action === "plan") {
      return NextResponse.json({
        data: await createTeamshipPrintPlan(context, {
          shippingOrderNumber: typeof body?.shippingOrderNumber === "string" ? body.shippingOrderNumber : "",
          requestKey: typeof body?.requestKey === "string" ? body.requestKey : ""
        })
      }, { status: 201 });
    }
    if (action === "approve") {
      return NextResponse.json({
        data: await approveTeamshipPrintPlan(
          context,
          typeof body?.jobId === "string" ? body.jobId : "",
          body?.confirmed === true
        )
      });
    }
    if (action === "status") {
      return NextResponse.json({
        data: await getTeamshipPrintJobForEmployee(context, typeof body?.jobId === "string" ? body.jobId : "")
      });
    }
    throw new TeamshipPrintJobError("Unsupported print action.");
  } catch (error) {
    const known = error instanceof TeamshipPrintJobError || error instanceof OpenClawPrintAuthError || error instanceof AuthorizationError;
    const status = known && "status" in error ? error.status : 500;
    return NextResponse.json(
      { error: status === 500 ? "The Teamship print request failed." : error instanceof Error ? error.message : "Print request failed." },
      { status }
    );
  }
}
