import { ModuleKey } from "@prisma/client";
import { NextResponse } from "next/server";

import { buildGarlandTeamshipReview, parseTeamshipAlertDigest } from "@/modules/shipment-documents/teamship-review";
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

  if (orders.length === 0) {
    return NextResponse.json({ error: "Upload and extract at least one Garland PDF shipping order." }, { status: 400 });
  }

  const config = getTeamshipConfigurationStatus();
  const runtimeCredentials = readRuntimeCredentials(body?.teamshipCredentials);

  if (!config.configured && !runtimeCredentials) {
    return NextResponse.json(
      {
        error: `Teamship is not configured. Missing: ${config.missing.join(", ")}. Enter one-time Teamship credentials for this manual run or add the missing server env vars.`,
        configuration: config
      },
      { status: 503 }
    );
  }

  try {
    const teamshipOrders = await fetchTeamshipShippingOrdersForReview({
      shipmentDate: body?.shipmentDate,
      srNumbers: orders.map((order) => order.srNumber),
      credentials: runtimeCredentials
    });

    return NextResponse.json(buildGarlandTeamshipReview(orders, teamshipOrders, teamshipAlerts));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to run the Teamship review." },
      { status: 502 }
    );
  }
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
