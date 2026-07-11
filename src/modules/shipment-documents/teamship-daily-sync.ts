import { Prisma } from "@prisma/client";

import type { TeamshipShippingOrderDetail } from "@/modules/shipment-documents/teamship-review-types";
import { prisma } from "@/server/db";
import { fetchTeamshipShippingOrdersForReview } from "@/server/integrations/teamship";
import { getTeamshipSyncEnabledCredentials } from "@/server/integrations/teamship-settings";

type TeamshipSyncTriggerSource = "MANUAL" | "CRON";

export type TeamshipDailySyncResult = {
  runId: string;
  tenantId: string;
  shipmentDate: string;
  triggerSource: TeamshipSyncTriggerSource;
  status: "SUCCESS" | "FAILED" | "SKIPPED";
  fetchedCount: number;
  insertedCount: number;
  updatedCount: number;
  skippedCount: number;
  storedCount: number;
  orders: TeamshipShippingOrderDetail[];
  errorMessage?: string;
};

type SyncInput = {
  tenantId: string;
  shipmentDate: string;
  triggerSource: TeamshipSyncTriggerSource;
  createdByUserId?: string | null;
};

type TeamshipDailySyncClient = typeof prisma & {
  teamshipDailySyncRun: {
    create(args: { data: Record<string, unknown>; select: { id: true } }): Promise<{ id: string }>;
    update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<unknown>;
    findFirst(args: {
      where: Record<string, unknown>;
      orderBy: Record<string, "asc" | "desc">;
      select: { startedAt: true };
    }): Promise<{ startedAt: Date } | null>;
  };
  teamshipSyncedOrder: {
    findMany(args: {
      where: Record<string, unknown>;
      select: Record<string, boolean>;
    }): Promise<Array<{ syncKey?: string }>>;
    upsert(args: {
      where: { tenantId_syncKey: { tenantId: string; syncKey: string } };
      update: Record<string, unknown>;
      create: Record<string, unknown>;
    }): Promise<unknown>;
    count(args: { where: Record<string, unknown> }): Promise<number>;
  };
};

type SyncableOrder = {
  syncKey: string;
  srNumber: string | null;
  teamshipOrderId: string | null;
  teamshipUrl: string | null;
  carrier: string | null;
  shipToName: string | null;
  city: string | null;
  state: string | null;
  rawOrder: Prisma.InputJsonValue;
};

export async function syncTeamshipDailyOrders(input: SyncInput): Promise<TeamshipDailySyncResult> {
  const shipmentDate = parseShipmentDate(input.shipmentDate);
  const client = prisma as TeamshipDailySyncClient;
  const run = await client.teamshipDailySyncRun.create({
    data: {
      tenantId: input.tenantId,
      shipmentDate,
      triggerSource: input.triggerSource,
      status: "RUNNING",
      createdByUserId: input.createdByUserId ?? null
    },
    select: {
      id: true
    }
  });

  try {
    const orders = await fetchTeamshipShippingOrdersForReview({
      tenantId: input.tenantId,
      shipmentDate: input.shipmentDate,
      srNumbers: []
    });
    const syncableOrders = orders.map(mapSyncableOrder).filter((order): order is SyncableOrder => Boolean(order));
    const existingKeys = await loadExistingSyncKeys(input.tenantId, syncableOrders.map((order) => order.syncKey));
    let insertedCount = 0;
    let updatedCount = 0;

    for (const order of syncableOrders) {
      const existed = existingKeys.has(order.syncKey);
      await client.teamshipSyncedOrder.upsert({
        where: {
          tenantId_syncKey: {
            tenantId: input.tenantId,
            syncKey: order.syncKey
          }
        },
        update: {
          shipmentDate,
          srNumber: order.srNumber,
          teamshipOrderId: order.teamshipOrderId,
          teamshipUrl: order.teamshipUrl,
          carrier: order.carrier,
          shipToName: order.shipToName,
          city: order.city,
          state: order.state,
          rawOrder: order.rawOrder,
          lastSyncedAt: new Date(),
          syncCount: {
            increment: 1
          }
        },
        create: {
          tenantId: input.tenantId,
          syncKey: order.syncKey,
          shipmentDate,
          srNumber: order.srNumber,
          teamshipOrderId: order.teamshipOrderId,
          teamshipUrl: order.teamshipUrl,
          carrier: order.carrier,
          shipToName: order.shipToName,
          city: order.city,
          state: order.state,
          rawOrder: order.rawOrder
        }
      });

      if (existed) {
        updatedCount += 1;
      } else {
        insertedCount += 1;
        existingKeys.add(order.syncKey);
      }
    }

    const skippedCount = orders.length - syncableOrders.length;
    const storedCount = await client.teamshipSyncedOrder.count({
      where: {
        tenantId: input.tenantId,
        shipmentDate
      }
    });

    await client.teamshipDailySyncRun.update({
      where: {
        id: run.id
      },
      data: {
        status: "SUCCESS",
        fetchedCount: orders.length,
        insertedCount,
        updatedCount,
        skippedCount,
        finishedAt: new Date()
      }
    });

    return {
      runId: run.id,
      tenantId: input.tenantId,
      shipmentDate: input.shipmentDate,
      triggerSource: input.triggerSource,
      status: "SUCCESS",
      fetchedCount: orders.length,
      insertedCount,
      updatedCount,
      skippedCount,
      storedCount,
      orders
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unable to sync Teamship daily orders.";
    await client.teamshipDailySyncRun.update({
      where: {
        id: run.id
      },
      data: {
        status: "FAILED",
        errorMessage,
        finishedAt: new Date()
      }
    });

    throw error;
  }
}

export async function runDueTeamshipDailySyncs(shipmentDate = getTodayInputValue()) {
  const enabledCredentials = await getTeamshipSyncEnabledCredentials();
  const results: TeamshipDailySyncResult[] = [];

  for (const credential of enabledCredentials) {
    if (!(await isCronSyncDue(credential.tenantId, credential.settings.syncCadenceMinutes))) {
      results.push({
        runId: "",
        tenantId: credential.tenantId,
        shipmentDate,
        triggerSource: "CRON",
        status: "SKIPPED",
        fetchedCount: 0,
        insertedCount: 0,
        updatedCount: 0,
        skippedCount: 0,
        storedCount: 0,
        orders: []
      });
      continue;
    }

    try {
      results.push(
        await syncTeamshipDailyOrders({
          tenantId: credential.tenantId,
          shipmentDate,
          triggerSource: "CRON"
        })
      );
    } catch (error) {
      results.push({
        runId: "",
        tenantId: credential.tenantId,
        shipmentDate,
        triggerSource: "CRON",
        status: "FAILED",
        fetchedCount: 0,
        insertedCount: 0,
        updatedCount: 0,
        skippedCount: 0,
        storedCount: 0,
        orders: [],
        errorMessage: error instanceof Error ? error.message : "Unable to sync Teamship daily orders."
      });
    }
  }

  return results;
}

async function isCronSyncDue(tenantId: string, cadenceMinutes: number) {
  const client = prisma as TeamshipDailySyncClient;
  const latestRun = await client.teamshipDailySyncRun.findFirst({
    where: {
      tenantId,
      triggerSource: "CRON",
      status: "SUCCESS"
    },
    orderBy: {
      startedAt: "desc"
    },
    select: {
      startedAt: true
    }
  });

  if (!latestRun) {
    return true;
  }

  const elapsedMs = Date.now() - latestRun.startedAt.getTime();
  return elapsedMs >= cadenceMinutes * 60 * 1000;
}

async function loadExistingSyncKeys(tenantId: string, syncKeys: string[]) {
  if (syncKeys.length === 0) {
    return new Set<string>();
  }

  const client = prisma as TeamshipDailySyncClient;
  const existing = await client.teamshipSyncedOrder.findMany({
    where: {
      tenantId,
      syncKey: {
        in: syncKeys
      }
    },
    select: {
      syncKey: true
    }
  });

  return new Set(existing.map((order) => order.syncKey).filter((value): value is string => Boolean(value)));
}

function mapSyncableOrder(order: TeamshipShippingOrderDetail): SyncableOrder | null {
  const srNumber = readFirstString(order.shipment_id, order.order_number, order.display_id, order.record_no);
  const teamshipOrderId = readFirstString(order.id, order.order_id);
  const syncKey = normalizeSyncKey(srNumber ?? teamshipOrderId);

  if (!syncKey) {
    return null;
  }

  return {
    syncKey,
    srNumber,
    teamshipOrderId,
    teamshipUrl: readFirstString(order.url),
    carrier: readFirstString(
      order.carrier,
      order.ship_method,
      order.shipping_carrier,
      order.method,
      order.carrier_name,
      order.carrier_value,
      order.shipping_info?.carrier,
      order.shipping_info?.method
    ),
    shipToName: readFirstString(
      order.ship_to_name,
      order.shipping_info?.shipping_address?.company,
      order.shipping_info?.shipping_address?.name,
      order.customer?.company,
      order.customer?.name
    ),
    city: readFirstString(order.ship_to_city, order.ship_city, order.shipping_info?.shipping_address?.city),
    state: readFirstString(order.ship_to_state, order.ship_state, order.shipping_info?.shipping_address?.state),
    rawOrder: order as Prisma.InputJsonValue
  };
}

function readFirstString(...values: Array<unknown>) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }

    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
  }

  return null;
}

function normalizeSyncKey(value: string | null) {
  return value?.trim().replace(/\s+/g, "").toUpperCase() || null;
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
