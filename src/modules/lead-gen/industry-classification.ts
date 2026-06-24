const INDUSTRY_RULES = [
  {
    label: "Furniture & Home",
    hsPrefixes: ["94", "4420", "4421"],
    keywords: ["furniture", "mattress", "sofa", "chair", "table", "cabinet", "lighting", "home decor"]
  },
  {
    label: "Apparel & Footwear",
    hsPrefixes: ["61", "62", "64", "65"],
    keywords: ["apparel", "garment", "shirt", "pants", "dress", "footwear", "shoe", "sneaker", "textile"]
  },
  {
    label: "Building Materials",
    hsPrefixes: ["44", "68", "69", "70", "73", "76"],
    keywords: ["tile", "flooring", "lumber", "plywood", "stone", "granite", "cabinetry", "building material"]
  },
  {
    label: "Industrial Equipment",
    hsPrefixes: ["84", "85", "86"],
    keywords: ["pump", "compressor", "machinery", "industrial", "motor", "equipment", "generator", "tooling"]
  },
  {
    label: "Food & Beverage",
    hsPrefixes: ["02", "03", "04", "07", "08", "09", "16", "17", "18", "19", "20", "21", "22"],
    keywords: ["food", "beverage", "snack", "drink", "juice", "frozen", "seafood", "meat", "produce"]
  },
  {
    label: "Consumer Goods",
    hsPrefixes: ["39", "42", "48", "49", "95", "96"],
    keywords: ["household", "consumer goods", "plasticware", "toy", "sporting goods", "packaging", "paper goods"]
  },
  {
    label: "Automotive",
    hsPrefixes: ["87", "4011", "4012"],
    keywords: ["automotive", "auto parts", "vehicle", "tire", "brake", "engine", "aftermarket"]
  },
  {
    label: "Electronics",
    hsPrefixes: ["85", "90"],
    keywords: ["electronics", "computer", "appliance", "battery", "circuit", "display", "telecom"]
  },
  {
    label: "Chemicals",
    hsPrefixes: ["28", "29", "32", "33", "34", "35", "38"],
    keywords: ["chemical", "adhesive", "paint", "resin", "detergent", "cosmetic", "cleaner"]
  },
  {
    label: "Logistics / Carrier / Forwarder",
    hsPrefixes: [],
    keywords: ["steamship", "carrier", "shipping line", "freight forwarder", "customs broker", "logistics services"]
  }
] as const;

export const INDUSTRY_OPTIONS = INDUSTRY_RULES.map((rule) => rule.label);

export type IndustryClassification = {
  primaryIndustry: string | null;
  secondaryIndustry: string | null;
  confidence: number;
  source: "HS_CODE" | "KEYWORD" | "MIXED" | "UNKNOWN";
};

export function classifyTradeMiningIndustry(input: {
  productDescription?: string | null;
  hsCode?: string | null;
}): IndustryClassification {
  return classifyTradeMiningIndustryFromRecords([input]);
}

export function classifyTradeMiningIndustryFromRecords(
  records: Array<{
    productDescription?: string | null;
    hsCode?: string | null;
  }>
): IndustryClassification {
  const industryScores = new Map<string, number>();
  const signalSources = new Set<"HS_CODE" | "KEYWORD">();

  for (const record of records) {
    const hsCode = normalizeHsCode(record.hsCode);
    const productText = normalizeText(record.productDescription);

    for (const rule of INDUSTRY_RULES) {
      let score = 0;

      if (hsCode && rule.hsPrefixes.some((prefix) => hsCode.startsWith(prefix))) {
        score += 6;
        signalSources.add("HS_CODE");
      }

      const keywordMatches = rule.keywords.filter((keyword) => productText.includes(keyword)).length;
      if (keywordMatches > 0) {
        score += keywordMatches * 3;
        signalSources.add("KEYWORD");
      }

      if (score > 0) {
        industryScores.set(rule.label, (industryScores.get(rule.label) ?? 0) + score);
      }
    }
  }

  const ranked = [...industryScores.entries()].sort((left, right) => right[1] - left[1]);
  const primary = ranked[0] ?? null;
  const secondary = ranked[1] ?? null;

  if (!primary) {
    return {
      primaryIndustry: null,
      secondaryIndustry: null,
      confidence: 0,
      source: "UNKNOWN"
    };
  }

  const totalScore = ranked.reduce((sum, [, score]) => sum + score, 0);
  const confidence = Math.max(
    20,
    Math.min(
      100,
      Math.round((primary[1] / Math.max(totalScore, 1)) * 100) + (secondary ? Math.max(0, primary[1] - secondary[1]) : 10)
    )
  );

  return {
    primaryIndustry: primary[0],
    secondaryIndustry: secondary && secondary[1] >= Math.max(4, primary[1] * 0.5) ? secondary[0] : null,
    confidence,
    source:
      signalSources.size === 2
        ? "MIXED"
        : signalSources.has("HS_CODE")
          ? "HS_CODE"
          : signalSources.has("KEYWORD")
            ? "KEYWORD"
            : "UNKNOWN"
  };
}

function normalizeHsCode(value: string | null | undefined) {
  return (value ?? "").replace(/[^0-9]/g, "");
}

function normalizeText(value: string | null | undefined) {
  return (value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
