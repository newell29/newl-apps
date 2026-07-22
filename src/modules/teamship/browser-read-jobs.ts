import type { Prisma } from "@prisma/client";

import type {
  TeamshipBrowserInventoryAllRow,
  TeamshipBrowserLpnRow,
  TeamshipBrowserProductHistory,
  TeamshipBrowserReadAdapter,
  TeamshipBrowserReceivingOrder,
  TeamshipBrowserShippingOrderPallets,
  TeamshipBrowserScope
} from "@/modules/teamship/browser-read-contracts";
import { prisma } from "@/server/db";
import { resolveTenantTeamshipCredentials, type TeamshipStoredCredentials } from "@/server/integrations/teamship-settings";

export const TEAMSHIP_BROWSER_JOB_OPERATIONS = [
  "searchInventoryAll",
  "searchLpn",
  "getReceivingOrder",
  "getProductHistory",
  "getShippingOrderPallets"
] as const;

const TEAMSHIP_BROWSER_JOB_WAIT_MS = 120_000;
const TEAMSHIP_BROWSER_JOB_CLAIM_MS = 3 * 60_000;

export type TeamshipBrowserJobOperation = typeof TEAMSHIP_BROWSER_JOB_OPERATIONS[number];

export type TeamshipBrowserJobInput =
  | { operation: "searchInventoryAll"; sku: string }
  | { operation: "searchLpn"; queryType: "SKU" | "LPN" | "SERIAL"; query: string }
  | { operation: "getReceivingOrder"; orderId: string }
  | { operation: "getProductHistory"; productId: string }
  | { operation: "getShippingOrderPallets"; teamshipOrderId: string };

export type TeamshipBrowserJobResult =
  | { operation: "searchInventoryAll"; rows: TeamshipBrowserInventoryAllRow[] }
  | { operation: "searchLpn"; rows: TeamshipBrowserLpnRow[] }
  | { operation: "getReceivingOrder"; rows: TeamshipBrowserReceivingOrder[] }
  | { operation: "getProductHistory"; rows: TeamshipBrowserProductHistory[] }
  | { operation: "getShippingOrderPallets"; rows: TeamshipBrowserShippingOrderPallets[] };

export class TeamshipBrowserJobValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TeamshipBrowserJobValidationError";
  }
}

export type ClaimedTeamshipBrowserJob = {
  id: string;
  operation: TeamshipBrowserJobOperation;
  input: TeamshipBrowserJobInput;
  scope: TeamshipBrowserScope;
  credentials: TeamshipStoredCredentials;
};

type RequestedBy = {
  userId: string | null;
  userEmail: string | null;
  userName: string | null;
};

type RemoteAdapterOptions = {
  tenantId: string;
  tenantSlug: string;
  requestedBy: RequestedBy;
  timeoutMs?: number;
  pollIntervalMs?: number;
};

export function getTeamshipBrowserWorkerRuntimeStatus(env: Record<string, string | undefined> = process.env) {
  if (env.TEAMSHIP_BROWSER_WORKER_QUEUE_ENABLED !== "true") {
    return {
      enabled: false,
      configured: false,
      reason: "TEAMSHIP_BROWSER_WORKER_QUEUE_ENABLED is not true."
    };
  }
  if (!env.TEAMSHIP_BROWSER_WORKER_TOKEN?.trim()) {
    return {
      enabled: true,
      configured: false,
      reason: "TEAMSHIP_BROWSER_WORKER_TOKEN is not configured."
    };
  }
  if (!env.TEAMSHIP_BROWSER_WORKER_TENANT_SLUG?.trim()) {
    return {
      enabled: true,
      configured: false,
      reason: "TEAMSHIP_BROWSER_WORKER_TENANT_SLUG is not configured."
    };
  }
  return { enabled: true, configured: true, reason: null };
}

export function getConfiguredTeamshipBrowserJobAdapter(
  options: RemoteAdapterOptions,
  env: Record<string, string | undefined> = process.env
): TeamshipBrowserReadAdapter | undefined {
  if (!getTeamshipBrowserWorkerRuntimeStatus(env).configured) {
    return undefined;
  }
  if (env.TEAMSHIP_BROWSER_WORKER_TENANT_SLUG?.trim() !== options.tenantSlug) {
    return undefined;
  }

  return createTeamshipBrowserJobAdapter(options);
}

export function createTeamshipBrowserJobAdapter(options: RemoteAdapterOptions): TeamshipBrowserReadAdapter {
  return {
    async searchInventoryAll(input) {
      const result = await enqueueAndWait({
        ...options,
        scope: input.scope,
        jobInput: { operation: "searchInventoryAll", sku: input.sku }
      });
      return result.operation === "searchInventoryAll" ? result.rows : [];
    },
    async searchLpn(input) {
      const result = await enqueueAndWait({
        ...options,
        scope: input.scope,
        jobInput: { operation: "searchLpn", queryType: input.queryType, query: input.query }
      });
      return result.operation === "searchLpn" ? result.rows : [];
    },
    async getReceivingOrder(input) {
      const result = await enqueueAndWait({
        ...options,
        scope: input.scope,
        jobInput: { operation: "getReceivingOrder", orderId: input.orderId }
      });
      return result.operation === "getReceivingOrder" ? result.rows : [];
    },
    async getProductHistory(input) {
      const result = await enqueueAndWait({
        ...options,
        scope: input.scope,
        jobInput: { operation: "getProductHistory", productId: input.productId }
      });
      return result.operation === "getProductHistory" ? result.rows : [];
    },
    async getShippingOrderPallets(input) {
      const result = await enqueueAndWait({
        ...options,
        scope: input.scope,
        jobInput: { operation: "getShippingOrderPallets", teamshipOrderId: input.teamshipOrderId }
      });
      return result.operation === "getShippingOrderPallets" ? result.rows : [];
    }
  };
}

export async function claimNextTeamshipBrowserJob(
  workerId: string,
  tenantSlug: string
): Promise<ClaimedTeamshipBrowserJob | null> {
  await expireStaleJobs();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + TEAMSHIP_BROWSER_JOB_CLAIM_MS);
  const tenantId = await requireWorkerTenantId(tenantSlug);

  const pending = await prisma.teamshipBrowserReadJob.findFirst({
    where: { tenantId, status: "PENDING", expiresAt: { gt: now } },
    orderBy: { createdAt: "asc" }
  });
  if (!pending) return null;

  const claimed = await prisma.teamshipBrowserReadJob.updateMany({
    where: { id: pending.id, tenantId, status: "PENDING" },
    data: { status: "CLAIMED", workerId, claimedAt: now, expiresAt }
  });
  if (claimed.count !== 1) return null;

  const job = await prisma.teamshipBrowserReadJob.findUniqueOrThrow({ where: { id: pending.id } });
  const credentials = await resolveTenantTeamshipCredentials({ tenantId: job.tenantId });
  if (!credentials) {
    await failTeamshipBrowserJob(job.id, workerId, tenantSlug, "CREDENTIALS_NOT_CONFIGURED", "Tenant-scoped Teamship credentials are not configured.");
    return null;
  }

  const operation = readOperation(job.operation);
  const input = parseJobInput(job.input);
  if (input.operation !== operation) {
    await failTeamshipBrowserJob(job.id, workerId, tenantSlug, "INVALID_JOB", "Teamship browser job operation did not match its input.");
    return null;
  }

  return {
    id: job.id,
    operation,
    input,
    scope: parseScope(job.scope),
    credentials
  };
}

export async function completeTeamshipBrowserJob(
  jobId: string,
  workerId: string,
  tenantSlug: string,
  result: unknown
) {
  const tenantId = await requireWorkerTenantId(tenantSlug);
  const job = await prisma.teamshipBrowserReadJob.findFirst({
    where: { id: jobId, tenantId, status: "CLAIMED", workerId },
    select: { operation: true }
  });
  if (!job) return false;

  const normalizedResult = parseTeamshipBrowserJobResult(result, readOperation(job.operation));
  const updated = await prisma.teamshipBrowserReadJob.updateMany({
    where: { id: jobId, tenantId, status: "CLAIMED", workerId },
    data: {
      status: "COMPLETED",
      result: normalizedResult as unknown as Prisma.InputJsonValue,
      completedAt: new Date(),
      errorCode: null,
      errorMessage: null
    }
  });
  return updated.count === 1;
}

export async function failTeamshipBrowserJob(
  jobId: string,
  workerId: string,
  tenantSlug: string,
  errorCode: string,
  errorMessage: string
) {
  const tenantId = await requireWorkerTenantId(tenantSlug);
  const updated = await prisma.teamshipBrowserReadJob.updateMany({
    where: { id: jobId, tenantId, status: "CLAIMED", workerId },
    data: {
      status: "FAILED",
      failedAt: new Date(),
      errorCode: sanitizeErrorCode(errorCode),
      errorMessage: sanitizeErrorMessage(errorMessage)
    }
  });
  return updated.count === 1;
}

async function enqueueAndWait({
  tenantId,
  requestedBy,
  scope,
  jobInput,
  timeoutMs = TEAMSHIP_BROWSER_JOB_WAIT_MS,
  pollIntervalMs = 1_000
}: RemoteAdapterOptions & {
  scope: TeamshipBrowserScope;
  jobInput: TeamshipBrowserJobInput;
}): Promise<TeamshipBrowserJobResult> {
  const job = await prisma.teamshipBrowserReadJob.create({
    data: {
      tenantId,
      operation: jobInput.operation,
      input: jobInput as unknown as Prisma.InputJsonValue,
      scope: scope as unknown as Prisma.InputJsonValue,
      requestedBy: requestedBy as unknown as Prisma.InputJsonValue,
      expiresAt: new Date(Date.now() + timeoutMs + 30_000)
    },
    select: { id: true }
  });

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const current = await prisma.teamshipBrowserReadJob.findUnique({
      where: { id: job.id },
      select: { status: true, result: true, errorCode: true, errorMessage: true }
    });
    if (!current) {
      throw new Error("Teamship browser job disappeared before completion.");
    }
    if (current.status === "COMPLETED") {
      return parseTeamshipBrowserJobResult(current.result, jobInput.operation);
    }
    if (current.status === "FAILED" || current.status === "EXPIRED") {
      throw new Error(current.errorMessage ?? current.errorCode ?? "Teamship browser job failed.");
    }
    await sleep(pollIntervalMs);
  }

  await prisma.teamshipBrowserReadJob.updateMany({
    where: { id: job.id, status: { in: ["PENDING", "CLAIMED"] } },
    data: { status: "EXPIRED", errorCode: "WORKER_TIMEOUT", errorMessage: "Teamship browser worker did not complete before timeout." }
  });
  throw new Error("Teamship browser worker did not complete before timeout.");
}

async function expireStaleJobs() {
  await prisma.teamshipBrowserReadJob.updateMany({
    where: { status: { in: ["PENDING", "CLAIMED"] }, expiresAt: { lt: new Date() } },
    data: { status: "EXPIRED", errorCode: "JOB_EXPIRED", errorMessage: "Teamship browser job expired before completion." }
  });
}

function parseJobInput(value: unknown): TeamshipBrowserJobInput {
  if (!value || typeof value !== "object") throw new Error("Browser job input is invalid.");
  const record = value as Record<string, unknown>;
  const operation = readOperation(record.operation);
  if (operation === "searchInventoryAll") return { operation, sku: requireString(record.sku, "sku") };
  if (operation === "searchLpn") {
    const queryType = requireString(record.queryType, "queryType");
    if (queryType !== "SKU" && queryType !== "LPN" && queryType !== "SERIAL") throw new Error("queryType is invalid.");
    return { operation, queryType, query: requireString(record.query, "query") };
  }
  if (operation === "getReceivingOrder") return { operation, orderId: requireString(record.orderId, "orderId") };
  if (operation === "getProductHistory") return { operation, productId: requireString(record.productId, "productId") };
  return { operation, teamshipOrderId: requireString(record.teamshipOrderId, "teamshipOrderId") };
}

export function parseTeamshipBrowserJobResult(
  value: unknown,
  expectedOperation: TeamshipBrowserJobOperation
): TeamshipBrowserJobResult {
  const record = requireRecord(value, "Browser job result");
  const operation = readOperation(record.operation);
  if (operation !== expectedOperation) {
    throw validationError("Browser job result operation did not match the claimed operation.");
  }
  const rows = requireArray(record.rows, "rows", 500);

  if (operation === "searchInventoryAll") {
    return { operation, rows: rows.map((row) => parseInventoryAllRow(row)) };
  }
  if (operation === "searchLpn") {
    return { operation, rows: rows.map((row) => parseLpnRow(row)) };
  }
  if (operation === "getReceivingOrder") {
    return { operation, rows: rows.map((row) => parseReceivingOrder(row)) };
  }
  if (operation === "getProductHistory") {
    return { operation, rows: rows.map((row) => parseProductHistory(row)) };
  }
  return { operation, rows: rows.map((row) => parseShippingOrderPallets(row)) };
}

function parseShippingOrderPallets(value: unknown): TeamshipBrowserShippingOrderPallets {
  const row = requireRecord(value, "Shipping order pallet preflight");
  const palletCount = nullableNumber(row.palletCount, "palletCount");
  if (!Number.isInteger(palletCount) || palletCount === null || palletCount <= 0 || palletCount > 100) {
    throw validationError("palletCount must be an integer from 1 to 100.");
  }
  return {
    teamshipOrderId: requiredResultString(row.teamshipOrderId, "teamshipOrderId"),
    palletCount,
    customerName: requiredResultString(row.customerName, "customerName"),
    warehouseName: requiredResultString(row.warehouseName, "warehouseName")
  };
}

function parseInventoryAllRow(value: unknown): TeamshipBrowserInventoryAllRow {
  const row = requireRecord(value, "Inventory All row");
  return {
    inventoryId: nullableString(row.inventoryId, "inventoryId"),
    productId: nullableString(row.productId, "productId"),
    productName: nullableString(row.productName, "productName"),
    sku: nullableString(row.sku, "sku"),
    available: nullableNumber(row.available, "available"),
    reserved: nullableNumber(row.reserved, "reserved"),
    onHand: nullableNumber(row.onHand, "onHand"),
    backordered: nullableNumber(row.backordered, "backordered"),
    status: nullableString(row.status, "status"),
    customerName: nullableString(row.customerName, "customerName"),
    warehouseName: nullableString(row.warehouseName, "warehouseName"),
    quarantined: nullableBoolean(row.quarantined, "quarantined")
  };
}

function parseLpnRow(value: unknown): TeamshipBrowserLpnRow {
  const row = requireRecord(value, "LPN row");
  return {
    inventoryId: nullableString(row.inventoryId, "inventoryId"),
    productId: nullableString(row.productId, "productId"),
    sku: nullableString(row.sku, "sku"),
    lpn: nullableString(row.lpn, "lpn"),
    quantity: nullableNumber(row.quantity, "quantity"),
    location: nullableString(row.location, "location"),
    status: nullableString(row.status, "status"),
    serialNumber: nullableString(row.serialNumber, "serialNumber"),
    customerName: nullableString(row.customerName, "customerName"),
    warehouseName: nullableString(row.warehouseName, "warehouseName"),
    quarantined: nullableBoolean(row.quarantined, "quarantined")
  };
}

function parseReceivingOrder(value: unknown): TeamshipBrowserReceivingOrder {
  const row = requireRecord(value, "Receiving order");
  return {
    orderId: requiredResultString(row.orderId, "orderId"),
    teamshipId: nullableString(row.teamshipId, "teamshipId"),
    status: nullableString(row.status, "status"),
    customerName: nullableString(row.customerName, "customerName"),
    warehouseName: nullableString(row.warehouseName, "warehouseName"),
    createdAt: nullableString(row.createdAt, "createdAt"),
    eta: nullableString(row.eta, "eta"),
    carrier: nullableString(row.carrier, "carrier"),
    bolNumber: nullableString(row.bolNumber, "bolNumber"),
    palletCount: nullableNumber(row.palletCount, "palletCount"),
    items: requireArray(row.items, "items", 1_000).map((item) => {
      const record = requireRecord(item, "Receiving order item");
      return {
        productId: nullableString(record.productId, "productId"),
        sku: nullableString(record.sku, "sku"),
        incoming: nullableNumber(record.incoming, "incoming"),
        received: nullableNumber(record.received, "received"),
        lpn: nullableString(record.lpn, "lpn"),
        location: nullableString(record.location, "location"),
        weight: nullableNumber(record.weight, "weight")
      };
    })
  };
}

function parseProductHistory(value: unknown): TeamshipBrowserProductHistory {
  const row = requireRecord(value, "Product history");
  return {
    productId: requiredResultString(row.productId, "productId"),
    sku: nullableString(row.sku, "sku"),
    productName: nullableString(row.productName, "productName"),
    customerName: nullableString(row.customerName, "customerName"),
    rows: requireArray(row.rows, "history rows", 2_000).map((item) => {
      const record = requireRecord(item, "Product history row");
      return {
        historyId: nullableString(record.historyId, "historyId"),
        date: nullableString(record.date, "date"),
        event: nullableString(record.event, "event"),
        adjustment: nullableNumber(record.adjustment, "adjustment"),
        availableAfter: nullableNumber(record.availableAfter, "availableAfter"),
        warehouseName: nullableString(record.warehouseName, "warehouseName"),
        batch: nullableString(record.batch, "batch"),
        serialNumber: nullableString(record.serialNumber, "serialNumber"),
        status: nullableString(record.status, "status")
      };
    })
  };
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw validationError(`${label} is invalid.`);
  }
  return value as Record<string, unknown>;
}

function requireArray(value: unknown, label: string, maximum: number): unknown[] {
  if (!Array.isArray(value) || value.length > maximum) {
    throw validationError(`${label} must be an array with at most ${maximum} entries.`);
  }
  return value;
}

function requiredResultString(value: unknown, label: string) {
  const parsed = nullableString(value, label);
  if (!parsed) throw validationError(`${label} is required.`);
  return parsed;
}

function nullableString(value: unknown, label: string): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") throw validationError(`${label} must be a string or null.`);
  const normalized = value.trim();
  if (normalized.length > 500 || /[\u0000-\u001f\u007f]/.test(normalized)) {
    throw validationError(`${label} contains invalid text.`);
  }
  return normalized || null;
}

function nullableNumber(value: unknown, label: string): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw validationError(`${label} must be a finite number or null.`);
  }
  return value;
}

function nullableBoolean(value: unknown, label: string): boolean | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "boolean") throw validationError(`${label} must be a boolean or null.`);
  return value;
}

function validationError(message: string) {
  return new TeamshipBrowserJobValidationError(message);
}

async function requireWorkerTenantId(tenantSlug: string) {
  const tenant = await prisma.tenant.findUnique({
    where: { slug: tenantSlug },
    select: { id: true }
  });
  if (!tenant) {
    throw new Error("Configured Teamship browser worker tenant does not exist.");
  }
  return tenant.id;
}

function parseScope(value: unknown): TeamshipBrowserScope {
  if (!value || typeof value !== "object") throw new Error("Browser job scope is invalid.");
  const record = value as Record<string, unknown>;
  return {
    customerId: requireString(record.customerId, "customerId"),
    customerName: requireString(record.customerName, "customerName"),
    warehouseId: requireString(record.warehouseId, "warehouseId"),
    warehouseName: requireString(record.warehouseName, "warehouseName")
  };
}

function readOperation(value: unknown): TeamshipBrowserJobOperation {
  if (typeof value === "string" && TEAMSHIP_BROWSER_JOB_OPERATIONS.includes(value as TeamshipBrowserJobOperation)) {
    return value as TeamshipBrowserJobOperation;
  }
  throw new Error("Teamship browser job operation is invalid.");
}

function requireString(value: unknown, label: string) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required.`);
  return value.trim();
}

function sanitizeErrorCode(value: string) {
  return value.trim().replace(/[^A-Z0-9_:-]/gi, "_").slice(0, 80) || "WORKER_ERROR";
}

function sanitizeErrorMessage(value: string) {
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ").slice(0, 500);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
