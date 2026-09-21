import { WebsiteInboundAttributionChannel } from "@prisma/client";

import type {
  WebsiteInboundFieldValue,
  WebsiteInboundSubmissionInput
} from "@/modules/website-inbound/types";

const ATTRIBUTION_ALIASES = {
  utmSource: ["utm_source", "Attribution - UTM Source"],
  utmMedium: ["utm_medium", "Attribution - UTM Medium"],
  utmCampaign: ["utm_campaign", "Attribution - UTM Campaign"],
  utmTerm: ["utm_term", "Attribution - UTM Term"],
  utmContent: ["utm_content", "Attribution - UTM Content"],
  gclid: ["GCLID", "Attribution - GCLID"],
  gbraid: ["GBRAID", "Attribution - GBRAID"],
  wbraid: ["WBRAID", "Attribution - WBRAID"],
  gaClientId: ["ga_client_id", "Attribution - GA Client ID"],
  campaignId: ["campaign_id", "Attribution - Campaign ID"],
  adGroupId: ["ad_group_id", "Attribution - Ad Group ID"],
  creativeId: ["creative_id", "Attribution - Creative ID"],
  matchType: ["match_type", "Attribution - Match Type"],
  network: ["Attribution - Network"],
  device: ["Attribution - Device"],
  landingPage: ["landing_page", "Attribution - Landing Page"],
  landingPath: ["landing_path", "Attribution - Landing Path"],
  firstReferrer: ["first_referrer", "Attribution - First Referrer"],
  firstReferrerDomain: ["first_referrer_domain", "Attribution - First Referrer Domain"],
  sessionStartedAt: ["session_started_at", "Attribution - Session Started At"],
  submittedAt: ["submitted_at", "Attribution - Submitted At"],
  trafficSourceGuess: ["traffic_source_guess", "Attribution - Traffic Source Guess"],
  attributionConfidence: ["attribution_confidence", "Attribution - Attribution Confidence"],
  isTest: ["is_test", "Attribution - Is Test"]
} as const;

const PAID_MEDIA = new Set(["cpc", "ppc", "paid", "paid_search", "paid-search", "sem"]);
const AI_DOMAINS = ["chatgpt", "openai", "perplexity", "claude", "copilot", "gemini"];
const AUTOMATED_TEST_MARKERS = new Set([
  "codex_diagnostic",
  "automated_check",
  "form_health_check",
  "synthetic_check",
  "qa_test"
]);
const INTERNAL_TEST_MARKERS = new Set(["internal", "internal_test", "employee", "employee_test"]);

export type NormalizedWebsiteInboundAttribution = {
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmTerm: string | null;
  utmContent: string | null;
  gclid: string | null;
  gbraid: string | null;
  wbraid: string | null;
  gaClientId: string | null;
  campaignId: string | null;
  adGroupId: string | null;
  creativeId: string | null;
  matchType: string | null;
  network: string | null;
  device: string | null;
  landingPage: string | null;
  landingPath: string | null;
  firstReferrer: string | null;
  firstReferrerDomain: string | null;
  sessionStartedAt: Date | null;
  submittedAt: Date;
  trafficSourceGuess: string | null;
  attributionConfidence: string | null;
  attributionChannel: WebsiteInboundAttributionChannel;
  attributionLocation: string | null;
  isTest: boolean;
  marketingExcludedReason: string | null;
};

export function normalizeWebsiteInboundAttribution(
  payload: Partial<WebsiteInboundSubmissionInput>,
  fields: Record<string, WebsiteInboundFieldValue>,
  receivedAt = new Date()
): NormalizedWebsiteInboundAttribution {
  const read = (name: keyof typeof ATTRIBUTION_ALIASES, max = 2000) =>
    cleanText(
      payload[name] ?? findField(fields, [name, ...ATTRIBUTION_ALIASES[name]]),
      max
    );
  const landingPage = read("landingPage");
  const landingPath = read("landingPath") ?? pathFromUrl(landingPage);
  const firstReferrer = read("firstReferrer");
  const firstReferrerDomain =
    read("firstReferrerDomain", 500) ?? domainFromUrl(firstReferrer);
  const explicitTest = booleanValue(
    payload.isTest ?? findField(fields, ["isTest", ...ATTRIBUTION_ALIASES.isTest])
  );
  const diagnosticMarker = hasDiagnosticMarker([
    payload.pageUrl,
    landingPage,
    landingPath
  ]);
  const sourceMarkers = [payload.formType, payload.source]
    .map((value) => cleanText(value, 200)?.toLowerCase())
    .filter((value): value is string => Boolean(value));
  const automatedMarker = sourceMarkers.some((value) => AUTOMATED_TEST_MARKERS.has(value));
  const internalMarker = sourceMarkers.some((value) => INTERNAL_TEST_MARKERS.has(value));
  const isTest = explicitTest || diagnosticMarker || automatedMarker || internalMarker;
  const marketingExcludedReason = diagnosticMarker
    ? "CODEX_DIAGNOSTIC"
    : automatedMarker
      ? "AUTOMATED_FORM_CHECK"
      : internalMarker
        ? "INTERNAL_SUBMISSION"
        : explicitTest
          ? "EXPLICIT_TEST"
          : null;
  const values = {
    utmSource: read("utmSource", 500),
    utmMedium: read("utmMedium", 500),
    utmCampaign: read("utmCampaign", 1000),
    utmTerm: read("utmTerm", 1000),
    utmContent: read("utmContent", 1000),
    gclid: read("gclid", 1000),
    gbraid: read("gbraid", 1000),
    wbraid: read("wbraid", 1000),
    gaClientId: read("gaClientId", 500),
    campaignId: read("campaignId", 500),
    adGroupId: read("adGroupId", 500),
    creativeId: read("creativeId", 500),
    matchType: read("matchType", 100),
    network: read("network", 100),
    device: read("device", 100),
    landingPage,
    landingPath,
    firstReferrer,
    firstReferrerDomain,
    sessionStartedAt: dateValue(read("sessionStartedAt", 100)),
    submittedAt: dateValue(read("submittedAt", 100)) ?? receivedAt,
    trafficSourceGuess: read("trafficSourceGuess", 500),
    attributionConfidence: read("attributionConfidence", 100),
    attributionLocation: deriveLocation(fields),
    isTest,
    marketingExcludedReason
  };

  return {
    ...values,
    attributionChannel: classifyWebsiteInboundChannel(values)
  };
}

export function classifyWebsiteInboundChannel(input: {
  utmSource?: string | null;
  utmMedium?: string | null;
  gclid?: string | null;
  gbraid?: string | null;
  wbraid?: string | null;
  campaignId?: string | null;
  adGroupId?: string | null;
  creativeId?: string | null;
  firstReferrerDomain?: string | null;
  trafficSourceGuess?: string | null;
}) {
  const source = lower(input.utmSource);
  const medium = lower(input.utmMedium);
  const guess = lower(input.trafficSourceGuess);
  const referrer = lower(input.firstReferrerDomain);

  if (
    PAID_MEDIA.has(medium) ||
    Boolean(input.gclid || input.gbraid || input.wbraid) ||
    Boolean(input.campaignId || input.adGroupId || input.creativeId) ||
    (source === "google" && medium === "cpc")
  ) {
    return WebsiteInboundAttributionChannel.PAID_SEARCH;
  }
  if (medium === "organic" || guess.includes("organic")) {
    return WebsiteInboundAttributionChannel.ORGANIC_SEARCH;
  }
  if (
    guess.includes("ai") ||
    AI_DOMAINS.some((domain) => source.includes(domain) || referrer.includes(domain))
  ) {
    return WebsiteInboundAttributionChannel.AI_REFERRAL;
  }
  if (medium === "local" || medium === "local_listing" || guess.includes("local")) {
    return WebsiteInboundAttributionChannel.LOCAL;
  }
  if (medium === "referral" || medium === "affiliate" || guess.includes("referral")) {
    return WebsiteInboundAttributionChannel.REFERRAL;
  }
  if (
    ["direct", "(none)", "none"].includes(medium) ||
    guess === "direct"
  ) {
    return WebsiteInboundAttributionChannel.DIRECT;
  }
  if (source || medium || referrer || guess) return WebsiteInboundAttributionChannel.OTHER;
  return WebsiteInboundAttributionChannel.UNKNOWN;
}

export function hasPaidClickId(input: { gclid?: string | null; gbraid?: string | null; wbraid?: string | null }) {
  return Boolean(input.gclid || input.gbraid || input.wbraid);
}

export function attributionCompleteness(input: {
  campaignId?: string | null;
  utmCampaign?: string | null;
  utmSource?: string | null;
  landingPage?: string | null;
  landingPath?: string | null;
  gclid?: string | null;
  gbraid?: string | null;
  wbraid?: string | null;
}) {
  const hasCampaign = Boolean(input.campaignId || input.utmCampaign);
  const hasLanding = Boolean(input.landingPage || input.landingPath);
  if (hasCampaign && input.utmSource && hasLanding) return "COMPLETE" as const;
  if (hasCampaign || hasLanding || input.utmSource || hasPaidClickId(input)) return "PARTIAL" as const;
  return "UNAVAILABLE" as const;
}

function findField(
  fields: Record<string, WebsiteInboundFieldValue>,
  candidates: readonly string[]
) {
  const normalized = new Map(
    Object.entries(fields).map(([key, value]) => [normalizeKey(key), value] as const)
  );
  for (const candidate of candidates) {
    const value = normalized.get(normalizeKey(candidate));
    if (value !== undefined) return value;
  }
  return undefined;
}

function deriveLocation(fields: Record<string, WebsiteInboundFieldValue>) {
  const values = [
    findField(fields, ["location", "service location", "project location"]),
    findField(fields, ["city", "destination city"]),
    findField(fields, ["province", "state", "destination province", "destination state"]),
    findField(fields, ["country", "destination country"])
  ]
    .map((value) => cleanText(value, 500))
    .filter((value): value is string => Boolean(value));
  return [...new Set(values)].join(", ") || null;
}

function normalizeKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function cleanText(value: unknown, max: number) {
  if (Array.isArray(value)) value = value.find((item) => cleanText(item, max));
  if (typeof value === "number" && Number.isFinite(value)) value = String(value);
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text ? text.slice(0, max) : null;
}

function lower(value: string | null | undefined) {
  return value?.trim().toLowerCase() ?? "";
}

function booleanValue(value: unknown) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1;
  if (typeof value !== "string") return false;
  return ["true", "1", "yes", "y", "test"].includes(value.trim().toLowerCase());
}

function dateValue(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function pathFromUrl(value: string | null) {
  if (!value) return null;
  try {
    return new URL(value, "https://www.newlgroup.com").pathname || "/";
  } catch {
    return null;
  }
}

function domainFromUrl(value: string | null) {
  if (!value) return null;
  try {
    return new URL(value).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

function hasDiagnosticMarker(values: Array<string | null | undefined>) {
  return values.some((value) => {
    if (!value) return false;
    try {
      return new URL(value, "https://www.newlgroup.com").searchParams.has(
        "codex_weekly_diagnostic"
      );
    } catch {
      return value.includes("codex_weekly_diagnostic");
    }
  });
}
