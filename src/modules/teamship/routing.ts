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

export function routeTeamshipQuestion(prompt: string): TeamshipQuestionRoute {
  const text = prompt.trim();
  const normalized = text.toLowerCase();

  if (!looksLikeTeamshipQuestion(normalized)) {
    return { kind: "NOT_TEAMSHIP" };
  }

  if (looksProcedural(normalized)) {
    return { kind: "KNOWLEDGE", reason: "PROCEDURAL" };
  }

  const customerId = extractIdentifier(text, /\bcustomer(?:\s+id)?\s*[:#]?\s*([A-Z0-9][A-Z0-9._/-]*)/i);
  const warehouseId = extractIdentifier(text, /\bwarehouse(?:\s+id)?\s*[:#]?\s*([A-Z0-9][A-Z0-9._/-]*)/i);
  const sku = extractIdentifier(text, /\bsku\s*[:#]?\s*([A-Z0-9][A-Z0-9._/-]*)/i);
  const lpn = extractIdentifier(text, /\blpn\s*[:#]?\s*([A-Z0-9][A-Z0-9._/-]*)/i);
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
      [!productId ? "productId" : null, !customerId ? "customerId" : null, !warehouseId ? "warehouseId" : null]
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
      [!receivingOrderId ? "receivingOrderId" : null, !customerId ? "customerId" : null, !warehouseId ? "warehouseId" : null]
    );
  }

  if (lpn || /\bwhere is\b/i.test(text) && sku) {
    const queryType = lpn ? "LPN" : "SKU";
    const query = lpn ?? sku;
    return buildToolRoute(
      "searchTeamshipLpn",
      { queryType, ...(query ? { query } : {}), ...(customerId ? { customerId } : {}), ...(warehouseId ? { warehouseId } : {}) },
      [!query ? queryType.toLowerCase() : null, !customerId ? "customerId" : null, !warehouseId ? "warehouseId" : null]
    );
  }

  if (sku && /\b(shipping eligible|eligible to ship|available to ship)\b/i.test(text)) {
    return buildToolRoute(
      "searchTeamshipInventory",
      { queryType: "SKU", query: sku, ...(customerId ? { customerId } : {}), ...(warehouseId ? { warehouseId } : {}) },
      [!customerId ? "customerId" : null, !warehouseId ? "warehouseId" : null]
    );
  }

  if (sku || /\b(how much|available|on hand|reserved|backordered|inventory all)\b/i.test(text)) {
    return buildToolRoute(
      "searchTeamshipInventoryAll",
      { ...(sku ? { sku } : {}), ...(customerId ? { customerId } : {}), ...(warehouseId ? { warehouseId } : {}) },
      [!sku ? "sku" : null, !customerId ? "customerId" : null, !warehouseId ? "warehouseId" : null]
    );
  }

  if (/\border\b/i.test(text) && !shippingOrderId) {
    return {
      kind: "CLARIFICATION",
      intendedTool: null,
      missingFields: ["orderType", "orderId", "customerId", "warehouseId"],
      message: "Specify whether this is a shipping or receiving order, plus the exact order, customer, and warehouse identifiers."
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
      [!shippingOrderId ? "shippingOrderId" : null, !customerId ? "customerId" : null, !warehouseId ? "warehouseId" : null]
    );
  }

  return { kind: "KNOWLEDGE", reason: "PROCEDURAL" };
}

function buildToolRoute(
  tool: TeamshipToolName,
  input: Record<string, string>,
  missing: Array<string | null>
): TeamshipQuestionRoute {
  const missingFields = missing.filter((field): field is string => Boolean(field));
  if (missingFields.length > 0) {
    return {
      kind: "CLARIFICATION",
      intendedTool: tool,
      missingFields,
      message: `Provide the exact ${formatMissingFields(missingFields)} before Teamship can be searched.`
    };
  }

  return { kind: "TOOL", tool, input };
}

function looksLikeTeamshipQuestion(text: string) {
  return /\b(teamship|sku|lpn|inventory|product history|shipping order|receiving order|warehouse|picking|packing|on hand|reserved|order status)\b/.test(text) ||
    /\border\b.*\b(?:cannot|can't|not)\s+proceed\b/.test(text);
}

function looksProcedural(text: string) {
  return /^(?:how do|how does|what is|what does|explain|where do|which screen|difference between)\b/.test(text) &&
    !/\b(status|arrived|received|available|on hand|reserved|where is|cannot proceed|can't proceed)\b/.test(text);
}

function extractIdentifier(text: string, pattern: RegExp) {
  return text.match(pattern)?.[1]?.trim() ?? null;
}

function formatMissingFields(fields: string[]) {
  const labels = fields.map((field) => {
    if (field === "customerId") return "customer identifier";
    if (field === "warehouseId") return "warehouse identifier";
    if (field === "shippingOrderId") return "shipping-order identifier";
    if (field === "receivingOrderId") return "receiving-order identifier";
    if (field === "productId") return "Teamship product identifier";
    if (field === "lpn") return "LPN";
    return field.toUpperCase();
  });

  return labels.length === 1 ? labels[0] : `${labels.slice(0, -1).join(", ")}, and ${labels.at(-1)}`;
}
