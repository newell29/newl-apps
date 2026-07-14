import { ModuleKey } from "@prisma/client";
import { NextResponse } from "next/server";

import { listGarlandEmailIntake, syncGarlandEmailIntake } from "@/modules/shipment-documents/garland-email-intake";
import { requireModule, requireMutationAccess } from "@/server/auth/authorization";
import { getAuthenticatedContext } from "@/server/tenant-context";

type EmailIntakeSyncRequest = {
  mailboxAddress?: string;
  lookbackDays?: number;
  maxMessagesPerMailbox?: number;
};

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const context = await getAuthenticatedContext();
  await requireModule(context, ModuleKey.SHIPMENT_DOCUMENTS);

  const requestUrl = new URL(request.url);
  const search = requestUrl.searchParams.get("search");
  const limit = Number.parseInt(requestUrl.searchParams.get("limit") ?? "25", 10);
  const result = await listGarlandEmailIntake(context.tenantId, { search, limit });

  return NextResponse.json({
    groups: result.groups.map(serializeEmailGroup),
    emails: result.emails.map(serializeEmail),
    totalCount: result.totalCount,
    rawEmailCount: result.rawEmailCount,
    latestRun: result.latestRun
      ? {
          ...result.latestRun,
          startedAt: result.latestRun.startedAt.toISOString(),
          finishedAt: result.latestRun.finishedAt?.toISOString() ?? null
        }
      : null
  });
}

export async function POST(request: Request) {
  const context = await getAuthenticatedContext();
  await requireModule(context, ModuleKey.SHIPMENT_DOCUMENTS);
  await requireMutationAccess(context);

  const body = (await request.json().catch(() => null)) as EmailIntakeSyncRequest | null;

  try {
    const sync = await syncGarlandEmailIntake(context, {
      tenantId: context.tenantId,
      userId: context.userId,
      mailboxAddress: body?.mailboxAddress,
      lookbackDays: body?.lookbackDays,
      maxMessagesPerMailbox: body?.maxMessagesPerMailbox
    });
    const list = await listGarlandEmailIntake(context.tenantId, { limit: 25 });

    return NextResponse.json({
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
      groups: list.groups.map(serializeEmailGroup),
      emails: list.emails.map(serializeEmail),
      totalCount: list.totalCount,
      rawEmailCount: list.rawEmailCount
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to sync Garland email intake." },
      { status: 502 }
    );
  }
}

function serializeEmailGroup(group: Awaited<ReturnType<typeof listGarlandEmailIntake>>["groups"][number]) {
  return {
    id: group.id,
    batchKey: group.batchKey,
    classification: group.classification,
    emailCount: group.emailCount,
    duplicateCount: group.duplicateCount,
    hasPdfAttachment: group.hasPdfAttachment,
    expectedOrderCount: group.expectedOrderCount,
    expectedPageCount: group.expectedPageCount,
    expectedPsStart: group.expectedPsStart,
    expectedPsEnd: group.expectedPsEnd,
    primaryEmail: serializeEmail(group.primaryEmail),
    emails: group.emails.map(serializeEmail)
  };
}

function serializeEmail(email: Awaited<ReturnType<typeof listGarlandEmailIntake>>["emails"][number]) {
  return {
    id: email.id,
    mailboxAddress: email.mailboxAddress,
    subject: email.subject,
    fromName: email.fromName,
    fromAddress: email.fromAddress,
    receivedAt: email.receivedAt.toISOString(),
    webLink: email.webLink,
    classification: email.classification,
    classificationReason: email.classificationReason,
    candidateScore: email.candidateScore,
    hasPdfAttachment: email.hasPdfAttachment,
    expectedOrderCount: email.expectedOrderCount,
    expectedPageCount: email.expectedPageCount,
    expectedPsStart: email.expectedPsStart,
    expectedPsEnd: email.expectedPsEnd,
    attachments: email.attachments.map((attachment) => ({
      id: attachment.id,
      fileName: attachment.fileName,
      contentType: attachment.contentType,
      sizeBytes: attachment.sizeBytes,
      contentHash: attachment.contentHash,
      intakeStatus: attachment.intakeStatus,
      pageCount: attachment.pageCount,
      createdAt: attachment.createdAt.toISOString()
    }))
  };
}
