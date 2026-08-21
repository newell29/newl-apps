import { createHash } from "node:crypto";

import type {
  TeamshipReadSession,
  TeamshipShippingProductSearchRow,
  TeamshipRuntimeCredentials
} from "@/server/integrations/teamship";
import {
  findTeamshipShippingOrders,
  searchTeamshipProductsForShipping
} from "@/server/integrations/teamship";
import { resolveTenantTeamshipCredentials } from "@/server/integrations/teamship-settings";
import type { TmgFulfillmentType } from "@/modules/shipment-documents/tmg-order-types";

const DEFAULT_TEAMSHIP_API_BASE_URL = "https://app.teamshipos.com/api";
const TEAMSHIP_SELF_PICKUP_CARRIER = "P/U";

export type TmgTeamshipProfile = {
  customerId: string;
  customerName: string;
  warehouseId: string;
  warehouseName: string;
  inventoryUserId: string;
  inventoryLocationId: string;
  carrierName: string;
};

export type TmgTeamshipPlanOrder = {
  customerReference: string;
  fulfillmentType: TmgFulfillmentType;
  orderDate: string;
  proNumber: string | null;
  packetHash: string;
  shipTo: {
    name: string;
    address: string;
    city: string;
    state: string;
    postalCode: string;
    countryCode: string;
    phone: string;
    email: string | null;
  };
  items: Array<{ sku: string; quantity: number }>;
};

export type TmgTeamshipCreatePayload = {
  customer_id: number;
  status: "requested";
  orderType: "unit";
  selectedProducts: Record<string, { stock_id: number; quantity: number }>;
  warehouse_id: number;
  shippingMethod: "ltl";
  ltlShipmentID: string;
  spdShipmentID: "";
  carrier_value: string;
  proNumber: string;
  poNumber: string;
  pickETA_date: string;
  ship_first_name: string;
  ship_last_name: null;
  ship_address: string;
  ship_city: string;
  ship_state: string;
  ship_zip: string;
  ship_country: string;
  ship_phone_number: string;
  ship_email: string | null;
};

export type TmgTeamshipCreatePlan = {
  workflowKey: "TMG_TEAMSHIP_CREATE_V1";
  customerReference: string;
  fulfillmentType: TmgFulfillmentType;
  packetHash: string;
  payload: TmgTeamshipCreatePayload;
  products: Array<{
    sku: string;
    productId: number;
    stockId: number;
    quantity: number;
  }>;
  requestHash: string;
};

export type TmgTeamshipApproval = {
  approvedByUserId: string;
  approvedAt: string;
  requestHash: string;
};

export type TmgTeamshipCreateEvidence = {
  requestHash: string;
  teamshipOrderId: string;
  teamshipOrderNumber: string;
  teamshipUrl: string;
  responseStatus: number;
  verifiedAt: string;
};

export async function buildTmgTeamshipCreatePlan({
  tenantId,
  order,
  profile,
  credentials = null,
  readSession,
  fetchImpl = fetch,
  searchProducts = searchTeamshipProductsForShipping
}: {
  tenantId: string;
  order: TmgTeamshipPlanOrder;
  profile: TmgTeamshipProfile;
  credentials?: TeamshipRuntimeCredentials | null;
  readSession?: TeamshipReadSession;
  fetchImpl?: typeof fetch;
  searchProducts?: typeof searchTeamshipProductsForShipping;
}): Promise<TmgTeamshipCreatePlan> {
  assertPositiveInteger(profile.customerId, "TMG Teamship customer ID");
  assertPositiveInteger(profile.warehouseId, "TMG Teamship warehouse ID");
  assertPositiveInteger(profile.inventoryUserId, "TMG Teamship inventory user ID");
  assertPositiveInteger(profile.inventoryLocationId, "TMG Teamship inventory location ID");
  if (order.items.length === 0) throw new Error("A TMG order must contain at least one packing-slip item.");

  const products = [] as TmgTeamshipCreatePlan["products"];
  const selectedProducts: TmgTeamshipCreatePayload["selectedProducts"] = {};
  for (const item of order.items) {
    if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
      throw new Error(`TMG packing-slip quantity for ${item.sku} must be a positive integer.`);
    }
    const rows = await searchProducts({
      tenantId,
      userId: profile.inventoryUserId,
      locationId: profile.inventoryLocationId,
      search: item.sku,
      credentials,
      readSession,
      fetchImpl
    });
    const match = selectExactTeamshipProduct({ rows, sku: item.sku, quantity: item.quantity, profile });
    const key = `${match.productId}-${match.stockId}`;
    if (selectedProducts[key]) throw new Error(`TMG product selection ${key} was duplicated.`);
    selectedProducts[key] = { stock_id: match.stockId, quantity: item.quantity };
    products.push({ sku: item.sku, productId: match.productId, stockId: match.stockId, quantity: item.quantity });
  }

  const payload: TmgTeamshipCreatePayload = {
    customer_id: Number(profile.customerId),
    status: "requested",
    orderType: "unit",
    selectedProducts,
    warehouse_id: Number(profile.warehouseId),
    shippingMethod: "ltl",
    ltlShipmentID: order.customerReference,
    spdShipmentID: "",
    carrier_value: order.fulfillmentType === "SELF_PICKUP" ? TEAMSHIP_SELF_PICKUP_CARRIER : profile.carrierName,
    proNumber: order.fulfillmentType === "SELF_PICKUP" ? "" : requireFreightProNumber(order.proNumber),
    poNumber: order.customerReference,
    pickETA_date: formatTeamshipDate(order.orderDate),
    ship_first_name: order.shipTo.name,
    ship_last_name: null,
    ship_address: order.shipTo.address,
    ship_city: order.shipTo.city,
    ship_state: order.shipTo.state,
    ship_zip: order.shipTo.postalCode,
    ship_country: order.shipTo.countryCode,
    ship_phone_number: order.shipTo.phone,
    ship_email: order.shipTo.email
  };
  const requestHash = hashTmgTeamshipRequest({
    workflowKey: "TMG_TEAMSHIP_CREATE_V1",
    customerReference: order.customerReference,
    fulfillmentType: order.fulfillmentType,
    packetHash: order.packetHash,
    payload,
    products
  });

  return {
    workflowKey: "TMG_TEAMSHIP_CREATE_V1",
    customerReference: order.customerReference,
    fulfillmentType: order.fulfillmentType,
    packetHash: order.packetHash,
    payload,
    products,
    requestHash
  };
}

export async function executeApprovedTmgTeamshipCreatePlan({
  tenantId,
  plan,
  approval,
  credentials = null,
  fetchImpl = fetch,
  findExistingOrders = findTeamshipShippingOrders
}: {
  tenantId: string;
  plan: TmgTeamshipCreatePlan;
  approval: TmgTeamshipApproval;
  credentials?: TeamshipRuntimeCredentials | null;
  fetchImpl?: typeof fetch;
  findExistingOrders?: typeof findTeamshipShippingOrders;
}): Promise<TmgTeamshipCreateEvidence> {
  assertApprovalMatchesPlan(plan, approval);
  const existing = await findExistingOrders({
    tenantId,
    orderIdentifier: plan.customerReference,
    credentials,
    fetchImpl
  });
  if (existing.some((order) => hasExactTmgTeamshipReference(order as Record<string, unknown>, plan.customerReference))) {
    throw new Error("An exact Teamship order already exists for this TMG customer reference. No create request was sent.");
  }

  const resolvedCredentials = credentials ?? await resolveTenantTeamshipCredentials({ tenantId });
  if (!resolvedCredentials) throw new Error("Teamship credentials are not configured for this tenant.");
  const apiBaseUrl = resolvedCredentials.apiBaseUrl?.trim().replace(/\/$/, "") || DEFAULT_TEAMSHIP_API_BASE_URL;
  const token = await login(fetchImpl, resolvedCredentials, apiBaseUrl);
  let response: Response;
  try {
    response = await fetchImpl(`${apiBaseUrl}/v1/ship-inventories`, {
      method: "POST",
      headers: buildHeaders(token),
      body: JSON.stringify(plan.payload),
      cache: "no-store"
    });
  } catch (error) {
    throw new Error(
      `The Teamship create request ended without a response. Do not retry automatically; search Teamship for the exact customer reference first. ${describeError(error)}`
    );
  }

  const json = await response.json().catch(() => null) as {
    data?: { id?: number | string; order_number?: number | string };
    message?: string;
    errors?: Array<{ message?: string }>;
  } | null;
  if (!response.ok || !json?.data?.id) {
    throw new Error(readTeamshipError(json) ?? `Teamship rejected the TMG create request with status ${response.status}.`);
  }
  const teamshipOrderId = String(json.data.id);
  const readback = await fetchImpl(`${apiBaseUrl}/v1/ship-inventories/${encodeURIComponent(teamshipOrderId)}`, {
    headers: buildHeaders(token),
    cache: "no-store"
  });
  const readbackJson = await readback.json().catch(() => null) as { data?: Record<string, unknown> } | null;
  if (!readback.ok || !readbackJson?.data || !hasExactTmgTeamshipReference(readbackJson.data, plan.customerReference)) {
    throw new Error("Teamship created an order, but exact customer-reference readback was not confirmed. The order needs manual review and must not be recreated automatically.");
  }

  const appBaseUrl = apiBaseUrl.replace(/\/api$/, "");
  return {
    requestHash: plan.requestHash,
    teamshipOrderId,
    teamshipOrderNumber: String(json.data.order_number ?? teamshipOrderId),
    teamshipUrl: `${appBaseUrl}/ship-inventories/${encodeURIComponent(teamshipOrderId)}`,
    responseStatus: response.status,
    verifiedAt: new Date().toISOString()
  };
}

export function hashTmgTeamshipRequest(value: Omit<TmgTeamshipCreatePlan, "requestHash">) {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

function selectExactTeamshipProduct({
  rows,
  sku,
  quantity,
  profile
}: {
  rows: TeamshipShippingProductSearchRow[];
  sku: string;
  quantity: number;
  profile: TmgTeamshipProfile;
}) {
  const normalizedSku = sku.trim().toUpperCase();
  const candidates = rows.flatMap((row) => {
    const rowSku = String(row.sku ?? row.product_sku ?? "").trim().toUpperCase();
    if (rowSku !== normalizedSku || readBoolean(row.is_quarantine ?? row.is_quarantine_stock)) return [];
    if (!matchesOptionalId(row.customer_id ?? row.user_id, profile.customerId)) return [];
    if (!matchesOptionalId(row.warehouse_id, profile.warehouseId)) return [];
    if (!matchesOptionalId(row.location_id, profile.inventoryLocationId)) return [];
    const productId = readPositiveInteger(row.product_id ?? row.id);
    const stockId = readPositiveInteger(row.inventory_stock_id ?? row.stock_id ?? row.inventory_id);
    const available = readNumber(row.available_quantity ?? row.available ?? row.on_hand_quantity ?? row.on_hand ?? row.quantity);
    if (!productId || !stockId || available === null || available < quantity) return [];
    return [{ productId, stockId }];
  });
  const unique = Array.from(new Map(candidates.map((candidate) => [`${candidate.productId}-${candidate.stockId}`, candidate])).values());
  if (unique.length !== 1) {
    throw new Error(`Expected one exact, available Teamship stock match for ${normalizedSku}; found ${unique.length}.`);
  }
  return unique[0]!;
}

function assertApprovalMatchesPlan(plan: TmgTeamshipCreatePlan, approval: TmgTeamshipApproval) {
  if (!approval.approvedByUserId.trim() || Number.isNaN(Date.parse(approval.approvedAt))) {
    throw new Error("A valid CSR approval record is required before a TMG Teamship order can be created.");
  }
  const computed = hashTmgTeamshipRequest({
    workflowKey: plan.workflowKey,
    customerReference: plan.customerReference,
    fulfillmentType: plan.fulfillmentType,
    packetHash: plan.packetHash,
    payload: plan.payload,
    products: plan.products
  });
  if (computed !== plan.requestHash || approval.requestHash !== plan.requestHash) {
    throw new Error("The approved TMG request no longer matches the exact Teamship create plan.");
  }
}

export function hasExactTmgTeamshipReference(order: Record<string, unknown>, expected: string) {
  const normalized = expected.trim().toUpperCase();
  return [
    order.poNumber,
    order.po_number,
    order.ltlShipmentID,
    order.amazon_shipment_id1,
    order.shipment_id,
    order.shipmentId
  ].some((value) => String(value ?? "").trim().toUpperCase() === normalized);
}

async function login(fetchImpl: typeof fetch, credentials: TeamshipRuntimeCredentials, apiBaseUrl: string) {
  const response = await fetchImpl(`${apiBaseUrl}/v1/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ email: credentials.email, password: credentials.password }),
    cache: "no-store"
  });
  const json = await response.json().catch(() => null) as { data?: { token?: string }; token?: string } | null;
  const token = json?.data?.token ?? json?.token;
  if (!response.ok || !token) throw new Error(`Teamship login failed with status ${response.status}.`);
  return token;
}

function buildHeaders(token: string) {
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" };
}

function formatTeamshipDate(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) throw new Error("TMG order date must use YYYY-MM-DD format.");
  return `${match[2]}/${match[3]}/${match[1]}`;
}

function requireFreightProNumber(value: string | null) {
  if (!value?.trim()) throw new Error("A freight TMG order requires a BOL PRO number.");
  return value.trim();
}

function assertPositiveInteger(value: string, label: string) {
  if (!readPositiveInteger(value)) throw new Error(`${label} must be a positive integer.`);
}

function readPositiveInteger(value: unknown) {
  const numberValue = readNumber(value);
  return numberValue !== null && Number.isInteger(numberValue) && numberValue > 0 ? numberValue : null;
}

function readNumber(value: unknown) {
  const numberValue = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : Number.NaN;
  return Number.isFinite(numberValue) ? numberValue : null;
}

function readBoolean(value: unknown) {
  return value === true || value === 1 || value === "1" || value === "true";
}

function matchesOptionalId(value: unknown, expected: string) {
  return value === null || value === undefined || String(value).trim() === "" || String(value).trim() === expected.trim();
}

function readTeamshipError(value: { message?: string; errors?: Array<{ message?: string }> } | null) {
  return value?.errors?.map((error) => error.message?.trim()).filter(Boolean).join(" ") || value?.message?.trim() || null;
}

function describeError(error: unknown) {
  return error instanceof Error ? error.message : "Unknown network failure.";
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
