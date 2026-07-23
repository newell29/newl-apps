import { NextResponse } from "next/server";

import {
  processShipmentInquiryOutlookJobsForUser,
  SHIPMENT_INQUIRY_PROCESS_TRIGGER_MANUAL
} from "@/modules/shipment-inquiries/outlook-processor";
import { AuthorizationError } from "@/server/auth/authorization";
import { getAuthenticatedContext } from "@/server/tenant-context";

export async function POST(request: Request) {
  try {
    const context = await getAuthenticatedContext();
    const body = (await request.json().catch(() => ({}))) as { limit?: number | null };
    const result = await processShipmentInquiryOutlookJobsForUser(context, {
      limit: body.limit,
      triggerSource: SHIPMENT_INQUIRY_PROCESS_TRIGGER_MANUAL
    });

    return NextResponse.json({ data: result });
  } catch (error) {
    const status = error instanceof AuthorizationError ? error.status : 502;
    return NextResponse.json(
      {
        error:
          status === 502
            ? "Unable to process Outlook shipment inquiry jobs."
            : error instanceof Error
              ? error.message
              : "Unable to process Outlook shipment inquiry jobs."
      },
      { status }
    );
  }
}
