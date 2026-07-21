import { AssistantSourceKind } from "@prisma/client";

import {
  getTeamshipReceivingOrder,
  getTeamshipProductHistory,
  getTeamshipShippingOrder,
  searchTeamshipInventory,
  searchTeamshipInventoryAll,
  searchTeamshipLpn,
  type TeamshipInventoryAllRecord,
  type TeamshipInventoryRecord,
  type TeamshipLpnRecord,
  type TeamshipProductHistoryRecord,
  type TeamshipReadResult,
  type TeamshipReceivingOrderRecord,
  type TeamshipShippingOrderRecord
} from "@/modules/teamship/read-tools";
import { getConfiguredTeamshipBrowserJobAdapter } from "@/modules/teamship/browser-read-jobs";
import { routeTeamshipQuestion } from "@/modules/teamship/routing";
import { getTenantTeamshipSettings } from "@/server/integrations/teamship-settings";
import type { AuthenticatedContext } from "@/server/tenant-context";

export async function maybeRunAssistantTeamshipRequest(
  context: AuthenticatedContext,
  prompt: string
) {
  const initialRoute = routeTeamshipQuestion(prompt);

  if (initialRoute.kind === "NOT_TEAMSHIP" || initialRoute.kind === "KNOWLEDGE") {
    return null;
  }

  const settings = await getTenantTeamshipSettings(context);
  const route = routeTeamshipQuestion(prompt, { readOnlyScopes: settings.readOnlyScopes });

  if (route.kind === "NOT_TEAMSHIP" || route.kind === "KNOWLEDGE") {
    return null;
  }

  if (route.kind === "CLARIFICATION") {
    return buildResponse({
      answer: route.message,
      intent: "TEAMSHIP_CLARIFICATION",
      route: route.intendedTool ?? "AMBIGUOUS",
      sources: []
    });
  }

  const browserReader = getConfiguredTeamshipBrowserJobAdapter({
    tenantId: context.tenantId,
    tenantSlug: context.tenantSlug,
    requestedBy: {
      userId: context.userId,
      userEmail: context.userEmail,
      userName: context.userName
    }
  });
  const toolDependencies = browserReader ? { browserReader, settings } : { settings };

  if (route.tool === "searchTeamshipInventory") {
    const result = await searchTeamshipInventory(context, {
      queryType: route.input.queryType as "SKU" | "LPN",
      query: route.input.query,
      customerId: route.input.customerId,
      warehouseId: route.input.warehouseId
    }, toolDependencies);
    return formatInventoryResult(result, route.input);
  }

  if (route.tool === "searchTeamshipInventoryAll") {
    const result = await searchTeamshipInventoryAll(context, {
      sku: route.input.sku,
      customerId: route.input.customerId,
      warehouseId: route.input.warehouseId
    }, toolDependencies);
    return formatInventoryAllResult(result, route.input);
  }

  if (route.tool === "searchTeamshipLpn") {
    const result = await searchTeamshipLpn(context, {
      queryType: route.input.queryType as "SKU" | "LPN" | "SERIAL",
      query: route.input.query,
      customerId: route.input.customerId,
      warehouseId: route.input.warehouseId
    }, toolDependencies);
    return formatLpnResult(result, route.input);
  }

  if (route.tool === "getTeamshipShippingOrder") {
    const result = await getTeamshipShippingOrder(context, {
      orderId: route.input.orderId,
      customerId: route.input.customerId,
      warehouseId: route.input.warehouseId
    }, toolDependencies);
    return formatShippingResult(result, route.input);
  }

  if (route.tool === "getTeamshipReceivingOrder") {
    const result = await getTeamshipReceivingOrder(context, {
      orderId: route.input.orderId,
      customerId: route.input.customerId,
      warehouseId: route.input.warehouseId
    }, toolDependencies);
    return formatReceivingResult(result, route.input);
  }

  const result = await getTeamshipProductHistory(context, {
    productId: route.input.productId,
    customerId: route.input.customerId,
    warehouseId: route.input.warehouseId
  }, toolDependencies);
  return formatProductHistoryResult(result, route.input);
}

function formatInventoryResult(
  result: TeamshipReadResult<TeamshipInventoryRecord[]>,
  input: Record<string, string>
) {
  if (!result.ok) {
    return formatUnavailableResult(result, input, "inventory");
  }

  const lines = result.data.map((record) => {
    const quantities = [
      record.available !== null ? `available ${record.available} (${record.availableSource.toLowerCase()})` : null,
      record.onHand !== null ? `on hand ${record.onHand}` : null,
      record.reserved !== null ? `reserved ${record.reserved}` : null
    ].filter((value): value is string => Boolean(value));
    const location = record.location.name ?? record.location.id ?? "location not returned";
    const handlingUnit = record.lpn ? `, LPN ${record.lpn}` : "";
    const quarantine = record.quarantined === true ? ", quarantined" : record.quarantined === false ? ", not quarantined" : "";
    return `${record.sku ?? input.query}: ${quantities.join(", ") || "quantities not returned"}; ${location}${handlingUnit}${quarantine}.`;
  });
  const answer = result.resultCount === 0
    ? `No exact ${input.queryType} ${input.query} inventory result was returned for customer ${input.customerId} and warehouse ${input.warehouseId}.`
    : `${result.resultCount} exact Teamship inventory result${result.resultCount === 1 ? "" : "s"} returned:\n${lines.join("\n")}`;

  return buildResponse({
    answer,
    intent: "TEAMSHIP_INVENTORY_READ",
    route: "searchTeamshipInventory",
    auditId: result.auditId,
    resultCount: result.resultCount,
    sources: result.data.map((record, index) => ({
      sourceKind: AssistantSourceKind.WMS_RECORD,
      sourceId: record.inventoryId ?? `${input.query}-${index + 1}`,
      title: `Teamship inventory result for ${input.query}`,
      excerpt: lines[index] ?? "Exact Teamship inventory result.",
      metadata: buildSourceMetadata(input, result.auditId, "searchTeamshipInventory")
    }))
  });
}

function formatInventoryAllResult(
  result: TeamshipReadResult<TeamshipInventoryAllRecord[]>,
  input: Record<string, string>
) {
  if (!result.ok) {
    return formatUnavailableResult(result, input, "Inventory All");
  }

  const lines = result.data.map((record) => {
    const quarantine = record.quarantined === true ? ", quarantined" : record.quarantined === false ? ", not quarantined" : "";
    return `${record.sku}: available ${formatQuantity(record.available)}, reserved ${formatQuantity(record.reserved)}, on hand ${formatQuantity(record.onHand)}, backordered ${formatQuantity(record.backordered)}${quarantine}.`;
  });
  const answer = result.resultCount === 0
    ? `No exact SKU ${input.sku} row was visible in Inventory All for customer ${input.customerId} and warehouse ${input.warehouseId}.`
    : `${result.resultCount} exact Inventory All result${result.resultCount === 1 ? "" : "s"} returned:\n${lines.join("\n")}`;

  return buildResponse({
    answer,
    intent: "TEAMSHIP_INVENTORY_ALL_READ",
    route: "searchTeamshipInventoryAll",
    auditId: result.auditId,
    resultCount: result.resultCount,
    input,
    sources: result.data.map((record, index) => ({
      sourceKind: AssistantSourceKind.WMS_RECORD,
      sourceId: record.inventoryId ?? record.productId ?? `${input.sku}-${index + 1}`,
      title: `Teamship Inventory All result for ${record.sku}`,
      excerpt: lines[index] ?? "Exact Teamship Inventory All result.",
      metadata: buildSourceMetadata(input, result.auditId, "searchTeamshipInventoryAll")
    }))
  });
}

function formatLpnResult(
  result: TeamshipReadResult<TeamshipLpnRecord[]>,
  input: Record<string, string>
) {
  if (!result.ok) {
    return formatUnavailableResult(result, input, "Ship by LPN");
  }

  const lines = result.data.map((record) => {
    const quarantine = record.quarantined === true ? ", quarantined" : record.quarantined === false ? ", not quarantined" : "";
    const status = record.status ? `, status ${record.status}` : "";
    return `${record.lpn ?? "LPN not returned"}: SKU ${record.sku ?? "not returned"}, quantity ${formatQuantity(record.quantity)}, location ${record.location ?? "not returned"}, warehouse ${record.warehouse.name}${record.serialNumber ? `, serial ${record.serialNumber}` : ""}${status}${quarantine}.`;
  });
  const answer = result.resultCount === 0
    ? `No exact ${input.queryType} ${input.query} row was visible in Ship by LPN for customer ${input.customerId} and warehouse ${input.warehouseId}.`
    : `${result.resultCount} exact Ship by LPN result${result.resultCount === 1 ? "" : "s"} returned:\n${lines.join("\n")}`;

  return buildResponse({
    answer,
    intent: "TEAMSHIP_LPN_READ",
    route: "searchTeamshipLpn",
    auditId: result.auditId,
    resultCount: result.resultCount,
    input,
    sources: result.data.map((record, index) => ({
      sourceKind: AssistantSourceKind.WMS_RECORD,
      sourceId: record.inventoryId ?? record.lpn ?? `${input.query}-${index + 1}`,
      title: `Teamship LPN result for ${input.query}`,
      excerpt: lines[index] ?? "Exact Teamship Ship by LPN result.",
      metadata: buildSourceMetadata(input, result.auditId, "searchTeamshipLpn")
    }))
  });
}

function formatReceivingResult(
  result: TeamshipReadResult<TeamshipReceivingOrderRecord[]>,
  input: Record<string, string>
) {
  if (!result.ok) {
    return formatUnavailableResult(result, input, "receiving order");
  }

  const lines = result.data.map((record) =>
    `${record.orderId}: status ${record.status ?? "not returned"}; ${record.items.length} product line${record.items.length === 1 ? "" : "s"}; pallet count ${formatQuantity(record.palletCount)}.`
  );
  const answer = result.resultCount === 0
    ? `No exact receiving order ${input.orderId} was returned for customer ${input.customerId} and warehouse ${input.warehouseId}.`
    : `${result.resultCount} exact Teamship receiving order result${result.resultCount === 1 ? "" : "s"} returned:\n${lines.join("\n")}`;

  return buildResponse({
    answer,
    intent: "TEAMSHIP_RECEIVING_ORDER_READ",
    route: "getTeamshipReceivingOrder",
    auditId: result.auditId,
    resultCount: result.resultCount,
    input,
    sources: result.data.map((record, index) => ({
      sourceKind: AssistantSourceKind.WMS_RECORD,
      sourceId: record.teamshipId ?? record.orderId,
      title: `Teamship receiving order ${record.orderId}`,
      excerpt: lines[index] ?? "Exact Teamship receiving-order result.",
      metadata: buildSourceMetadata(input, result.auditId, "getTeamshipReceivingOrder")
    }))
  });
}

function formatProductHistoryResult(
  result: TeamshipReadResult<TeamshipProductHistoryRecord[]>,
  input: Record<string, string>
) {
  if (!result.ok) {
    return formatUnavailableResult(result, input, "product history");
  }

  const lines = result.data.map((record) =>
    `${record.sku ?? record.productId}: ${record.rows.length} history event${record.rows.length === 1 ? "" : "s"} for ${record.warehouse.name}.`
  );
  const answer = result.resultCount === 0
    ? `No exact product ${input.productId} history was returned for customer ${input.customerId} and warehouse ${input.warehouseId}.`
    : `${result.resultCount} exact Teamship product history result${result.resultCount === 1 ? "" : "s"} returned:\n${lines.join("\n")}`;

  return buildResponse({
    answer,
    intent: "TEAMSHIP_PRODUCT_HISTORY_READ",
    route: "getTeamshipProductHistory",
    auditId: result.auditId,
    resultCount: result.resultCount,
    input,
    sources: result.data.map((record, index) => ({
      sourceKind: AssistantSourceKind.WMS_RECORD,
      sourceId: record.productId,
      title: `Teamship product history ${record.sku ?? record.productId}`,
      excerpt: lines[index] ?? "Exact Teamship product-history result.",
      metadata: buildSourceMetadata(input, result.auditId, "getTeamshipProductHistory")
    }))
  });
}

function formatQuantity(value: number | null) {
  return value === null ? "not returned" : String(value);
}

function formatShippingResult(
  result: TeamshipReadResult<TeamshipShippingOrderRecord[]>,
  input: Record<string, string>
) {
  if (!result.ok) {
    return formatUnavailableResult(result, input, "shipping order");
  }

  const lines = result.data.map((record) => {
    const stages = [
      record.status ? `status ${record.status}` : "status not returned",
      record.pickingStatus ? `picking ${record.pickingStatus}` : null,
      record.packingStatus ? `packing ${record.packingStatus}` : null
    ].filter((value): value is string => Boolean(value));
    return `${record.orderId}: ${stages.join(", ")}; ${record.items.length} item line${record.items.length === 1 ? "" : "s"}.`;
  });
  const answer = result.resultCount === 0
    ? `No exact shipping order ${input.orderId} was returned for customer ${input.customerId} and warehouse ${input.warehouseId}.`
    : `${result.resultCount} exact Teamship shipping order result${result.resultCount === 1 ? "" : "s"} returned:\n${lines.join("\n")}`;

  return buildResponse({
    answer,
    intent: "TEAMSHIP_SHIPPING_ORDER_READ",
    route: "getTeamshipShippingOrder",
    auditId: result.auditId,
    resultCount: result.resultCount,
    sources: result.data.map((record, index) => ({
      sourceKind: AssistantSourceKind.WMS_RECORD,
      sourceId: record.teamshipId ?? `${input.orderId}-${index + 1}`,
      title: `Teamship shipping order ${record.orderId}`,
      excerpt: lines[index] ?? "Exact Teamship shipping-order result.",
      metadata: buildSourceMetadata(input, result.auditId, "getTeamshipShippingOrder")
    }))
  });
}

function formatUnavailableResult(
  result: Extract<TeamshipReadResult<unknown>, { ok: false }>,
  input: Record<string, string>,
  subject: string
) {
  return buildResponse({
    answer: `I could not complete the Teamship ${subject} read. ${result.error.message}`,
    intent: "TEAMSHIP_READ_UNAVAILABLE",
    route: subject,
    auditId: result.auditId,
    errorCode: result.error.code,
    sources: [],
    input
  });
}

function buildSourceMetadata(input: Record<string, string>, auditId: string, tool: string) {
  return {
    sourceSystem: "TEAMSHIP_READ_ONLY",
    tool,
    auditId,
    customerId: input.customerId,
    warehouseId: input.warehouseId
  };
}

function buildResponse({
  answer,
  intent,
  route,
  auditId = null,
  resultCount,
  errorCode,
  sources,
  input
}: {
  answer: string;
  intent: string;
  route: string;
  auditId?: string | null;
  resultCount?: number;
  errorCode?: string;
  sources: Array<{
    sourceKind: AssistantSourceKind;
    sourceId: string | null;
    title: string;
    excerpt: string;
    metadata?: Record<string, unknown>;
  }>;
  input?: Record<string, string>;
}) {
  const metadata = {
    deterministic: true,
    intent,
    route,
    auditId,
    resultCount,
    errorCode,
    customerId: input?.customerId,
    warehouseId: input?.warehouseId
  };

  return {
    answer,
    intent,
    provider: "NEWL_TEAMSHIP_READ",
    model: "teamship-read-v1",
    messageMetadata: metadata,
    runMetadata: metadata,
    sources
  };
}
