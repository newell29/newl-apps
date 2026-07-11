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

export type TeamshipDailySyncRangeResult = {
  runIds: string[];
  tenantId: string;
  dateFrom: string;
  dateTo: string;
  triggerSource: TeamshipSyncTriggerSource;
  status: "SUCCESS" | "FAILED";
  fetchedCount: number;
  insertedCount: number;
  updatedCount: number;
  skippedCount: number;
  storedCount: number;
  orders: TeamshipShippingOrderDetail[];
  results: TeamshipDailySyncResult[];
};

type SyncInput = {
  tenantId: string;
  shipmentDate: string;
  triggerSource: TeamshipSyncTriggerSource;
  createdByUserId?: string | null;
  insertMissingOnly?: boolean;
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
    }): Promise<ExistingSyncedOrder[]>;
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

type ExistingSyncedOrder = Omit<SyncableOrder, "rawOrder"> & {
  rawOrder: unknown;
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
    const existingOrders = await loadExistingSyncOrders(input.tenantId, syncableOrders.map((order) => order.syncKey));
    let insertedCount = 0;
    let updatedCount = 0;
    let existingSkippedCount = 0;

    for (const order of syncableOrders) {
      const existingOrder = existingOrders.get(order.syncKey);

      if (input.insertMissingOnly && existingOrder) {
        existingSkippedCount += 1;
        continue;
      }

      if (existingOrder && !hasSyncedOrderChanged(existingOrder, order)) {
        existingSkippedCount += 1;
        continue;
      }

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

      existingOrders.set(order.syncKey, toExistingSyncedOrder(order));

      if (existingOrder) {
        updatedCount += 1;
      } else {
        insertedCount += 1;
      }
    }

    const skippedCount = orders.length - syncableOrders.length + existingSkippedCount;
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

export async function syncTeamshipDailyOrderRange({
  tenantId,
  dateFrom,
  dateTo,
  triggerSource,
  createdByUserId,
  insertMissingOnly
}: {
  tenantId: string;
  dateFrom: string;
  dateTo: string;
  triggerSource: TeamshipSyncTriggerSource;
  createdByUserId?: string | null;
  insertMissingOnly?: boolean;
}): Promise<TeamshipDailySyncRangeResult> {
  const dates = enumerateDateRange(dateFrom, dateTo);
  const results: TeamshipDailySyncResult[] = [];

  for (const shipmentDate of dates) {
    results.push(
      await syncTeamshipDailyOrders({
        tenantId,
        shipmentDate,
        triggerSource,
        createdByUserId,
        insertMissingOnly
      })
    );
  }

  return {
    runIds: results.map((result) => result.runId).filter(Boolean),
    tenantId,
    dateFrom: dates[0] ?? dateFrom,
    dateTo: dates.at(-1) ?? dateTo,
    triggerSource,
    status: "SUCCESS",
    fetchedCount: results.reduce((sum, result) => sum + result.fetchedCount, 0),
    insertedCount: results.reduce((sum, result) => sum + result.insertedCount, 0),
    updatedCount: results.reduce((sum, result) => sum + result.updatedCount, 0),
    skippedCount: results.reduce((sum, result) => sum + result.skippedCount, 0),
    storedCount: results.reduce((sum, result) => sum + result.storedCount, 0),
    orders: results.flatMap((result) => result.orders),
    results
  };
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

async function loadExistingSyncOrders(tenantId: string, syncKeys: string[]) {
  if (syncKeys.length === 0) {
    return new Map<string, ExistingSyncedOrder>();
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
      syncKey: true,
      srNumber: true,
      teamshipOrderId: true,
      teamshipUrl: true,
      carrier: true,
      shipToName: true,
      city: true,
      state: true,
      rawOrder: true
    }
  });

  return new Map(existing.map((order) => [order.syncKey, order]));
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

function hasSyncedOrderChanged(existing: ExistingSyncedOrder, incoming: SyncableOrder) {
  return (
    normalizeNullable(existing.srNumber) !== normalizeNullable(incoming.srNumber) ||
    normalizeNullable(existing.teamshipOrderId) !== normalizeNullable(incoming.teamshipOrderId) ||
    normalizeNullable(existing.teamshipUrl) !== normalizeNullable(incoming.teamshipUrl) ||
    normalizeNullable(existing.carrier) !== normalizeNullable(incoming.carrier) ||
    normalizeNullable(existing.shipToName) !== normalizeNullable(incoming.shipToName) ||
    normalizeNullable(existing.city) !== normalizeNullable(incoming.city) ||
    normalizeNullable(existing.state) !== normalizeNullable(incoming.state) ||
    stableJson(existing.rawOrder) !== stableJson(incoming.rawOrder)
  );
}

function toExistingSyncedOrder(order: SyncableOrder): ExistingSyncedOrder {
  return {
    syncKey: order.syncKey,
    srNumber: order.srNumber,
    teamshipOrderId: order.teamshipOrderId,
    teamshipUrl: order.teamshipUrl,
    carrier: order.carrier,
    shipToName: order.shipToName,
    city: order.city,
    state: order.state,
    rawOrder: order.rawOrder
  };
}

function normalizeNullable(value: string | null | undefined) {
  return value?.trim() || null;
}

function stableJson(value: unknown) {
  return JSON.stringify(sortJsonValue(value));
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJsonValue);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entryValue]) => [key, sortJsonValue(entryValue)])
    );
  }

  return value;
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

function enumerateDateRange(dateFrom: string, dateTo: string) {
  const parsedFrom = parseShipmentDate(dateFrom);
  const parsedTo = parseShipmentDate(dateTo);
  const start = parsedFrom <= parsedTo ? parsedFrom : parsedTo;
  const end = parsedFrom <= parsedTo ? parsedTo : parsedFrom;
  const dates: string[] = [];

  for (let cursor = new Date(start); cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    dates.push(cursor.toISOString().slice(0, 10));

    if (dates.length > 31) {
      throw new Error("Manual Teamship sync ranges are limited to 31 days at a time.");
    }
  }

  return dates;
}

function getTodayInputValue() {
  const now = new Date();
  const offsetMs = now.getTimezoneOffset() * 60 * 1000;
  return new Date(now.getTime() - offsetMs).toISOString().slice(0, 10);
}
