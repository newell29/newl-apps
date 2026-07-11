import { ModuleKey } from "@prisma/client";
import { NextResponse } from "next/server";

import { requireModule } from "@/server/auth/authorization";
import {
  fetchTeamshipShippingOrdersForReview,
  getTeamshipConfigurationStatus
} from "@/server/integrations/teamship";
import { getAuthenticatedContext } from "@/server/tenant-context";

type DailyOrdersRequest = {
  shipmentDate?: string;
};

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const context = await getAuthenticatedContext();
  await requireModule(context, ModuleKey.SHIPMENT_DOCUMENTS);

  const body = (await request.json().catch(() => null)) as DailyOrdersRequest | null;
  const shipmentDate = typeof body?.shipmentDate === "string" ? body.shipmentDate : null;
  const config = getTeamshipConfigurationStatus();

  if (!config.configured) {
    return NextResponse.json(
      {
        error: `Teamship is not configured. Missing: ${config.missing.join(", ")}.`,
        configuration: config
      },
      { status: 503 }
    );
  }

  try {
    const orders = await fetchTeamshipShippingOrdersForReview({ shipmentDate, srNumbers: [] });

    return NextResponse.json({
      orders,
      totalCount: orders.length,
      fetchedAt: new Date().toISOString(),
      cron: {
        enabled: false,
        cadence: "15 minutes",
        note: "Manual daily-order retrieval is implemented. The recurring cron is intentionally not scheduled yet."
      }
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to fetch Teamship daily orders." },
      { status: 502 }
    );
  }
}

export async function GET() {
  const context = await getAuthenticatedContext();
  await requireModule(context, ModuleKey.SHIPMENT_DOCUMENTS);

  return NextResponse.json({
    enabled: false,
    cadence: "15 minutes",
    message:
      "Garland Teamship daily-order sync is scaffolded for manual runs, but no Vercel cron schedule is enabled yet."
  });
}
