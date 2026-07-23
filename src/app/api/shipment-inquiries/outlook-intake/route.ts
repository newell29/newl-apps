import { AuthorizationError } from "@/server/auth/authorization";
import { syncShipmentInquiryOutlookIntakeForUser } from "@/modules/shipment-inquiries/outlook-intake";
import { getAuthenticatedContext } from "@/server/tenant-context";
import { NextResponse } from "next/server";

type ManualIntakeRequest = {
  maxMessagesPerMailbox?: number;
};

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const context = await getAuthenticatedContext();
    const body = (await request.json().catch(() => null)) as ManualIntakeRequest | null;
    const result = await syncShipmentInquiryOutlookIntakeForUser(context, {
      maxMessagesPerMailbox: body?.maxMessagesPerMailbox
    });

    return NextResponse.json({ data: result });
  } catch (error) {
    const status = error instanceof AuthorizationError ? error.status : 502;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to sync Outlook shipment inquiries." },
      { status }
    );
  }
}
