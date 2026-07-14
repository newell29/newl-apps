import { NextResponse } from "next/server";

import { listGarlandEmailIntake, syncGarlandEmailIntakeForTenant } from "@/modules/shipment-documents/garland-email-intake";
import { authenticateIngestionRequest, IngestionAuthError } from "@/server/ingestion-auth";

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
    const sync = await syncGarlandEmailIntakeForTenant({
      tenantId: tenant.tenantId,
      userId: null,
      mailboxAddress: body?.mailboxAddress,
      lookbackDays: body?.lookbackDays ?? 7,
      maxMessagesPerMailbox: body?.maxMessagesPerMailbox ?? 100,
      triggerSource: "N8N"
    });
    const list = await listGarlandEmailIntake(tenant.tenantId, { limit: 25 });

    return NextResponse.json({
      tenant: {
        slug: tenant.tenantSlug,
        name: tenant.tenantName
      },
      sync: {
        runId: sync.run.id,
        status: sync.run.status,
        mailboxAddress: sync.run.mailboxAddress,
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
      },
      intake: {
        groupedBatchCount: list.totalCount,
        rawEmailCount: list.rawEmailCount,
        latestRun: list.latestRun
          ? {
              id: list.latestRun.id,
              status: list.latestRun.status,
              startedAt: list.latestRun.startedAt.toISOString(),
              finishedAt: list.latestRun.finishedAt?.toISOString() ?? null
            }
          : null
      },
      fetchedAt: new Date().toISOString()
    });
  } catch (error) {
    if (error instanceof IngestionAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to run scheduled Garland email intake." },
      { status: 502 }
    );
  }
}
