import { ModuleKey } from "@prisma/client";
import { NextResponse } from "next/server";

import {
  buildGarlandCsrAgentReport,
  sendGarlandCsrAgentReportEmail
} from "@/modules/shipment-documents/teamship-csr-agent-report";
import { requireModule, requireMutationAccess } from "@/server/auth/authorization";
import { getAuthenticatedContext } from "@/server/tenant-context";

export const dynamic = "force-dynamic";

type ReportEmailRequestBody = {
  to?: string | string[];
};

export async function GET(_request: Request, { params }: { params: Promise<{ runId: string }> }) {
  try {
    const context = await getAuthenticatedContext();
    await requireModule(context, ModuleKey.SHIPMENT_DOCUMENTS);
    const { runId } = await params;
    const report = await buildGarlandCsrAgentReport(context, runId);

    return NextResponse.json({ report });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to build Garland CSR agent report." },
      { status: 500 }
    );
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ runId: string }> }) {
  try {
    const context = await getAuthenticatedContext();
    await requireModule(context, ModuleKey.SHIPMENT_DOCUMENTS);
    requireMutationAccess(context);
    const { runId } = await params;
    const body = (await request.json().catch(() => null)) as ReportEmailRequestBody | null;
    const { report, email } = await sendGarlandCsrAgentReportEmail(context, runId, { to: body?.to });

    return NextResponse.json({ report, email });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to email Garland CSR agent report." },
      { status: 500 }
    );
  }
}
