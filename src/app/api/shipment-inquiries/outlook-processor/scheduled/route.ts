import { NextResponse } from "next/server";

import {
  processShipmentInquiryOutlookJobs,
  SHIPMENT_INQUIRY_PROCESS_TRIGGER_SCHEDULED
} from "@/modules/shipment-inquiries/outlook-processor";
import { authenticateIngestionRequest, IngestionAuthError } from "@/server/ingestion-auth";

export async function POST(request: Request) {
  try {
    const tenant = await authenticateIngestionRequest(request);
    const body = (await request.json().catch(() => ({}))) as { limit?: number | null };
    const result = await processShipmentInquiryOutlookJobs(
      {
        tenantId: tenant.tenantId,
        tenantSlug: tenant.tenantSlug,
        tenantName: tenant.tenantName,
        userId: "system:shipment-inquiry-outlook-processor"
      },
      {
        limit: body.limit,
        triggerSource: SHIPMENT_INQUIRY_PROCESS_TRIGGER_SCHEDULED
      }
    );

    return NextResponse.json({ data: { tenant: tenant.tenantSlug, ...result } });
  } catch (error) {
    const status = error instanceof IngestionAuthError ? error.status : 502;
    return NextResponse.json(
      {
        error:
          status === 502
            ? "Unable to run scheduled Outlook shipment inquiry processing."
            : error instanceof Error
              ? error.message
              : "Unable to run scheduled Outlook shipment inquiry processing."
      },
      { status }
    );
  }
}
