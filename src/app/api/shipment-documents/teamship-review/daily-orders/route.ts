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

export async function GET(request: Request) {
  const config = getTeamshipConfigurationStatus();
  const syncSecret = process.env.TEAMSHIP_DAILY_SYNC_SECRET?.trim();

  if (!syncSecret) {
    return NextResponse.json(
      {
        enabled: false,
        scheduled: false,
        cadence: "15 minutes",
        message:
          "Garland Teamship daily-order sync is scaffolded, but TEAMSHIP_DAILY_SYNC_SECRET is not configured and no Vercel cron schedule is enabled yet."
      },
      { status: 503 }
    );
  }

  const requestHeaders = new Headers(request.headers);
  const authorization = requestHeaders.get("authorization") ?? "";
  const headerSecret = requestHeaders.get("x-newl-cron-secret") ?? "";
  const bearerSecret = authorization.toLowerCase().startsWith("bearer ") ? authorization.slice(7).trim() : "";

  if (![bearerSecret, headerSecret].includes(syncSecret)) {
    return NextResponse.json({ error: "Unauthorized Garland Teamship daily sync request." }, { status: 401 });
  }

  if (!config.configured) {
    return NextResponse.json(
      {
        error: `Teamship is not configured. Missing: ${config.missing.join(", ")}.`,
        configuration: config
      },
      { status: 503 }
    );
  }

  const requestUrl = new URL(request.url);
  const shipmentDate = requestUrl.searchParams.get("shipmentDate") ?? getTodayInputValue();

  try {
    const orders = await fetchTeamshipShippingOrdersForReview({ shipmentDate, srNumbers: [] });

    return NextResponse.json({
      orders,
      totalCount: orders.length,
      fetchedAt: new Date().toISOString(),
      cron: {
        enabled: true,
        scheduled: false,
        cadence: "15 minutes",
        shipmentDate,
        note: "This endpoint is cron-ready and read-only, but no Vercel cron schedule is enabled in the repo yet."
      }
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to run Garland Teamship daily sync." },
      { status: 502 }
    );
  }
}

function getTodayInputValue() {
  const now = new Date();
  const offsetMs = now.getTimezoneOffset() * 60 * 1000;
  return new Date(now.getTime() - offsetMs).toISOString().slice(0, 10);
}
