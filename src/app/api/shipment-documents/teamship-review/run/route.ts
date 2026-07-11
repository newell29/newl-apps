import { ModuleKey } from "@prisma/client";
import { NextResponse } from "next/server";

import { getTeamshipSyncedOrdersForReview } from "@/modules/shipment-documents/teamship-daily-sync";
import { buildGarlandTeamshipReview, parseTeamshipAlertDigest } from "@/modules/shipment-documents/teamship-review";
import { getReviewedTeamshipSrNumbers } from "@/modules/shipment-documents/teamship-review-history";
import type { GarlandPdfShippingOrder } from "@/modules/shipment-documents/teamship-review-types";
import { requireModule } from "@/server/auth/authorization";
import {
  fetchTeamshipShippingOrdersForReview,
  getTeamshipConfigurationStatus
} from "@/server/integrations/teamship";
import { getAuthenticatedContext } from "@/server/tenant-context";

type ReviewRequest = {
  shipmentDate?: string;
  orders?: GarlandPdfShippingOrder[];
  alertDigest?: string;
  teamshipCredentials?: {
    email?: string;
    password?: string;
  };
};

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const context = await getAuthenticatedContext();
  await requireModule(context, ModuleKey.SHIPMENT_DOCUMENTS);

  const body = (await request.json().catch(() => null)) as ReviewRequest | null;
  const orders = Array.isArray(body?.orders) ? body.orders.filter(isGarlandPdfOrder) : [];
  const teamshipAlerts = parseTeamshipAlertDigest(typeof body?.alertDigest === "string" ? body.alertDigest : "");
  const shipmentDateInput = typeof body?.shipmentDate === "string" ? body.shipmentDate : getTodayInputValue();
  const shipmentDate = parseShipmentDate(shipmentDateInput);

  if (orders.length === 0) {
    return NextResponse.json({ error: "Upload and extract at least one Garland PDF shipping order." }, { status: 400 });
  }

  const reviewedSrNumbers = await getReviewedTeamshipSrNumbers(
    context,
    shipmentDate,
    orders.map((order) => order.srNumber)
  );
  const skippedAlreadyReviewedOrders = orders.filter((order) => reviewedSrNumbers.has(order.srNumber.trim().toUpperCase()));
  const ordersToReview = orders.filter((order) => !reviewedSrNumbers.has(order.srNumber.trim().toUpperCase()));

  const config = await getTeamshipConfigurationStatus(context.tenantId);
  const runtimeCredentials = readRuntimeCredentials(body?.teamshipCredentials);

  if (!config.configured && !runtimeCredentials) {
    return NextResponse.json(
      {
        error: `Teamship is not configured. Missing: ${config.missing.join(", ")}. Add Teamship credentials in Settings.`,
        configuration: config
      },
      { status: 503 }
    );
  }

  try {
    const syncedTeamshipOrders = await getTeamshipSyncedOrdersForReview({
      tenantId: context.tenantId,
      shipmentDate: shipmentDateInput
    });
    const teamshipOrders =
      syncedTeamshipOrders.length > 0
        ? syncedTeamshipOrders
        : await fetchTeamshipShippingOrdersForReview({
            tenantId: context.tenantId,
            shipmentDate: shipmentDateInput,
            srNumbers: ordersToReview.map((order) => order.srNumber),
            credentials: runtimeCredentials
          });

    return NextResponse.json(
      buildGarlandTeamshipReview(ordersToReview, teamshipOrders, teamshipAlerts, {
        includeUnmatchedTeamshipOrders: syncedTeamshipOrders.length > 0,
        skippedAlreadyReviewedOrders
      })
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to run the Teamship review." },
      { status: 502 }
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

function getTodayInputValue() {
  const now = new Date();
  const offsetMs = now.getTimezoneOffset() * 60 * 1000;
  return new Date(now.getTime() - offsetMs).toISOString().slice(0, 10);
}

function readRuntimeCredentials(value: ReviewRequest["teamshipCredentials"]) {
  const email = typeof value?.email === "string" ? value.email.trim() : "";
  const password = typeof value?.password === "string" ? value.password.trim() : "";

  if (!email && !password) {
    return null;
  }

  if (!email || !password) {
    return null;
  }

  return { email, password };
}

function isGarlandPdfOrder(value: GarlandPdfShippingOrder): value is GarlandPdfShippingOrder {
  return Boolean(
    value &&
      typeof value === "object" &&
      typeof value.psNumber === "string" &&
      /^PS\d{6}$/i.test(value.psNumber) &&
      typeof value.srNumber === "string" &&
      /^SR\d{5,8}$/i.test(value.srNumber) &&
      Array.isArray(value.pageNumbers)
  );
}
