import { Prisma } from "@prisma/client";

import type {
  GarlandTeamshipOrderReview,
  GarlandTeamshipReviewResponse
} from "@/modules/shipment-documents/teamship-review-types";
import { prisma } from "@/server/db";
import type { AuthenticatedContext } from "@/server/tenant-context";

const WORKFLOW_KEY = "GARLAND_TEAMSHIP_REVIEW";

export type TeamshipReviewWorkflowStatus = "NEEDS_SETUP" | "READY_TO_PRINT" | "BOL_PRINTED" | "NEEDS_REVIEW" | "NO_PDF" | "SKIPPED";

export type TeamshipReviewHistoryOrder = {
  id: string;
  psNumber: string;
  srNumber: string;
  status: GarlandTeamshipOrderReview["status"];
  teamshipOrderId: string | null;
  teamshipUrl: string | null;
  carrier: string | null;
  shipToName: string | null;
  city: string | null;
  state: string | null;
  shipToPo: string | null;
  pageNumbers: number[];
  mismatchCount: number;
  workflowStatus: TeamshipReviewWorkflowStatus;
  bolPrintedAt: string | null;
};

export type TeamshipReviewHistoryRun = {
  id: string;
  documentLabel: string;
  shipmentDate: string;
  sourcePdfFileName: string | null;
  pdfOrderCount: number;
  teamshipMatchedCount: number;
  passedCount: number;
  failedCount: number;
  missingTeamshipCount: number;
  pendingTeamshipCount: number;
  noPdfCount: number;
  alertDigestOrderCount: number;
  psNumbers: string[];
  srNumbers: string[];
  createdAt: string;
  createdByName: string | null;
  orders: TeamshipReviewHistoryOrder[];
};

export type TeamshipReviewHistoryResponse = {
  runs: TeamshipReviewHistoryRun[];
  totalCount: number;
  search: string;
  dateFrom: string;
  dateTo: string;
  allDates: boolean;
};

type SaveTeamshipReviewRunInput = {
  context: AuthenticatedContext;
  documentLabel: string;
  shipmentDate: Date;
  sourcePdfFileName: string | null;
  review: GarlandTeamshipReviewResponse;
  alertDigestOrderCount: number;
};

type TeamshipReviewRunQueryClient = typeof prisma & {
  teamshipReviewRun: {
    findMany(args: {
      where: Record<string, unknown>;
      orderBy: Array<Record<string, "asc" | "desc">>;
      take: number;
      select: Record<string, unknown>;
    }): Promise<TeamshipReviewRunRecord[]>;
    count(args: { where: Record<string, unknown> }): Promise<number>;
    create(args: { data: Record<string, unknown> }): Promise<unknown>;
    updateMany(args: { where: Record<string, unknown>; data: Record<string, unknown> }): Promise<{ count: number }>;
  };
  teamshipReviewOrder: {
    findMany(args: {
      where: Record<string, unknown>;
      select: { srNumber: true };
    }): Promise<Array<{ srNumber: string }>>;
    updateMany(args: { where: Record<string, unknown>; data: Record<string, unknown> }): Promise<{ count: number }>;
  };
};

type TeamshipReviewRunRecord = {
  id: string;
  documentLabel: string;
  shipmentDate: Date;
  sourcePdfFileName: string | null;
  pdfOrderCount: number;
  teamshipMatchedCount: number;
  passedCount: number;
  failedCount: number;
  missingTeamshipCount: number;
  pendingTeamshipCount: number;
  noPdfCount: number;
  alertDigestOrderCount: number;
  createdAt: Date;
  createdBy: {
    name: string | null;
    email: string;
  } | null;
  orders: TeamshipReviewOrderRecord[];
};

type TeamshipReviewOrderRecord = {
  id: string;
  psNumber: string;
  srNumber: string;
  status: string;
  teamshipOrderId: string | null;
  teamshipUrl: string | null;
  carrier: string | null;
  shipToName: string | null;
  city: string | null;
  state: string | null;
  shipToPo: string | null;
  pageNumbers: unknown;
  mismatchCount: number;
  workflowStatus: string;
  bolPrintedAt: Date | null;
};

export async function getTeamshipReviewHistory(
  context: AuthenticatedContext,
  filters: { search?: string; dateFrom?: string | null; dateTo?: string | null; allDates?: boolean; take?: number } = {}
): Promise<TeamshipReviewHistoryResponse> {
  const search = filters.search?.trim() ?? "";
  const allDates = filters.allDates === true;
  const parsedDateFrom = parseHistoryDate(filters.dateFrom) ?? getTodayInputValue();
  const parsedDateTo = parseHistoryDate(filters.dateTo) ?? parsedDateFrom;
  const dateFrom = allDates ? "" : parsedDateFrom <= parsedDateTo ? parsedDateFrom : parsedDateTo;
  const dateTo = allDates ? "" : parsedDateFrom <= parsedDateTo ? parsedDateTo : parsedDateFrom;
  const take = Math.min(100, Math.max(1, filters.take ?? 40));
  const where: Record<string, unknown> = {
    tenantId: context.tenantId,
    workflowKey: WORKFLOW_KEY,
    deletedAt: null
  };

  if (!allDates) {
    where.shipmentDate = {
      gte: new Date(`${dateFrom}T00:00:00.000Z`),
      lte: new Date(`${dateTo}T23:59:59.999Z`)
    };
  }

  if (search) {
    where.OR = [
      {
        searchText: {
          contains: search,
          mode: "insensitive"
        }
      },
      {
        orders: {
          some: {
            OR: [
              { psNumber: { contains: search, mode: "insensitive" } },
              { srNumber: { contains: search, mode: "insensitive" } },
              { status: { contains: search, mode: "insensitive" } },
              { teamshipOrderId: { contains: search, mode: "insensitive" } },
              { teamshipUrl: { contains: search, mode: "insensitive" } },
              { carrier: { contains: search, mode: "insensitive" } },
              { shipToName: { contains: search, mode: "insensitive" } },
              { city: { contains: search, mode: "insensitive" } },
              { state: { contains: search, mode: "insensitive" } },
              { shipToPo: { contains: search, mode: "insensitive" } },
              { workflowStatus: { contains: search, mode: "insensitive" } }
            ]
          }
        }
      }
    ];
  }

  const client = prisma as TeamshipReviewRunQueryClient;
  const [runs, totalCount] = await Promise.all([
    client.teamshipReviewRun.findMany({
      where,
      orderBy: [{ shipmentDate: "desc" }, { createdAt: "desc" }],
      take,
      select: {
        id: true,
        documentLabel: true,
        shipmentDate: true,
        sourcePdfFileName: true,
        pdfOrderCount: true,
        teamshipMatchedCount: true,
        passedCount: true,
        failedCount: true,
        missingTeamshipCount: true,
        pendingTeamshipCount: true,
        noPdfCount: true,
        alertDigestOrderCount: true,
        createdAt: true,
        createdBy: {
          select: {
            name: true,
            email: true
          }
        },
        orders: {
          orderBy: [{ psNumber: "asc" }, { srNumber: "asc" }],
          select: {
            id: true,
            psNumber: true,
            srNumber: true,
            status: true,
            teamshipOrderId: true,
            teamshipUrl: true,
            carrier: true,
            shipToName: true,
            city: true,
            state: true,
            shipToPo: true,
            pageNumbers: true,
            mismatchCount: true,
            workflowStatus: true,
            bolPrintedAt: true
          }
        }
      }
    }),
    client.teamshipReviewRun.count({ where })
  ]);

  return {
    runs: runs.map(mapTeamshipReviewRun),
    totalCount,
    search,
    dateFrom,
    dateTo,
    allDates
  };
}

export async function saveTeamshipReviewRun(input: SaveTeamshipReviewRunInput) {
  const { context, review } = input;
  const pdfOrdersByKey = new Map(review.pdfOrders.map((order) => [buildOrderKey(order.psNumber, order.srNumber), order]));
  const orderRows = review.reviews.map((orderReview) => {
    const pdfOrder = pdfOrdersByKey.get(buildOrderKey(orderReview.psNumber, orderReview.srNumber));

    return {
      tenantId: context.tenantId,
      psNumber: orderReview.psNumber,
      srNumber: orderReview.srNumber,
      status: orderReview.status,
      teamshipOrderId: orderReview.teamshipOrderId,
      teamshipUrl: orderReview.teamshipUrl,
      carrier: readFieldValue(orderReview, "shipVia") ?? readFieldValue(orderReview, "carrier", "teamship") ?? pdfOrder?.shipVia ?? null,
      shipToName: pdfOrder?.shipToName ?? readFieldValue(orderReview, "ship_to_name", "teamship") ?? null,
      city: pdfOrder?.shipToCity ?? readFieldValue(orderReview, "ship_to_city", "teamship") ?? null,
      state: pdfOrder?.shipToState ?? readFieldValue(orderReview, "ship_to_state", "teamship") ?? null,
      shipToPo: pdfOrder?.shipToPo ?? null,
      pageNumbers: orderReview.pageNumbers as Prisma.InputJsonValue,
      pdfOrder: (pdfOrder ?? null) as Prisma.InputJsonValue,
      review: orderReview as Prisma.InputJsonValue,
      mismatchCount: orderReview.issueCount,
      workflowStatus: getInitialWorkflowStatus(orderReview)
    };
  });

  const searchText = buildSearchText(input, orderRows);
  const client = prisma as TeamshipReviewRunQueryClient;

  await client.teamshipReviewRun.create({
    data: {
      tenantId: context.tenantId,
      workflowKey: WORKFLOW_KEY,
      documentLabel: input.documentLabel,
      shipmentDate: input.shipmentDate,
      sourcePdfFileName: input.sourcePdfFileName,
      pdfOrderCount: review.summary.pdfOrderCount,
      teamshipMatchedCount: review.summary.teamshipMatchedCount,
      passedCount: review.summary.passedCount,
      failedCount: review.summary.failedCount,
      missingTeamshipCount: review.summary.missingTeamshipCount,
      pendingTeamshipCount: review.summary.pendingTeamshipCount,
      noPdfCount: review.summary.noPdfCount,
      alertDigestOrderCount: input.alertDigestOrderCount,
      summary: review.summary as Prisma.InputJsonValue,
      extractedOrders: review.pdfOrders as Prisma.InputJsonValue,
      reviewResponse: review as Prisma.InputJsonValue,
      searchText,
      createdByUserId: context.userId,
      orders: {
        create: orderRows
      }
    }
  });
}

export async function deleteTeamshipReviewRun(context: AuthenticatedContext, runId: string) {
  const client = prisma as TeamshipReviewRunQueryClient;
  const result = await client.teamshipReviewRun.updateMany({
    where: {
      id: runId,
      tenantId: context.tenantId,
      workflowKey: WORKFLOW_KEY,
      deletedAt: null
    },
    data: {
      deletedAt: new Date(),
      deletedByUserId: context.userId
    }
  });

  if (result.count === 0) {
    throw new Error("Teamship review run was not found or was already deleted.");
  }
}

export async function markTeamshipReviewOrderBolPrinted({
  context,
  runId,
  orderId,
  printed
}: {
  context: AuthenticatedContext;
  runId: string;
  orderId: string;
  printed: boolean;
}) {
  const client = prisma as TeamshipReviewRunQueryClient;
  const result = await client.teamshipReviewOrder.updateMany({
    where: {
      id: orderId,
      runId,
      tenantId: context.tenantId,
      run: {
        tenantId: context.tenantId,
        workflowKey: WORKFLOW_KEY,
        deletedAt: null
      }
    },
    data: printed
      ? {
          workflowStatus: "BOL_PRINTED",
          bolPrintedAt: new Date(),
          bolPrintedByUserId: context.userId
        }
      : {
          workflowStatus: "READY_TO_PRINT",
          bolPrintedAt: null,
          bolPrintedByUserId: null
        }
  });

  if (result.count === 0) {
    throw new Error("Teamship review order was not found or belongs to a deleted run.");
  }
}

export async function markTeamshipReviewOrdersReadyToPrint({
  tenantId,
  shipmentDate,
  srNumbers
}: {
  tenantId: string;
  shipmentDate: Date;
  srNumbers: string[];
}) {
  const normalizedSrNumbers = Array.from(new Set(srNumbers.map((value) => value.trim().toUpperCase()).filter(Boolean)));

  if (normalizedSrNumbers.length === 0) {
    return 0;
  }

  const client = prisma as TeamshipReviewRunQueryClient;
  const result = await client.teamshipReviewOrder.updateMany({
    where: {
      tenantId,
      srNumber: {
        in: normalizedSrNumbers
      },
      workflowStatus: {
        not: "BOL_PRINTED"
      },
      run: {
        tenantId,
        workflowKey: WORKFLOW_KEY,
        shipmentDate,
        deletedAt: null
      }
    },
    data: {
      workflowStatus: "READY_TO_PRINT"
    }
  });

  return result.count;
}

export async function getReviewedTeamshipSrNumbers(context: AuthenticatedContext, shipmentDate: Date, srNumbers: string[]) {
  const normalizedSrNumbers = Array.from(new Set(srNumbers.map((value) => value.trim().toUpperCase()).filter(Boolean)));

  if (normalizedSrNumbers.length === 0) {
    return new Set<string>();
  }

  const client = prisma as TeamshipReviewRunQueryClient;
  const reviewedOrders = await client.teamshipReviewOrder.findMany({
    where: {
      tenantId: context.tenantId,
      srNumber: {
        in: normalizedSrNumbers
      },
      run: {
        tenantId: context.tenantId,
        workflowKey: WORKFLOW_KEY,
        shipmentDate,
        deletedAt: null
      }
    },
    select: {
      srNumber: true
    }
  });

  return new Set(reviewedOrders.map((order) => order.srNumber.trim().toUpperCase()));
}

function mapTeamshipReviewRun(record: TeamshipReviewRunRecord): TeamshipReviewHistoryRun {
  const orders = record.orders.map(mapTeamshipReviewOrder);

  return {
    id: record.id,
    documentLabel: record.documentLabel,
    shipmentDate: record.shipmentDate.toISOString(),
    sourcePdfFileName: record.sourcePdfFileName,
    pdfOrderCount: record.pdfOrderCount,
    teamshipMatchedCount: record.teamshipMatchedCount,
    passedCount: record.passedCount,
    failedCount: record.failedCount,
    missingTeamshipCount: record.missingTeamshipCount,
    pendingTeamshipCount: record.pendingTeamshipCount,
    noPdfCount: record.noPdfCount,
    alertDigestOrderCount: record.alertDigestOrderCount,
    psNumbers: orders.map((order) => order.psNumber).filter(Boolean),
    srNumbers: orders.map((order) => order.srNumber).filter(Boolean),
    createdAt: record.createdAt.toISOString(),
    createdByName: record.createdBy?.name?.trim() || record.createdBy?.email || null,
    orders
  };
}

function mapTeamshipReviewOrder(record: TeamshipReviewOrderRecord): TeamshipReviewHistoryOrder {
  return {
    id: record.id,
    psNumber: record.psNumber,
    srNumber: record.srNumber,
    status: normalizeReviewStatus(record.status),
    teamshipOrderId: record.teamshipOrderId,
    teamshipUrl: record.teamshipUrl,
    carrier: record.carrier,
    shipToName: record.shipToName,
    city: record.city,
    state: record.state,
    shipToPo: record.shipToPo,
    pageNumbers: Array.isArray(record.pageNumbers)
      ? record.pageNumbers.filter((value): value is number => typeof value === "number")
      : [],
    mismatchCount: record.mismatchCount,
    workflowStatus: normalizeWorkflowStatus(record.workflowStatus),
    bolPrintedAt: record.bolPrintedAt ? record.bolPrintedAt.toISOString() : null
  };
}

function getInitialWorkflowStatus(orderReview: GarlandTeamshipOrderReview): TeamshipReviewWorkflowStatus {
  if (orderReview.status === "NO_PDF") {
    return "NO_PDF";
  }

  if (orderReview.status === "SKIPPED_ALREADY_REVIEWED") {
    return "SKIPPED";
  }

  if (orderReview.status === "MISSING_TEAMSHIP" || orderReview.status === "PENDING_TEAMSHIP" || orderReview.status === "FAIL") {
    return "NEEDS_REVIEW";
  }

  return "NEEDS_SETUP";
}

function normalizeWorkflowStatus(status: string): TeamshipReviewWorkflowStatus {
  return ["NEEDS_SETUP", "READY_TO_PRINT", "BOL_PRINTED", "NEEDS_REVIEW", "NO_PDF", "SKIPPED"].includes(status)
    ? (status as TeamshipReviewWorkflowStatus)
    : "NEEDS_SETUP";
}

function normalizeReviewStatus(status: string): GarlandTeamshipOrderReview["status"] {
  return ["PASS", "FAIL", "MISSING_TEAMSHIP", "PENDING_TEAMSHIP", "NO_PDF", "SKIPPED_ALREADY_REVIEWED"].includes(status)
    ? (status as GarlandTeamshipOrderReview["status"])
    : "FAIL";
}

function buildOrderKey(psNumber: string, srNumber: string) {
  return `${psNumber.trim().toUpperCase()}::${srNumber.trim().toUpperCase()}`;
}

function readFieldValue(orderReview: GarlandTeamshipOrderReview, fieldKey: string, source: "pdf" | "teamship" = "pdf") {
  const field = orderReview.fields.find((candidate) => candidate.key === fieldKey);
  const value = source === "pdf" ? field?.pdfValue : field?.teamshipValue;
  return value?.trim() || null;
}

function buildSearchText(input: SaveTeamshipReviewRunInput, orderRows: Array<Record<string, unknown>>) {
  const values = [
    input.documentLabel,
    input.sourcePdfFileName,
    input.shipmentDate.toISOString().slice(0, 10),
    input.review.fetchedAt,
    `orders ${input.review.summary.pdfOrderCount}`,
    `matched ${input.review.summary.teamshipMatchedCount}`,
    `passed ${input.review.summary.passedCount}`,
    `failed ${input.review.summary.failedCount}`,
    `missing ${input.review.summary.missingTeamshipCount}`,
    `pending ${input.review.summary.pendingTeamshipCount}`,
    input.context.userName,
    input.context.userEmail,
    ...input.review.teamshipAlerts.flatMap((alert) => [
      alert.srNumber,
      alert.reason,
      alert.rawText,
      ...alert.items.flatMap((item) => [item.itemNumber, item.description, item.requestedQuantity, item.serialNumber])
    ]),
    ...input.review.pdfOrders.flatMap((order) => [
      order.psNumber,
      order.srNumber,
      order.shipToCode,
      order.shipToName,
      order.shipToAddress1,
      order.shipToCity,
      order.shipToState,
      order.shipToPostalCode,
      order.shipToCountry,
      order.shipToPo,
      order.freightTerms,
      order.orderDate,
      order.shipVia,
      order.instructions,
      order.rawText,
      ...order.items.flatMap((item) => [
        item.sku,
        item.description,
        item.quantity === null ? null : String(item.quantity),
        item.dueShipDate,
        ...item.serialNumbers
      ])
    ]),
    ...input.review.reviews.flatMap((review) => [
      review.psNumber,
      review.srNumber,
      review.status,
      review.teamshipOrderId,
      review.teamshipUrl,
      review.alert?.reason,
      review.alert?.rawText,
      ...review.fields.flatMap((field) => [field.key, field.label, field.status, field.pdfValue, field.teamshipValue, field.message]),
      ...review.productDimensions.flatMap((dimension) => [
        dimension.sku,
        dimension.source,
        dimension.productType,
        dimension.quantity === null ? null : String(dimension.quantity),
        dimension.lengthIn === null ? null : String(dimension.lengthIn),
        dimension.widthIn === null ? null : String(dimension.widthIn),
        dimension.heightIn === null ? null : String(dimension.heightIn),
        dimension.weightLb === null ? null : String(dimension.weightLb),
        dimension.weightUnit,
        dimension.confidence,
        dimension.note
      ])
    ]),
    ...orderRows.flatMap((row) => [
      row.psNumber,
      row.srNumber,
      row.status,
      row.teamshipOrderId,
      row.carrier,
      row.shipToName,
      row.city,
      row.state,
      row.shipToPo,
      row.workflowStatus
    ])
  ];

  return values
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .join(" ")
    .slice(0, 12000);
}

function parseHistoryDate(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : null;
}

function getTodayInputValue() {
  const now = new Date();
  const offsetMs = now.getTimezoneOffset() * 60 * 1000;
  return new Date(now.getTime() - offsetMs).toISOString().slice(0, 10);
}
