import type {
  GarlandPdfShippingOrder,
  GarlandShippingOrderItem,
  GarlandTeamshipOrderReview,
  GarlandTeamshipReviewField,
  GarlandTeamshipReviewResponse,
  GarlandTeamshipReviewSummary,
  ReviewFieldStatus,
  TeamshipCustomField,
  TeamshipShippingOrderDetail
} from "@/modules/shipment-documents/teamship-review-types";

type TextPage = {
  pageNumber: number;
  text: string;
};

const PS_PATTERN = /\bPS\d{6}\b/i;
const SR_PATTERN = /\bSR\d{5,8}\b/i;

export function parseGarlandShippingOrderPages(pages: TextPage[]): GarlandPdfShippingOrder[] {
  const orders: GarlandPdfShippingOrder[] = [];

  for (const page of pages) {
    const parsedPage = parseGarlandShippingOrderPage(page);

    if (!parsedPage) {
      const previous = orders.at(-1);
      if (previous) {
        previous.pageNumbers.push(page.pageNumber);
        previous.rawText = [previous.rawText, page.text].filter(Boolean).join("\n\n");
      }
      continue;
    }

    const existingOrder = findExistingOrder(orders, parsedPage);

    if (existingOrder) {
      existingOrder.pageNumbers.push(page.pageNumber);
      existingOrder.rawText = [existingOrder.rawText, page.text].filter(Boolean).join("\n\n");
      existingOrder.instructions = mergeText(existingOrder.instructions, parsedPage.instructions);
      existingOrder.items.push(...parsedPage.items);
      existingOrder.shipVia ||= parsedPage.shipVia;
      existingOrder.freightTerms ||= parsedPage.freightTerms;
      continue;
    }

    orders.push(parsedPage);
  }

  return orders;
}

function parseGarlandShippingOrderPage(page: TextPage): GarlandPdfShippingOrder | null {
  const lines = normalizePageLines(page.text);
  const fullText = lines.join("\n");
  const psNumber = fullText.match(PS_PATTERN)?.[0].toUpperCase() ?? null;
  const srNumber =
    matchFirst(fullText, [
      /Order Number\s+(SR\d{5,8})/i,
      /Sales Order\s+(SR\d{5,8})/i,
      SR_PATTERN
    ])?.toUpperCase() ?? null;

  if (!psNumber && !srNumber) {
    return null;
  }

  const headerLine = lines.find((line) => PS_PATTERN.test(line));
  const shipToCode = headerLine?.match(/\b(\d{5,10})\b/)?.[1] ?? null;
  const shipToName = extractShipToName(lines);
  const addressLines = extractAddressLines(lines);
  const cityStatePostal = parseCityStatePostal(addressLines);
  const orderLine = lines.find((line) => /(?:Order Number|Sales Order)\s+SR\d+/i.test(line)) ?? "";
  const orderDateShipViaLine = lines.find((line) => /Order Date\b/i.test(line) && /Ship Via\b/i.test(line)) ?? "";
  const itemHeaderIndex = lines.findIndex((line) => /^Ln\s+Item Number\b/i.test(line));

  return {
    pageNumbers: [page.pageNumber],
    psNumber: psNumber ?? "",
    srNumber: srNumber ?? "",
    shipToCode,
    shipToName,
    shipToAddress1: addressLines.find((line) => !parseCityStatePostal([line]) && !isCountryLine(line)) ?? null,
    shipToCity: cityStatePostal?.city ?? null,
    shipToState: cityStatePostal?.state ?? null,
    shipToPostalCode: cityStatePostal?.postalCode ?? null,
    shipToCountry: addressLines.find(isCountryLine) ?? null,
    shipToPo: extractShipToPo(orderLine),
    freightTerms: matchFirst(orderLine, [/Frt Terms\s+(.+)$/i]),
    orderDate: matchFirst(orderDateShipViaLine || orderLine, [/Order Date\s+(\d{1,2}\/\d{1,2}\/\d{4})/i]),
    shipVia: matchFirst(orderDateShipViaLine, [/Ship Via\s+(.+)$/i]),
    instructions: extractInstructions(lines, itemHeaderIndex),
    items: extractItems(lines, itemHeaderIndex),
    rawText: page.text
  };
}

function findExistingOrder(orders: GarlandPdfShippingOrder[], candidate: GarlandPdfShippingOrder) {
  return orders.find((order) => {
    if (order.psNumber && candidate.psNumber && order.psNumber === candidate.psNumber) {
      return true;
    }

    return Boolean(order.srNumber && candidate.srNumber && order.srNumber === candidate.srNumber);
  });
}

function normalizePageLines(text: string) {
  return text
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function extractShipToName(lines: string[]) {
  const directLine = lines.find(
    (line) => /Pre-Shipper/i.test(line) && !/^Pre-Shipper\s*$/i.test(line) && !/\bShip-To\b|\bPrint Date\b/i.test(line)
  );
  if (directLine) {
    return directLine.replace(/Pre-Shipper/i, "").trim() || null;
  }

  const preShipperIndex = lines.findIndex((line) => /^Pre-Shipper$/i.test(line));
  if (preShipperIndex >= 0) {
    return lines[preShipperIndex + 1] ?? null;
  }

  return null;
}

function extractAddressLines(lines: string[]) {
  const psHeaderIndex = lines.findIndex((line) => PS_PATTERN.test(line));
  const orderIndex = lines.findIndex((line) => /(?:Order Number|Sales Order)\s+SR\d+/i.test(line));

  if (psHeaderIndex < 0 || orderIndex < 0 || orderIndex <= psHeaderIndex) {
    return [];
  }

  return lines
    .slice(psHeaderIndex + 1, orderIndex)
    .filter((line) => {
      if (/P\s*I\s*C\s*K\s*L\s*I\s*S\s*T/i.test(line)) {
        return false;
      }

      if (/Pre-Shipper/i.test(line)) {
        return false;
      }

      return !/\bShip-To\b|\bPrint Date\b/i.test(line);
    });
}

function parseCityStatePostal(lines: string[]) {
  for (const line of lines) {
    const match = line.match(/^(.+?),\s*([A-Z]{2})\s+([A-Z]\d[A-Z]\s?\d[A-Z]\d|\d{5}(?:-\d{4})?)$/i);
    if (match) {
      return {
        city: match[1]?.trim() ?? null,
        state: match[2]?.trim().toUpperCase() ?? null,
        postalCode: match[3]?.trim().toUpperCase() ?? null
      };
    }
  }

  return null;
}

function isCountryLine(line: string) {
  return /^(Canada|United States(?: of America)?|USA|US)$/i.test(line.trim());
}

function extractShipToPo(line: string) {
  return matchFirst(line, [/Ship To PO\s+(.+?)\s+Frt Terms\b/i, /Ship To PO\s+(.+)$/i]);
}

function extractInstructions(lines: string[], itemHeaderIndex: number) {
  const startIndex = lines.findIndex((line) => /Order Date\b/i.test(line));
  if (startIndex < 0 || itemHeaderIndex <= startIndex) {
    return "";
  }

  return lines.slice(startIndex + 1, itemHeaderIndex).join("\n").trim();
}

function extractItems(lines: string[], itemHeaderIndex: number): GarlandShippingOrderItem[] {
  if (itemHeaderIndex < 0) {
    return [];
  }

  const itemLines = lines.slice(itemHeaderIndex + 1);
  const items: GarlandShippingOrderItem[] = [];
  let current: GarlandShippingOrderItem | null = null;
  const serialCandidates: string[] = [];

  for (const line of itemLines) {
    if (/^\d{1,2}\/\d{1,2}\/\d{4}\b/.test(line)) {
      break;
    }

    const itemStart = line.match(/^(\d+)\s+(.+?)\s+(\d{6})(?:\s|$)/);
    if (itemStart) {
      if (current) {
        current.serialNumbers = extractSerialNumbers(serialCandidates);
        items.push(current);
      }

      current = {
        lineNumber: Number.parseInt(itemStart[1] ?? "", 10),
        sku: (itemStart[2] ?? "").trim(),
        description: "",
        quantity: null,
        dueShipDate: null,
        serialNumbers: []
      };
      serialCandidates.length = 0;
      continue;
    }

    if (!current) {
      continue;
    }

    const quantityMatch = line.match(/\b(\d+(?:\.\d+)?)\s+EA\s+(\d{1,2}\/\d{1,2}\/\d{4})\b/i);
    if (quantityMatch) {
      current.quantity = Number.parseFloat(quantityMatch[1] ?? "");
      current.dueShipDate = quantityMatch[2] ?? null;
      continue;
    }

    if (/^(NEWLS|MACKIE)\b/i.test(line)) {
      serialCandidates.push(line);
      continue;
    }

    current.description = mergeText(current.description, line);
  }

  if (current) {
    current.serialNumbers = extractSerialNumbers(serialCandidates);
    items.push(current);
  }

  return items;
}

function extractSerialNumbers(lines: string[]) {
  return lines.flatMap((line) => {
    const matches = line.match(/\b\d{10,16}\b/g) ?? [];
    return matches.map((match) => match.trim());
  });
}

function matchFirst(text: string, patterns: RegExp[]) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      return match[1].trim();
    }
    if (match?.[0] && pattern === SR_PATTERN) {
      return match[0].trim();
    }
  }

  return null;
}

function mergeText(left: string, right: string) {
  const chunks = [left, right].map((value) => value.trim()).filter(Boolean);
  return Array.from(new Set(chunks)).join("\n");
}

export function buildGarlandTeamshipReview(
  pdfOrders: GarlandPdfShippingOrder[],
  teamshipOrders: TeamshipShippingOrderDetail[]
): GarlandTeamshipReviewResponse {
  const teamshipByShipmentId = new Map(
    teamshipOrders
      .map((order) => [normalizeIdentifier(order.shipment_id), order] as const)
      .filter(([shipmentId]) => shipmentId.length > 0)
  );
  const reviews = pdfOrders.map((pdfOrder) => {
    const teamshipOrder = teamshipByShipmentId.get(normalizeIdentifier(pdfOrder.srNumber)) ?? null;
    return buildOrderReview(pdfOrder, teamshipOrder);
  });

  return {
    summary: summarizeReviews(pdfOrders, reviews),
    pdfOrders,
    reviews,
    fetchedAt: new Date().toISOString()
  };
}

function buildOrderReview(
  pdfOrder: GarlandPdfShippingOrder,
  teamshipOrder: TeamshipShippingOrderDetail | null
): GarlandTeamshipOrderReview {
  if (!teamshipOrder) {
    return {
      srNumber: pdfOrder.srNumber,
      psNumber: pdfOrder.psNumber,
      pageNumbers: pdfOrder.pageNumbers,
      status: "MISSING_TEAMSHIP",
      teamshipOrderId: null,
      teamshipUrl: null,
      issueCount: 1,
      fields: [
        {
          key: "teamshipOrder",
          label: "Teamship shipping order",
          status: "MISSING",
          pdfValue: pdfOrder.srNumber,
          teamshipValue: null,
          message: "No Teamship shipping order was returned for this SR/shipment ID."
        }
      ]
    };
  }

  const fields: GarlandTeamshipReviewField[] = [
    exactField("shipment_id", "Shipment ID / SR", pdfOrder.srNumber, teamshipOrder.shipment_id),
    psField(pdfOrder.psNumber, teamshipOrder),
    exactField("po_number", "Ship To PO", pdfOrder.shipToPo, teamshipOrder.po_number),
    carrierField(pdfOrder.shipVia, teamshipOrder),
    textField("ship_to_name", "Ship-to name", pdfOrder.shipToName, readTeamshipShipToName(teamshipOrder)),
    textField("ship_to_address_1", "Ship-to address", pdfOrder.shipToAddress1, readTeamshipAddress1(teamshipOrder)),
    textField("ship_to_city", "Ship-to city", pdfOrder.shipToCity, readTeamshipCity(teamshipOrder)),
    exactField("ship_to_state", "Ship-to province/state", pdfOrder.shipToState, readTeamshipState(teamshipOrder)),
    postalField(pdfOrder.shipToPostalCode, readTeamshipPostalCode(teamshipOrder)),
    countryField(pdfOrder.shipToCountry, readTeamshipCountry(teamshipOrder)),
    itemSkuField(pdfOrder, teamshipOrder),
    serialField(pdfOrder, teamshipOrder),
    instructionsField(pdfOrder.instructions, teamshipOrder.shipping_instructions)
  ];
  const issueCount = fields.filter((field) => field.status === "DISCREPANCY" || field.status === "MISSING").length;

  return {
    srNumber: pdfOrder.srNumber,
    psNumber: pdfOrder.psNumber,
    pageNumbers: pdfOrder.pageNumbers,
    status: issueCount === 0 ? "PASS" : "FAIL",
    teamshipOrderId: String(teamshipOrder.id ?? teamshipOrder.order_id ?? ""),
    teamshipUrl: teamshipOrder.url ?? null,
    issueCount,
    fields
  };
}

function exactField(key: string, label: string, pdfValue: string | null, teamshipValue: string | number | null | undefined) {
  return buildField({
    key,
    label,
    pdfValue,
    teamshipValue: stringifyValue(teamshipValue),
    matches: normalizeIdentifier(pdfValue) === normalizeIdentifier(teamshipValue)
  });
}

function textField(key: string, label: string, pdfValue: string | null, teamshipValue: string | null | undefined) {
  const pdfNormalized = normalizeText(pdfValue);
  const teamshipNormalized = normalizeText(teamshipValue);
  return buildField({
    key,
    label,
    pdfValue,
    teamshipValue: stringifyValue(teamshipValue),
    matches:
      pdfNormalized.length > 0 &&
      teamshipNormalized.length > 0 &&
      (pdfNormalized === teamshipNormalized ||
        pdfNormalized.includes(teamshipNormalized) ||
        teamshipNormalized.includes(pdfNormalized))
  });
}

function psField(psNumber: string | null, teamshipOrder: TeamshipShippingOrderDetail): GarlandTeamshipReviewField {
  const candidates = collectTeamshipStrings(teamshipOrder);
  const match = candidates.find((candidate) => normalizeIdentifier(candidate).includes(normalizeIdentifier(psNumber)));
  return buildField({
    key: "psNumber",
    label: "Pre-shipper / PS number",
    pdfValue: psNumber,
    teamshipValue: match ?? null,
    matches: Boolean(match)
  });
}

function carrierField(pdfShipVia: string | null, teamshipOrder: TeamshipShippingOrderDetail): GarlandTeamshipReviewField {
  const pdfCarrier = normalizeCarrier(pdfShipVia);
  const candidates = [
    teamshipOrder.carrier,
    teamshipOrder.ship_method,
    teamshipOrder.shipping_carrier,
    teamshipOrder.method,
    teamshipOrder.carrier_name,
    teamshipOrder.shipping_info?.carrier,
    teamshipOrder.shipping_info?.method
  ].filter(Boolean);
  const match = candidates.find((candidate) => normalizeCarrier(candidate) === pdfCarrier) ?? null;

  return buildField({
    key: "carrier",
    label: "Carrier / ship via",
    pdfValue: pdfShipVia,
    teamshipValue: stringifyValue(match ?? candidates.join(" / ")),
    matches: Boolean(pdfCarrier && match)
  });
}

function postalField(pdfValue: string | null, teamshipValue: string | null | undefined) {
  return buildField({
    key: "ship_to_zip",
    label: "Postal / ZIP",
    pdfValue,
    teamshipValue: stringifyValue(teamshipValue),
    matches: normalizePostalCode(pdfValue) === normalizePostalCode(teamshipValue)
  });
}

function countryField(pdfValue: string | null, teamshipValue: string | null | undefined) {
  return buildField({
    key: "ship_to_country",
    label: "Country",
    pdfValue,
    teamshipValue: stringifyValue(teamshipValue),
    matches: normalizeCountry(pdfValue) === normalizeCountry(teamshipValue)
  });
}

function itemSkuField(
  pdfOrder: GarlandPdfShippingOrder,
  teamshipOrder: TeamshipShippingOrderDetail
): GarlandTeamshipReviewField {
  const pdfSkus = pdfOrder.items.map((item) => normalizeSku(item.sku)).filter(Boolean);
  const teamshipSkus = (teamshipOrder.items ?? []).map((item) => normalizeSku(item.sku)).filter(Boolean);
  const missingSkus = pdfSkus.filter((sku) => !teamshipSkus.includes(sku));

  return {
    key: "items",
    label: "Item SKUs",
    status: missingSkus.length === 0 && pdfSkus.length > 0 ? "MATCH" : "DISCREPANCY",
    pdfValue: pdfOrder.items.map((item) => item.sku).join(", ") || null,
    teamshipValue: (teamshipOrder.items ?? []).map((item) => item.sku).filter(Boolean).join(", ") || null,
    message:
      missingSkus.length === 0 && pdfSkus.length > 0
        ? "All PDF SKUs were found in Teamship."
        : `Missing Teamship SKU(s): ${missingSkus.join(", ") || "unable to compare"}.`
  };
}

function serialField(
  pdfOrder: GarlandPdfShippingOrder,
  teamshipOrder: TeamshipShippingOrderDetail
): GarlandTeamshipReviewField {
  const pdfSerials = pdfOrder.items.flatMap((item) => item.serialNumbers);

  if (pdfSerials.length === 0) {
    return {
      key: "serialNumbers",
      label: "Serial numbers",
      status: "INFO",
      pdfValue: null,
      teamshipValue: null,
      message: "No serial numbers were visible in the PDF text for this order."
    };
  }

  const teamshipStrings = collectTeamshipStrings(teamshipOrder).map(normalizeIdentifier);
  const missingSerials = pdfSerials.filter(
    (serial) => !teamshipStrings.some((candidate) => candidate.includes(normalizeIdentifier(serial)))
  );

  return {
    key: "serialNumbers",
    label: "Serial numbers",
    status: missingSerials.length === 0 ? "MATCH" : "DISCREPANCY",
    pdfValue: pdfSerials.join(", "),
    teamshipValue: missingSerials.length === 0 ? "Found in Teamship fields" : "Not all serials found",
    message:
      missingSerials.length === 0
        ? "All PDF serial numbers were found somewhere in the Teamship order detail."
        : `Serial number(s) not found in Teamship detail: ${missingSerials.join(", ")}.`
  };
}

function instructionsField(pdfInstructions: string | null, teamshipInstructions: string | null | undefined) {
  const pdfNormalized = normalizeText(pdfInstructions);

  if (!pdfNormalized) {
    return {
      key: "shipping_instructions",
      label: "Shipping instructions",
      status: "INFO" as ReviewFieldStatus,
      pdfValue: null,
      teamshipValue: stringifyValue(teamshipInstructions),
      message: "No shipping instructions were parsed from the PDF."
    };
  }

  const teamshipNormalized = normalizeText(teamshipInstructions);
  const pdfTokens = pdfNormalized.split(" ").filter((token) => token.length >= 4);
  const matchedTokens = pdfTokens.filter((token) => teamshipNormalized.includes(token));
  const coverage = pdfTokens.length === 0 ? 0 : matchedTokens.length / pdfTokens.length;

  return buildField({
    key: "shipping_instructions",
    label: "Shipping instructions",
    pdfValue: pdfInstructions,
    teamshipValue: stringifyValue(teamshipInstructions),
    matches: coverage >= 0.6
  });
}

function buildField({
  key,
  label,
  pdfValue,
  teamshipValue,
  matches
}: {
  key: string;
  label: string;
  pdfValue: string | null;
  teamshipValue: string | null;
  matches: boolean;
}): GarlandTeamshipReviewField {
  const hasPdf = Boolean(pdfValue?.trim());
  const hasTeamship = Boolean(teamshipValue?.trim());

  if (!hasPdf && !hasTeamship) {
    return {
      key,
      label,
      status: "INFO",
      pdfValue: null,
      teamshipValue: null,
      message: "Neither source provided a value."
    };
  }

  if (!hasTeamship) {
    return {
      key,
      label,
      status: "MISSING",
      pdfValue,
      teamshipValue,
      message: "PDF has a value, but Teamship does not."
    };
  }

  return {
    key,
    label,
    status: matches ? "MATCH" : "DISCREPANCY",
    pdfValue,
    teamshipValue,
    message: matches ? "Values match." : "PDF and Teamship values do not match."
  };
}

function summarizeReviews(
  pdfOrders: GarlandPdfShippingOrder[],
  reviews: GarlandTeamshipOrderReview[]
): GarlandTeamshipReviewSummary {
  return {
    pdfOrderCount: pdfOrders.length,
    teamshipMatchedCount: reviews.filter((review) => review.status !== "MISSING_TEAMSHIP").length,
    passedCount: reviews.filter((review) => review.status === "PASS").length,
    failedCount: reviews.filter((review) => review.status === "FAIL").length,
    missingTeamshipCount: reviews.filter((review) => review.status === "MISSING_TEAMSHIP").length
  };
}

function readTeamshipShipToName(order: TeamshipShippingOrderDetail) {
  return order.ship_to_name ?? order.shipping_info?.shipping_address?.name ?? null;
}

function readTeamshipAddress1(order: TeamshipShippingOrderDetail) {
  return order.ship_to_address_1 ?? order.shipping_info?.shipping_address?.address_1 ?? null;
}

function readTeamshipCity(order: TeamshipShippingOrderDetail) {
  return order.ship_to_city ?? order.shipping_info?.shipping_address?.city ?? null;
}

function readTeamshipState(order: TeamshipShippingOrderDetail) {
  return order.ship_to_state ?? order.shipping_info?.shipping_address?.state ?? null;
}

function readTeamshipPostalCode(order: TeamshipShippingOrderDetail) {
  return order.ship_to_zip ?? order.shipping_info?.shipping_address?.zip ?? null;
}

function readTeamshipCountry(order: TeamshipShippingOrderDetail) {
  return order.ship_to_country ?? order.shipping_info?.shipping_address?.country ?? null;
}

function collectTeamshipStrings(order: TeamshipShippingOrderDetail) {
  const strings: string[] = [];
  const visit = (value: unknown) => {
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      strings.push(String(value));
      return;
    }

    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }

    if (value && typeof value === "object") {
      Object.entries(value as Record<string, unknown>).forEach(([key, childValue]) => {
        if (key.toLowerCase().includes("token") || key.toLowerCase().includes("password")) {
          return;
        }
        visit(childValue);
      });
    }
  };

  visit(order);
  return strings.filter(Boolean);
}

export function readCustomFieldValue(fields: TeamshipCustomField[] | undefined, labels: string[]) {
  const normalizedLabels = labels.map(normalizeText);
  const field = fields?.find((candidate) => {
    const label = normalizeText(candidate.label);
    const ediKey = normalizeText(candidate.edi_key);
    return normalizedLabels.some((normalizedLabel) => label.includes(normalizedLabel) || ediKey.includes(normalizedLabel));
  });

  return stringifyValue(field?.value);
}

function stringifyValue(value: unknown) {
  if (value === null || value === undefined) {
    return null;
  }

  return String(value);
}

function normalizeIdentifier(value: unknown) {
  return stringifyValue(value)?.toUpperCase().replace(/[^A-Z0-9]/g, "") ?? "";
}

function normalizeText(value: unknown) {
  return stringifyValue(value)
    ?.toUpperCase()
    .replace(/&/g, " AND ")
    .replace(/[^A-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim() ?? "";
}

function normalizeSku(value: unknown) {
  return stringifyValue(value)?.toUpperCase().trim() ?? "";
}

function normalizePostalCode(value: unknown) {
  return stringifyValue(value)?.toUpperCase().replace(/[^A-Z0-9]/g, "") ?? "";
}

function normalizeCountry(value: unknown) {
  const normalized = normalizeText(value);

  if (["CA", "CAN", "CANADA"].includes(normalized)) {
    return "CA";
  }

  if (["US", "USA", "UNITED STATES", "UNITED STATES OF AMERICA"].includes(normalized)) {
    return "US";
  }

  return normalized;
}

function normalizeCarrier(value: unknown) {
  const normalized = normalizeText(value);

  if (!normalized) {
    return "";
  }

  if (normalized.includes("SURETRACK") || normalized.includes("SURE TRACK") || normalized.includes("SURETRAK")) {
    return "SURETRACK";
  }

  if (normalized.includes("SPEEDY")) {
    return "SPEEDY";
  }

  if (normalized.includes("MIDLAND")) {
    return "MIDLAND";
  }

  if (normalized.includes("UPS")) {
    return "UPS";
  }

  if (normalized === "P U" || normalized.includes("PICKUP") || normalized.includes("PICK UP")) {
    return "PICKUP";
  }

  return normalized;
}
