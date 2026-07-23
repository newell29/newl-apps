import { PlatformRole } from "@prisma/client";
import { NextResponse } from "next/server";

import {
  SHIPMENT_INQUIRY_SYNC_TRIGGER_SCHEDULED,
  syncShipmentInquiryOutlookIntake
} from "@/modules/shipment-inquiries/outlook-intake";
import { authenticateIngestionRequest, IngestionAuthError } from "@/server/ingestion-auth";
import type { AuthenticatedContext } from "@/server/tenant-context";

type ScheduledIntakeRequest = {
  maxMessagesPerMailbox?: number;
};

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const tenant = await authenticateIngestionRequest(request);
    const body = (await request.json().catch(() => null)) as ScheduledIntakeRequest | null;
    const context: AuthenticatedContext = {
      ...tenant,
      userId: "system:shipment-inquiry-outlook-intake",
      userEmail: "shipment-inquiry-outlook-intake@newl.internal",
      userName: "Shipment Inquiry Outlook Intake Scheduler",
      role: PlatformRole.ADMIN
    };
    const result = await syncShipmentInquiryOutlookIntake(context, {
      maxMessagesPerMailbox: body?.maxMessagesPerMailbox,
      triggerSource: SHIPMENT_INQUIRY_SYNC_TRIGGER_SCHEDULED
    });

    return NextResponse.json({
      data: {
        tenant: {
          slug: tenant.tenantSlug,
          name: tenant.tenantName
        },
        ...result
      }
    });
  } catch (error) {
    if (error instanceof IngestionAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to run scheduled Outlook shipment inquiry intake." },
      { status: 502 }
    );
  }
}
