import { TRADEMINING_INDUSTRY_PACKS } from "@/modules/lead-gen/industry-packs";

export const INDUSTRY_OPTIONS = TRADEMINING_INDUSTRY_PACKS.map((rule) => rule.label);

export type IndustryClassification = {
  primaryIndustry: string | null;
  secondaryIndustry: string | null;
  confidence: number;
  source: "HS_CODE" | "KEYWORD" | "MIXED" | "UNKNOWN";
};

export function classifyTradeMiningIndustry(input: {
  productDescription?: string | null;
  hsCode?: string | null;
  companyName?: string | null;
  domain?: string | null;
}): IndustryClassification {
  return classifyTradeMiningIndustryFromRecords([input]);
}

export function classifyTradeMiningIndustryFromRecords(
  records: Array<{
    productDescription?: string | null;
    hsCode?: string | null;
    companyName?: string | null;
    domain?: string | null;
  }>
): IndustryClassification {
  const industryScores = new Map<string, number>();
  const signalSources = new Set<"HS_CODE" | "KEYWORD">();

  for (const record of records) {
    const hsCode = normalizeHsCode(record.hsCode);
    const productText = normalizeText(record.productDescription);
    const companyText = normalizeText([record.companyName, record.domain].filter(Boolean).join(" "));

    for (const rule of TRADEMINING_INDUSTRY_PACKS) {
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

      const companyKeywordMatches = rule.keywords.filter((keyword) => companyText.includes(keyword)).length;
      if (companyKeywordMatches > 0) {
        score += companyKeywordMatches * 2;
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
