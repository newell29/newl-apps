import { Prisma } from "@prisma/client";

import type {
  GarlandTeamshipOrderReview,
  GarlandTeamshipReviewResponse
} from "@/modules/shipment-documents/teamship-review-types";
import { prisma } from "@/server/db";
import type { AuthenticatedContext } from "@/server/tenant-context";

const WORKFLOW_KEY = "GARLAND_TEAMSHIP_REVIEW";

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
};

export async function getTeamshipReviewHistory(
  context: AuthenticatedContext,
  filters: { search?: string; take?: number } = {}
): Promise<TeamshipReviewHistoryResponse> {
  const search = filters.search?.trim() ?? "";
  const take = Math.min(100, Math.max(1, filters.take ?? 40));
  const where: Record<string, unknown> = {
    tenantId: context.tenantId,
    workflowKey: WORKFLOW_KEY,
    deletedAt: null
  };

  if (search) {
    where.searchText = {
      contains: search,
      mode: "insensitive"
    };
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
            mismatchCount: true
          }
        }
      }
    }),
    client.teamshipReviewRun.count({ where })
  ]);

  return {
    runs: runs.map(mapTeamshipReviewRun),
    totalCount,
    search
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
      carrier: readFieldValue(orderReview, "shipVia") ?? pdfOrder?.shipVia ?? null,
      shipToName: pdfOrder?.shipToName ?? null,
      city: pdfOrder?.shipToCity ?? null,
      state: pdfOrder?.shipToState ?? null,
      shipToPo: pdfOrder?.shipToPo ?? null,
      pageNumbers: orderReview.pageNumbers as Prisma.InputJsonValue,
      pdfOrder: (pdfOrder ?? null) as Prisma.InputJsonValue,
      review: orderReview as Prisma.InputJsonValue,
      mismatchCount: orderReview.issueCount
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
    mismatchCount: record.mismatchCount
  };
}

function normalizeReviewStatus(status: string): GarlandTeamshipOrderReview["status"] {
  return ["PASS", "FAIL", "MISSING_TEAMSHIP", "PENDING_TEAMSHIP"].includes(status)
    ? (status as GarlandTeamshipOrderReview["status"])
    : "FAIL";
}

function buildOrderKey(psNumber: string, srNumber: string) {
  return `${psNumber.trim().toUpperCase()}::${srNumber.trim().toUpperCase()}`;
}

function readFieldValue(orderReview: GarlandTeamshipOrderReview, fieldKey: string) {
  const field = orderReview.fields.find((candidate) => candidate.key === fieldKey);
  return field?.pdfValue?.trim() || null;
}

function buildSearchText(input: SaveTeamshipReviewRunInput, orderRows: Array<Record<string, unknown>>) {
  const values = [
    input.documentLabel,
    input.sourcePdfFileName,
    input.shipmentDate.toISOString().slice(0, 10),
    input.context.userName,
    input.context.userEmail,
    ...orderRows.flatMap((row) => [
      row.psNumber,
      row.srNumber,
      row.status,
      row.teamshipOrderId,
      row.carrier,
      row.shipToName,
      row.city,
      row.state,
      row.shipToPo
    ])
  ];

  return values
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .join(" ")
    .slice(0, 12000);
}
