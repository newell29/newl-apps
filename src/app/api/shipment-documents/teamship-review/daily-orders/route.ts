import { ModuleKey } from "@prisma/client";
import { NextResponse } from "next/server";

import { runDueTeamshipDailySyncs, syncTeamshipDailyOrders } from "@/modules/shipment-documents/teamship-daily-sync";
import { requireModule, requireMutationAccess } from "@/server/auth/authorization";
import { getTeamshipConfigurationStatus } from "@/server/integrations/teamship";
import { getAuthenticatedContext } from "@/server/tenant-context";

type DailyOrdersRequest = {
  shipmentDate?: string;
};

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const context = await getAuthenticatedContext();
  await requireModule(context, ModuleKey.SHIPMENT_DOCUMENTS);
  await requireMutationAccess(context);

  const body = (await request.json().catch(() => null)) as DailyOrdersRequest | null;
  const shipmentDate = typeof body?.shipmentDate === "string" ? body.shipmentDate : null;
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
    const sync = await syncTeamshipDailyOrders({
      tenantId: context.tenantId,
      shipmentDate: shipmentDate ?? getTodayInputValue(),
      triggerSource: "MANUAL",
      createdByUserId: context.userId
    });

    return NextResponse.json({
      orders: sync.orders,
      totalCount: sync.fetchedCount,
      fetchedAt: new Date().toISOString(),
      sync
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to sync Teamship daily orders." },
      { status: 502 }
    );
  }
}

export async function GET(request: Request) {
  const syncSecret = process.env.TEAMSHIP_DAILY_SYNC_SECRET?.trim() || process.env.CRON_SECRET?.trim();

  if (!syncSecret) {
    return NextResponse.json(
      {
        enabled: false,
        scheduled: false,
        cadence: "15 minutes",
        message: "Garland Teamship daily-order sync requires TEAMSHIP_DAILY_SYNC_SECRET or CRON_SECRET before cron requests can run."
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

  const requestUrl = new URL(request.url);
  const shipmentDate = requestUrl.searchParams.get("shipmentDate") ?? getTodayInputValue();

  try {
    const results = await runDueTeamshipDailySyncs(shipmentDate);

    return NextResponse.json({
      results,
      tenantCount: results.length,
      totalFetchedCount: results.reduce((sum, result) => sum + result.fetchedCount, 0),
      totalInsertedCount: results.reduce((sum, result) => sum + result.insertedCount, 0),
      totalUpdatedCount: results.reduce((sum, result) => sum + result.updatedCount, 0),
      totalSkippedCount: results.reduce((sum, result) => sum + result.skippedCount, 0),
      fetchedAt: new Date().toISOString(),
      cron: {
        enabled: true,
        scheduled: true,
        shipmentDate,
        note: "Tenant Settings control whether each tenant syncs and how often it is eligible to run."
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
