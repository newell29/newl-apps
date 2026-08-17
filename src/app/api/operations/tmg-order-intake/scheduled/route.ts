import { PlatformRole } from "@prisma/client";
import { NextResponse } from "next/server";

import { syncTmgEmailIntake, TMG_EMAIL_TRIGGER_SCHEDULED } from "@/modules/shipment-documents/tmg-email-intake";
import { authenticateIngestionRequest, IngestionAuthError } from "@/server/ingestion-auth";
import type { AuthenticatedContext } from "@/server/tenant-context";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(request: Request) {
  try {
    const tenant = await authenticateIngestionRequest(request);
    const context: AuthenticatedContext = {
      ...tenant,
      userId: "system:tmg-email-intake",
      userEmail: "tmg-email-intake@newl.internal",
      userName: "TMG Email Intake Scheduler",
      role: PlatformRole.ADMIN
    };
    return NextResponse.json({ data: await syncTmgEmailIntake(context, { triggerSource: TMG_EMAIL_TRIGGER_SCHEDULED }) });
  } catch (error) {
    const status = error instanceof IngestionAuthError ? error.status : 502;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to run scheduled TMG email intake." }, { status });
  }
}
