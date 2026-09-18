import { PlatformRole } from "@prisma/client";
import { NextResponse } from "next/server";

import {
  getWebsiteInboundMailboxConfiguration,
  syncWebsiteInboundCorrespondence
} from "@/modules/website-inbound/correspondence";
import {
  authenticateIngestionCronRequest,
  IngestionAuthError
} from "@/server/ingestion-auth";
import type { AuthenticatedContext } from "@/server/tenant-context";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request) {
  try {
    const tenant = await authenticateIngestionCronRequest(request);
    const context: AuthenticatedContext = {
      ...tenant,
      userId: "system:website-inbound-correspondence",
      userEmail: "website-inbound-correspondence@newl.internal",
      userName: "Inbound Correspondence Scheduler",
      role: PlatformRole.ADMIN
    };
    const configuration = await getWebsiteInboundMailboxConfiguration(tenant.tenantId);
    if (!configuration.enabled) {
      return NextResponse.json({
        data: { skipped: true, reason: configuration.reason },
        note: "Inbound correspondence is not enabled for this tenant."
      });
    }
    return NextResponse.json({
      data: await syncWebsiteInboundCorrespondence(context, { trigger: "scheduled" }),
      note: "Mailbox correspondence was synchronized. No customer email was sent."
    });
  } catch (error) {
    const status = error instanceof IngestionAuthError ? error.status : 502;
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to synchronize inbound correspondence."
      },
      { status }
    );
  }
}
