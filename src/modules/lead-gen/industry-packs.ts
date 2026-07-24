export const TRADEMINING_INDUSTRY_PACKS = [
  {
    id: "furniture-home",
    label: "Furniture & Home",
    description: "Furniture, mattresses, lighting, cabinetry, and home décor.",
    hsPrefixes: ["94", "4420", "4421"],
    keywords: ["furniture", "mattress", "sofa", "chair", "table", "cabinet", "lighting", "home decor"]
  },
  {
    id: "apparel-footwear",
    label: "Apparel & Footwear",
    description: "Apparel, garments, footwear, textiles, and fashion accessories.",
    hsPrefixes: ["61", "62", "64", "65"],
    keywords: ["apparel", "garment", "shirt", "pants", "dress", "footwear", "shoe", "sneaker", "textile"]
  },
  {
    id: "building-materials",
    label: "Building Materials",
    description: "Flooring, tile, lumber, stone, glass, cabinetry, and metal building products.",
    hsPrefixes: ["44", "68", "69", "70", "73", "76"],
    keywords: ["tile", "flooring", "lumber", "plywood", "stone", "granite", "cabinetry", "building material"]
  },
  {
    id: "industrial-equipment",
    label: "Industrial Equipment",
    description: "Machinery, motors, pumps, tools, generators, and industrial components.",
    hsPrefixes: ["84", "85", "86"],
    keywords: ["pump", "compressor", "machinery", "industrial", "motor", "equipment", "generator", "tooling"]
  },
  {
    id: "food-beverage",
    label: "Food & Beverage",
    description: "Packaged food, beverages, produce, meat, seafood, and ingredients.",
    hsPrefixes: ["02", "03", "04", "07", "08", "09", "16", "17", "18", "19", "20", "21", "22"],
    keywords: ["food", "beverage", "snack", "drink", "juice", "frozen", "seafood", "meat", "produce"]
  },
  {
    id: "consumer-goods",
    label: "Consumer Goods",
    description: "Household products, toys, sporting goods, packaging, and paper goods.",
    hsPrefixes: ["39", "42", "48", "49", "95", "96"],
    keywords: ["household", "consumer goods", "plasticware", "toy", "sporting goods", "packaging", "paper goods"]
  },
  {
    id: "automotive",
    label: "Automotive",
    description: "Vehicles, replacement parts, tires, engines, brakes, and aftermarket products.",
    hsPrefixes: ["87", "4011", "4012"],
    keywords: ["automotive", "auto parts", "vehicle", "tire", "brake", "engine", "aftermarket"]
  },
  {
    id: "electronics",
    label: "Electronics",
    description: "Computers, appliances, batteries, circuits, displays, and telecommunications products.",
    hsPrefixes: ["85", "90"],
    keywords: ["electronics", "computer", "appliance", "battery", "circuit", "display", "telecom"]
  },
  {
    id: "chemicals",
    label: "Chemicals",
    description: "Chemicals, paints, resins, adhesives, cleaners, cosmetics, and detergents.",
    hsPrefixes: ["28", "29", "32", "33", "34", "35", "38"],
    keywords: ["chemical", "adhesive", "paint", "resin", "detergent", "cosmetic", "cleaner"]
  },
  {
    id: "logistics-providers",
    label: "Logistics / Carrier / Forwarder",
    description: "Carriers, forwarders, brokers, warehouses, fulfillment providers, and other logistics companies.",
    hsPrefixes: [],
    keywords: [
      "steamship",
      "carrier",
      "shipping line",
      "freight forwarder",
      "customs broker",
      "logistics services",
      "logistics",
      "distribution",
      "warehouse",
      "warehousing",
      "fulfillment",
      "transport",
      "trucking",
      "drayage",
      "3pl"
    ]
  }
] as const;

export const TRADEMINING_INDUSTRY_FILTER_MODES = ["HARD", "PREFER", "EXCLUDE"] as const;

export type TradeMiningIndustryFilterMode = (typeof TRADEMINING_INDUSTRY_FILTER_MODES)[number];
export type TradeMiningIndustryPackId = (typeof TRADEMINING_INDUSTRY_PACKS)[number]["id"];

const packById = new Map(TRADEMINING_INDUSTRY_PACKS.map((pack) => [pack.id, pack]));
const validModes = new Set<string>(TRADEMINING_INDUSTRY_FILTER_MODES);

export function isTradeMiningIndustryPackId(value: string): value is TradeMiningIndustryPackId {
  return packById.has(value as TradeMiningIndustryPackId);
}

export function isTradeMiningIndustryFilterMode(value: string): value is TradeMiningIndustryFilterMode {
  return validModes.has(value);
}

export function normalizeTradeMiningIndustryPackIds(value: unknown) {
  if (!Array.isArray(value)) {
    return [] as TradeMiningIndustryPackId[];
  }

  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item, index, array): item is TradeMiningIndustryPackId => {
      return isTradeMiningIndustryPackId(item) && array.indexOf(item) === index;
    });
}

export function normalizeTradeMiningIndustryFilterMode(
  value: unknown
): TradeMiningIndustryFilterMode {
  return typeof value === "string" && isTradeMiningIndustryFilterMode(value) ? value : "PREFER";
}

export function selectedTradeMiningIndustryPacks(ids: readonly string[]) {
  return ids
    .map((id) => packById.get(id as TradeMiningIndustryPackId))
    .filter((pack): pack is (typeof TRADEMINING_INDUSTRY_PACKS)[number] => Boolean(pack));
}

export function matchesTradeMiningIndustryLabels(
  ids: readonly string[],
  primaryIndustry: string | null | undefined,
  secondaryIndustry: string | null | undefined
) {
  const selectedLabels = new Set<string>(selectedTradeMiningIndustryPacks(ids).map((pack) => pack.label));
  return Boolean(
    (primaryIndustry && selectedLabels.has(primaryIndustry)) ||
      (secondaryIndustry && selectedLabels.has(secondaryIndustry))
  );
}

export function matchesTradeMiningIndustrySignals(
  ids: readonly string[],
  productDescription: string | null | undefined,
  hsCode: string | null | undefined
) {
  const normalizedProduct = normalizeText(productDescription);
  const normalizedHsCode = (hsCode ?? "").replace(/[^0-9]/g, "");

  return selectedTradeMiningIndustryPacks(ids).some((pack) => {
    return (
      (normalizedHsCode && pack.hsPrefixes.some((prefix) => normalizedHsCode.startsWith(prefix))) ||
      (normalizedProduct && pack.keywords.some((keyword) => normalizedProduct.includes(normalizeText(keyword))))
    );
  });
}

function normalizeText(value: string | null | undefined) {
  return (value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
