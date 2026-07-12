import { Prisma } from "@prisma/client";

import {
  getGarlandLearnedProductDimensionRecommendations,
  recordGarlandCsrProductDimensionOverrides
} from "@/modules/shipment-documents/garland-product-dimension-directory";
import { collectGarlandProductDimensionSkus } from "@/modules/shipment-documents/garland-product-dimensions";
import type { TeamshipPhase2AgentMode } from "@/modules/shipment-documents/teamship-phase2-agent-execution";
import {
  buildTeamshipPhase2DryRunPlan,
  type TeamshipPhase2DryRunPlan,
  type TeamshipPhase2OrderPlan
} from "@/modules/shipment-documents/teamship-phase2-dry-run";
import { buildGarlandTeamshipReview } from "@/modules/shipment-documents/teamship-review";
import { markTeamshipReviewOrdersReadyToPrint } from "@/modules/shipment-documents/teamship-review-history";
import type {
  GarlandPdfShippingOrder,
  GarlandTeamshipReviewResponse
} from "@/modules/shipment-documents/teamship-review-types";
import { prisma } from "@/server/db";
import { fetchTeamshipShippingOrdersForReview } from "@/server/integrations/teamship";
import type { AuthenticatedContext, TenantContext } from "@/server/tenant-context";

const WORKFLOW_KEY = "GARLAND_TEAMSHIP_PHASE2_UPDATE";

export type TeamshipUpdateJobStatus =
  | "DRAFT"
  | "APPROVED"
  | "RUNNING"
  | "SUCCESS"
  | "FAILED"
  | "NEEDS_REVIEW"
  | "CANCELLED";

export type TeamshipUpdateOrderStatus =
  | "READY"
  | "BLOCKED"
  | "SKIPPED"
  | "APPROVED"
  | "RUNNING"
  | "SUCCESS"
  | "FAILED"
  | "NEEDS_REVIEW";

export type TeamshipUpdateJobSummary = {
  id: string;
  documentLabel: string;
  shipmentDate: string;
  sourcePdfFileName: string | null;
  status: TeamshipUpdateJobStatus;
  agentMode: string;
  dryRun: boolean;
  selectedSrNumbers: string[];
  summary: TeamshipPhase2DryRunPlan["summary"];
  errorMessage: string | null;
  agentId: string | null;
  createdAt: string;
  approvedAt: string | null;
  agentClaimedAt: string | null;
  agentStartedAt: string | null;
  agentFinishedAt: string | null;
  lastVerificationAt: string | null;
  createdByName: string | null;
  approvedByName: string | null;
  orders: TeamshipUpdateOrderSummary[];
};

export type TeamshipUpdateOrderSummary = {
  id: string;
  psNumber: string;
  srNumber: string;
  teamshipOrderId: string | null;
  teamshipUrl: string | null;
  status: TeamshipUpdateOrderStatus;
  sourceReviewStatus: string;
  plannedFieldUpdateCount: number;
  plannedPalletRowCount: number;
  validationIssues: string[];
  errorMessage: string | null;
  agentEvidence: TeamshipUpdateOrderAgentEvidence | null;
};

export type TeamshipUpdateOrderAgentEvidence = {
  status: string;
  fieldActionCount: number;
  palletActionCount: number;
  responseStatus: number | null;
  error: string | null;
};

export type TeamshipUpdateJobsResponse = {
  jobs: TeamshipUpdateJobSummary[];
  totalCount: number;
};

type CreateTeamshipUpdateJobInput = {
  documentLabel: string;
  shipmentDate: string;
  sourcePdfFileName: string | null;
  review: GarlandTeamshipReviewResponse;
  selectedSrNumbers: string[];
  agentMode?: TeamshipPhase2AgentMode;
};

type TeamshipUpdateJobClient = typeof prisma & {
  teamshipUpdateJob: {
    findMany(args: {
      where: Record<string, unknown>;
      orderBy: Array<Record<string, "asc" | "desc">>;
      take: number;
      include: TeamshipUpdateJobInclude;
    }): Promise<TeamshipUpdateJobRecord[]>;
    findFirst(args: { where: Record<string, unknown>; include: TeamshipUpdateJobInclude }): Promise<TeamshipUpdateJobRecord | null>;
    count(args: { where: Record<string, unknown> }): Promise<number>;
    create(args: { data: Record<string, unknown>; include: TeamshipUpdateJobInclude }): Promise<TeamshipUpdateJobRecord>;
    update(args: { where: { id: string }; data: Record<string, unknown>; include: TeamshipUpdateJobInclude }): Promise<TeamshipUpdateJobRecord>;
  };
  teamshipUpdateOrder: {
    updateMany(args: { where: Record<string, unknown>; data: Record<string, unknown> }): Promise<{ count: number }>;
    findMany(args: { where: Record<string, unknown>; select: { srNumber: true; status: true } }): Promise<Array<{ srNumber: string; status: string }>>;
  };
};

type TeamshipUpdateJobInclude = {
  orders: { orderBy: Array<Record<string, "asc" | "desc">> };
  createdBy: { select: { name: true; email: true } };
  approvedBy: { select: { name: true; email: true } };
};

type TeamshipUpdateJobRecord = {
  id: string;
  documentLabel: string;
  shipmentDate: Date;
  sourcePdfFileName: string | null;
  status: string;
  agentMode: string;
  dryRun: boolean;
  selectedSrNumbers: unknown;
  summary: unknown;
  sourceReviewResponse: unknown;
  sourcePdfOrders: unknown;
  plan: unknown;
  errorMessage: string | null;
  agentId: string | null;
  agentClaimedAt: Date | null;
  agentStartedAt: Date | null;
  agentFinishedAt: Date | null;
  approvedAt: Date | null;
  lastVerificationAt: Date | null;
  createdAt: Date;
  createdBy: { name: string | null; email: string } | null;
  approvedBy: { name: string | null; email: string } | null;
  orders: TeamshipUpdateOrderRecord[];
};

type TeamshipUpdateOrderRecord = {
  id: string;
  psNumber: string;
  srNumber: string;
  teamshipOrderId: string | null;
  teamshipUrl: string | null;
  status: string;
  sourceReviewStatus: string;
  plannedFieldUpdates: unknown;
  plannedPalletRows: unknown;
  validationIssues: unknown;
  agentResult: unknown;
  errorMessage: string | null;
};

const includeJobDetails: TeamshipUpdateJobInclude = {
  orders: {
    orderBy: [{ psNumber: "asc" }, { srNumber: "asc" }]
  },
  createdBy: {
    select: {
      name: true,
      email: true
    }
  },
  approvedBy: {
    select: {
      name: true,
      email: true
    }
  }
};

export async function getTeamshipUpdateJobs(
  context: Pick<TenantContext, "tenantId">,
  filters: { take?: number } = {}
): Promise<TeamshipUpdateJobsResponse> {
  const client = prisma as TeamshipUpdateJobClient;
  const where = {
    tenantId: context.tenantId,
    workflowKey: WORKFLOW_KEY
  };
  const [jobs, totalCount] = await Promise.all([
    client.teamshipUpdateJob.findMany({
      where,
      orderBy: [{ createdAt: "desc" }],
      take: Math.min(50, Math.max(1, filters.take ?? 20)),
      include: includeJobDetails
    }),
    client.teamshipUpdateJob.count({ where })
  ]);

  return {
    jobs: jobs.map(mapUpdateJob),
    totalCount
  };
}

export async function createTeamshipUpdateJob(context: AuthenticatedContext, input: CreateTeamshipUpdateJobInput) {
  const selectedSrNumbers = Array.from(
    new Set(input.selectedSrNumbers.map((srNumber) => normalizeIdentifier(srNumber)).filter(Boolean))
  );

  if (selectedSrNumbers.length === 0) {
    throw new Error("Select at least one reviewed shipment before creating an update job.");
  }

  const plan = buildTeamshipPhase2DryRunPlan(input.review);
  const selectedOrders = plan.orders.filter((order) => selectedSrNumbers.includes(normalizeIdentifier(order.srNumber)));

  if (selectedOrders.length === 0) {
    throw new Error("None of the selected shipments are available in the current review plan.");
  }

  const agentMode = normalizeAgentMode(input.agentMode);
  const selectedPdfOrders = input.review.pdfOrders.filter((order) => selectedSrNumbers.includes(normalizeIdentifier(order.srNumber)));
  const selectedReviewResponse: GarlandTeamshipReviewResponse = {
    ...input.review,
    pdfOrders: selectedPdfOrders,
    reviews: input.review.reviews.filter((review) => selectedSrNumbers.includes(normalizeIdentifier(review.srNumber))),
    summary: buildSelectedReviewSummary(input.review, selectedSrNumbers)
  };
  const selectedPlan: TeamshipPhase2DryRunPlan = {
    ...plan,
    summary: summarizePlanOrders(selectedOrders),
    orders: selectedOrders
  };
  const now = new Date();
  const client = prisma as TeamshipUpdateJobClient;
  const job = await client.teamshipUpdateJob.create({
    data: {
      tenantId: context.tenantId,
      workflowKey: WORKFLOW_KEY,
      documentLabel: input.documentLabel,
      shipmentDate: parseShipmentDate(input.shipmentDate),
      sourcePdfFileName: input.sourcePdfFileName,
      status: selectedOrders.some((order) => order.status === "BLOCKED") ? "NEEDS_REVIEW" : "DRAFT",
      agentMode,
      dryRun: agentMode === "DRY_RUN",
      selectedSrNumbers: selectedSrNumbers as Prisma.InputJsonValue,
      summary: selectedPlan.summary as Prisma.InputJsonValue,
      sourceReviewResponse: selectedReviewResponse as unknown as Prisma.InputJsonValue,
      sourcePdfOrders: selectedPdfOrders as unknown as Prisma.InputJsonValue,
      plan: selectedPlan as unknown as Prisma.InputJsonValue,
      searchText: buildJobSearchText({
        documentLabel: input.documentLabel,
        sourcePdfFileName: input.sourcePdfFileName,
        selectedOrders
      }),
      createdByUserId: context.userId,
      orders: {
        create: selectedOrders.map((order) => ({
          tenantId: context.tenantId,
          psNumber: order.psNumber,
          srNumber: order.srNumber,
          teamshipOrderId: order.teamshipOrderId,
          teamshipUrl: order.teamshipUrl,
          status: mapPlanStatusToOrderStatus(order.status),
          sourceReviewStatus: order.sourceReviewStatus,
          plannedFieldUpdates: order.plannedFieldUpdates as unknown as Prisma.InputJsonValue,
          plannedPalletRows: order.plannedPalletRows as unknown as Prisma.InputJsonValue,
          validationIssues: order.validationIssues as unknown as Prisma.InputJsonValue,
          createdAt: now,
          updatedAt: now
        }))
      }
    },
    include: includeJobDetails
  });
  await recordGarlandCsrProductDimensionOverrides({
    tenantId: context.tenantId,
    documentLabel: input.documentLabel,
    pdfOrders: selectedPdfOrders,
    dimensions: selectedReviewResponse.reviews.flatMap((review) => review.productDimensions)
  });

  return mapUpdateJob(job);
}

export async function approveTeamshipUpdateJob(context: AuthenticatedContext, jobId: string) {
  const existing = await findTenantJob(context, jobId);

  if (existing.status !== "DRAFT") {
    throw new Error(`Only draft jobs can be approved for the agent. Current status: ${existing.status}.`);
  }

  const blockedOrders = existing.orders.filter((order) => order.status === "BLOCKED");

  if (blockedOrders.length > 0) {
    throw new Error("Resolve blocked dimension/weight issues before approving this job for the agent.");
  }

  const client = prisma as TeamshipUpdateJobClient;
  await client.teamshipUpdateOrder.updateMany({
    where: {
      tenantId: context.tenantId,
      jobId,
      status: "READY"
    },
    data: {
      status: "APPROVED"
    }
  });

  const updated = await client.teamshipUpdateJob.update({
    where: { id: jobId },
    data: {
      status: "APPROVED",
      approvedByUserId: context.userId,
      approvedAt: new Date()
    },
    include: includeJobDetails
  });

  return mapUpdateJob(updated);
}

export async function cancelTeamshipUpdateJob(context: AuthenticatedContext, jobId: string) {
  await findTenantJob(context, jobId);
  const client = prisma as TeamshipUpdateJobClient;
  const updated = await client.teamshipUpdateJob.update({
    where: { id: jobId },
    data: {
      status: "CANCELLED"
    },
    include: includeJobDetails
  });

  return mapUpdateJob(updated);
}

export async function rescanTeamshipUpdateJob(context: AuthenticatedContext, jobId: string) {
  const job = await findTenantJob(context, jobId);
  const verification = await verifyTeamshipUpdateJob(context, job);
  const client = prisma as TeamshipUpdateJobClient;
  const updated = await client.teamshipUpdateJob.update({
    where: { id: jobId },
    data: {
      verificationResponse: verification as unknown as Prisma.InputJsonValue,
      lastVerificationAt: new Date()
    },
    include: includeJobDetails
  });

  return mapUpdateJob(updated);
}

export async function claimNextTeamshipUpdateJobForAgent(context: TenantContext, agentId: string) {
  const client = prisma as TeamshipUpdateJobClient;
  const job = await client.teamshipUpdateJob.findFirst({
    where: {
      tenantId: context.tenantId,
      workflowKey: WORKFLOW_KEY,
      status: "APPROVED"
    },
    include: includeJobDetails
  });

  if (!job) {
    return null;
  }

  const updated = await client.teamshipUpdateJob.update({
    where: { id: job.id },
    data: {
      status: "RUNNING",
      agentId,
      agentClaimedAt: new Date(),
      agentStartedAt: new Date()
    },
    include: includeJobDetails
  });
  await client.teamshipUpdateOrder.updateMany({
    where: {
      tenantId: context.tenantId,
      jobId: job.id,
      status: "APPROVED"
    },
    data: {
      status: "RUNNING"
    }
  });

  return {
    job: mapUpdateJob(updated),
    executionPayload: updated.plan
  };
}

export async function completeTeamshipUpdateJobFromAgent({
  context,
  jobId,
  status,
  agentResult
}: {
  context: TenantContext;
  jobId: string;
  status: "SUCCESS" | "FAILED" | "NEEDS_REVIEW";
  agentResult: unknown;
}) {
  const job = await findTenantJob(context, jobId);
  let verification: GarlandTeamshipReviewResponse | null = null;
  let verificationError: string | null = null;

  if (shouldVerifyAfterAgentCompletion(status)) {
    try {
      verification = await verifyTeamshipUpdateJob(context, job);
    } catch (error) {
      verificationError = error instanceof Error ? error.message : "Unable to rescan Teamship after agent completion.";
    }
  }

  const finalStatus = verificationError ? "NEEDS_REVIEW" : status;
  const client = prisma as TeamshipUpdateJobClient;
  const agentOrderResults = readAgentOrderResults(agentResult);

  if (agentOrderResults.length > 0) {
    await Promise.all(
      agentOrderResults.map((order) =>
        client.teamshipUpdateOrder.updateMany({
          where: {
            tenantId: context.tenantId,
            jobId,
            srNumber: order.srNumber
          },
          data: {
            status: mapAgentOrderStatus(order.status, finalStatus),
            agentResult: order as unknown as Prisma.InputJsonValue,
            errorMessage: order.error ?? null
          }
        })
      )
    );
  } else {
    await client.teamshipUpdateOrder.updateMany({
      where: {
        tenantId: context.tenantId,
        jobId
      },
      data: {
        status: finalStatus === "SUCCESS" ? "SUCCESS" : finalStatus
      }
    });
  }

  const updated = await client.teamshipUpdateJob.update({
    where: { id: jobId },
    data: {
      status: finalStatus,
      agentFinishedAt: new Date(),
      errorMessage: verificationError,
      agentResult: (agentResult ?? null) as Prisma.InputJsonValue,
      verificationResponse: verification ? (verification as unknown as Prisma.InputJsonValue) : undefined,
      lastVerificationAt: verification ? new Date() : undefined
    },
    include: includeJobDetails
  });

  if (finalStatus === "SUCCESS") {
    await markTeamshipReviewOrdersReadyToPrint({
      tenantId: context.tenantId,
      shipmentDate: job.shipmentDate,
      srNumbers: updated.orders.filter((order) => order.status === "SUCCESS").map((order) => order.srNumber)
    });
  }

  return mapUpdateJob(updated);
}

async function findTenantJob(context: Pick<TenantContext, "tenantId">, jobId: string) {
  const client = prisma as TeamshipUpdateJobClient;
  const job = await client.teamshipUpdateJob.findFirst({
    where: {
      id: jobId,
      tenantId: context.tenantId,
      workflowKey: WORKFLOW_KEY
    },
    include: includeJobDetails
  });

  if (!job) {
    throw new Error("Teamship update job was not found.");
  }

  return job;
}

async function verifyTeamshipUpdateJob(context: Pick<TenantContext, "tenantId">, job: TeamshipUpdateJobRecord) {
  const pdfOrders = readJsonArray<GarlandPdfShippingOrder>(job.sourcePdfOrders);
  const srNumbers = pdfOrders.map((order) => order.srNumber);
  const teamshipOrders = await fetchTeamshipShippingOrdersForReview({
    tenantId: context.tenantId,
    shipmentDate: formatInputDate(job.shipmentDate),
    srNumbers
  });
  const learnedProductDimensions = await getGarlandLearnedProductDimensionRecommendations({
    tenantId: context.tenantId,
    skus: collectGarlandProductDimensionSkus({
      pdfOrders,
      teamshipOrders
    })
  });

  return buildGarlandTeamshipReview(pdfOrders, teamshipOrders, [], {
    learnedProductDimensions
  });
}

function buildSelectedReviewSummary(review: GarlandTeamshipReviewResponse, selectedSrNumbers: string[]) {
  const selectedReviews = review.reviews.filter((order) => selectedSrNumbers.includes(normalizeIdentifier(order.srNumber)));

  return {
    pdfOrderCount: selectedReviews.filter((order) => order.status !== "NO_PDF").length,
    teamshipMatchedCount: selectedReviews.filter((order) => Boolean(order.teamshipOrderId)).length,
    passedCount: selectedReviews.filter((order) => order.status === "PASS").length,
    failedCount: selectedReviews.filter((order) => order.status === "FAIL").length,
    missingTeamshipCount: selectedReviews.filter((order) => order.status === "MISSING_TEAMSHIP").length,
    pendingTeamshipCount: selectedReviews.filter((order) => order.status === "PENDING_TEAMSHIP").length,
    noPdfCount: selectedReviews.filter((order) => order.status === "NO_PDF").length,
    skippedAlreadyReviewedCount: selectedReviews.filter((order) => order.status === "SKIPPED_ALREADY_REVIEWED").length
  };
}

function summarizePlanOrders(orders: TeamshipPhase2OrderPlan[]): TeamshipPhase2DryRunPlan["summary"] {
  return {
    orderCount: orders.length,
    readyCount: orders.filter((order) => order.status === "READY").length,
    blockedCount: orders.filter((order) => order.status === "BLOCKED").length,
    skippedCount: orders.filter((order) => order.status === "SKIPPED").length,
    plannedFieldUpdateCount: orders.reduce((sum, order) => sum + order.plannedFieldUpdates.length, 0),
    plannedPalletRowCount: orders.reduce((sum, order) => sum + order.plannedPalletRows.length, 0)
  };
}

function mapPlanStatusToOrderStatus(status: TeamshipPhase2OrderPlan["status"]): TeamshipUpdateOrderStatus {
  if (status === "READY") {
    return "READY";
  }

  if (status === "BLOCKED") {
    return "BLOCKED";
  }

  return "SKIPPED";
}

function mapUpdateJob(job: TeamshipUpdateJobRecord): TeamshipUpdateJobSummary {
  return {
    id: job.id,
    documentLabel: job.documentLabel,
    shipmentDate: formatInputDate(job.shipmentDate),
    sourcePdfFileName: job.sourcePdfFileName,
    status: normalizeJobStatus(job.status),
    agentMode: job.agentMode,
    dryRun: job.dryRun,
    selectedSrNumbers: readStringArray(job.selectedSrNumbers),
    summary: readSummary(job.summary),
    errorMessage: job.errorMessage,
    agentId: job.agentId,
    createdAt: job.createdAt.toISOString(),
    approvedAt: job.approvedAt?.toISOString() ?? null,
    agentClaimedAt: job.agentClaimedAt?.toISOString() ?? null,
    agentStartedAt: job.agentStartedAt?.toISOString() ?? null,
    agentFinishedAt: job.agentFinishedAt?.toISOString() ?? null,
    lastVerificationAt: job.lastVerificationAt?.toISOString() ?? null,
    createdByName: readUserName(job.createdBy),
    approvedByName: readUserName(job.approvedBy),
    orders: job.orders.map(mapUpdateOrder)
  };
}

function readAgentOrderResults(value: unknown) {
  const payload = value && typeof value === "object" ? (value as { orders?: unknown }) : null;
  const orders = Array.isArray(payload?.orders) ? payload.orders : [];

  return orders
    .map((order) => (order && typeof order === "object" ? (order as { srNumber?: unknown; status?: unknown; error?: unknown }) : null))
    .filter((order): order is { srNumber: string; status: string; error?: string } => {
      return typeof order?.srNumber === "string" && order.srNumber.trim().length > 0 && typeof order.status === "string";
    })
    .map((order) => ({
      srNumber: order.srNumber.trim(),
      status: order.status,
      error: typeof order.error === "string" && order.error.trim().length > 0 ? order.error.trim() : null
    }));
}

function shouldVerifyAfterAgentCompletion(status: "SUCCESS" | "FAILED" | "NEEDS_REVIEW") {
  return status === "SUCCESS" || status === "NEEDS_REVIEW";
}

function mapAgentOrderStatus(status: string, finalStatus: "SUCCESS" | "FAILED" | "NEEDS_REVIEW"): TeamshipUpdateOrderStatus {
  if (status === "UPDATED") {
    return "SUCCESS";
  }

  if (status === "FAILED") {
    return "FAILED";
  }

  if (status === "READY" || status === "BLOCKED" || status === "SKIPPED") {
    return finalStatus === "SUCCESS" ? "SUCCESS" : finalStatus;
  }

  return finalStatus === "SUCCESS" ? "SUCCESS" : finalStatus;
}

function mapUpdateOrder(order: TeamshipUpdateOrderRecord): TeamshipUpdateOrderSummary {
  return {
    id: order.id,
    psNumber: order.psNumber,
    srNumber: order.srNumber,
    teamshipOrderId: order.teamshipOrderId,
    teamshipUrl: order.teamshipUrl,
    status: normalizeOrderStatus(order.status),
    sourceReviewStatus: order.sourceReviewStatus,
    plannedFieldUpdateCount: readJsonArray(order.plannedFieldUpdates).length,
    plannedPalletRowCount: readJsonArray(order.plannedPalletRows).length,
    validationIssues: readStringArray(order.validationIssues),
    errorMessage: order.errorMessage,
    agentEvidence: readOrderAgentEvidence(order.agentResult)
  };
}

function readOrderAgentEvidence(value: unknown): TeamshipUpdateOrderAgentEvidence | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const evidence = value as {
    status?: unknown;
    fieldActions?: unknown;
    palletActions?: unknown;
    responseStatus?: unknown;
    error?: unknown;
  };
  const status = typeof evidence.status === "string" && evidence.status.trim() ? evidence.status.trim() : null;

  if (!status) {
    return null;
  }

  return {
    status,
    fieldActionCount: readJsonArray(evidence.fieldActions).length,
    palletActionCount: readJsonArray(evidence.palletActions).length,
    responseStatus: typeof evidence.responseStatus === "number" && Number.isFinite(evidence.responseStatus) ? evidence.responseStatus : null,
    error: typeof evidence.error === "string" && evidence.error.trim() ? evidence.error.trim() : null
  };
}

function normalizeJobStatus(value: string): TeamshipUpdateJobStatus {
  return ["DRAFT", "APPROVED", "RUNNING", "SUCCESS", "FAILED", "NEEDS_REVIEW", "CANCELLED"].includes(value)
    ? (value as TeamshipUpdateJobStatus)
    : "NEEDS_REVIEW";
}

function normalizeAgentMode(value: TeamshipPhase2AgentMode | null | undefined): TeamshipPhase2AgentMode {
  return value === "LIVE_API" ? "LIVE_API" : "DRY_RUN";
}

function normalizeOrderStatus(value: string): TeamshipUpdateOrderStatus {
  return ["READY", "BLOCKED", "SKIPPED", "APPROVED", "RUNNING", "SUCCESS", "FAILED", "NEEDS_REVIEW"].includes(value)
    ? (value as TeamshipUpdateOrderStatus)
    : "NEEDS_REVIEW";
}

function readSummary(value: unknown): TeamshipPhase2DryRunPlan["summary"] {
  const summary = value && typeof value === "object" ? (value as TeamshipPhase2DryRunPlan["summary"]) : null;

  return {
    orderCount: readNumber(summary?.orderCount),
    readyCount: readNumber(summary?.readyCount),
    blockedCount: readNumber(summary?.blockedCount),
    skippedCount: readNumber(summary?.skippedCount),
    plannedFieldUpdateCount: readNumber(summary?.plannedFieldUpdateCount),
    plannedPalletRowCount: readNumber(summary?.plannedPalletRowCount)
  };
}

function readNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function readJsonArray<T = unknown>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function readStringArray(value: unknown) {
  return readJsonArray(value).map(String).filter(Boolean);
}

function readUserName(user: { name: string | null; email: string } | null) {
  return user?.name ?? user?.email ?? null;
}

function buildJobSearchText({
  documentLabel,
  sourcePdfFileName,
  selectedOrders
}: {
  documentLabel: string;
  sourcePdfFileName: string | null;
  selectedOrders: TeamshipPhase2OrderPlan[];
}) {
  return [
    documentLabel,
    sourcePdfFileName,
    ...selectedOrders.flatMap((order) => [order.psNumber, order.srNumber, order.teamshipOrderId ?? "", order.teamshipUrl ?? ""])
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function parseShipmentDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error("shipmentDate must use YYYY-MM-DD format.");
  }

  const parsed = new Date(`${value}T00:00:00.000Z`);

  if (Number.isNaN(parsed.getTime())) {
    throw new Error("shipmentDate is invalid.");
  }

  return parsed;
}

function formatInputDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

function normalizeIdentifier(value: string | null | undefined) {
  return value?.trim().replace(/[^A-Z0-9]/gi, "").toUpperCase() || "";
}
