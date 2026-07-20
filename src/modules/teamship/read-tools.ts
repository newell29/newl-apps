import { ModuleKey, type Prisma } from "@prisma/client";

import type {
  TeamshipShippingOrderDetail,
  TeamshipShippingOrderItem
} from "@/modules/shipment-documents/teamship-review-types";
import { hasTeamshipInternalReadAccess } from "@/modules/teamship/access-policy";
import type {
  TeamshipBrowserInventoryAllRow,
  TeamshipBrowserLpnRow,
  TeamshipBrowserProductHistory,
  TeamshipBrowserReadAdapter,
  TeamshipBrowserReceivingOrder
} from "@/modules/teamship/browser-read-contracts";
import { prisma } from "@/server/db";
import {
  findTeamshipShippingOrders,
  searchTeamshipProductsForShipping,
  type TeamshipShippingProductSearchRow
} from "@/server/integrations/teamship";
import {
  getTenantTeamshipSettings,
  resolveTenantTeamshipCredentials,
  type TeamshipReadScope,
  type TeamshipSettings
} from "@/server/integrations/teamship-settings";
import type { AuthenticatedContext } from "@/server/tenant-context";

export type TeamshipReadErrorCode =
  | "INVALID_INPUT"
  | "ACCESS_DENIED"
  | "TOOL_DISABLED"
  | "SCOPE_NOT_CONFIGURED"
  | "SCOPE_UNVERIFIED"
  | "CAPABILITY_UNAVAILABLE"
  | "CREDENTIALS_NOT_CONFIGURED"
  | "TEAMSHIP_UNAVAILABLE"
  | "AUDIT_FAILED";

export type TeamshipResultCardinality = "ZERO" | "ONE" | "MULTIPLE";

export type TeamshipReadResult<T> =
  | {
      ok: true;
      cardinality: TeamshipResultCardinality;
      resultCount: number;
      data: T;
      auditId: string;
    }
  | {
      ok: false;
      error: {
        code: TeamshipReadErrorCode;
        message: string;
        retryable: boolean;
      };
      auditId: string | null;
    };

type TeamshipScopedInput = {
  customerId: string;
  warehouseId: string;
};

export type SearchTeamshipInventoryInput = TeamshipScopedInput & {
  queryType: "SKU" | "LPN";
  query: string;
};

export type SearchTeamshipInventoryAllInput = TeamshipScopedInput & {
  sku: string;
};

export type SearchTeamshipLpnInput = TeamshipScopedInput & {
  queryType: "SKU" | "LPN";
  query: string;
};

export type GetTeamshipShippingOrderInput = TeamshipScopedInput & {
  orderId: string;
};

export type GetTeamshipReceivingOrderInput = TeamshipScopedInput & {
  orderId: string;
};

export type GetTeamshipProductHistoryInput = TeamshipScopedInput & {
  productId: string;
};

export type TeamshipInventoryRecord = {
  inventoryId: string | null;
  sku: string | null;
  productName: string | null;
  lpn: string | null;
  serialNumber: string | null;
  customer: { id: string; name: string };
  warehouse: { id: string; name: string };
  location: { id: string | null; name: string | null };
  onHand: number | null;
  reserved: number | null;
  available: number | null;
  availableSource: "TEAMSHIP" | "COMPUTED" | "UNAVAILABLE";
  quarantined: boolean | null;
};

export type TeamshipShippingOrderRecord = {
  teamshipId: string | null;
  orderId: string;
  status: string | null;
  pickingStatus: string | null;
  packingStatus: string | null;
  customer: { id: string; name: string };
  warehouse: { id: string; name: string };
  carrier: string | null;
  shipmentDate: string | null;
  items: Array<{
    sku: string | null;
    quantity: number | null;
    serialNumbers: string[];
  }>;
};

export type TeamshipInventoryAllRecord = {
  inventoryId: string | null;
  productId: string | null;
  productName: string | null;
  sku: string;
  customer: { id: string; name: string };
  warehouse: { id: string; name: string };
  available: number | null;
  reserved: number | null;
  onHand: number | null;
  backordered: number | null;
  status: string | null;
  quarantined: boolean | null;
  sourceView: "INVENTORY_ALL";
};

export type TeamshipLpnRecord = {
  inventoryId: string | null;
  productId: string | null;
  sku: string | null;
  lpn: string | null;
  quantity: number | null;
  location: string | null;
  status: string | null;
  serialNumber: string | null;
  customer: { id: string; name: string };
  warehouse: { id: string; name: string };
  quarantined: boolean | null;
  sourceView: "SHIP_BY_LPN";
};

export type TeamshipReceivingOrderRecord = {
  orderId: string;
  teamshipId: string | null;
  status: string | null;
  customer: { id: string; name: string };
  warehouse: { id: string; name: string };
  createdAt: string | null;
  eta: string | null;
  carrier: string | null;
  bolNumber: string | null;
  palletCount: number | null;
  items: TeamshipBrowserReceivingOrder["items"];
};

export type TeamshipProductHistoryRecord = {
  productId: string;
  sku: string | null;
  productName: string | null;
  customer: { id: string; name: string };
  warehouse: { id: string; name: string };
  rows: TeamshipBrowserProductHistory["rows"];
};

export type TeamshipToolDependencies = {
  settings?: TeamshipSettings;
  browserReader?: TeamshipBrowserReadAdapter;
};

type AuditOutcome = {
  status: "SUCCESS" | "DENIED" | "ERROR";
  errorCode?: TeamshipReadErrorCode;
  resultCount?: number;
  recordIds?: string[];
};

export async function searchTeamshipInventory(
  context: AuthenticatedContext,
  input: SearchTeamshipInventoryInput,
  dependencies: TeamshipToolDependencies = {}
): Promise<TeamshipReadResult<TeamshipInventoryRecord[]>> {
  const operation = "teamship.read.inventory.search";

  try {
    const query = requireIdentifier(input.query, "query");
    if (input.queryType !== "SKU" && input.queryType !== "LPN") {
      return await auditedError(context, operation, input, "INVALID_INPUT", "queryType must be SKU or LPN.", false);
    }

    const scopeResult = await authorizeTeamshipScope(context, input, dependencies.settings);
    if (!scopeResult.ok) {
      return await auditedError(context, operation, input, scopeResult.code, scopeResult.message, false);
    }
    const credentials = await resolveTenantTeamshipCredentials(context);
    if (!credentials) {
      return await auditedError(
        context,
        operation,
        input,
        "CREDENTIALS_NOT_CONFIGURED",
        "Tenant-scoped Teamship credentials are not configured.",
        false
      );
    }

    const rows = await searchTeamshipProductsForShipping({
      tenantId: context.tenantId,
      userId: scopeResult.scope.inventoryUserId,
      locationId: scopeResult.scope.inventoryLocationId,
      search: query,
      credentials
    });
    const records = rows
      .filter((row) => rowMatchesInventoryQuery(row, input.queryType, query))
      .filter((row) => rowMatchesConfiguredScope(row, scopeResult.scope))
      .map((row) => normalizeInventoryRecord(row, scopeResult.scope));

    return await auditedSuccess(context, operation, input, records, records.map((record) => record.inventoryId));
  } catch (error) {
    return await auditedUnexpectedError(context, operation, input, error);
  }
}

export async function searchTeamshipInventoryAll(
  context: AuthenticatedContext,
  input: SearchTeamshipInventoryAllInput,
  dependencies: TeamshipToolDependencies = {}
): Promise<TeamshipReadResult<TeamshipInventoryAllRecord[]>> {
  const operation = "teamship.read.inventory-all.search";

  try {
    const sku = requireIdentifier(input.sku, "sku");
    const scopeResult = await authorizeTeamshipScope(context, input, dependencies.settings);
    if (!scopeResult.ok) {
      return await auditedError(context, operation, input, scopeResult.code, scopeResult.message, false);
    }
    if (!dependencies.browserReader) {
      return await auditedError(
        context,
        operation,
        input,
        "CAPABILITY_UNAVAILABLE",
        "The guarded Teamship Inventory All browser reader is not configured for this runtime.",
        false
      );
    }
    const credentials = await resolveTenantTeamshipCredentials(context);
    if (!credentials) {
      return await auditedError(
        context,
        operation,
        input,
        "CREDENTIALS_NOT_CONFIGURED",
        "Tenant-scoped Teamship credentials are not configured.",
        false
      );
    }

    const rows = await dependencies.browserReader.searchInventoryAll({
      credentials,
      scope: toBrowserScope(scopeResult.scope),
      sku
    });
    const exactRows = rows.filter((row) => normalizeIdentifier(row.sku) === normalizeIdentifier(sku));
    const scopedRows = exactRows.filter((row) => browserInventoryRowMatchesScope(row, scopeResult.scope));
    if (exactRows.length > 0 && scopedRows.length === 0) {
      return await auditedError(
        context,
        operation,
        input,
        "SCOPE_UNVERIFIED",
        "Inventory All returned the SKU without exact customer and warehouse evidence for the requested scope.",
        false,
        exactRows.map((row) => row.inventoryId)
      );
    }

    const records = scopedRows.map((row) => normalizeInventoryAllRecord(row, sku, scopeResult.scope));
    return await auditedSuccess(context, operation, input, records, records.map((record) => record.inventoryId));
  } catch (error) {
    return await auditedUnexpectedError(context, operation, input, error);
  }
}

export async function searchTeamshipLpn(
  context: AuthenticatedContext,
  input: SearchTeamshipLpnInput,
  dependencies: TeamshipToolDependencies = {}
): Promise<TeamshipReadResult<TeamshipLpnRecord[]>> {
  const operation = "teamship.read.lpn.search";

  try {
    const query = requireIdentifier(input.query, "query");
    if (input.queryType !== "SKU" && input.queryType !== "LPN") {
      return await auditedError(context, operation, input, "INVALID_INPUT", "queryType must be SKU or LPN.", false);
    }
    const scopeResult = await authorizeTeamshipScope(context, input, dependencies.settings);
    if (!scopeResult.ok) {
      return await auditedError(context, operation, input, scopeResult.code, scopeResult.message, false);
    }
    if (!dependencies.browserReader) {
      return await auditedError(
        context,
        operation,
        input,
        "CAPABILITY_UNAVAILABLE",
        "The guarded Teamship LPN browser reader is not configured for this runtime.",
        false
      );
    }
    const credentials = await resolveTenantTeamshipCredentials(context);
    if (!credentials) {
      return await auditedError(
        context,
        operation,
        input,
        "CREDENTIALS_NOT_CONFIGURED",
        "Tenant-scoped Teamship credentials are not configured.",
        false
      );
    }

    const rows = await dependencies.browserReader.searchLpn({
      credentials,
      scope: toBrowserScope(scopeResult.scope),
      queryType: input.queryType,
      query
    });
    const exactRows = rows.filter((row) => browserLpnRowMatchesQuery(row, input.queryType, query));
    const scopedRows = exactRows.filter((row) => browserLpnRowMatchesScope(row, scopeResult.scope));
    if (exactRows.length > 0 && scopedRows.length === 0) {
      return await auditedError(
        context,
        operation,
        input,
        "SCOPE_UNVERIFIED",
        "Ship by LPN returned a match without exact customer and warehouse evidence for the requested scope.",
        false,
        exactRows.map((row) => row.inventoryId)
      );
    }

    const records = scopedRows.map((row) => normalizeLpnRecord(row, scopeResult.scope));
    return await auditedSuccess(context, operation, input, records, records.map((record) => record.inventoryId));
  } catch (error) {
    return await auditedUnexpectedError(context, operation, input, error);
  }
}

export async function getTeamshipShippingOrder(
  context: AuthenticatedContext,
  input: GetTeamshipShippingOrderInput,
  dependencies: TeamshipToolDependencies = {}
): Promise<TeamshipReadResult<TeamshipShippingOrderRecord[]>> {
  const operation = "teamship.read.shipping-order.get";

  try {
    const orderId = requireIdentifier(input.orderId, "orderId");
    const scopeResult = await authorizeTeamshipScope(context, input, dependencies.settings);
    if (!scopeResult.ok) {
      return await auditedError(context, operation, input, scopeResult.code, scopeResult.message, false);
    }
    const credentials = await resolveTenantTeamshipCredentials(context);
    if (!credentials) {
      return await auditedError(
        context,
        operation,
        input,
        "CREDENTIALS_NOT_CONFIGURED",
        "Tenant-scoped Teamship credentials are not configured.",
        false
      );
    }

    const orders = await findTeamshipShippingOrders({
      tenantId: context.tenantId,
      orderIdentifier: orderId,
      credentials
    });
    const scopedOrders = orders.filter((order) => shippingOrderMatchesScope(order, scopeResult.scope));

    if (orders.length > 0 && scopedOrders.length === 0) {
      return await auditedError(
        context,
        operation,
        input,
        "SCOPE_UNVERIFIED",
        "The matching Teamship order did not contain customer and warehouse evidence for the requested scope.",
        false,
        orders.map(readTeamshipInternalId)
      );
    }

    const records = scopedOrders.map((order) => normalizeShippingOrder(order, orderId, scopeResult.scope));
    return await auditedSuccess(context, operation, input, records, records.map((record) => record.teamshipId));
  } catch (error) {
    return await auditedUnexpectedError(context, operation, input, error);
  }
}

export async function getTeamshipReceivingOrder(
  context: AuthenticatedContext,
  input: GetTeamshipReceivingOrderInput,
  dependencies: TeamshipToolDependencies = {}
): Promise<TeamshipReadResult<TeamshipReceivingOrderRecord[]>> {
  const operation = "teamship.read.receiving-order.get";

  try {
    const orderId = requireIdentifier(input.orderId, "orderId");
    const scopeResult = await authorizeTeamshipScope(context, input, dependencies.settings);
    if (!scopeResult.ok) {
      return await auditedError(context, operation, input, scopeResult.code, scopeResult.message, false);
    }
    if (!dependencies.browserReader) {
      return await auditedError(
        context,
        operation,
        input,
        "CAPABILITY_UNAVAILABLE",
        "The guarded Teamship receiving-order browser reader is not configured for this runtime.",
        false
      );
    }
    const credentials = await resolveTenantTeamshipCredentials(context);
    if (!credentials) {
      return await auditedError(
        context,
        operation,
        input,
        "CREDENTIALS_NOT_CONFIGURED",
        "Tenant-scoped Teamship credentials are not configured.",
        false
      );
    }

    const orders = await dependencies.browserReader.getReceivingOrder({
      credentials,
      scope: toBrowserScope(scopeResult.scope),
      orderId
    });
    const exactOrders = orders.filter((order) => normalizeIdentifier(order.orderId) === normalizeIdentifier(orderId));
    const scopedOrders = exactOrders.filter((order) => browserReceivingOrderMatchesScope(order, scopeResult.scope));
    if (exactOrders.length > 0 && scopedOrders.length === 0) {
      return await auditedError(
        context,
        operation,
        input,
        "SCOPE_UNVERIFIED",
        "The receiving order did not contain exact customer and warehouse evidence for the requested scope.",
        false,
        exactOrders.map((order) => order.teamshipId)
      );
    }

    const records = scopedOrders.map((order) => normalizeReceivingOrder(order, scopeResult.scope));
    return await auditedSuccess(context, operation, input, records, records.map((record) => record.teamshipId));
  } catch (error) {
    return await auditedUnexpectedError(context, operation, input, error);
  }
}

export async function getTeamshipProductHistory(
  context: AuthenticatedContext,
  input: GetTeamshipProductHistoryInput,
  dependencies: TeamshipToolDependencies = {}
): Promise<TeamshipReadResult<TeamshipProductHistoryRecord[]>> {
  const operation = "teamship.read.product-history.get";

  try {
    const productId = requireIdentifier(input.productId, "productId");
    const scopeResult = await authorizeTeamshipScope(context, input, dependencies.settings);
    if (!scopeResult.ok) {
      return await auditedError(context, operation, input, scopeResult.code, scopeResult.message, false);
    }
    if (!dependencies.browserReader) {
      return await auditedError(
        context,
        operation,
        input,
        "CAPABILITY_UNAVAILABLE",
        "The guarded Teamship product-history browser reader is not configured for this runtime.",
        false
      );
    }
    const credentials = await resolveTenantTeamshipCredentials(context);
    if (!credentials) {
      return await auditedError(
        context,
        operation,
        input,
        "CREDENTIALS_NOT_CONFIGURED",
        "Tenant-scoped Teamship credentials are not configured.",
        false
      );
    }

    const products = await dependencies.browserReader.getProductHistory({
      credentials,
      scope: toBrowserScope(scopeResult.scope),
      productId
    });
    const exactProducts = products.filter((product) => normalizeIdentifier(product.productId) === normalizeIdentifier(productId));
    const scopedProducts = exactProducts.filter((product) => browserProductMatchesCustomer(product, scopeResult.scope));
    if (exactProducts.length > 0 && scopedProducts.length === 0) {
      return await auditedError(
        context,
        operation,
        input,
        "SCOPE_UNVERIFIED",
        "The product did not contain exact customer evidence for the requested scope.",
        false,
        [productId]
      );
    }

    const records = scopedProducts.map((product) => normalizeProductHistory(product, scopeResult.scope));
    return await auditedSuccess(context, operation, input, records, records.map((record) => record.productId));
  } catch (error) {
    return await auditedUnexpectedError(context, operation, input, error);
  }
}

async function authorizeTeamshipScope(
  context: AuthenticatedContext,
  input: TeamshipScopedInput,
  suppliedSettings?: TeamshipSettings
): Promise<
  | { ok: true; scope: TeamshipReadScope }
  | { ok: false; code: TeamshipReadErrorCode; message: string }
> {
  if (!hasTeamshipInternalReadAccess(context)) {
    return { ok: false, code: "ACCESS_DENIED", message: "Teamship read access is not permitted for this user." };
  }

  const moduleAccess = await prisma.tenantModuleAccess.findFirst({
    where: {
      tenantId: context.tenantId,
      enabled: true,
      module: {
        key: ModuleKey.SHIPMENT_DOCUMENTS
      }
    },
    select: { id: true }
  });
  if (!moduleAccess) {
    return { ok: false, code: "ACCESS_DENIED", message: "Teamship read access is not enabled for this tenant." };
  }

  const customerId = requireIdentifier(input.customerId, "customerId");
  const warehouseId = requireIdentifier(input.warehouseId, "warehouseId");
  const settings = suppliedSettings ?? (await getTenantTeamshipSettings(context));

  if (!settings.readOnlySearchEnabled) {
    return { ok: false, code: "TOOL_DISABLED", message: "Teamship read-only search is not enabled for this tenant." };
  }

  const scope = settings.readOnlyScopes.find(
    (candidate) => candidate.customerId === customerId && candidate.warehouseId === warehouseId
  );

  if (!scope) {
    return {
      ok: false,
      code: "SCOPE_NOT_CONFIGURED",
      message: "The requested Teamship customer and warehouse scope is not configured."
    };
  }

  return { ok: true, scope };
}

function normalizeInventoryRecord(
  row: TeamshipShippingProductSearchRow,
  scope: TeamshipReadScope
): TeamshipInventoryRecord {
  const onHand = readNumber(row.on_hand_quantity ?? row.on_hand);
  const reserved = readNumber(row.reserved_quantity ?? row.reserved);
  const teamshipAvailable = readNumber(row.available_quantity ?? row.available);
  const computedAvailable = onHand !== null && reserved !== null ? onHand - reserved : null;

  return {
    inventoryId: readString(row.inventory_stock_id ?? row.stock_id ?? row.inventory_id ?? row.id),
    sku: readString(row.sku ?? row.product_sku),
    productName: readString(row.product_name ?? row.name ?? row.title),
    lpn: readString(row.lpn ?? row.lpn_name ?? row.lpn_id) ?? readCustomAttribute(row, "lpn"),
    serialNumber: readString(row.serial_number ?? row.serial) ?? readCustomAttribute(row, "serial"),
    customer: { id: scope.customerId, name: scope.customerName },
    warehouse: { id: scope.warehouseId, name: scope.warehouseName },
    location: {
      id: readString(row.location_id),
      name: readString(row.location_name)
    },
    onHand,
    reserved,
    available: teamshipAvailable ?? computedAvailable,
    availableSource: teamshipAvailable !== null ? "TEAMSHIP" : computedAvailable !== null ? "COMPUTED" : "UNAVAILABLE",
    quarantined: readBoolean(row.is_quarantine_stock ?? row.is_quarantine)
  };
}

function normalizeInventoryAllRecord(
  row: TeamshipBrowserInventoryAllRow,
  requestedSku: string,
  scope: TeamshipReadScope
): TeamshipInventoryAllRecord {
  return {
    inventoryId: row.inventoryId,
    productId: row.productId,
    productName: row.productName,
    sku: row.sku ?? requestedSku,
    customer: { id: scope.customerId, name: scope.customerName },
    warehouse: { id: scope.warehouseId, name: scope.warehouseName },
    available: row.available,
    reserved: row.reserved,
    onHand: row.onHand,
    backordered: row.backordered,
    status: row.status,
    quarantined: row.quarantined,
    sourceView: "INVENTORY_ALL"
  };
}

function normalizeLpnRecord(row: TeamshipBrowserLpnRow, scope: TeamshipReadScope): TeamshipLpnRecord {
  return {
    inventoryId: row.inventoryId,
    productId: row.productId,
    sku: row.sku,
    lpn: row.lpn,
    quantity: row.quantity,
    location: row.location,
    status: row.status,
    serialNumber: row.serialNumber,
    customer: { id: scope.customerId, name: scope.customerName },
    warehouse: { id: scope.warehouseId, name: scope.warehouseName },
    quarantined: row.quarantined,
    sourceView: "SHIP_BY_LPN"
  };
}

function normalizeReceivingOrder(
  order: TeamshipBrowserReceivingOrder,
  scope: TeamshipReadScope
): TeamshipReceivingOrderRecord {
  return {
    orderId: order.orderId,
    teamshipId: order.teamshipId,
    status: order.status,
    customer: { id: scope.customerId, name: scope.customerName },
    warehouse: { id: scope.warehouseId, name: scope.warehouseName },
    createdAt: order.createdAt,
    eta: order.eta,
    carrier: order.carrier,
    bolNumber: order.bolNumber,
    palletCount: order.palletCount,
    items: order.items
  };
}

function normalizeProductHistory(
  product: TeamshipBrowserProductHistory,
  scope: TeamshipReadScope
): TeamshipProductHistoryRecord {
  return {
    productId: product.productId,
    sku: product.sku,
    productName: product.productName,
    customer: { id: scope.customerId, name: scope.customerName },
    warehouse: { id: scope.warehouseId, name: scope.warehouseName },
    rows: product.rows.filter((row) => warehouseNamesMatch(row.warehouseName, scope.warehouseName))
  };
}

function normalizeShippingOrder(
  order: TeamshipShippingOrderDetail,
  requestedOrderId: string,
  scope: TeamshipReadScope
): TeamshipShippingOrderRecord {
  return {
    teamshipId: readTeamshipInternalId(order),
    orderId: readString(order.shipment_id ?? order.order_number ?? order.display_id ?? order.record_no) ?? requestedOrderId,
    status: readString(order.shipment_status ?? order.shipmentStatus ?? order.status ?? order.state),
    pickingStatus: readString(order.picking_status),
    packingStatus: readString(order.packing_status),
    customer: { id: scope.customerId, name: scope.customerName },
    warehouse: { id: scope.warehouseId, name: scope.warehouseName },
    carrier: readString(order.carrier_name ?? order.shipping_carrier ?? order.carrier ?? order.ship_method),
    shipmentDate: readString(order.shipment_date ?? order.pickup_eta ?? order.pickETA_date),
    items: (order.items ?? order.order_items ?? order.orderItems ?? []).map(normalizeShippingItem)
  };
}

function normalizeShippingItem(item: TeamshipShippingOrderItem) {
  return {
    sku: readString(item.sku ?? item.product_sku ?? item.productSku ?? item.item_number ?? item.itemNumber),
    quantity: readNumber(item.quantity ?? item.qty ?? item.inventory_count),
    serialNumbers: readSerialNumbers(item)
  };
}

function rowMatchesInventoryQuery(row: TeamshipShippingProductSearchRow, queryType: "SKU" | "LPN", query: string) {
  const values = queryType === "SKU"
    ? [row.sku, row.product_sku]
    : [row.lpn, row.lpn_name, row.lpn_id, readCustomAttribute(row, "lpn")];
  return values.some((value) => normalizeIdentifier(value) === normalizeIdentifier(query));
}

function rowMatchesConfiguredScope(row: TeamshipShippingProductSearchRow, scope: TeamshipReadScope) {
  const customerId = readString(row.customer_id ?? row.user_id);
  const warehouseId = readString(row.warehouse_id);
  const locationId = readString(row.location_id);

  return (
    (!customerId || customerId === scope.customerId || customerId === scope.inventoryUserId) &&
    (!warehouseId || warehouseId === scope.warehouseId) &&
    (!locationId || locationId === scope.inventoryLocationId || locationId === scope.warehouseId)
  );
}

function toBrowserScope(scope: TeamshipReadScope) {
  return {
    customerId: scope.customerId,
    customerName: scope.customerName,
    warehouseId: scope.warehouseId,
    warehouseName: scope.warehouseName
  };
}

function browserInventoryRowMatchesScope(row: TeamshipBrowserInventoryAllRow, scope: TeamshipReadScope) {
  return exactBrowserScopeNamesMatch(row.customerName, row.warehouseName, scope);
}

function browserLpnRowMatchesQuery(row: TeamshipBrowserLpnRow, queryType: "SKU" | "LPN", query: string) {
  const value = queryType === "SKU" ? row.sku : row.lpn;
  return normalizeIdentifier(value) === normalizeIdentifier(query);
}

function browserLpnRowMatchesScope(row: TeamshipBrowserLpnRow, scope: TeamshipReadScope) {
  return exactBrowserScopeNamesMatch(row.customerName, row.warehouseName, scope);
}

function browserReceivingOrderMatchesScope(order: TeamshipBrowserReceivingOrder, scope: TeamshipReadScope) {
  return exactBrowserScopeNamesMatch(order.customerName, order.warehouseName, scope);
}

function browserProductMatchesCustomer(product: TeamshipBrowserProductHistory, scope: TeamshipReadScope) {
  return normalizeName(product.customerName) === normalizeName(scope.customerName);
}

function exactBrowserScopeNamesMatch(
  customerName: string | null,
  warehouseName: string | null,
  scope: TeamshipReadScope
) {
  return (
    normalizeName(customerName) === normalizeName(scope.customerName) &&
    warehouseNamesMatch(warehouseName, scope.warehouseName)
  );
}

function warehouseNamesMatch(observedName: string | null, configuredName: string) {
  const observed = normalizeName(observedName);
  const configured = normalizeName(configuredName);
  if (observed === configured) return true;
  return configured === "ANNAGEM" && observed === "MISSISSAUGA - ANNAGEM";
}

function shippingOrderMatchesScope(order: TeamshipShippingOrderDetail, scope: TeamshipReadScope) {
  const customerId = readString(order.customer_id ?? order.user_id ?? order.customer?.id);
  const customerName = readString(order.customer?.company ?? order.customer?.name ?? order.customer_name ?? order.company ?? order.user_company);
  const warehouseId = readString(order.warehouse_id ?? order.location_id);
  const warehouseName = readString(order.warehouse_name ?? order.location_name);
  const customerMatches = customerId
    ? customerId === scope.customerId || customerId === scope.inventoryUserId
    : normalizeName(customerName) === normalizeName(scope.customerName);
  const warehouseMatches = warehouseId
    ? warehouseId === scope.warehouseId || warehouseId === scope.inventoryLocationId
    : normalizeName(warehouseName) === normalizeName(scope.warehouseName);

  return customerMatches && warehouseMatches;
}

async function auditedSuccess<T>(
  context: AuthenticatedContext,
  action: string,
  input: TeamshipScopedInput,
  data: T[],
  recordIds: Array<string | null>
): Promise<TeamshipReadResult<T[]>> {
  const auditId = await writeAudit(context, action, input, {
    status: "SUCCESS",
    resultCount: data.length,
    recordIds: recordIds.filter((value): value is string => Boolean(value))
  });
  if (!auditId) {
    return auditFailure();
  }

  return {
    ok: true,
    cardinality: data.length === 0 ? "ZERO" : data.length === 1 ? "ONE" : "MULTIPLE",
    resultCount: data.length,
    data,
    auditId
  };
}

async function auditedError<T>(
  context: AuthenticatedContext,
  action: string,
  input: TeamshipScopedInput,
  code: TeamshipReadErrorCode,
  message: string,
  retryable: boolean,
  recordIds: Array<string | null> = []
): Promise<TeamshipReadResult<T>> {
  const auditId = await writeAudit(context, action, input, {
    status: code === "ACCESS_DENIED" || code === "SCOPE_NOT_CONFIGURED" ? "DENIED" : "ERROR",
    errorCode: code,
    recordIds: recordIds.filter((value): value is string => Boolean(value))
  });
  if (!auditId) {
    return auditFailure();
  }

  return { ok: false, error: { code, message, retryable }, auditId };
}

async function auditedUnexpectedError<T>(
  context: AuthenticatedContext,
  action: string,
  input: TeamshipScopedInput,
  error: unknown
): Promise<TeamshipReadResult<T>> {
  const isValidationError = error instanceof Error && error.name === "TeamshipInputError";
  return auditedError(
    context,
    action,
    input,
    isValidationError ? "INVALID_INPUT" : "TEAMSHIP_UNAVAILABLE",
    isValidationError ? error instanceof Error ? error.message : "Invalid Teamship input." : "Teamship could not complete the read-only request.",
    !isValidationError
  );
}

async function writeAudit(
  context: AuthenticatedContext,
  action: string,
  input: TeamshipScopedInput,
  outcome: AuditOutcome
) {
  try {
    const record = await prisma.auditLog.create({
      data: {
        tenantId: context.tenantId,
        actorUserId: context.userId,
        action,
        entityType: "TeamshipRead",
        entityId:
          "orderId" in input
            ? readString(input.orderId)
            : "productId" in input
              ? readString(input.productId)
              : "query" in input
                ? readString(input.query)
                : "sku" in input
                  ? readString(input.sku)
                  : null,
        after: {
          customerId: readString(input.customerId),
          warehouseId: readString(input.warehouseId),
          actorRole: context.role,
          accessPolicy: "NEWL_INTERNAL_TEAM_V1",
          queryType: "queryType" in input ? input.queryType : undefined,
          ...outcome
        } as Prisma.InputJsonValue
      },
      select: { id: true }
    });
    return record.id;
  } catch {
    return null;
  }
}

function auditFailure<T>(): TeamshipReadResult<T> {
  return {
    ok: false,
    error: {
      code: "AUDIT_FAILED",
      message: "The Teamship request was not returned because its audit record could not be written.",
      retryable: true
    },
    auditId: null
  };
}

function requireIdentifier(value: unknown, field: string) {
  if (typeof value !== "string") {
    throw inputError(`${field} is required.`);
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > 120 || /[\u0000-\u001f\u007f]/.test(normalized)) {
    throw inputError(`${field} must be between 1 and 120 printable characters.`);
  }
  return normalized;
}

function inputError(message: string) {
  const error = new Error(message);
  error.name = "TeamshipInputError";
  return error;
}

function readString(value: unknown) {
  if (typeof value !== "string" && typeof value !== "number") {
    return null;
  }
  const normalized = String(value).trim();
  return normalized || null;
}

function readNumber(value: unknown) {
  if (typeof value !== "number" && typeof value !== "string") {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function readBoolean(value: unknown) {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return value !== 0;
  }
  if (typeof value === "string") {
    if (/^(true|yes|1)$/i.test(value.trim())) return true;
    if (/^(false|no|0)$/i.test(value.trim())) return false;
  }
  return null;
}

function readCustomAttribute(row: TeamshipShippingProductSearchRow, name: string) {
  const attributes = row.custom_attributes ?? row.customAttributes ?? [];
  const match = attributes.find((attribute) => normalizeName(attribute.name) === normalizeName(name));
  return readString(match?.value);
}

function readSerialNumbers(item: TeamshipShippingOrderItem) {
  const values = [
    item.serial,
    item.serial_number,
    item.serialNumber,
    item.serial_numbers,
    item.serialNumbers,
    item.product?.serial,
    item.product?.serial_number,
    item.product?.serialNumber,
    item.product?.serial_numbers,
    item.product?.serialNumbers
  ];

  return Array.from(new Set(values.flatMap((value) => {
    if (Array.isArray(value)) return value.map(readString).filter((item): item is string => Boolean(item));
    const parsed = readString(value);
    return parsed ? parsed.split(/[,;\n]+/).map((item) => item.trim()).filter(Boolean) : [];
  })));
}

function readTeamshipInternalId(order: TeamshipShippingOrderDetail) {
  return readString(order.id ?? order.order_id);
}

function normalizeIdentifier(value: unknown) {
  return readString(value)?.replace(/[^a-z0-9]/gi, "").toUpperCase() ?? "";
}

function normalizeName(value: unknown) {
  return readString(value)?.replace(/\s+/g, " ").trim().toUpperCase() ?? "";
}
