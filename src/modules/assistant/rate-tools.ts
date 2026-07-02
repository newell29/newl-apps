import { AssistantSourceKind } from "@prisma/client";

import { getLtlRatePortalShell } from "@/modules/ltl-rate-portal/queries";
import type { LtlCountryCode, LtlQuoteRequest } from "@/modules/ltl-rate-portal/types";
import { UPS_SERVICE_OPTIONS } from "@/modules/ups-tools/constants";
import { inferCountryFromPostalCode } from "@/modules/ups-tools/engine";
import { getUpsToolsShell } from "@/modules/ups-tools/queries";
import type { QuoteRequest, UpsServiceName } from "@/modules/ups-tools/types";
import { getLtlQuotes } from "@/server/integrations/seven-l";
import { getUpsQuote } from "@/server/integrations/ups";
import type { TenantContext } from "@/server/tenant-context";

type AssistantRateMode = "LTL" | "UPS";

type ResolvedAssistantRateLocation = {
  label: string;
  postalCode: string;
  city?: string;
  state?: string;
  country: "US" | "CA";
};

type ParsedAssistantRatePrompt = {
  mode: AssistantRateMode | null;
  modeExplicit: boolean;
  origin: ResolvedAssistantRateLocation | null;
  destination: ResolvedAssistantRateLocation | null;
  length: number | null;
  width: number | null;
  height: number | null;
  weight: number | null;
  quantity: number | null;
  quantityUnit: "PALLET" | "PACKAGE" | null;
  residential: boolean;
  requestedUpsServices: UpsServiceName[];
};

type AssistantRateToolResult = {
  answer: string;
  intent: "RATE_REQUEST";
  provider: string;
  model: string;
  messageMetadata: Record<string, unknown>;
  runMetadata: Record<string, unknown>;
  sources: Array<{
    sourceKind: AssistantSourceKind;
    sourceId: string | null;
    title: string;
    excerpt: string;
    metadata?: Record<string, unknown>;
  }>;
};

const CITY_LOCATION_CATALOG: Array<ResolvedAssistantRateLocation & { aliases: string[] }> = [
  { aliases: ["charlotte", "charlotte nc", "charlotte, nc"], label: "Charlotte, NC", postalCode: "28273", city: "CHARLOTTE", state: "NC", country: "US" },
  { aliases: ["dallas", "dallas tx", "dallas, tx"], label: "Dallas, TX", postalCode: "75201", city: "DALLAS", state: "TX", country: "US" },
  { aliases: ["los angeles", "los angeles ca", "los angeles, ca"], label: "Los Angeles, CA", postalCode: "90001", city: "LOS ANGELES", state: "CA", country: "US" },
  { aliases: ["beverly hills", "beverly hills ca", "beverly hills, ca"], label: "Beverly Hills, CA", postalCode: "90210", city: "BEVERLY HILLS", state: "CA", country: "US" },
  { aliases: ["chicago", "chicago il", "chicago, il"], label: "Chicago, IL", postalCode: "60601", city: "CHICAGO", state: "IL", country: "US" },
  { aliases: ["houston", "houston tx", "houston, tx"], label: "Houston, TX", postalCode: "77001", city: "HOUSTON", state: "TX", country: "US" },
  { aliases: ["atlanta", "atlanta ga", "atlanta, ga"], label: "Atlanta, GA", postalCode: "30301", city: "ATLANTA", state: "GA", country: "US" },
  { aliases: ["miami", "miami fl", "miami, fl"], label: "Miami, FL", postalCode: "33101", city: "MIAMI", state: "FL", country: "US" },
  { aliases: ["toronto", "toronto on", "toronto, on"], label: "Toronto, ON", postalCode: "M5H2N2", city: "TORONTO", state: "ON", country: "CA" },
  { aliases: ["mississauga", "mississauga on", "mississauga, on"], label: "Mississauga, ON", postalCode: "L5T1Z3", city: "MISSISSAUGA", state: "ON", country: "CA" },
  { aliases: ["montreal", "montreal qc", "montreal, qc"], label: "Montreal, QC", postalCode: "H3B2Y5", city: "MONTREAL", state: "QC", country: "CA" },
  { aliases: ["vancouver", "vancouver bc", "vancouver, bc"], label: "Vancouver, BC", postalCode: "V6B1T8", city: "VANCOUVER", state: "BC", country: "CA" }
];

const UPS_SERVICE_KEYWORDS: Array<{ service: UpsServiceName; needles: string[] }> = [
  { service: "Next Day Air Saver", needles: ["next day air saver"] },
  { service: "Next Day Air", needles: ["next day air", "nda"] },
  { service: "2nd Day Air", needles: ["2nd day air", "second day air"] },
  { service: "3 Day Select", needles: ["3 day select", "three day select"] },
  { service: "Ground", needles: ["ground"] }
];

const POSTAL_CODE_PATTERN = /\b(?:\d{5}|[A-Za-z]\d[A-Za-z][ -]?\d[A-Za-z]\d)\b/g;

export async function maybeRunAssistantRateRequest(
  context: TenantContext & { userId: string },
  prompt: string,
  threadPromptContext?: string | null
): Promise<AssistantRateToolResult | null> {
  const parsed = parseAssistantRatePrompt(prompt, threadPromptContext);
  if (!parsed) {
    return null;
  }

  const missingFields = collectMissingFields(parsed);
  if (missingFields.length > 0) {
    return {
      answer: `I can quote that once I have ${missingFields.join(", ")}.`,
      intent: "RATE_REQUEST",
      provider: "NEWL_RATE_ASSISTANT",
      model: "rate-collection-v1",
      messageMetadata: {
        deterministic: true,
        intent: "RATE_REQUEST",
        needsClarification: true,
        missingFields
      },
      runMetadata: {
        deterministic: true,
        intent: "RATE_REQUEST",
        missingFields,
        parsed
      },
      sources: []
    };
  }

  const mode = parsed.mode ?? inferAssistantRateMode(parsed);
  if (mode === "UPS") {
    return runUpsAssistantRate(context, parsed);
  }

  return runLtlAssistantRate(context, parsed);
}

export function parseAssistantRatePrompt(prompt: string, threadPromptContext?: string | null): ParsedAssistantRatePrompt | null {
  const normalized = prompt.trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  const contextualPrompt =
    threadPromptContext && threadPromptContext.trim().length > 0 ? `${threadPromptContext}\n${prompt}` : prompt;
  const contextualNormalized = contextualPrompt.trim().toLowerCase();

  const quoteLanguagePresent =
    /(?:\brate\b|\bquote\b|\bpricing\b|\bpriced\b|\b7l\b|\bups\b|\bltl\b|\bfreight\b)/i.test(contextualPrompt);
  if (!quoteLanguagePresent) {
    return null;
  }

  const modeExplicit =
    /(?:\bups\b|\bparcel\b|\bpackage\b|\bbox\b|\b7l\b|\bseven l\b|\bltl\b|\bfreight\b|\bpallet\b|\bskid\b)/i.test(contextualPrompt);
  const quantityWithUnitMatch = contextualPrompt.match(/(\d+)\s*(pallets?|skids?|plt|packages?|pkgs?|boxes?|cartons?)/i);
  const quantityStandaloneMatch = contextualPrompt.match(/\b(?:qty|quantity)(?:\s+is|:)?\s*(\d+)\b/i);
  const quantity = quantityWithUnitMatch
    ? Number.parseInt(quantityWithUnitMatch[1], 10)
    : quantityStandaloneMatch
      ? Number.parseInt(quantityStandaloneMatch[1], 10)
      : null;
  const quantityToken = quantityWithUnitMatch?.[2]?.toLowerCase() ?? "";
  const quantityUnit =
    quantityToken.includes("pallet") || quantityToken.includes("skid") || quantityToken === "plt"
      ? "PALLET"
      : quantityWithUnitMatch
      ? "PACKAGE"
      : null;
  const weightMatch = contextualPrompt.match(/(\d+(?:\.\d+)?)\s*(?:lb|lbs|pounds?)/i);
  const dimsMatch = contextualPrompt.match(/(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)/i);
  const postalMatches = [...contextualPrompt.matchAll(POSTAL_CODE_PATTERN)].map((match) => ({
    value: normalizePostalCode(match[0]),
    index: match.index ?? 0
  }));
  const cityMatches = findCatalogLocationsInPrompt(contextualPrompt);
  const fromToLabels = extractFromToLabels(contextualPrompt);

  const origin =
    resolveLocationFromToken(postalMatches[0]?.value) ??
    cityMatches[0]?.location ??
    resolveAssistantRateLocation(fromToLabels.origin);
  const destination =
    resolveLocationFromToken(postalMatches[1]?.value) ??
    cityMatches.find((match) => match.location.postalCode !== origin?.postalCode)?.location ??
    resolveAssistantRateLocation(fromToLabels.destination);

  const requestedUpsServices = UPS_SERVICE_KEYWORDS.flatMap(({ service, needles }) =>
    needles.some((needle) => contextualNormalized.includes(needle)) ? [service] : []
  );

  return {
    mode: detectExplicitRateMode(contextualNormalized, quantityUnit),
    modeExplicit,
    origin: origin ?? null,
    destination: destination ?? null,
    length: dimsMatch ? Number.parseFloat(dimsMatch[1]) : null,
    width: dimsMatch ? Number.parseFloat(dimsMatch[2]) : null,
    height: dimsMatch ? Number.parseFloat(dimsMatch[3]) : null,
    weight: weightMatch ? Number.parseFloat(weightMatch[1]) : null,
    quantity,
    quantityUnit,
    residential: /\bresidential\b/.test(normalized),
    requestedUpsServices
  };
}

function collectMissingFields(parsed: ParsedAssistantRatePrompt) {
  const missing: string[] = [];
  if (!parsed.origin) missing.push("an origin");
  if (!parsed.destination) missing.push("a destination");
  if (!parsed.length || !parsed.width || !parsed.height) missing.push("dimensions");
  if (!parsed.weight) missing.push("weight");
  if (!parsed.quantity) missing.push("quantity");
  return missing;
}

function inferAssistantRateMode(parsed: ParsedAssistantRatePrompt): AssistantRateMode {
  if (parsed.quantityUnit === "PALLET") {
    return "LTL";
  }

  return "UPS";
}

function detectExplicitRateMode(normalizedPrompt: string, quantityUnit: ParsedAssistantRatePrompt["quantityUnit"]) {
  if (/\bups\b|\bparcel\b|\bpackage\b|\bbox\b|\bcarton\b/.test(normalizedPrompt)) {
    return "UPS";
  }

  if (/\b7l\b|\bseven l\b|\bltl\b|\bfreight\b/.test(normalizedPrompt) || quantityUnit === "PALLET") {
    return "LTL";
  }

  return null;
}

function extractFromToLabels(prompt: string) {
  const match = prompt.match(/from\s+(.+?)\s+to\s+(.+?)(?=(?:\s+\d+(?:\.\d+)?\s*[x×]\s*\d+(?:\.\d+)?\s*[x×]\s*\d+(?:\.\d+)?)|(?:\s+\d+(?:\.\d+)?\s*(?:lb|lbs|pounds?))|(?:\s+\d+\s*(?:pallets?|skids?|packages?|pkgs?|boxes?|cartons?))|$)/i);
  return {
    origin: match?.[1] ?? null,
    destination: match?.[2] ?? null
  };
}

function findCatalogLocationsInPrompt(prompt: string) {
  const normalizedPrompt = normalizeLocationKey(prompt);
  return CITY_LOCATION_CATALOG.flatMap((location) => {
    const matchedAlias = location.aliases.find((alias) => normalizedPrompt.includes(normalizeLocationKey(alias)));
    if (!matchedAlias) {
      return [];
    }

    return [
      {
        location,
        index: normalizedPrompt.indexOf(normalizeLocationKey(matchedAlias))
      }
    ];
  }).sort((left, right) => left.index - right.index);
}

function resolveAssistantRateLocation(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const postalMatch = value.match(POSTAL_CODE_PATTERN);
  if (postalMatch?.[0]) {
    return resolveLocationFromToken(normalizePostalCode(postalMatch[0]));
  }

  const normalized = normalizeLocationKey(value);
  const match = CITY_LOCATION_CATALOG.find((location) =>
    location.aliases.some((alias) => normalizeLocationKey(alias) === normalized)
  );
  if (!match) {
    return null;
  }

  return {
    label: match.label,
    postalCode: match.postalCode,
    city: match.city,
    state: match.state,
    country: match.country
  } satisfies ResolvedAssistantRateLocation;
}

function resolveLocationFromToken(postalCode: string | undefined) {
  if (!postalCode) {
    return null;
  }

  const catalogMatch = CITY_LOCATION_CATALOG.find((location) => location.postalCode === postalCode);
  if (catalogMatch) {
    return {
      label: catalogMatch.label,
      postalCode: catalogMatch.postalCode,
      city: catalogMatch.city,
      state: catalogMatch.state,
      country: catalogMatch.country
    } satisfies ResolvedAssistantRateLocation;
  }

  return {
    label: postalCode,
    postalCode,
    country: inferCountryFromPostalCode(postalCode)
  };
}

function normalizePostalCode(value: string) {
  const trimmed = value.trim().toUpperCase();
  return /^[A-Z]/.test(trimmed) ? trimmed.replace(/\s+/g, "") : trimmed;
}

function normalizeLocationKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

async function runUpsAssistantRate(
  context: TenantContext & { userId: string },
  parsed: ParsedAssistantRatePrompt
): Promise<AssistantRateToolResult> {
  const shell = await getUpsToolsShell(context, "SHIPMENT_RATE_QUOTE");
  if (!shell.moduleEnabled) {
    return emptyRateToolResult("UPS Tools is not enabled for this tenant.", "UPS");
  }
  const account = shell.accounts.find((candidate) => candidate.status === "ACTIVE");

  if (!account) {
    return emptyRateToolResult(
      "UPS quoting is not ready for this tenant yet. Add or enable a UPS account in Settings before requesting parcel rates.",
      "UPS"
    );
  }

  const services = parsed.requestedUpsServices.length > 0 ? parsed.requestedUpsServices : UPS_SERVICE_OPTIONS;
  const requestBase = {
    shipmentReference: "assistant-chat",
    originPostalCode: parsed.origin!.postalCode,
    originCountryCode: inferCountryFromPostalCode(parsed.origin!.postalCode),
    destinationPostalCode: parsed.destination!.postalCode,
    destinationCountryCode: inferCountryFromPostalCode(parsed.destination!.postalCode),
    weight: parsed.weight!,
    length: parsed.length!,
    width: parsed.width!,
    height: parsed.height!,
    isResidential: parsed.residential
  } satisfies Omit<QuoteRequest, "service">;

  const quotes = await Promise.all(
    services.map((service) =>
      getUpsQuote(account, {
        ...requestBase,
        service
      })
    )
  );
  quotes.sort((left, right) => left.totalWithTax - right.totalWithTax || left.transitDays - right.transitDays);
  const best = quotes[0];

  return {
    answer: [
      `UPS returned ${quotes.length} quote(s) for ${formatLane(parsed)} using ${account.name}.`,
      `Best rate: ${best.service} at $${best.totalWithTax.toFixed(2)}, ${best.transitDays} transit day(s), billable weight ${best.billableWeight} lbs.`,
      ...quotes.slice(0, 4).map((quote, index) =>
        `${index + 1}. ${quote.service} $${quote.totalWithTax.toFixed(2)} | transit ${quote.transitDays} day(s) | account ${quote.accountShipperNumber}`
      )
    ].join("\n"),
    intent: "RATE_REQUEST",
    provider: "UPS_TOOL",
    model: "ups-live-rate-v1",
    messageMetadata: {
      deterministic: false,
      intent: "RATE_REQUEST",
      tool: "UPS",
      accountId: account.id,
      quoteCount: quotes.length
    },
    runMetadata: {
      deterministic: false,
      intent: "RATE_REQUEST",
      tool: "UPS",
      accountId: account.id,
      requestBase,
      serviceCount: services.length
    },
    sources: [
      {
        sourceKind: AssistantSourceKind.RATE_TOOL,
        sourceId: account.id,
        title: `UPS quote via ${account.name}`,
        excerpt: `${formatLane(parsed)}. ${quotes.length} service option(s) returned.`,
        metadata: {
          accountId: account.id,
          shipperNumber: account.shipperNumber,
          serviceCount: quotes.length
        }
      }
    ]
  };
}

async function runLtlAssistantRate(
  context: TenantContext & { userId: string },
  parsed: ParsedAssistantRatePrompt
): Promise<AssistantRateToolResult> {
  const shell = await getLtlRatePortalShell(context);
  if (!shell.moduleEnabled) {
    return emptyRateToolResult("The LTL Rate Portal is not enabled for this tenant.", "LTL");
  }
  const account = shell.accounts.find((candidate) => candidate.status === "ACTIVE");

  if (!account) {
    return emptyRateToolResult(
      "7L quoting is not ready for this tenant yet. Add or enable a 7L account in Settings before requesting LTL rates.",
      "LTL"
    );
  }

  const request: LtlQuoteRequest = {
    customerReference: "assistant-chat",
    originCity: parsed.origin?.city ?? "",
    originState: parsed.origin?.state ?? "",
    originZipcode: parsed.origin!.postalCode,
    originCountry: parsed.origin!.country as LtlCountryCode,
    destinationCity: parsed.destination?.city ?? "",
    destinationState: parsed.destination?.state ?? "",
    destinationZipcode: parsed.destination!.postalCode,
    destinationCountry: parsed.destination!.country as LtlCountryCode,
    pickupDate: "Not scheduled",
    uom: "US",
    accessorialCodes: [],
    pieces: [
      {
        qty: parsed.quantity!,
        weight: parsed.weight!,
        weightType: parsed.quantity! > 1 ? "total" : "each",
        length: parsed.length!,
        width: parsed.width!,
        height: parsed.height!,
        dimType: "PLT",
        freightClass: "70",
        hazmat: false,
        stack: true
      }
    ]
  };

  const { data, errors } = await getLtlQuotes(account, [request]);
  if (data.length === 0) {
    const errorMessage = errors[0]?.errorMessage ?? "7L returned no quote results.";
    return emptyRateToolResult(errorMessage, "LTL");
  }

  const quotes = [...data].sort((left, right) => left.total - right.total || left.transitDays - right.transitDays);
  const best = quotes[0];

  return {
    answer: [
      `7L returned ${quotes.length} quote(s) for ${formatLane(parsed)} using ${account.name}.`,
      `Lowest rate: ${best.carrierName} at $${best.total.toFixed(2)}, ${best.transitDays} transit day(s).`,
      ...quotes.slice(0, 4).map((quote, index) =>
        `${index + 1}. ${quote.carrierName} $${quote.total.toFixed(2)} | transit ${quote.transitDays} day(s) | quote ${quote.quoteNumber}`
      ),
      ...(errors.length > 0 ? [`${errors.length} carrier(s) returned an error.`] : [])
    ].join("\n"),
    intent: "RATE_REQUEST",
    provider: "SEVEN_L_TOOL",
    model: "ltl-live-rate-v1",
    messageMetadata: {
      deterministic: false,
      intent: "RATE_REQUEST",
      tool: "LTL",
      accountId: account.id,
      quoteCount: quotes.length,
      errorCount: errors.length
    },
    runMetadata: {
      deterministic: false,
      intent: "RATE_REQUEST",
      tool: "LTL",
      accountId: account.id,
      quoteCount: quotes.length,
      errorCount: errors.length,
      request
    },
    sources: [
      {
        sourceKind: AssistantSourceKind.RATE_TOOL,
        sourceId: account.id,
        title: `7L quote via ${account.name}`,
        excerpt: `${formatLane(parsed)}. ${quotes.length} carrier quote(s) returned.`,
        metadata: {
          accountId: account.id,
          quoteCount: quotes.length,
          errorCount: errors.length
        }
      }
    ]
  };
}

function emptyRateToolResult(message: string, tool: AssistantRateMode): AssistantRateToolResult {
  return {
    answer: message,
    intent: "RATE_REQUEST",
    provider: `${tool}_TOOL`,
    model: `${tool.toLowerCase()}-rate-v1`,
    messageMetadata: {
      deterministic: true,
      intent: "RATE_REQUEST",
      tool,
      error: true
    },
    runMetadata: {
      deterministic: true,
      intent: "RATE_REQUEST",
      tool,
      error: true,
      message
    },
    sources: []
  };
}

function formatLane(parsed: ParsedAssistantRatePrompt) {
  const quantityLabel =
    parsed.quantityUnit === "PALLET"
      ? `${parsed.quantity} pallet(s)`
      : `${parsed.quantity} package(s)`;
  return `${parsed.origin?.label ?? parsed.origin?.postalCode} to ${parsed.destination?.label ?? parsed.destination?.postalCode}, ${quantityLabel} ${parsed.length}x${parsed.width}x${parsed.height}, ${parsed.weight} lbs`;
}
