import { PlatformRole } from "@prisma/client";
import { NextResponse } from "next/server";

import {
  GARLAND_EMAIL_SYNC_TRIGGER_SCHEDULED,
  syncGarlandEmailIntake
} from "@/modules/shipment-documents/garland-email-intake";
import { authenticateIngestionRequest, IngestionAuthError } from "@/server/ingestion-auth";
import type { AuthenticatedContext } from "@/server/tenant-context";

type ScheduledEmailIntakeRequest = {
  mailboxAddress?: string;
  lookbackDays?: number;
  maxMessagesPerMailbox?: number;
};

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const tenant = await authenticateIngestionRequest(request);
    const body = (await request.json().catch(() => null)) as ScheduledEmailIntakeRequest | null;
    const context: AuthenticatedContext = {
      ...tenant,
      userId: "system:garland-email-intake",
      userEmail: "garland-email-intake@newl.internal",
      userName: "Garland Email Intake Scheduler",
      role: PlatformRole.ADMIN
    };

    const sync = await syncGarlandEmailIntake(context, {
      tenantId: tenant.tenantId,
      userId: null,
      mailboxAddress: body?.mailboxAddress,
      lookbackDays: body?.lookbackDays,
      maxMessagesPerMailbox: body?.maxMessagesPerMailbox,
      triggerSource: GARLAND_EMAIL_SYNC_TRIGGER_SCHEDULED
    });

    return NextResponse.json({
      data: {
        tenant: {
          slug: tenant.tenantSlug,
          name: tenant.tenantName
        },
        sync: {
          runId: sync.run.id,
          status: sync.run.status,
          mailboxAddress: sync.run.mailboxAddress,
          triggerSource: sync.run.triggerSource,
          messageCount: sync.messageCount,
          candidateMessageCount: sync.candidateMessageCount,
          storedEmailCount: sync.storedCount,
          createdEmailCount: sync.createdCount,
          updatedEmailCount: sync.updatedCount,
          attachmentCount: sync.attachmentsFetched,
          storedAttachmentCount: sync.attachmentsStored,
          duplicateAttachmentCount: sync.duplicateAttachmentCount,
          attachmentErrors: sync.attachmentErrors,
          failures: sync.failures
        }
      }
    });
  } catch (error) {
    if (error instanceof IngestionAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    const message = error instanceof Error ? error.message : "Unable to run scheduled Garland email intake.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
