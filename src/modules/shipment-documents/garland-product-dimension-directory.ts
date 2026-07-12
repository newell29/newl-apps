import {
  extractTeamshipPalletDimensionRows,
  isLearnableTeamshipDimension,
  isUpsGarlandOrder
} from "@/modules/shipment-documents/garland-product-dimensions";
import type {
  GarlandProductDimensionRecommendation,
  TeamshipShippingOrderDetail
} from "@/modules/shipment-documents/teamship-review-types";
import { prisma } from "@/server/db";

type ProductDimensionObservationClient = typeof prisma & {
  garlandProductDimensionObservation: {
    createMany(args: {
      data: ProductDimensionObservationCreateInput[];
      skipDuplicates: boolean;
    }): Promise<{ count: number }>;
    findMany(args: {
      where: Record<string, unknown>;
      orderBy: Array<Record<string, "asc" | "desc">>;
      take: number;
      select: Record<string, boolean>;
    }): Promise<ProductDimensionObservationRecord[]>;
  };
};

type ProductDimensionObservationCreateInput = {
  tenantId: string;
  observationKey: string;
  sku: string;
  source: string;
  sourceTeamshipOrderId: string | null;
  sourceSrNumber: string | null;
  carrier: string | null;
  commodity: string | null;
  quantity: number | null;
  lengthIn: number;
  widthIn: number;
  heightIn: number;
  weightLb: number;
  weightUnit: string | null;
};

type ProductDimensionObservationRecord = ProductDimensionObservationCreateInput & {
  observedAt: Date;
};

type LearnedDimensionAggregate = {
  sku: string;
  lengthIn: number;
  widthIn: number;
  heightIn: number;
  weightLb: number;
  weightUnit: string | null;
  count: number;
  latestObservedAt: Date;
  sourceSrNumbers: Set<string>;
};

export async function recordGarlandProductDimensionObservations({
  tenantId,
  orders
}: {
  tenantId: string;
  orders: TeamshipShippingOrderDetail[];
}) {
  const rows = orders.flatMap((order) => buildObservationRows({ tenantId, order }));

  if (rows.length === 0) {
    return { observedCount: 0, insertedCount: 0 };
  }

  const client = prisma as ProductDimensionObservationClient;
  const result = await client.garlandProductDimensionObservation.createMany({
    data: rows,
    skipDuplicates: true
  });

  return {
    observedCount: rows.length,
    insertedCount: result.count
  };
}

export async function getGarlandLearnedProductDimensionRecommendations({
  tenantId,
  skus
}: {
  tenantId: string;
  skus: string[];
}): Promise<GarlandProductDimensionRecommendation[]> {
  const normalizedSkus = Array.from(new Set(skus.map(normalizeSku).filter((sku): sku is string => Boolean(sku))));

  if (normalizedSkus.length === 0) {
    return [];
  }

  const client = prisma as ProductDimensionObservationClient;
  const observations = await client.garlandProductDimensionObservation.findMany({
    where: {
      tenantId,
      sku: {
        in: normalizedSkus
      }
    },
    orderBy: [{ observedAt: "desc" }],
    take: 1000,
    select: {
      tenantId: true,
      observationKey: true,
      sku: true,
      source: true,
      sourceTeamshipOrderId: true,
      sourceSrNumber: true,
      carrier: true,
      commodity: true,
      quantity: true,
      lengthIn: true,
      widthIn: true,
      heightIn: true,
      weightLb: true,
      weightUnit: true,
      observedAt: true
    }
  });

  return Array.from(aggregateObservations(observations).values()).map(mapAggregateToRecommendation);
}

function buildObservationRows({
  tenantId,
  order
}: {
  tenantId: string;
  order: TeamshipShippingOrderDetail;
}): ProductDimensionObservationCreateInput[] {
  if (isUpsGarlandOrder({ pdfOrder: null, teamshipOrder: order })) {
    return [];
  }

  const sourceTeamshipOrderId = readFirstString(order.id, order.order_id);
  const sourceSrNumber = readFirstString(order.shipment_id, order.order_number, order.display_id, order.record_no);
  const sourceOrderKey = normalizeObservationPart(sourceTeamshipOrderId ?? sourceSrNumber);

  if (!sourceOrderKey) {
    return [];
  }

  const carrier = readFirstString(
    order.carrier,
    order.ship_method,
    order.shipping_carrier,
    order.method,
    order.carrier_name,
    order.carrier_value,
    order.shipping_info?.carrier,
    order.shipping_info?.method
  );
  const rows: ProductDimensionObservationCreateInput[] = [];

  for (const recommendation of extractTeamshipPalletDimensionRows(order)) {
    if (!isLearnableTeamshipDimension(recommendation)) {
      continue;
    }

    const sku = normalizeSku(recommendation.sku);

    if (!sku || recommendation.lengthIn === null || recommendation.widthIn === null || recommendation.heightIn === null || recommendation.weightLb === null) {
      continue;
    }

    const observationKey = [
      sourceOrderKey,
      sku,
      formatNumberKey(recommendation.lengthIn),
      formatNumberKey(recommendation.widthIn),
      formatNumberKey(recommendation.heightIn),
      formatNumberKey(recommendation.weightLb),
      normalizeObservationPart(recommendation.weightUnit ?? "lbs")
    ].join("|");

    rows.push({
      tenantId,
      observationKey,
      sku,
      source: "TEAMSHIP_PALLET",
      sourceTeamshipOrderId,
      sourceSrNumber,
      carrier,
      commodity: readCommodityForSku(order, sku),
      quantity: recommendation.quantity,
      lengthIn: recommendation.lengthIn,
      widthIn: recommendation.widthIn,
      heightIn: recommendation.heightIn,
      weightLb: recommendation.weightLb,
      weightUnit: recommendation.weightUnit ?? "lbs"
    });
  }

  return rows;
}

function aggregateObservations(observations: ProductDimensionObservationRecord[]) {
  const aggregates = new Map<string, LearnedDimensionAggregate>();

  for (const observation of observations) {
    const key = [
      observation.sku,
      formatNumberKey(observation.lengthIn),
      formatNumberKey(observation.widthIn),
      formatNumberKey(observation.heightIn),
      formatNumberKey(observation.weightLb),
      normalizeObservationPart(observation.weightUnit ?? "lbs")
    ].join("|");
    const aggregate = aggregates.get(key) ?? {
      sku: observation.sku,
      lengthIn: observation.lengthIn,
      widthIn: observation.widthIn,
      heightIn: observation.heightIn,
      weightLb: observation.weightLb,
      weightUnit: observation.weightUnit ?? "lbs",
      count: 0,
      latestObservedAt: observation.observedAt,
      sourceSrNumbers: new Set<string>()
    };

    aggregate.count += 1;

    if (observation.observedAt > aggregate.latestObservedAt) {
      aggregate.latestObservedAt = observation.observedAt;
    }

    if (observation.sourceSrNumber) {
      aggregate.sourceSrNumbers.add(observation.sourceSrNumber);
    }

    aggregates.set(key, aggregate);
  }

  return aggregates;
}

function mapAggregateToRecommendation(aggregate: LearnedDimensionAggregate): GarlandProductDimensionRecommendation {
  const exampleSrNumbers = Array.from(aggregate.sourceSrNumbers).slice(0, 3);
  const exampleText = exampleSrNumbers.length > 0 ? ` Examples: ${exampleSrNumbers.join(", ")}.` : "";

  return {
    sku: aggregate.sku,
    source: "TEAMSHIP_LEARNED",
    productType: null,
    quantity: null,
    lengthIn: aggregate.lengthIn,
    widthIn: aggregate.widthIn,
    heightIn: aggregate.heightIn,
    weightLb: aggregate.weightLb,
    weightUnit: aggregate.weightUnit,
    confidence: aggregate.count >= 2 ? "HIGH" : "MEDIUM",
    note: `Learned from ${aggregate.count} saved Teamship pallet observation(s), latest ${aggregate.latestObservedAt.toISOString().slice(0, 10)}.${exampleText}`
  };
}

function readCommodityForSku(order: TeamshipShippingOrderDetail, sku: string) {
  const pallets = [...(order.pallets ?? []), ...(order.pallet_dims ?? [])];

  for (const pallet of pallets) {
    if (typeof pallet.commodity === "string" && pallet.commodity.toUpperCase().includes(sku)) {
      return pallet.commodity.trim();
    }
  }

  return null;
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

function normalizeSku(value: string | null | undefined) {
  return value?.trim().toUpperCase().replace(/\s+/g, " ") || null;
}

function normalizeObservationPart(value: string | null | undefined) {
  return value?.trim().toUpperCase().replace(/[^A-Z0-9. -]/g, "").replace(/\s+/g, " ") || null;
}

function formatNumberKey(value: number) {
  return Number(value.toFixed(3)).toString();
}
