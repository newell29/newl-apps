import { ModuleKey } from "@prisma/client";
import { NextResponse } from "next/server";

import { parseTeamshipAlertDigest } from "@/modules/shipment-documents/teamship-review";
import {
  getTeamshipReviewHistory,
  saveTeamshipReviewRun
} from "@/modules/shipment-documents/teamship-review-history";
import type { GarlandTeamshipReviewResponse } from "@/modules/shipment-documents/teamship-review-types";
import { requireModule, requireMutationAccess } from "@/server/auth/authorization";
import { getAuthenticatedContext } from "@/server/tenant-context";

export const dynamic = "force-dynamic";

type SaveTeamshipReviewPayload = {
  documentLabel?: unknown;
  shipmentDate?: unknown;
  sourcePdfFileName?: unknown;
  review?: unknown;
  alertDigest?: unknown;
};

export async function GET(request: Request) {
  try {
    const context = await getAuthenticatedContext();
    await requireModule(context, ModuleKey.SHIPMENT_DOCUMENTS);
    const { searchParams } = new URL(request.url);
    const history = await getTeamshipReviewHistory(context, {
      search: searchParams.get("search") ?? ""
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
    const shipmentDate = parseShipmentDate(readRequiredString(body.shipmentDate, "shipmentDate"));
    const sourcePdfFileName = readOptionalString(body.sourcePdfFileName);
    const review = readReviewResponse(body.review);
    const alertDigest = readOptionalString(body.alertDigest) ?? "";

    await saveTeamshipReviewRun({
      context,
      documentLabel,
      shipmentDate,
      sourcePdfFileName,
      review,
      alertDigestOrderCount: parseTeamshipAlertDigest(alertDigest).length
    });

    const history = await getTeamshipReviewHistory(context);
    return NextResponse.json(history, { status: 201 });
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

function readReviewResponse(value: unknown): GarlandTeamshipReviewResponse {
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
