import { ModuleKey } from "@prisma/client";
import { NextResponse } from "next/server";

import { buildTeamshipPayloadInspection } from "@/modules/shipment-documents/teamship-payload-inspector";
import type { TeamshipShippingOrderDetail } from "@/modules/shipment-documents/teamship-review-types";
import { requireModule } from "@/server/auth/authorization";
import {
  fetchTeamshipShippingOrdersForReview,
  getTeamshipConfigurationStatus
} from "@/server/integrations/teamship";
import { getAuthenticatedContext } from "@/server/tenant-context";

type InspectPayloadRequest = {
  shipmentDate?: string;
  srNumber?: string;
  expectedSerials?: string[];
  expectedSkus?: string[];
};

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const context = await getAuthenticatedContext();
  await requireModule(context, ModuleKey.SHIPMENT_DOCUMENTS);

  const body = (await request.json().catch(() => null)) as InspectPayloadRequest | null;
  const srNumber = typeof body?.srNumber === "string" ? body.srNumber.trim().toUpperCase() : "";
  const shipmentDate = typeof body?.shipmentDate === "string" && body.shipmentDate.trim() ? body.shipmentDate.trim() : undefined;

  if (!srNumber) {
    return NextResponse.json({ error: "srNumber is required." }, { status: 400 });
  }

  const config = await getTeamshipConfigurationStatus(context.tenantId);

  if (!config.configured) {
    return NextResponse.json(
      {
        error: `Teamship is not configured. Missing: ${config.missing.join(", ")}. Add Teamship credentials in Settings.`,
        configuration: config
      },
      { status: 503 }
    );
  }

  try {
    const teamshipOrders = await fetchTeamshipShippingOrdersForReview({
      tenantId: context.tenantId,
      shipmentDate,
      srNumbers: [srNumber]
    });
    const teamshipOrder = findTeamshipOrderBySr(teamshipOrders, srNumber);

    return NextResponse.json(
      buildTeamshipPayloadInspection({
        srNumber,
        teamshipOrder,
        expectedSerials: readStringArray(body?.expectedSerials),
        expectedSkus: readStringArray(body?.expectedSkus)
      })
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to inspect the Teamship payload." },
      { status: 502 }
    );
  }
}

function findTeamshipOrderBySr(orders: TeamshipShippingOrderDetail[], srNumber: string) {
  const target = normalizeIdentifier(srNumber);

  return (
    orders.find((order) =>
      [
        order.shipment_id,
        order.order_number,
        order.display_id,
        order.record_no,
        order.amazon_shipment_id1,
        order.edi_field_1,
        order.edi_field_2,
        order.edi_field_3,
        order.edi_field_4
      ].some((value) => normalizeIdentifier(value).includes(target))
    ) ?? null
  );
}

function readStringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}

function normalizeIdentifier(value: unknown) {
  return String(value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}
