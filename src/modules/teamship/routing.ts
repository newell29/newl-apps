import { resolveTeamshipScopeReference } from "@/modules/teamship/scope-reference";
import type { TeamshipReadScope } from "@/server/integrations/teamship-settings";

export type TeamshipToolName =
  | "searchTeamshipInventory"
  | "searchTeamshipInventoryAll"
  | "searchTeamshipLpn"
  | "getTeamshipShippingOrder"
  | "getTeamshipReceivingOrder"
  | "getTeamshipProductHistory";

export type TeamshipQuestionRoute =
  | { kind: "NOT_TEAMSHIP" }
  | { kind: "KNOWLEDGE"; reason: "PROCEDURAL" }
  | {
      kind: "TOOL";
      tool: TeamshipToolName;
      input: Record<string, string>;
    }
  | {
      kind: "CLARIFICATION";
      intendedTool: TeamshipToolName | null;
      missingFields: string[];
      message: string;
    };

export function routeTeamshipQuestion(
  prompt: string,
  options: { readOnlyScopes?: readonly TeamshipReadScope[] } = {}
): TeamshipQuestionRoute {
  const text = prompt.trim();
  const normalized = text.toLowerCase();

  if (!looksLikeTeamshipQuestion(normalized)) {
    return { kind: "NOT_TEAMSHIP" };
  }

  if (looksProcedural(normalized)) {
    return { kind: "KNOWLEDGE", reason: "PROCEDURAL" };
  }

  const reference = resolveTeamshipScopeReference(text, options.readOnlyScopes ?? []);
  const isGarland = /\bgarland\b/i.test(text);
  const warehouseWasNamed = /\bwarehouse(?:\s+id)?\s*[:#]?\s*[A-Z0-9._/-]+/i.test(text);
  const customerId = reference.customerId ?? referenceCompatibleIdentifier(
    extractScopedIdentifier(text, "customer"),
    options.readOnlyScopes
  ) ??
    (isGarland ? "420" : null);
  const warehouseId = reference.warehouseId ?? referenceCompatibleIdentifier(
    extractScopedIdentifier(text, "warehouse"),
    options.readOnlyScopes
  ) ??
    (isGarland && !warehouseWasNamed ? "102" : null);
  const sku = extractIdentifier(text, /\bsku(?!s\b)\s*[:#]?\s*([A-Z0-9][A-Z0-9._/-]*)/i);
  const lpn = extractIdentifier(text, /\blpn(?!s\b)(?:\s+(?:number|id))?\s*[:#]?\s*([A-Z0-9][A-Z0-9._/-]*)/i);
  const serial = extractIdentifier(text, /\bserial(?!s\b)(?:\s+number)?\s*[:#]?\s*([A-Z0-9][A-Z0-9._/-]*)/i);
  const productId = extractIdentifier(text, /\bproduct\s+id\s*[:#]?\s*([A-Z0-9][A-Z0-9._/-]*)/i) ??
    extractIdentifier(text, /\bproduct\s*[:#]\s*([A-Z0-9][A-Z0-9._/-]*)/i);
  const receivingOrderId = extractIdentifier(
    text,
    /\b(?:receiving|inventory)\s+order\s*[:#]?\s*([A-Z0-9][A-Z0-9._/-]*)/i
  );
  const shippingOrderId = extractIdentifier(
    text,
    /\bshipping\s+order\s*[:#]?\s*([A-Z0-9][A-Z0-9._/-]*)/i
  ) ?? extractIdentifier(text, /\bsr\s*[:#]?\s*([A-Z0-9][A-Z0-9._/-]*)/i);

  if (/\b(product|inventory)\s+history\b/i.test(text)) {
    return buildToolRoute(
      "getTeamshipProductHistory",
      {
        ...(productId ? { productId } : {}),
        ...(customerId ? { customerId } : {}),
        ...(warehouseId ? { warehouseId } : {})
      },
      [!productId ? "productId" : null, !customerId ? "customerId" : null, !warehouseId ? "warehouseId" : null],
      reference.warehouseChoices
    );
  }

  if (receivingOrderId || /\b(receiving|inventory order|arrived|received)\b/i.test(text)) {
    return buildToolRoute(
      "getTeamshipReceivingOrder",
      {
        ...(receivingOrderId ? { orderId: receivingOrderId } : {}),
        ...(customerId ? { customerId } : {}),
        ...(warehouseId ? { warehouseId } : {})
      },
      [!receivingOrderId ? "receivingOrderId" : null, !customerId ? "customerId" : null, !warehouseId ? "warehouseId" : null],
      reference.warehouseChoices
    );
  }

  const requestsHandlingUnitDetail = /\b(?:lpns?|locations?|serials?|quarantin(?:e|ed))\b/i.test(text);
  if (lpn || serial || (sku && (/\bwhere is\b/i.test(text) || requestsHandlingUnitDetail))) {
    const queryType = lpn ? "LPN" : serial ? "SERIAL" : "SKU";
    const query = lpn ?? serial ?? sku;
    return buildToolRoute(
      "searchTeamshipLpn",
      { queryType, ...(query ? { query } : {}), ...(customerId ? { customerId } : {}), ...(warehouseId ? { warehouseId } : {}) },
      [!query ? queryType.toLowerCase() : null, !customerId ? "customerId" : null, !warehouseId ? "warehouseId" : null],
      reference.warehouseChoices
    );
  }

  if (sku && /\b(shipping eligible|eligible to ship|available to ship)\b/i.test(text)) {
    return buildToolRoute(
      "searchTeamshipInventory",
      { queryType: "SKU", query: sku, ...(customerId ? { customerId } : {}), ...(warehouseId ? { warehouseId } : {}) },
      [!customerId ? "customerId" : null, !warehouseId ? "warehouseId" : null],
      reference.warehouseChoices
    );
  }

  if (sku || /\b(how much|available|on hand|reserved|backordered|inventory all)\b/i.test(text)) {
    return buildToolRoute(
      "searchTeamshipInventoryAll",
      { ...(sku ? { sku } : {}), ...(customerId ? { customerId } : {}), ...(warehouseId ? { warehouseId } : {}) },
      [!sku ? "sku" : null, !customerId ? "customerId" : null, !warehouseId ? "warehouseId" : null],
      reference.warehouseChoices
    );
  }

  if (/\border\b/i.test(text) && !shippingOrderId) {
    return {
      kind: "CLARIFICATION",
      intendedTool: null,
      missingFields: ["orderType", "orderId", "customerId", "warehouseId"],
      message: "Specify whether this is a shipping or receiving order, plus the exact order and configured customer name. Include the warehouse name when that customer has more than one configured warehouse."
    };
  }

  if (shippingOrderId || /\b(shipping order|order status|cannot proceed|can't proceed|not proceed)\b/i.test(text)) {
    return buildToolRoute(
      "getTeamshipShippingOrder",
      {
        ...(shippingOrderId ? { orderId: shippingOrderId } : {}),
        ...(customerId ? { customerId } : {}),
        ...(warehouseId ? { warehouseId } : {})
      },
      [!shippingOrderId ? "shippingOrderId" : null, !customerId ? "customerId" : null, !warehouseId ? "warehouseId" : null],
      reference.warehouseChoices
    );
  }

  return { kind: "KNOWLEDGE", reason: "PROCEDURAL" };
}

function buildToolRoute(
  tool: TeamshipToolName,
  input: Record<string, string>,
  missing: Array<string | null>,
  warehouseChoices: string[] = []
): TeamshipQuestionRoute {
  const missingFields = missing.filter((field): field is string => Boolean(field));
  if (missingFields.length > 0) {
    return {
      kind: "CLARIFICATION",
      intendedTool: tool,
      missingFields,
      message: missingFields.length === 1 && missingFields[0] === "warehouseId" && warehouseChoices.length > 1
        ? `Specify the warehouse by name: ${formatChoices(warehouseChoices)}.`
        : `Provide the exact ${formatMissingFields(missingFields)} before Teamship can be searched.`
    };
  }

  return { kind: "TOOL", tool, input };
}

function formatChoices(choices: string[]) {
  return choices.length === 2 ? choices.join(" or ") : `${choices.slice(0, -1).join(", ")}, or ${choices.at(-1)}`;
}

function referenceCompatibleIdentifier(value: string | null, scopes: readonly TeamshipReadScope[] | undefined) {
  if (!value || !scopes || scopes.length === 0) return value;
  return /^\d+$/.test(value) ? value : null;
}

function looksLikeTeamshipQuestion(text: string) {
  return /\b(teamship|sku|lpn|serial|inventory|product history|shipping order|receiving order|warehouse|picking|packing|on hand|reserved|order status)\b/.test(text) ||
    /\border\b.*\b(?:cannot|can't|not)\s+proceed\b/.test(text);
}

function looksProcedural(text: string) {
  return /^(?:how do|how does|what is|what does|explain|where do|which screen|difference between)\b/.test(text) &&
    !/\b(status|arrived|received|available|on hand|reserved|where is|cannot proceed|can't proceed)\b/.test(text);
}

function extractIdentifier(text: string, pattern: RegExp) {
  return text.match(pattern)?.[1]?.trim() ?? null;
}

function extractScopedIdentifier(text: string, field: "customer" | "warehouse") {
  const parenthetical = extractIdentifier(
    text,
    new RegExp(`\\b${field}(?:\\s+id)?\\s*[:#]?\\s*[A-Z0-9 ._/-]{1,80}\\(\\s*([A-Z0-9][A-Z0-9._/-]*)\\s*\\)`, "i")
  );
  if (parenthetical) return parenthetical;

  const identifier = extractIdentifier(
    text,
    new RegExp(`\\b${field}(?:\\s+id)?\\s*[:#]?\\s*([A-Z0-9][A-Z0-9._/-]*)`, "i")
  );
  if (field === "customer" && identifier?.toLowerCase() === "garland") return "420";
  if (field === "warehouse" && identifier?.toLowerCase() === "annagem") return "102";
  return identifier;
}

function formatMissingFields(fields: string[]) {
  const labels = fields.map((field) => {
    if (field === "customerId") return "configured customer name";
    if (field === "warehouseId") return "configured warehouse name";
    if (field === "shippingOrderId") return "shipping-order identifier";
    if (field === "receivingOrderId") return "receiving-order identifier";
    if (field === "productId") return "Teamship product identifier";
    if (field === "lpn") return "LPN";
    return field.toUpperCase();
  });

  return labels.length === 1 ? labels[0] : `${labels.slice(0, -1).join(", ")}, and ${labels.at(-1)}`;
}
