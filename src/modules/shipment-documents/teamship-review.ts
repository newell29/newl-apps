import type {
  GarlandPdfShippingOrder,
  GarlandShippingOrderItem,
  GarlandTeamshipOrderReview,
  GarlandTeamshipReviewField,
  GarlandTeamshipReviewResponse,
  GarlandTeamshipReviewSummary,
  ReviewFieldStatus,
  TeamshipAlertOrder,
  TeamshipAlertOrderItem,
  TeamshipCustomField,
  TeamshipShippingOrderDetail
} from "@/modules/shipment-documents/teamship-review-types";
import { buildGarlandProductDimensionRecommendations } from "@/modules/shipment-documents/garland-product-dimensions";

type TextPage = {
  pageNumber: number;
  text: string;
};

const PS_PATTERN = /\bPS\d{6}\b/i;
const SR_PATTERN = /\bSR\d{5,8}\b/i;

export function parseTeamshipAlertDigest(text: string): TeamshipAlertOrder[] {
  const lines = text
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const alerts: TeamshipAlertOrder[] = [];
  let reason = "Teamship alert";
  let current: { srNumber: string; rawLines: string[] } | null = null;

  const pushCurrent = () => {
    if (!current) {
      return;
    }

    const itemLines = current.rawLines.filter((line) => !/^Item Number\s+Description\s+Requested Qty\s+Serial Number$/i.test(line));
    alerts.push({
      srNumber: current.srNumber,
      reason,
      items: itemLines.map(parseAlertItemLine),
      rawText: current.rawLines.join("\n").trim()
    });
    current = null;
  };

  for (const line of lines) {
    const cleanLine = cleanDigestLine(line);
    const reasonMatch = cleanLine.match(/^Shipping Orders\s+[—-]\s+(.+?)(?:\s*\(\d+\))?$/i);

    if (reasonMatch?.[1]) {
      pushCurrent();
      reason = reasonMatch[1].trim();
      continue;
    }

    const orderMatch = cleanLine.match(/\bOrder\s+(SR\d{5,8})\b/i);

    if (orderMatch?.[1]) {
      pushCurrent();
      current = { srNumber: orderMatch[1].toUpperCase(), rawLines: [] };
      continue;
    }

    if (current) {
      current.rawLines.push(cleanLine);
    }
  }

  pushCurrent();

  return dedupeAlerts(alerts);
}

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
  teamshipOrders: TeamshipShippingOrderDetail[],
  teamshipAlerts: TeamshipAlertOrder[] = [],
  options: {
    includeUnmatchedTeamshipOrders?: boolean;
    skippedAlreadyReviewedOrders?: GarlandPdfShippingOrder[];
  } = {}
): GarlandTeamshipReviewResponse {
  const alertByShipmentId = new Map(
    teamshipAlerts.map((alert) => [normalizeIdentifier(alert.srNumber), alert] as const).filter(([shipmentId]) => shipmentId.length > 0)
  );
  const teamshipByShipmentId = groupTeamshipOrdersByShipmentId(teamshipOrders);
  const reviews = pdfOrders.map((pdfOrder) => {
    const teamshipOrder = teamshipByShipmentId.get(normalizeIdentifier(pdfOrder.srNumber)) ?? null;
    const alert = alertByShipmentId.get(normalizeIdentifier(pdfOrder.srNumber)) ?? null;
    return buildOrderReview(pdfOrder, teamshipOrder, alert);
  });
  const skippedAlreadyReviewedReviews = (options.skippedAlreadyReviewedOrders ?? []).map(buildSkippedAlreadyReviewedReview);
  const skippedShipmentIds = new Set(skippedAlreadyReviewedReviews.map((review) => normalizeIdentifier(review.srNumber)));

  if (options.includeUnmatchedTeamshipOrders) {
    const matchedPdfShipmentIds = new Set(pdfOrders.map((order) => normalizeIdentifier(order.srNumber)));

    for (const [shipmentId, teamshipOrder] of teamshipByShipmentId) {
      if (!shipmentId || matchedPdfShipmentIds.has(shipmentId) || skippedShipmentIds.has(shipmentId)) {
        continue;
      }

      reviews.push(buildNoPdfReview(teamshipOrder));
    }
  }

  reviews.push(...skippedAlreadyReviewedReviews);

  return {
    summary: summarizeReviews(pdfOrders, reviews),
    pdfOrders,
    reviews,
    teamshipAlerts,
    fetchedAt: new Date().toISOString()
  };
}

function groupTeamshipOrdersByShipmentId(teamshipOrders: TeamshipShippingOrderDetail[]) {
  const teamshipByShipmentId = new Map<string, TeamshipShippingOrderDetail>();

  for (const order of teamshipOrders) {
    const shipmentId = normalizeIdentifier(readTeamshipShipmentId(order));

    if (!shipmentId || teamshipByShipmentId.has(shipmentId)) {
      continue;
    }

    teamshipByShipmentId.set(shipmentId, order);
  }

  return teamshipByShipmentId;
}

function buildOrderReview(
  pdfOrder: GarlandPdfShippingOrder,
  teamshipOrder: TeamshipShippingOrderDetail | null,
  alert: TeamshipAlertOrder | null
): GarlandTeamshipOrderReview {
  if (!teamshipOrder) {
    if (alert) {
      return {
        srNumber: pdfOrder.srNumber,
        psNumber: pdfOrder.psNumber,
        pageNumbers: pdfOrder.pageNumbers,
        status: "PENDING_TEAMSHIP",
        teamshipOrderId: null,
        teamshipUrl: null,
        issueCount: 0,
        alert,
        productDimensions: buildGarlandProductDimensionRecommendations({ pdfOrder, teamshipOrder: null }),
        fields: [
          {
            key: "teamshipAlert",
            label: "Teamship alert",
            status: "PENDING",
            pdfValue: pdfOrder.srNumber,
            teamshipValue: alert.reason,
            message: buildAlertMessage(alert)
          }
        ]
      };
    }

    return {
      srNumber: pdfOrder.srNumber,
      psNumber: pdfOrder.psNumber,
      pageNumbers: pdfOrder.pageNumbers,
      status: "MISSING_TEAMSHIP",
      teamshipOrderId: null,
      teamshipUrl: null,
      issueCount: 1,
      alert: null,
      productDimensions: buildGarlandProductDimensionRecommendations({ pdfOrder, teamshipOrder: null }),
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
    exactField("shipment_id", "Shipment ID / SR", pdfOrder.srNumber, readTeamshipShipmentId(teamshipOrder)),
    psField(pdfOrder.psNumber, teamshipOrder),
    exactField("po_number", "Ship To PO", pdfOrder.shipToPo, readTeamshipPoNumber(teamshipOrder)),
    exactField("freight_terms", "Freight terms", pdfOrder.freightTerms, readTeamshipFreightTerms(teamshipOrder)),
    carrierField(pdfOrder.shipVia, teamshipOrder),
    textField("ship_to_name", "Ship-to name", pdfOrder.shipToName, readTeamshipShipToName(teamshipOrder)),
    textField("ship_to_address_1", "Ship-to address", pdfOrder.shipToAddress1, readTeamshipAddress1(teamshipOrder)),
    textField("ship_to_city", "Ship-to city", pdfOrder.shipToCity, readTeamshipCity(teamshipOrder)),
    exactField("ship_to_state", "Ship-to province/state", pdfOrder.shipToState, readTeamshipState(teamshipOrder)),
    postalField(pdfOrder.shipToPostalCode, readTeamshipPostalCode(teamshipOrder)),
    countryField(pdfOrder.shipToCountry, readTeamshipCountry(teamshipOrder)),
    itemSkuField(pdfOrder, teamshipOrder),
    serialField(pdfOrder, teamshipOrder),
    instructionsField(pdfOrder.instructions, readTeamshipInstructions(teamshipOrder))
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
    alert,
    productDimensions: buildGarlandProductDimensionRecommendations({ pdfOrder, teamshipOrder }),
    fields
  };
}

function buildNoPdfReview(teamshipOrder: TeamshipShippingOrderDetail): GarlandTeamshipOrderReview {
  const srNumber = stringifyValue(readTeamshipShipmentId(teamshipOrder)) ?? "UNKNOWN";

  return {
    srNumber,
    psNumber: readTeamshipPsNumber(teamshipOrder) ?? "No PDF",
    pageNumbers: [],
    status: "NO_PDF",
    teamshipOrderId: String(teamshipOrder.id ?? teamshipOrder.order_id ?? ""),
    teamshipUrl: teamshipOrder.url ?? null,
    issueCount: 1,
    alert: null,
    productDimensions: buildGarlandProductDimensionRecommendations({ pdfOrder: null, teamshipOrder }),
    fields: [
      {
        key: "uploadedPdf",
        label: "Uploaded Garland PDF",
        status: "MISSING",
        pdfValue: null,
        teamshipValue: srNumber,
        message: "Teamship has this shipping order for the selected date, but no matching Garland PDF order was uploaded."
      },
      {
        key: "carrier",
        label: "Carrier / ship via",
        status: "INFO",
        pdfValue: null,
        teamshipValue: readTeamshipCarrier(teamshipOrder),
        message: "Teamship value shown for triage."
      },
      {
        key: "ship_to_name",
        label: "Ship-to name",
        status: "INFO",
        pdfValue: null,
        teamshipValue: readTeamshipShipToName(teamshipOrder),
        message: "Teamship value shown for triage."
      },
      {
        key: "ship_to_city",
        label: "Ship-to city",
        status: "INFO",
        pdfValue: null,
        teamshipValue: readTeamshipCity(teamshipOrder),
        message: "Teamship value shown for triage."
      },
      {
        key: "ship_to_state",
        label: "Ship-to province/state",
        status: "INFO",
        pdfValue: null,
        teamshipValue: readTeamshipState(teamshipOrder),
        message: "Teamship value shown for triage."
      }
    ]
  };
}

function buildSkippedAlreadyReviewedReview(pdfOrder: GarlandPdfShippingOrder): GarlandTeamshipOrderReview {
  return {
    srNumber: pdfOrder.srNumber,
    psNumber: pdfOrder.psNumber,
    pageNumbers: pdfOrder.pageNumbers,
    status: "SKIPPED_ALREADY_REVIEWED",
    teamshipOrderId: null,
    teamshipUrl: null,
    issueCount: 0,
    alert: null,
    productDimensions: buildGarlandProductDimensionRecommendations({ pdfOrder, teamshipOrder: null }),
    fields: [
      {
        key: "alreadyReviewed",
        label: "Previous review",
        status: "INFO",
        pdfValue: pdfOrder.srNumber,
        teamshipValue: "Already saved",
        message: "This SR already has a saved Teamship review for this shipment date, so it was not re-verified."
      }
    ]
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
    teamshipOrder.carrier_value,
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
  const teamshipStrings = collectTeamshipStrings(teamshipOrder).map(normalizeSku).filter(Boolean);
  const missingSkus = pdfSkus.filter(
    (sku) => !teamshipSkus.includes(sku) && !teamshipStrings.some((candidate) => candidate.includes(sku))
  );

  return {
    key: "items",
    label: "Item SKUs",
    status: missingSkus.length === 0 && pdfSkus.length > 0 ? "MATCH" : "DISCREPANCY",
    pdfValue: pdfOrder.items.map((item) => item.sku).join(", ") || null,
    teamshipValue:
      (teamshipOrder.items ?? []).map((item) => item.sku).filter(Boolean).join(", ") ||
      (missingSkus.length === 0 ? "Found in Teamship fields" : null),
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

  const teamshipSerialStrings = collectTeamshipSerialStrings(teamshipOrder);
  const teamshipStrings = [...collectTeamshipStrings(teamshipOrder), ...teamshipSerialStrings].map(normalizeIdentifier);
  const missingSerials = pdfSerials.filter(
    (serial) => !teamshipStrings.some((candidate) => candidate.includes(normalizeIdentifier(serial)))
  );

  return {
    key: "serialNumbers",
    label: "Serial numbers",
    status: missingSerials.length === 0 ? "MATCH" : "DISCREPANCY",
    pdfValue: pdfSerials.join(", "),
    teamshipValue: missingSerials.length === 0 ? uniqueStrings(teamshipSerialStrings).join(", ") || "Found in Teamship fields" : "Not all serials found",
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
    teamshipMatchedCount: reviews.filter((review) => review.status === "PASS" || review.status === "FAIL").length,
    passedCount: reviews.filter((review) => review.status === "PASS").length,
    failedCount: reviews.filter((review) => review.status === "FAIL").length,
    missingTeamshipCount: reviews.filter((review) => review.status === "MISSING_TEAMSHIP").length,
    pendingTeamshipCount: reviews.filter((review) => review.status === "PENDING_TEAMSHIP").length,
    noPdfCount: reviews.filter((review) => review.status === "NO_PDF").length,
    skippedAlreadyReviewedCount: reviews.filter((review) => review.status === "SKIPPED_ALREADY_REVIEWED").length
  };
}

function cleanDigestLine(line: string) {
  return line
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\*\*/g, "")
    .replace(/[^\S\t]+/g, " ")
    .trim();
}

function parseAlertItemLine(line: string): TeamshipAlertOrderItem {
  const parts = line
    .split(/\t+/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length >= 4) {
    return {
      itemNumber: parts[0] ?? null,
      description: parts.slice(1, -2).join(" ") || null,
      requestedQuantity: parts.at(-2) ?? null,
      serialNumber: parts.at(-1) ?? null,
      rawText: line
    };
  }

  return {
    itemNumber: parts[0] ?? null,
    description: parts.length > 1 ? parts.slice(1).join(" ") : null,
    requestedQuantity: null,
    serialNumber: null,
    rawText: line
  };
}

function dedupeAlerts(alerts: TeamshipAlertOrder[]) {
  const bySr = new Map<string, TeamshipAlertOrder>();
  for (const alert of alerts) {
    bySr.set(normalizeIdentifier(alert.srNumber), alert);
  }

  return Array.from(bySr.values());
}

function buildAlertMessage(alert: TeamshipAlertOrder) {
  const itemSummary = alert.items
    .map((item) => [item.itemNumber, item.requestedQuantity ? `qty ${item.requestedQuantity}` : null].filter(Boolean).join(" "))
    .filter(Boolean)
    .join(", ");

  return itemSummary
    ? `Teamship alert says this order is pending Teamship creation because of ${alert.reason}: ${itemSummary}.`
    : `Teamship alert says this order is pending Teamship creation because of ${alert.reason}.`;
}

function readTeamshipShipToName(order: TeamshipShippingOrderDetail) {
  const firstLastName = [order.ship_first_name, order.ship_last_name].filter(Boolean).join(" ").trim();
  return order.ship_to_name ?? (firstLastName || order.shipping_info?.shipping_address?.name || null);
}

function readTeamshipAddress1(order: TeamshipShippingOrderDetail) {
  return order.ship_to_address_1 ?? order.ship_address_1 ?? order.shipping_info?.shipping_address?.address_1 ?? null;
}

function readTeamshipCity(order: TeamshipShippingOrderDetail) {
  return order.ship_to_city ?? order.ship_city ?? order.shipping_info?.shipping_address?.city ?? null;
}

function readTeamshipState(order: TeamshipShippingOrderDetail) {
  return order.ship_to_state ?? order.ship_state ?? order.shipping_info?.shipping_address?.state ?? null;
}

function readTeamshipPostalCode(order: TeamshipShippingOrderDetail) {
  return order.ship_to_zip ?? order.ship_zip ?? order.shipping_info?.shipping_address?.zip ?? null;
}

function readTeamshipCountry(order: TeamshipShippingOrderDetail) {
  return order.ship_to_country ?? order.ship_country ?? order.shipping_info?.shipping_address?.country ?? null;
}

function readTeamshipShipmentId(order: TeamshipShippingOrderDetail) {
  return order.shipment_id ?? order.amazon_shipment_id1 ?? stringifyValue(order.edi_field_1);
}

function readTeamshipPoNumber(order: TeamshipShippingOrderDetail) {
  return order.po_number ?? order.poNumber ?? null;
}

function readTeamshipFreightTerms(order: TeamshipShippingOrderDetail) {
  return (
    stringifyValue(order.edi_field_3) ??
    readCustomFieldValue(order.custom_fields, ["freight terms code", "freight terms", "frt terms"]) ??
    readTeamshipValueByKeys(order, ["freight_terms_code", "freightTermsCode", "freight_terms", "freightTerms", "frt_terms", "frtTerms"])
  );
}

function readTeamshipInstructions(order: TeamshipShippingOrderDetail) {
  return (
    order.shipping_instructions ??
    stringifyValue(order.edi_field_4) ??
    readCustomFieldValue(order.custom_fields, ["special instructions", "shipping instructions", "instructions"]) ??
    readTeamshipValueByKeys(order, [
      "special_instructions",
      "specialInstructions",
      "shipping_instructions",
      "shippingInstructions",
      "instructions",
      "delivery_instructions",
      "deliveryInstructions"
    ])
  );
}

function readTeamshipCarrier(order: TeamshipShippingOrderDetail) {
  return (
    order.carrier ??
    order.ship_method ??
    order.shipping_carrier ??
    order.method ??
    order.carrier_name ??
    order.carrier_value ??
    order.shipping_info?.carrier ??
    order.shipping_info?.method ??
    null
  );
}

function readTeamshipPsNumber(order: TeamshipShippingOrderDetail) {
  const candidates = collectTeamshipStrings(order);
  return candidates.find((candidate) => PS_PATTERN.test(candidate))?.match(PS_PATTERN)?.[0].toUpperCase() ?? null;
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

function collectTeamshipSerialStrings(order: TeamshipShippingOrderDetail) {
  const serials: string[] = [];

  const visit = (value: unknown, key = "") => {
    if (typeof value === "string" || typeof value === "number") {
      const text = String(value);
      if (isSerialLikeKey(key)) {
        serials.push(text);
      }
      serials.push(...extractSerialsFromText(text));
      return;
    }

    if (Array.isArray(value)) {
      value.forEach((childValue) => visit(childValue, key));
      return;
    }

    if (value && typeof value === "object") {
      Object.entries(value as Record<string, unknown>).forEach(([childKey, childValue]) => {
        if (isSensitiveTeamshipKey(childKey)) {
          return;
        }
        visit(childValue, childKey);
      });
    }
  };

  visit(order);
  return uniqueStrings(serials.map((serial) => serial.trim()).filter(Boolean));
}

function extractSerialsFromText(value: string) {
  const serials: string[] = [];
  const patterns = [
    /\b(?:serial|serial\s*number|sn)\s*[:#-]?\s*([A-Z0-9][A-Z0-9-]{5,})\b/gi,
    /\bSN\s*[:#-]?\s*([A-Z0-9][A-Z0-9-]{5,})\b/gi
  ];

  for (const pattern of patterns) {
    for (const match of value.matchAll(pattern)) {
      if (match[1]) {
        serials.push(match[1]);
      }
    }
  }

  return serials;
}

function isSerialLikeKey(key: string) {
  const normalized = normalizeObjectKey(key);
  return normalized.includes("serial") || normalized === "sn";
}

function readTeamshipValueByKeys(order: TeamshipShippingOrderDetail, keys: string[]) {
  const targetKeys = keys.map(normalizeObjectKey).filter(Boolean);
  const visited = new Set<unknown>();

  const visit = (value: unknown): string | null => {
    if (!value || typeof value !== "object") {
      return null;
    }

    if (visited.has(value)) {
      return null;
    }
    visited.add(value);

    for (const [key, childValue] of Object.entries(value as Record<string, unknown>)) {
      if (isSensitiveTeamshipKey(key)) {
        continue;
      }

      const normalizedKey = normalizeObjectKey(key);
      const keyMatches = targetKeys.some((targetKey) => normalizedKey === targetKey || normalizedKey.includes(targetKey));
      const stringValue = stringifyValue(childValue);

      if (keyMatches && stringValue) {
        return stringValue;
      }

      const nestedValue = visit(childValue);
      if (nestedValue) {
        return nestedValue;
      }
    }

    return null;
  };

  return visit(order);
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

function isSensitiveTeamshipKey(key: string) {
  const normalized = key.toLowerCase();
  return normalized.includes("token") || normalized.includes("password");
}

function normalizeObjectKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values));
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

  if (normalized === "P U" || normalized.startsWith("P U ") || normalized.includes("PICKUP") || normalized.includes("PICK UP")) {
    return "PICKUP";
  }

  return normalized;
}
