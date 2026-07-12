import garlandReferenceRows from "@/data/garland-product-dimensions.json";

import type {
  GarlandPdfShippingOrder,
  GarlandProductDimensionRecommendation,
  TeamshipPalletDim,
  TeamshipShippingOrderDetail
} from "@/modules/shipment-documents/teamship-review-types";

type GarlandReferenceRow = {
  sku: string;
  productType: string | null;
  lengthIn: number | null;
  widthIn: number | null;
  heightIn: number | null;
  weightLb: number | null;
  sourceSheet: string;
};

const referenceBySku = new Map<string, GarlandReferenceRow[]>();

for (const row of garlandReferenceRows as GarlandReferenceRow[]) {
  const key = normalizeSku(row.sku);

  if (!key) {
    continue;
  }

  const rows = referenceBySku.get(key) ?? [];
  rows.push(row);
  referenceBySku.set(key, rows);
}

export function buildGarlandProductDimensionRecommendations({
  pdfOrder,
  teamshipOrder
}: {
  pdfOrder: GarlandPdfShippingOrder | null;
  teamshipOrder: TeamshipShippingOrderDetail | null;
}): GarlandProductDimensionRecommendation[] {
  const skuOrder = new Set<string>();
  const recommendations: GarlandProductDimensionRecommendation[] = [];
  const isUps = isUpsGarlandOrder({ pdfOrder, teamshipOrder });

  for (const sku of pdfOrder?.items.map((item) => item.sku) ?? []) {
    addSku(skuOrder, sku);
  }

  for (const item of teamshipOrder?.items ?? []) {
    addSku(skuOrder, item.sku);
  }

  const observedRows = teamshipOrder ? extractTeamshipPalletDimensionRows(teamshipOrder) : [];

  for (const observedRow of observedRows) {
    addSku(skuOrder, observedRow.sku);
    if (!isUps) {
      recommendations.push(observedRow);
    }
  }

  if (isUps) {
    return dedupeRecommendations(Array.from(skuOrder).map(buildUpsRuleRecommendation));
  }

  for (const sku of skuOrder) {
    for (const row of referenceBySku.get(sku) ?? []) {
      recommendations.push({
        sku,
        source: "GARLAND_REFERENCE",
        productType: row.productType,
        quantity: null,
        lengthIn: row.lengthIn,
        widthIn: row.widthIn,
        heightIn: row.heightIn,
        weightLb: row.weightLb,
        weightUnit: "lbs",
        confidence: row.lengthIn && row.widthIn && row.heightIn && row.weightLb ? "HIGH" : "MEDIUM",
        note: `Garland freight dims sheet (${row.sourceSheet}).`
      });
    }
  }

  return dedupeRecommendations(recommendations);
}

function buildUpsRuleRecommendation(sku: string): GarlandProductDimensionRecommendation {
  return {
    sku,
    source: "UPS_RULE",
    productType: null,
    quantity: null,
    lengthIn: 1,
    widthIn: 1,
    heightIn: 1,
    weightLb: 1,
    weightUnit: "lbs",
    confidence: "HIGH",
    note: "Garland UPS rule: always use 1 x 1 x 1 and 1 lb regardless of SKU."
  };
}

function extractTeamshipPalletDimensionRows(order: TeamshipShippingOrderDetail): GarlandProductDimensionRecommendation[] {
  const rows: GarlandProductDimensionRecommendation[] = [];
  const pallets = [...(order.pallets ?? []), ...(order.pallet_dims ?? [])];

  for (const pallet of pallets) {
    const skus = extractSkusFromCommodity(pallet.commodity);

    for (const sku of skus) {
      rows.push(buildObservedRecommendation(sku, pallet));
    }
  }

  return rows;
}

function buildObservedRecommendation(sku: string, pallet: TeamshipPalletDim): GarlandProductDimensionRecommendation {
  const lengthIn = parseNumber(pallet.length);
  const widthIn = parseNumber(pallet.width);
  const heightIn = parseNumber(pallet.height);
  const weightLb = parseNumber(pallet.weight);
  const isPlaceholder =
    (lengthIn === 1 && widthIn === 1 && heightIn === 1) ||
    weightLb === 1 ||
    weightLb === 0 ||
    heightIn === 0;

  return {
    sku,
    source: "TEAMSHIP_PALLET",
    productType: null,
    quantity: parseNumber(pallet.quantity),
    lengthIn,
    widthIn,
    heightIn,
    weightLb,
    weightUnit: pallet.weight_unit ?? "lbs",
    confidence: isPlaceholder ? "LOW" : lengthIn && widthIn && heightIn && weightLb ? "HIGH" : "MEDIUM",
    note: isPlaceholder
      ? "Observed in Teamship pallet row, but looks like placeholder pallet data."
      : "Observed in Teamship pallet row."
  };
}

function extractSkusFromCommodity(value: string | null | undefined) {
  const text = value?.trim() ?? "";

  if (!text) {
    return [];
  }

  const matches = Array.from(text.matchAll(/\bSKU\s*:\s*([^,;]+)/gi))
    .map((match) => normalizeSku(match[1]))
    .filter((sku): sku is string => Boolean(sku));

  if (matches.length > 0) {
    return Array.from(new Set(matches));
  }

  const fallback = normalizeSku(text.split(/[,\s]/)[0] ?? "");
  return fallback ? [fallback] : [];
}

function dedupeRecommendations(recommendations: GarlandProductDimensionRecommendation[]) {
  const seen = new Set<string>();
  const deduped: GarlandProductDimensionRecommendation[] = [];

  for (const recommendation of recommendations) {
    const key = [
      recommendation.sku,
      recommendation.source,
      recommendation.lengthIn,
      recommendation.widthIn,
      recommendation.heightIn,
      recommendation.weightLb,
      recommendation.quantity,
      recommendation.note
    ].join("|");

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(recommendation);
  }

  return deduped.sort((left, right) => {
    const skuCompare = left.sku.localeCompare(right.sku);

    if (skuCompare !== 0) {
      return skuCompare;
    }

    return sourceRank(left.source) - sourceRank(right.source);
  });
}

function addSku(skuSet: Set<string>, sku: string | null | undefined) {
  const normalized = normalizeSku(sku);

  if (normalized) {
    skuSet.add(normalized);
  }
}

function parseNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function normalizeSku(value: string | null | undefined) {
  return value?.trim().toUpperCase().replace(/\s+/g, " ") || null;
}

function isUpsGarlandOrder({
  pdfOrder,
  teamshipOrder
}: {
  pdfOrder: GarlandPdfShippingOrder | null;
  teamshipOrder: TeamshipShippingOrderDetail | null;
}) {
  const carrierValues = [
    pdfOrder?.shipVia,
    teamshipOrder?.carrier,
    teamshipOrder?.ship_method,
    teamshipOrder?.shipping_carrier,
    teamshipOrder?.method,
    teamshipOrder?.carrier_name,
    teamshipOrder?.carrier_value,
    teamshipOrder?.shipping_info?.carrier,
    teamshipOrder?.shipping_info?.method
  ];

  return carrierValues.some((value) => normalizeCarrier(value).includes("UPS"));
}

function normalizeCarrier(value: string | null | undefined) {
  return value?.toUpperCase().replace(/[^A-Z0-9]/g, "") ?? "";
}

function sourceRank(source: GarlandProductDimensionRecommendation["source"]) {
  if (source === "UPS_RULE") {
    return 0;
  }

  return source === "TEAMSHIP_PALLET" ? 1 : 2;
}
