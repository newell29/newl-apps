import { ModuleKey, Prisma } from "@prisma/client";

import { requireModule, requireMutationAccess } from "@/server/auth/authorization";
import { prisma } from "@/server/db";
import type { AuthenticatedContext, TenantContext } from "@/server/tenant-context";
import {
  isLtlParsedInquiry,
  parseShipmentInquiryWithOpenAI,
  type ParsedShipmentInquiry
} from "@/modules/shipment-inquiries/parser";
import { rateLtlInquiryIfApplicable } from "@/modules/shipment-inquiries/ltl-rating";
import { sendShipmentInquiryResultEmail } from "@/modules/shipment-inquiries/result-email";
import { runShipmentInquiryTmsAutomation, type TmsAutomationResult } from "@/modules/shipment-inquiries/tms-automation";

export const SHIPMENT_INQUIRY_PROCESS_TRIGGER_MANUAL = "MANUAL";
export const SHIPMENT_INQUIRY_PROCESS_TRIGGER_SCHEDULED = "SCHEDULED";

type ShipmentInquiryProcessInput = {
  limit?: number | null;
  triggerSource?: string | null;
};

type ShipmentInquiryJobOutcome = {
  jobId: string;
  status: "COMPLETED" | "FAILED" | "SKIPPED";
  stage: string;
  error: string | null;
};

type StageProgress = {
  outlookMessageReceived?: boolean;
  parsingStarted?: string;
  parsingCompleted?: string;
  customerLookupStarted?: string;
  customerLookupFailed?: string;
  tmsStarted?: string;
  tmsCompleted?: string;
  tmsSkippedExisting?: string;
  ltlRatingStarted?: string;
  ltlRatingCompleted?: string;
  tradeMiningStarted?: string;
  tradeMiningCompleted?: string;
  notificationStarted?: string;
  notificationCompleted?: string;
};

const DEFAULT_PROCESS_LIMIT = 5;

export async function processShipmentInquiryOutlookJobsForUser(
  ctx: AuthenticatedContext,
  input: ShipmentInquiryProcessInput = {}
) {
  await requireModule(ctx, ModuleKey.OCEAN_FREIGHT_PRICING);
  await requireMutationAccess(ctx);

  return processShipmentInquiryOutlookJobs(ctx, {
    ...input,
    triggerSource: input.triggerSource ?? SHIPMENT_INQUIRY_PROCESS_TRIGGER_MANUAL
  });
}

export async function processShipmentInquiryOutlookJobs(
  ctx: TenantContext & { userId?: string | null },
  input: ShipmentInquiryProcessInput = {}
) {
  const limit = clampInteger(input.limit ?? DEFAULT_PROCESS_LIMIT, 1, 25);
  const outcomes: ShipmentInquiryJobOutcome[] = [];

  for (let index = 0; index < limit; index += 1) {
    const job = await claimNextPendingShipmentInquiryJob(ctx);
    if (!job) {
      break;
    }

    outcomes.push(await processClaimedShipmentInquiryJob(ctx, job.id));
  }

  const result = {
    triggerSource: input.triggerSource?.trim() || SHIPMENT_INQUIRY_PROCESS_TRIGGER_SCHEDULED,
    attemptedCount: outcomes.length,
    completedCount: outcomes.filter((outcome) => outcome.status === "COMPLETED").length,
    failedCount: outcomes.filter((outcome) => outcome.status === "FAILED").length,
    skippedCount: outcomes.filter((outcome) => outcome.status === "SKIPPED").length,
    outcomes
  };

  await prisma.auditLog.create({
    data: {
      tenantId: ctx.tenantId,
      actorUserId: ctx.userId ?? null,
      action: "shipment-inquiry.outlook-processor.ran",
      entityType: "ShipmentInquiryAutomationJob",
      entityId: null,
      after: result as Prisma.InputJsonObject
    }
  });

  return result;
}

async function claimNextPendingShipmentInquiryJob(ctx: TenantContext & { userId?: string | null }) {
  const pending = await prisma.shipmentInquiryAutomationJob.findFirst({
    where: {
      tenantId: ctx.tenantId,
      status: "PENDING"
    },
    orderBy: { discoveredAt: "asc" },
    select: { id: true }
  });

  if (!pending) {
    return null;
  }

  try {
    return await prisma.shipmentInquiryAutomationJob.update({
      where: {
        tenantId_id: {
          tenantId: ctx.tenantId,
          id: pending.id
        },
        status: "PENDING"
      },
      data: {
        status: "PROCESSING",
        attemptCount: { increment: 1 },
        processingStartedAt: new Date(),
        approvalRecordedAt: new Date(),
        lastError: null,
        stageProgress: {
          outlookMessageReceived: true
        } satisfies StageProgress
      },
      select: { id: true }
    });
  } catch {
    return null;
  }
}

async function processClaimedShipmentInquiryJob(
  ctx: TenantContext & { userId?: string | null },
  jobId: string
): Promise<ShipmentInquiryJobOutcome> {
  const job = await prisma.shipmentInquiryAutomationJob.findUniqueOrThrow({
    where: {
      tenantId_id: {
        tenantId: ctx.tenantId,
        id: jobId
      }
    },
    select: {
      id: true,
      subject: true,
      normalizedBodyText: true,
      parsedInquiry: true,
      tmsFileNumber: true,
      stageProgress: true
    }
  });

  let currentStage = "outlook_message_received";
  let progress = readStageProgress(job.stageProgress);

  try {
    const parsed =
      job.parsedInquiry && isRecord(job.parsedInquiry)
        ? (job.parsedInquiry as ParsedShipmentInquiry)
        : await parseAndStoreInquiry(ctx.tenantId, job.id, job.normalizedBodyText ?? "", progress);
    progress = {
      ...progress,
      parsingCompleted: progress.parsingCompleted ?? new Date().toISOString()
    };

    currentStage = "customer_lookup";
    await updateStageProgress(ctx.tenantId, job.id, {
      ...progress,
      customerLookupStarted: new Date().toISOString()
    });

    const customer = parsed.customer.trim();
    if (!customer) {
      throw new Error("Customer lookup cannot continue because OpenAI did not identify a customer name.");
    }

    currentStage = "tms_creation";
    const tms = await runTmsStage(ctx, job.id, parsed, job.tmsFileNumber, progress);

    currentStage = isLtlParsedInquiry(parsed) ? "seven_l_rating" : "trademining";
    await updateStageProgress(ctx.tenantId, job.id, {
      ...readStageProgress((await readJobProgress(ctx.tenantId, job.id))?.stageProgress),
      ...(isLtlParsedInquiry(parsed)
        ? { ltlRatingStarted: new Date().toISOString() }
        : { tradeMiningStarted: new Date().toISOString() })
    });
    const ltl = await rateLtlInquiryIfApplicable(ctx, parsed);
    await prisma.shipmentInquiryAutomationJob.update({
      where: { tenantId_id: { tenantId: ctx.tenantId, id: job.id } },
      data: {
        sevenLResult: ltl as Prisma.InputJsonObject,
        tradeMiningResult: tms.tradeMiningCustomerIntelligence as unknown as Prisma.InputJsonObject,
        stageProgress: {
          ...readStageProgress((await readJobProgress(ctx.tenantId, job.id))?.stageProgress),
          ...(ltl.isLtl
            ? { ltlRatingCompleted: new Date().toISOString() }
            : { tradeMiningCompleted: new Date().toISOString() })
        } as Prisma.InputJsonObject
      }
    });

    currentStage = "notification";
    await updateStageProgress(ctx.tenantId, job.id, {
      ...readStageProgress((await readJobProgress(ctx.tenantId, job.id))?.stageProgress),
      notificationStarted: new Date().toISOString()
    });
    const notification = await sendShipmentInquiryResultEmail({
      originalSubject: job.subject,
      inquiry: parsed,
      tms,
      ltl
    });
    await prisma.shipmentInquiryAutomationJob.update({
      where: { tenantId_id: { tenantId: ctx.tenantId, id: job.id } },
      data: {
        status: "COMPLETED",
        completedAt: new Date(),
        notificationResult: notification as Prisma.InputJsonObject,
        stageProgress: {
          ...readStageProgress((await readJobProgress(ctx.tenantId, job.id))?.stageProgress),
          notificationCompleted: new Date().toISOString()
        } as Prisma.InputJsonObject
      }
    });

    return {
      jobId: job.id,
      status: "COMPLETED",
      stage: "completed",
      error: null
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown shipment inquiry processor error.";
    const failedProgress =
      currentStage === "customer_lookup"
        ? {
            ...progress,
            customerLookupFailed: new Date().toISOString()
          }
        : progress;

    await prisma.shipmentInquiryAutomationJob.update({
      where: {
        tenantId_id: {
          tenantId: ctx.tenantId,
          id: job.id
        }
      },
      data: {
        status: "FAILED",
        lastError: `${currentStage}: ${message}`,
        stageProgress: failedProgress as Prisma.InputJsonObject
      }
    });

    return {
      jobId: job.id,
      status: "FAILED",
      stage: currentStage,
      error: message
    };
  }
}

async function parseAndStoreInquiry(
  tenantId: string,
  jobId: string,
  bodyText: string,
  progress: StageProgress
): Promise<ParsedShipmentInquiry> {
  if (!bodyText.trim()) {
    throw new Error("Outlook inquiry job does not contain body text to parse.");
  }

  await updateStageProgress(tenantId, jobId, {
    ...progress,
    parsingStarted: new Date().toISOString()
  });

  const parsed = await parseShipmentInquiryWithOpenAI(bodyText);
  const completedProgress = {
    ...progress,
    parsingStarted: progress.parsingStarted ?? new Date().toISOString(),
    parsingCompleted: new Date().toISOString()
  };

  await prisma.shipmentInquiryAutomationJob.update({
    where: {
      tenantId_id: {
        tenantId,
        id: jobId
      }
    },
    data: {
      parsedInquiry: parsed as Prisma.InputJsonObject,
      stageProgress: completedProgress as Prisma.InputJsonObject,
      sevenLResult: isLtlParsedInquiry(parsed)
        ? ({ status: "not_reached", reason: "Customer lookup did not complete before LTL rating." } as Prisma.InputJsonObject)
        : undefined,
      tradeMiningResult: !isLtlParsedInquiry(parsed)
        ? ({ status: "not_reached", reason: "Customer lookup did not complete before TradeMining." } as Prisma.InputJsonObject)
        : undefined
    }
  });

  return parsed;
}

async function runTmsStage(
  ctx: TenantContext & { userId?: string | null },
  jobId: string,
  parsed: ParsedShipmentInquiry,
  existingTmsFileNumber: string | null,
  progress: StageProgress
): Promise<TmsAutomationResult> {
  if (existingTmsFileNumber) {
    await updateStageProgress(ctx.tenantId, jobId, {
      ...progress,
      tmsSkippedExisting: new Date().toISOString()
    });
    return {
      quoteNumber: existingTmsFileNumber,
      quoteUrl: "",
      tradeMiningCustomerIntelligence: {
        searchStarted: false,
        searchSucceeded: false,
        customerNameSearched: parsed.customer,
        customerType: parsed.customertype === "agent" ? "agent" : "customer",
        searchField: parsed.customertype === "agent" ? "MasterShipperName" : "ConsigneeName",
        dateRange: { start: "", end: "" },
        totalShipmentRecordsFound: 0,
        searchId: null,
        warning: "TradeMining was not rerun because an existing TMS quote number is already recorded for this Outlook job.",
        fieldsUsed: [],
        summary: {},
        recentRecords: [],
        workbookAttachment: null
      }
    };
  }

  await updateStageProgress(ctx.tenantId, jobId, {
    ...progress,
    tmsStarted: new Date().toISOString()
  });
  const result = await runShipmentInquiryTmsAutomation(parsed);
  await prisma.shipmentInquiryAutomationJob.update({
    where: { tenantId_id: { tenantId: ctx.tenantId, id: jobId } },
    data: {
      tmsFileNumber: result.quoteNumber,
      tmsQuoteUrl: result.quoteUrl,
      tradeMiningResult: result.tradeMiningCustomerIntelligence as unknown as Prisma.InputJsonObject,
      stageProgress: {
        ...progress,
        tmsStarted: progress.tmsStarted ?? new Date().toISOString(),
        tmsCompleted: new Date().toISOString()
      } as Prisma.InputJsonObject
    }
  });
  return result;
}

async function readJobProgress(tenantId: string, jobId: string) {
  return prisma.shipmentInquiryAutomationJob.findUnique({
    where: { tenantId_id: { tenantId, id: jobId } },
    select: { stageProgress: true }
  });
}

async function updateStageProgress(tenantId: string, jobId: string, progress: StageProgress) {
  await prisma.shipmentInquiryAutomationJob.update({
    where: {
      tenantId_id: {
        tenantId,
        id: jobId
      }
    },
    data: {
      stageProgress: progress as Prisma.InputJsonObject
    }
  });
}

function readStageProgress(value: unknown): StageProgress {
  return isRecord(value) ? (value as StageProgress) : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function clampInteger(value: number | null | undefined, min: number, max: number) {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.min(max, Math.max(min, Math.trunc(value as number)));
}
