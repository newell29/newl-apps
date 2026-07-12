import type {
  TeamshipPayloadInspectionMatch,
  TeamshipPayloadInspectionResult,
  TeamshipShippingOrderDetail
} from "@/modules/shipment-documents/teamship-review-types";

const MAX_MATCHES_PER_GROUP = 40;
const VALUE_PREVIEW_LENGTH = 180;

export function buildTeamshipPayloadInspection({
  srNumber,
  teamshipOrder,
  expectedSerials,
  expectedSkus
}: {
  srNumber: string;
  teamshipOrder: TeamshipShippingOrderDetail | null;
  expectedSerials: string[];
  expectedSkus: string[];
}): TeamshipPayloadInspectionResult {
  const normalizedExpectedSerials = uniqueNormalizedValues(expectedSerials);
  const normalizedExpectedSkus = uniqueNormalizedValues(expectedSkus);

  if (!teamshipOrder) {
    return {
      srNumber,
      teamshipOrderId: null,
      teamshipUrl: null,
      fetchedAt: new Date().toISOString(),
      inspectedEndpoints: [
        "GET /v1/ship-inventories",
        "GET /v1/ship-inventories/{id}",
        "GET /ship-inventories/{id} UI page",
        "GET /admin/get-prod-ship-invt-edit"
      ],
      expectedSerials: normalizedExpectedSerials,
      expectedSkus: normalizedExpectedSkus,
      searchedValueCount: 0,
      exactSerialMatches: [],
      serialLikeMatches: [],
      skuMatches: [],
      conclusion: "TEAMSHIP_ORDER_NOT_FOUND",
      message: "No Teamship order was returned for this SR, so the payload could not be inspected."
    };
  }

  const inspection = inspectJsonValue(teamshipOrder, {
    expectedSerials: normalizedExpectedSerials,
    expectedSkus: normalizedExpectedSkus
  });
  const exactSerialMatches = limitMatches(inspection.exactSerialMatches);
  const serialLikeMatches = limitMatches(inspection.serialLikeMatches);
  const skuMatches = limitMatches(inspection.skuMatches);
  const conclusion = buildConclusion({
    exactSerialMatches,
    serialLikeMatches,
    expectedSerials: normalizedExpectedSerials
  });

  return {
    srNumber,
    teamshipOrderId: readFirstString(teamshipOrder.id, teamshipOrder.order_id),
    teamshipUrl: readFirstString(teamshipOrder.url) ?? buildTeamshipOrderUrl(readFirstString(teamshipOrder.id, teamshipOrder.order_id)),
    fetchedAt: new Date().toISOString(),
    inspectedEndpoints: [
      "GET /v1/ship-inventories",
      "GET /v1/ship-inventories/{id}",
      "GET /ship-inventories/{id} UI page",
      "GET /admin/get-prod-ship-invt-edit"
    ],
    expectedSerials: normalizedExpectedSerials,
    expectedSkus: normalizedExpectedSkus,
    searchedValueCount: inspection.searchedValueCount,
    exactSerialMatches,
    serialLikeMatches,
    skuMatches,
    conclusion,
    message: buildConclusionMessage({
      conclusion,
      exactSerialMatches,
      serialLikeMatches,
      expectedSerials: normalizedExpectedSerials
    })
  };
}

function inspectJsonValue(
  value: unknown,
  {
    expectedSerials,
    expectedSkus
  }: {
    expectedSerials: string[];
    expectedSkus: string[];
  }
) {
  const exactSerialMatches: TeamshipPayloadInspectionMatch[] = [];
  const serialLikeMatches: TeamshipPayloadInspectionMatch[] = [];
  const skuMatches: TeamshipPayloadInspectionMatch[] = [];
  let searchedValueCount = 0;

  const visit = (childValue: unknown, path: string, key: string | null) => {
    if (isPrimitive(childValue)) {
      searchedValueCount += 1;
      const text = String(childValue);
      const normalizedText = normalizeIdentifier(text);

      for (const serial of expectedSerials) {
        if (serial && normalizedText.includes(serial)) {
          exactSerialMatches.push(buildMatch({ path, key, value: text, matchedValue: serial, reason: "EXPECTED_SERIAL" }));
        }
      }

      if (key && isSerialLikeKey(key)) {
        serialLikeMatches.push(buildMatch({ path, key, value: text, matchedValue: null, reason: "SERIAL_LIKE_KEY" }));
      } else {
        const extractedSerials = extractSerialsFromText(text);
        for (const serial of extractedSerials) {
          serialLikeMatches.push(buildMatch({ path, key, value: text, matchedValue: serial, reason: "SERIAL_TEXT" }));
        }
      }

      for (const sku of expectedSkus) {
        if (sku && normalizedText.includes(sku)) {
          skuMatches.push(buildMatch({ path, key, value: text, matchedValue: sku, reason: "EXPECTED_SKU" }));
        }
      }

      return;
    }

    if (Array.isArray(childValue)) {
      childValue.forEach((item, index) => visit(item, `${path}[${index}]`, key));
      return;
    }

    if (childValue && typeof childValue === "object") {
      for (const [childKey, nestedValue] of Object.entries(childValue as Record<string, unknown>)) {
        if (isSensitiveTeamshipKey(childKey)) {
          continue;
        }

        visit(nestedValue, `${path}.${childKey}`, childKey);
      }
    }
  };

  visit(value, "$", null);

  return {
    searchedValueCount,
    exactSerialMatches: dedupeMatches(exactSerialMatches),
    serialLikeMatches: dedupeMatches(serialLikeMatches),
    skuMatches: dedupeMatches(skuMatches)
  };
}

function buildMatch({
  path,
  key,
  value,
  matchedValue,
  reason
}: {
  path: string;
  key: string | null;
  value: string;
  matchedValue: string | null;
  reason: TeamshipPayloadInspectionMatch["reason"];
}): TeamshipPayloadInspectionMatch {
  return {
    path,
    key,
    valuePreview: previewValue(value),
    matchedValue,
    reason
  };
}

function buildConclusion({
  exactSerialMatches,
  serialLikeMatches,
  expectedSerials
}: {
  exactSerialMatches: TeamshipPayloadInspectionMatch[];
  serialLikeMatches: TeamshipPayloadInspectionMatch[];
  expectedSerials: string[];
}): TeamshipPayloadInspectionResult["conclusion"] {
  if (expectedSerials.length > 0 && exactSerialMatches.length > 0) {
    return "EXPECTED_SERIAL_FOUND";
  }

  if (serialLikeMatches.length > 0) {
    return "SERIAL_EVIDENCE_FOUND";
  }

  return "NO_SERIAL_EVIDENCE";
}

function buildConclusionMessage({
  conclusion,
  exactSerialMatches,
  serialLikeMatches,
  expectedSerials
}: {
  conclusion: TeamshipPayloadInspectionResult["conclusion"];
  exactSerialMatches: TeamshipPayloadInspectionMatch[];
  serialLikeMatches: TeamshipPayloadInspectionMatch[];
  expectedSerials: string[];
}) {
  if (conclusion === "EXPECTED_SERIAL_FOUND") {
    return `Found expected PDF serial value(s) in the fetched Teamship payload at ${exactSerialMatches.length} path(s). This is likely a mapping/display issue.`;
  }

  if (conclusion === "SERIAL_EVIDENCE_FOUND") {
    return `Found ${serialLikeMatches.length} serial-like value(s), but not the expected PDF serial${expectedSerials.length === 1 ? "" : "s"}. Review these paths to decide whether the value format differs.`;
  }

  return "No expected serial or serial-like value was found in the fetched Teamship payload. The serial may be behind a separate Teamship order-line, inventory, EDI, or allocation endpoint.";
}

function dedupeMatches(matches: TeamshipPayloadInspectionMatch[]) {
  const seen = new Set<string>();
  const deduped: TeamshipPayloadInspectionMatch[] = [];

  for (const match of matches) {
    const key = [match.path, match.reason, match.matchedValue, match.valuePreview].join("|");

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(match);
  }

  return deduped;
}

function limitMatches(matches: TeamshipPayloadInspectionMatch[]) {
  return matches.slice(0, MAX_MATCHES_PER_GROUP);
}

function uniqueNormalizedValues(values: string[]) {
  return Array.from(new Set(values.map(normalizeIdentifier).filter(Boolean)));
}

function isPrimitive(value: unknown): value is string | number | boolean {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

function isSerialLikeKey(key: string) {
  const normalized = normalizeObjectKey(key);
  return normalized.includes("serial") || normalized === "sn";
}

function isSensitiveTeamshipKey(key: string) {
  const normalized = key.toLowerCase();
  return normalized.includes("token") || normalized.includes("password") || normalized.includes("secret");
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
        serials.push(normalizeIdentifier(match[1]));
      }
    }
  }

  return Array.from(new Set(serials.filter(Boolean)));
}

function normalizeObjectKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function normalizeIdentifier(value: unknown) {
  return String(value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function previewValue(value: string) {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length > VALUE_PREVIEW_LENGTH ? `${compact.slice(0, VALUE_PREVIEW_LENGTH - 1)}...` : compact;
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

function buildTeamshipOrderUrl(orderId: string | null) {
  return orderId ? `https://app.teamshipos.com/ship-inventories/${encodeURIComponent(orderId)}` : null;
}
