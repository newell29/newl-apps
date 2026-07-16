import { ModuleKey, Prisma } from "@prisma/client";

import { getGarlandGraphSettings } from "@/modules/shipment-documents/garland-email-intake";
import { extractGarlandShippingOrdersFromPdfBytes } from "@/modules/shipment-documents/garland-pdf-server-extraction";
import { getGarlandLearnedProductDimensionRecommendations } from "@/modules/shipment-documents/garland-product-dimension-directory";
import { collectGarlandProductDimensionSkus } from "@/modules/shipment-documents/garland-product-dimensions";
import { buildTeamshipPhase2DryRunPlan } from "@/modules/shipment-documents/teamship-phase2-dry-run";
import { buildGarlandTeamshipReview } from "@/modules/shipment-documents/teamship-review";
import { saveTeamshipReviewRun } from "@/modules/shipment-documents/teamship-review-history";
import { approveTeamshipUpdateJob, createTeamshipUpdateJob } from "@/modules/shipment-documents/teamship-update-jobs";
import { requireModule, requireMutationAccess } from "@/server/auth/authorization";
import { prisma } from "@/server/db";
import { getMicrosoftGraphApplicationAccessToken } from "@/server/integrations/microsoft-graph-application";
import { fetchMicrosoftGraphMessageAttachmentContent } from "@/server/integrations/microsoft-graph-mail";
import { fetchTeamshipShippingOrdersForReview } from "@/server/integrations/teamship";
import type { AuthenticatedContext } from "@/server/tenant-context";

const READY_ATTACHMENT_STATUSES = ["PDF_METADATA_READY", "PDF_PARSE_FAILED"] as const;
const DEFAULT_MAX_ATTACHMENTS = 8;

export type GarlandEmailAgentAutomationResult = {
  processedAttachmentCount: number;
  parsedAttachmentCount: number;
  duplicateAttachmentCount: number;
  failedAttachmentCount: number;
  createdReviewRunIds: string[];
  createdUpdateJobIds: string[];
  approvedUpdateJobIds: string[];
  skippedReasons: string[];
};

type GarlandAttachmentForProcessing = Prisma.GarlandSourceAttachmentGetPayload<{
  include: {
    sourceEmail: {
      select: {
        id: true;
        mailboxAddress: true;
        graphMessageId: true;
        subject: true;
        receivedAt: true;
      };
    };
  };
}>;

export async function processGarlandEmailAgentReadyAttachments(
  context: AuthenticatedContext,
  options: { maxAttachments?: number | null } = {}
): Promise<GarlandEmailAgentAutomationResult> {
  await requireModule(context, ModuleKey.SHIPMENT_DOCUMENTS);
  await requireMutationAccess(context);

  const maxAttachments = Math.min(25, Math.max(1, options.maxAttachments ?? DEFAULT_MAX_ATTACHMENTS));
  const settings = await getGarlandGraphSettings(context.tenantId);
  if (!settings.mailSyncEnabled || !settings.crossMailboxReady) {
    return emptyResult([settings.runtimeNotes || "Microsoft Graph mail sync is not ready."]);
  }

  const attachments = await prisma.garlandSourceAttachment.findMany({
    where: {
      tenantId: context.tenantId,
      intakeStatus: { in: [...READY_ATTACHMENT_STATUSES] },
      sourceEmail: {
        is: {
          classification: { in: ["GARLAND_DOCUMENT_BATCH", "GARLAND_DOCUMENT_CORRECTION"] }
        }
      }
    },
    orderBy: [{ createdAt: "asc" }],
    take: maxAttachments,
    include: {
      sourceEmail: {
        select: {
          id: true,
          mailboxAddress: true,
          graphMessageId: true,
          subject: true,
          receivedAt: true
        }
      }
    }
  });

  if (attachments.length === 0) {
    return emptyResult(["No Garland PDF attachments are waiting for automated processing."]);
  }

  const accessToken = await getMicrosoftGraphApplicationAccessToken();
  const result: GarlandEmailAgentAutomationResult = {
    processedAttachmentCount: 0,
    parsedAttachmentCount: 0,
    duplicateAttachmentCount: 0,
    failedAttachmentCount: 0,
    createdReviewRunIds: [],
    createdUpdateJobIds: [],
    approvedUpdateJobIds: [],
    skippedReasons: []
  };

  for (const attachment of attachments) {
    result.processedAttachmentCount += 1;

    try {
      const attachmentContent = await fetchMicrosoftGraphMessageAttachmentContent(
        accessToken,
        attachment.sourceEmail.mailboxAddress,
        attachment.sourceEmail.graphMessageId,
        attachment.graphAttachmentId
      );
      const contentBytes = attachmentContent.contentBytes;

      if (!contentBytes) {
        throw new Error("Microsoft Graph did not return attachment content bytes for this PDF.");
      }

      const fileBytes = new Uint8Array(Buffer.from(contentBytes, "base64"));
      const extraction = await extractGarlandShippingOrdersFromPdfBytes(fileBytes);
      const duplicateAttachment = await findDuplicateParsedAttachment({
        tenantId: context.tenantId,
        attachmentId: attachment.id,
        contentHash: extraction.contentHash
      });

      if (duplicateAttachment) {
        result.duplicateAttachmentCount += 1;
        await prisma.garlandSourceAttachment.update({
          where: { tenantId_id: { tenantId: context.tenantId, id: attachment.id } },
          data: {
            contentHash: extraction.contentHash,
            pageCount: extraction.pageCount,
            extractedPsNumbers: extraction.psNumbers,
            extractedSrNumbers: extraction.srNumbers,
            extractionFingerprint: buildExtractionFingerprint(extraction),
            intakeStatus: "PDF_DUPLICATE",
            duplicateOfAttachmentId: duplicateAttachment.id,
            parseError: null
          }
        });
        continue;
      }

      if (extraction.orders.length === 0) {
        throw new Error("No Garland shipping orders were extracted from this PDF.");
      }

      await prisma.garlandSourceAttachment.update({
        where: { tenantId_id: { tenantId: context.tenantId, id: attachment.id } },
        data: {
          contentHash: extraction.contentHash,
          pageCount: extraction.pageCount,
          extractedPsNumbers: extraction.psNumbers,
          extractedSrNumbers: extraction.srNumbers,
          extractionFingerprint: buildExtractionFingerprint(extraction),
          intakeStatus: "PDF_PARSED",
          duplicateOfAttachmentId: null,
          parseError: null
        }
      });
      result.parsedAttachmentCount += 1;

      const review = await buildAutomatedReview(context, {
        attachment,
        shipmentDateInput: formatInputDate(attachment.sourceEmail.receivedAt),
        orders: extraction.orders
      });
      const reviewRunId = await saveTeamshipReviewRun({
        context,
        documentLabel: buildDocumentLabel(attachment, extraction.psNumbers),
        shipmentDate: parseInputDate(formatInputDate(attachment.sourceEmail.receivedAt)),
        sourcePdfFileName: attachment.fileName,
        review,
        alertDigestOrderCount: 0
      });

      if (reviewRunId) {
        result.createdReviewRunIds.push(reviewRunId);
      }

      const readySrNumbers = buildTeamshipPhase2DryRunPlan(review).orders
        .filter((order) => order.status === "READY")
        .filter(
          (order) =>
            order.plannedFieldUpdates.length > 0 ||
            order.plannedPalletRows.length > 0 ||
            order.plannedBolCleanup?.removeCustomerOrderWeights
        )
        .map((order) => order.srNumber);

      if (readySrNumbers.length === 0) {
        result.skippedReasons.push(`${attachment.fileName}: no matched shipments were safe to auto-approve for Teamship updates.`);
        continue;
      }

      const job = await createTeamshipUpdateJob(context, {
        documentLabel: buildDocumentLabel(attachment, extraction.psNumbers),
        shipmentDate: formatInputDate(attachment.sourceEmail.receivedAt),
        sourcePdfFileName: attachment.fileName,
        review,
        selectedSrNumbers: readySrNumbers,
        agentMode: "LIVE_API"
      });
      result.createdUpdateJobIds.push(job.id);

      if (job.status === "DRAFT") {
        const approved = await approveTeamshipUpdateJob(context, job.id);
        result.approvedUpdateJobIds.push(approved.id);
      } else {
        result.skippedReasons.push(`${attachment.fileName}: update job ${job.id} needs review before the VM agent can run.`);
      }
    } catch (error) {
      result.failedAttachmentCount += 1;
      const message = error instanceof Error ? error.message : "Unknown Garland email automation error.";
      await prisma.garlandSourceAttachment.update({
        where: { tenantId_id: { tenantId: context.tenantId, id: attachment.id } },
        data: {
          intakeStatus: "PDF_PARSE_FAILED",
          parseError: message
        }
      });
      result.skippedReasons.push(`${attachment.fileName}: ${message}`);
    }
  }

  return result;
}

async function buildAutomatedReview(
  context: AuthenticatedContext,
  input: {
    attachment: GarlandAttachmentForProcessing;
    shipmentDateInput: string;
    orders: Awaited<ReturnType<typeof extractGarlandShippingOrdersFromPdfBytes>>["orders"];
  }
) {
  const teamshipOrders = await fetchTeamshipShippingOrdersForReview({
    tenantId: context.tenantId,
    shipmentDate: input.shipmentDateInput,
    srNumbers: input.orders.map((order) => order.srNumber)
  });
  const learnedProductDimensions = await getGarlandLearnedProductDimensionRecommendations({
    tenantId: context.tenantId,
    skus: collectGarlandProductDimensionSkus({
      pdfOrders: input.orders,
      teamshipOrders
    })
  });

  return buildGarlandTeamshipReview(input.orders, teamshipOrders, [], {
    learnedProductDimensions
  });
}

async function findDuplicateParsedAttachment({
  tenantId,
  attachmentId,
  contentHash
}: {
  tenantId: string;
  attachmentId: string;
  contentHash: string;
}) {
  return prisma.garlandSourceAttachment.findFirst({
    where: {
      tenantId,
      id: { not: attachmentId },
      contentHash,
      intakeStatus: { in: ["PDF_PARSED", "PDF_DUPLICATE"] }
    },
    select: { id: true }
  });
}

function buildExtractionFingerprint(extraction: Awaited<ReturnType<typeof extractGarlandShippingOrdersFromPdfBytes>>) {
  return [extraction.contentHash, extraction.pageCount, extraction.psNumbers.join(","), extraction.srNumbers.join(",")].join(":");
}

function buildDocumentLabel(attachment: GarlandAttachmentForProcessing, psNumbers: string[]) {
  const date = formatDisplayDate(attachment.sourceEmail.receivedAt);
  const psRange = compactRange(psNumbers);
  return psRange ? `${date} - ${psRange}` : date;
}

function compactRange(values: string[]) {
  const unique = [...new Set(values.filter(Boolean))];
  if (unique.length === 0) return "";
  if (unique.length === 1) return unique[0];
  return `${unique[0]} - ${unique.at(-1)}`;
}

function formatInputDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function parseInputDate(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}

function formatDisplayDate(date: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "America/Toronto"
  }).format(date);
}

function emptyResult(skippedReasons: string[]): GarlandEmailAgentAutomationResult {
  return {
    processedAttachmentCount: 0,
    parsedAttachmentCount: 0,
    duplicateAttachmentCount: 0,
    failedAttachmentCount: 0,
    createdReviewRunIds: [],
    createdUpdateJobIds: [],
    approvedUpdateJobIds: [],
    skippedReasons
  };
}
