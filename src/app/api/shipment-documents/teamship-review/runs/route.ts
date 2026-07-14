import { ModuleKey } from "@prisma/client";
import { NextResponse } from "next/server";

import { buildGarlandTeamshipReview, parseTeamshipAlertDigest } from "@/modules/shipment-documents/teamship-review";
import {
  getTeamshipReviewHistory,
  saveTeamshipReviewRun
} from "@/modules/shipment-documents/teamship-review-history";
import type {
  GarlandTeamshipReviewResponse,
  TeamshipShippingOrderDetail
} from "@/modules/shipment-documents/teamship-review-types";
import { requireModule, requireMutationAccess } from "@/server/auth/authorization";
import { getAuthenticatedContext } from "@/server/tenant-context";

export const dynamic = "force-dynamic";

type SaveTeamshipReviewPayload = {
  documentLabel?: unknown;
  shipmentDate?: unknown;
  sourcePdfFileName?: unknown;
  review?: unknown;
  teamshipOrders?: unknown;
  alertDigest?: unknown;
};

export async function GET(request: Request) {
  try {
    const context = await getAuthenticatedContext();
    await requireModule(context, ModuleKey.SHIPMENT_DOCUMENTS);
    const { searchParams } = new URL(request.url);
    const history = await getTeamshipReviewHistory(context, {
      search: searchParams.get("search") ?? "",
      dateFrom: searchParams.get("dateFrom"),
      dateTo: searchParams.get("dateTo"),
      allDates: searchParams.get("allDates") === "true"
    });

    return NextResponse.json(history);
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to load Teamship review history." },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const context = await getAuthenticatedContext();
    await requireModule(context, ModuleKey.SHIPMENT_DOCUMENTS);
    await requireMutationAccess(context);
    const body = (await request.json().catch(() => null)) as SaveTeamshipReviewPayload | null;

    if (!body) {
      return NextResponse.json({ error: "A Teamship review payload is required." }, { status: 400 });
    }

    const documentLabel = readRequiredString(body.documentLabel, "documentLabel");
    const shipmentDateInput = readRequiredString(body.shipmentDate, "shipmentDate");
    const shipmentDate = parseShipmentDate(shipmentDateInput);
    const sourcePdfFileName = readOptionalString(body.sourcePdfFileName);
    const alertDigest = readOptionalString(body.alertDigest) ?? "";
    const teamshipAlerts = parseTeamshipAlertDigest(alertDigest);
    const review = readReviewResponse(body.review) ?? buildTeamshipOnlyReview(body.teamshipOrders, teamshipAlerts);

    const savedRunId = await saveTeamshipReviewRun({
      context,
      documentLabel,
      shipmentDate,
      sourcePdfFileName,
      review,
      alertDigestOrderCount: teamshipAlerts.length
    });

    const history = await getTeamshipReviewHistory(context, {
      dateFrom: shipmentDateInput,
      dateTo: shipmentDateInput
    });
    return NextResponse.json({ ...history, savedRunId }, { status: 201 });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to save Teamship review run." },
      { status: 500 }
    );
  }
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

function readRequiredString(value: unknown, label: string) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} is required.`);
  }

  return value.trim();
}

function readOptionalString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function readReviewResponse(value: unknown): GarlandTeamshipReviewResponse | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (
    !value ||
    typeof value !== "object" ||
    !("summary" in value) ||
    !("pdfOrders" in value) ||
    !Array.isArray((value as GarlandTeamshipReviewResponse).pdfOrders) ||
    !("reviews" in value) ||
    !Array.isArray((value as GarlandTeamshipReviewResponse).reviews)
  ) {
    throw new Error("A completed Teamship review response is required before saving.");
  }

  return value as GarlandTeamshipReviewResponse;
}

function buildTeamshipOnlyReview(teamshipOrdersValue: unknown, teamshipAlerts: ReturnType<typeof parseTeamshipAlertDigest>) {
  const teamshipOrders = readTeamshipOrders(teamshipOrdersValue);

  if (teamshipOrders.length === 0) {
    throw new Error("Run a Teamship sync or complete a Garland PDF review before saving.");
  }

  return buildGarlandTeamshipReview([], teamshipOrders, teamshipAlerts, {
    includeUnmatchedTeamshipOrders: true
  });
}

function readTeamshipOrders(value: unknown): TeamshipShippingOrderDetail[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((order): order is TeamshipShippingOrderDetail => Boolean(order && typeof order === "object"));
}
