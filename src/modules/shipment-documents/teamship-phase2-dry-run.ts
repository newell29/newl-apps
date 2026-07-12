import { isUpsGarlandOrder } from "@/modules/shipment-documents/garland-product-dimensions";
import type {
  GarlandPdfShippingOrder,
  GarlandProductDimensionRecommendation,
  GarlandTeamshipOrderReview,
  GarlandTeamshipReviewField,
  GarlandTeamshipReviewResponse,
  GarlandShippingOrderItem
} from "@/modules/shipment-documents/teamship-review-types";

export type TeamshipPhase2DryRunPlan = {
  mode: "DRY_RUN";
  dryRun: true;
  wouldUpdateTeamship: false;
  generatedAt: string;
  summary: {
    orderCount: number;
    readyCount: number;
    blockedCount: number;
    skippedCount: number;
    plannedFieldUpdateCount: number;
    plannedPalletRowCount: number;
  };
  orders: TeamshipPhase2OrderPlan[];
};

export type TeamshipPhase2OrderPlan = {
  psNumber: string;
  srNumber: string;
  teamshipOrderId: string | null;
  teamshipUrl: string | null;
  status: "READY" | "BLOCKED" | "SKIPPED";
  sourceReviewStatus: GarlandTeamshipOrderReview["status"];
  plannedFieldUpdates: TeamshipPhase2FieldUpdate[];
  plannedPalletRows: TeamshipPhase2PalletRowPlan[];
  validationIssues: string[];
};

export type TeamshipPhase2FieldUpdate = {
  reviewFieldKey: string;
  label: string;
  teamshipField: string;
  currentValue: string | null;
  proposedValue: string;
  reason: string;
};

export type TeamshipPhase2PalletRowPlan = {
  rowNumber: number;
  sku: string;
  quantity: number;
  lengthIn: number | null;
  widthIn: number | null;
  heightIn: number | null;
  weightLb: number | null;
  weightUnit: string;
  commodity: string;
  hasUsableDimensions: boolean;
  dimensionSource: GarlandProductDimensionRecommendation["source"] | "MISSING";
  dimensionConfidence: GarlandProductDimensionRecommendation["confidence"] | "LOW";
  sourceNote: string;
  teamshipFields: Record<string, string | number>;
};

const FIELD_UPDATE_DESTINATIONS: Record<string, string> = {
  po_number: "poNumber",
  freight_terms: "edi_field_3",
  carrier: "carrier_value",
  shipping_instructions: "edi_field_4"
};

export function buildTeamshipPhase2DryRunPlan(review: GarlandTeamshipReviewResponse): TeamshipPhase2DryRunPlan {
  const pdfOrdersByKey = new Map(review.pdfOrders.map((order) => [buildOrderKey(order.psNumber, order.srNumber), order]));
  const orders = review.reviews.map((orderReview) =>
    buildOrderPlan({
      orderReview,
      pdfOrder: pdfOrdersByKey.get(buildOrderKey(orderReview.psNumber, orderReview.srNumber)) ?? null
    })
  );

  return {
    mode: "DRY_RUN",
    dryRun: true,
    wouldUpdateTeamship: false,
    generatedAt: new Date().toISOString(),
    summary: {
      orderCount: orders.length,
      readyCount: orders.filter((order) => order.status === "READY").length,
      blockedCount: orders.filter((order) => order.status === "BLOCKED").length,
      skippedCount: orders.filter((order) => order.status === "SKIPPED").length,
      plannedFieldUpdateCount: orders.reduce((sum, order) => sum + order.plannedFieldUpdates.length, 0),
      plannedPalletRowCount: orders.reduce((sum, order) => sum + order.plannedPalletRows.length, 0)
    },
    orders
  };
}

function buildOrderPlan({
  orderReview,
  pdfOrder
}: {
  orderReview: GarlandTeamshipOrderReview;
  pdfOrder: GarlandPdfShippingOrder | null;
}): TeamshipPhase2OrderPlan {
  if (!pdfOrder || !orderReview.teamshipOrderId || orderReview.status === "MISSING_TEAMSHIP" || orderReview.status === "PENDING_TEAMSHIP") {
    return {
      psNumber: orderReview.psNumber,
      srNumber: orderReview.srNumber,
      teamshipOrderId: orderReview.teamshipOrderId,
      teamshipUrl: orderReview.teamshipUrl,
      status: "SKIPPED",
      sourceReviewStatus: orderReview.status,
      plannedFieldUpdates: [],
      plannedPalletRows: [],
      validationIssues: ["No matched Teamship order is available for a safe Phase 2 dry run."]
    };
  }

  if (orderReview.status === "NO_PDF" || orderReview.status === "SKIPPED_ALREADY_REVIEWED") {
    return {
      psNumber: orderReview.psNumber,
      srNumber: orderReview.srNumber,
      teamshipOrderId: orderReview.teamshipOrderId,
      teamshipUrl: orderReview.teamshipUrl,
      status: "SKIPPED",
      sourceReviewStatus: orderReview.status,
      plannedFieldUpdates: [],
      plannedPalletRows: [],
      validationIssues: [`Review status ${orderReview.status} is not eligible for Phase 2 pallet planning.`]
    };
  }

  const plannedFieldUpdates = buildFieldUpdates(orderReview.fields);
  const plannedPalletRows = pdfOrder.items.map((item, index) =>
    buildPalletRowPlan({
      rowNumber: index + 1,
      item,
      dimensions: selectDimensionForSku(orderReview.productDimensions, item.sku),
      pdfOrder
    })
  );
  const validationIssues = validateOrderPlan({ pdfOrder, plannedPalletRows });
  const status = validationIssues.length === 0 ? "READY" : "BLOCKED";

  return {
    psNumber: orderReview.psNumber,
    srNumber: orderReview.srNumber,
    teamshipOrderId: orderReview.teamshipOrderId,
    teamshipUrl: orderReview.teamshipUrl,
    status,
    sourceReviewStatus: orderReview.status,
    plannedFieldUpdates,
    plannedPalletRows,
    validationIssues
  };
}

function buildFieldUpdates(fields: GarlandTeamshipReviewField[]) {
  const updates: TeamshipPhase2FieldUpdate[] = [];

  for (const field of fields) {
    const teamshipField = FIELD_UPDATE_DESTINATIONS[field.key];
    const proposedValue = field.pdfValue?.trim();

    if (!teamshipField || !proposedValue || (field.status !== "DISCREPANCY" && field.status !== "MISSING")) {
      continue;
    }

    updates.push({
      reviewFieldKey: field.key,
      label: field.label,
      teamshipField,
      currentValue: field.teamshipValue,
      proposedValue,
      reason: field.message
    });
  }

  return updates;
}

function buildPalletRowPlan({
  rowNumber,
  item,
  dimensions,
  pdfOrder
}: {
  rowNumber: number;
  item: GarlandShippingOrderItem;
  dimensions: GarlandProductDimensionRecommendation | null;
  pdfOrder: GarlandPdfShippingOrder;
}): TeamshipPhase2PalletRowPlan {
  const quantity = readItemQuantity(item);
  const commodity = buildCommodity(item, quantity);
  const hasUsableDimensions = Boolean(dimensions);
  const weightUnit = dimensions?.weightUnit?.trim() || "lbs";

  return {
    rowNumber,
    sku: item.sku.trim().toUpperCase(),
    quantity,
    lengthIn: dimensions?.lengthIn ?? null,
    widthIn: dimensions?.widthIn ?? null,
    heightIn: dimensions?.heightIn ?? null,
    weightLb: dimensions?.weightLb ?? null,
    weightUnit,
    commodity,
    hasUsableDimensions,
    dimensionSource: dimensions?.source ?? "MISSING",
    dimensionConfidence: dimensions?.confidence ?? "LOW",
    sourceNote: dimensions
      ? isUpsGarlandOrder({ pdfOrder, teamshipOrder: null })
        ? "UPS order placeholder rule."
        : dimensions.note
      : "No usable dimension/weight recommendation found; commodity text can still be prepared.",
    teamshipFields: buildTeamshipPalletFields({
      rowNumber,
      quantity,
      dimensions,
      weightUnit,
      commodity
    })
  };
}

function buildTeamshipPalletFields({
  rowNumber,
  quantity,
  dimensions,
  weightUnit,
  commodity
}: {
  rowNumber: number;
  quantity: number;
  dimensions: GarlandProductDimensionRecommendation | null;
  weightUnit: string;
  commodity: string;
}) {
  const fields: Record<string, string | number> = {
    pallets_count: rowNumber,
    [`pallet_${rowNumber}`]: quantity,
    [`pallet_${rowNumber}_commodity`]: commodity
  };

  if (dimensions) {
    fields[`pallet_${rowNumber}_length`] = dimensions.lengthIn ?? 0;
    fields[`pallet_${rowNumber}_width`] = dimensions.widthIn ?? 0;
    fields[`pallet_${rowNumber}_height`] = dimensions.heightIn ?? 0;
    fields[`pallet_${rowNumber}_weight`] = dimensions.weightLb ?? 0;
    fields[`pallet_${rowNumber}_weight_unit`] = weightUnit;
  }

  return fields;
}

function validateOrderPlan({
  pdfOrder,
  plannedPalletRows
}: {
  pdfOrder: GarlandPdfShippingOrder;
  plannedPalletRows: TeamshipPhase2PalletRowPlan[];
}) {
  const issues: string[] = [];

  pdfOrder.items.forEach((item, index) => {
    const row = plannedPalletRows[index];
    const sku = item.sku.trim().toUpperCase();

    if (!row.hasUsableDimensions) {
      issues.push(`No usable dimension/weight recommendation found for SKU ${sku}.`);
    } else if (
      ![row.lengthIn, row.widthIn, row.heightIn, row.weightLb].every(
        (value) => typeof value === "number" && Number.isFinite(value) && value > 0
      )
    ) {
      issues.push(`SKU ${sku} has invalid dimensions or weight.`);
    }

    if (!row.commodity.includes(sku)) {
      issues.push(`SKU ${sku} commodity text does not include the SKU.`);
    }

    for (const serialNumber of item.serialNumbers) {
      if (!row.commodity.includes(serialNumber.trim())) {
        issues.push(`SKU ${sku} commodity text is missing serial ${serialNumber}.`);
      }
    }
  });

  return issues;
}

function selectDimensionForSku(recommendations: GarlandProductDimensionRecommendation[], sku: string) {
  const normalizedSku = sku.trim().toUpperCase();
  const candidates = recommendations
    .filter((recommendation) => recommendation.sku.trim().toUpperCase() === normalizedSku)
    .filter(hasCompleteDimensions)
    .filter((recommendation) => recommendation.source !== "TEAMSHIP_PALLET" || recommendation.confidence !== "LOW")
    .sort((left, right) => dimensionSourceRank(left) - dimensionSourceRank(right));

  return candidates[0] ?? null;
}

function hasCompleteDimensions(recommendation: GarlandProductDimensionRecommendation) {
  return [recommendation.lengthIn, recommendation.widthIn, recommendation.heightIn, recommendation.weightLb].every(
    (value) => typeof value === "number" && Number.isFinite(value) && value > 0
  );
}

function dimensionSourceRank(recommendation: GarlandProductDimensionRecommendation) {
  if (recommendation.source === "CSR_OVERRIDE") {
    return 0;
  }

  if (recommendation.source === "UPS_RULE") {
    return 1;
  }

  if (recommendation.source === "CSR_LEARNED") {
    return 2;
  }

  if (recommendation.source === "TEAMSHIP_PALLET") {
    return 3;
  }

  if (recommendation.source === "TEAMSHIP_LEARNED") {
    return 4;
  }

  return 5;
}

function buildCommodity(item: GarlandShippingOrderItem, quantity: number) {
  const sku = item.sku.trim().toUpperCase();

  if (item.serialNumbers.length > 0) {
    return item.serialNumbers
      .map((serialNumber) => serialNumber.trim())
      .filter(Boolean)
      .map((serialNumber) => `SKU: ${sku} SN: ${serialNumber}`)
      .join("\n");
  }

  return `SKU: ${sku} QTY: ${quantity}`;
}

function readItemQuantity(item: GarlandShippingOrderItem) {
  if (typeof item.quantity === "number" && Number.isFinite(item.quantity) && item.quantity > 0) {
    return item.quantity;
  }

  return Math.max(1, item.serialNumbers.length);
}

function buildOrderKey(psNumber: string, srNumber: string) {
  return `${psNumber.trim().toUpperCase()}::${srNumber.trim().toUpperCase()}`;
}
