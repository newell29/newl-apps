import { ModuleKey, Prisma } from "@prisma/client";
import { NextResponse } from "next/server";

import { processGarlandEmailAgentReadyAttachments } from "@/modules/shipment-documents/garland-email-agent-automation";
import { requireModule, requireMutationAccess } from "@/server/auth/authorization";
import { prisma } from "@/server/db";
import { getAuthenticatedContext } from "@/server/tenant-context";

const MANUAL_REVIEW_CONFIRMATION = "RUN_GARLAND_TEAMSHIP_REVIEW";

type ManualReviewRequest = {
  attachmentIds?: unknown;
  expectedPsStart?: unknown;
  expectedPsEnd?: unknown;
  confirmation?: unknown;
};

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(request: Request) {
  try {
    const context = await getAuthenticatedContext();
    await requireModule(context, ModuleKey.SHIPMENT_DOCUMENTS);
    await requireMutationAccess(context);

    const body = (await request.json().catch(() => null)) as ManualReviewRequest | null;
    if (body?.confirmation !== MANUAL_REVIEW_CONFIRMATION) {
      return NextResponse.json(
        { error: "Confirm this exact Garland batch before starting its Teamship review." },
        { status: 400 }
      );
    }

    const attachmentIds = readAttachmentIds(body?.attachmentIds);
    if (attachmentIds.length === 0) {
      return NextResponse.json({ error: "Select at least one Garland PDF attachment to review." }, { status: 400 });
    }

    const expectedPsStart = readOptionalIdentifier(body?.expectedPsStart);
    const expectedPsEnd = readOptionalIdentifier(body?.expectedPsEnd);
    const selectedAttachments = await prisma.garlandSourceAttachment.findMany({
      where: {
        tenantId: context.tenantId,
        id: { in: attachmentIds }
      },
      select: {
        id: true,
        sourceEmail: {
          select: {
            expectedPsStart: true,
            expectedPsEnd: true
          }
        }
      }
    });

    if (selectedAttachments.length !== attachmentIds.length) {
      return NextResponse.json({ error: "One or more selected Garland attachments were not found for this tenant." }, { status: 404 });
    }

    if (Boolean(expectedPsStart) !== Boolean(expectedPsEnd)) {
      return NextResponse.json(
        { error: "The confirmed Garland PS range is incomplete. Refresh Email Intake before retrying." },
        { status: 400 }
      );
    }

    if (
      expectedPsStart &&
      expectedPsEnd &&
      !selectedAttachments.every(
        (attachment) =>
          attachment.sourceEmail.expectedPsStart === expectedPsStart &&
          attachment.sourceEmail.expectedPsEnd === expectedPsEnd
      )
    ) {
      return NextResponse.json(
        { error: "The selected attachment no longer matches the confirmed Garland PS range. Refresh Email Intake before retrying." },
        { status: 409 }
      );
    }

    await writeAudit({
      tenantId: context.tenantId,
      actorUserId: context.userId,
      action: "garland.email-intake.manual-review-requested",
      attachmentIds,
      expectedPsStart,
      expectedPsEnd
    });

    const automation = await processGarlandEmailAgentReadyAttachments(context, {
      attachmentIds,
      maxAttachments: attachmentIds.length
    });

    await writeAudit({
      tenantId: context.tenantId,
      actorUserId: context.userId,
      action: "garland.email-intake.manual-review-finished",
      attachmentIds,
      expectedPsStart,
      expectedPsEnd,
      result: automation
    });

    return NextResponse.json({ data: automation });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to start this Garland Teamship review." },
      { status: 500 }
    );
  }
}

function readAttachmentIds(value: unknown) {
  if (!Array.isArray(value)) return [];

  return [...new Set(value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean))].slice(
    0,
    25
  );
}

function readOptionalIdentifier(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim().toUpperCase() : null;
}

async function writeAudit(input: {
  tenantId: string;
  actorUserId: string;
  action: string;
  attachmentIds: string[];
  expectedPsStart: string | null;
  expectedPsEnd: string | null;
  result?: Awaited<ReturnType<typeof processGarlandEmailAgentReadyAttachments>>;
}) {
  await prisma.auditLog.create({
    data: {
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      action: input.action,
      entityType: "GarlandSourceAttachmentBatch",
      entityId: input.attachmentIds[0] ?? null,
      after: {
        attachmentIds: input.attachmentIds,
        expectedPsStart: input.expectedPsStart,
        expectedPsEnd: input.expectedPsEnd,
        ...(input.result
          ? {
              processedAttachmentCount: input.result.processedAttachmentCount,
              createdReviewRunIds: input.result.createdReviewRunIds,
              createdUpdateJobIds: input.result.createdUpdateJobIds,
              approvedUpdateJobIds: input.result.approvedUpdateJobIds,
              deferredAllMissingAttachmentCount: input.result.deferredAllMissingAttachmentCount,
              failedAttachmentCount: input.result.failedAttachmentCount
            }
          : {})
      } satisfies Prisma.InputJsonValue
    }
  });
}
