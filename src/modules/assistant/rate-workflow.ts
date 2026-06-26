import { AssistantSourceKind, ModuleKey } from "@prisma/client";

import { getLtlRatePortalShell } from "@/modules/ltl-rate-portal/queries";
import type { LtlCountryCode, LtlFreightPiece, LtlQuoteRequest, SevenLAccountConfig } from "@/modules/ltl-rate-portal/types";
import { AuthorizationError, requireModule } from "@/server/auth/authorization";
import { getLtlQuotes } from "@/server/integrations/seven-l";
import type { AuthenticatedContext } from "@/server/tenant-context";

export type ParsedAssistantRateRequest = {
  mode: "LTL";
  originLabel: string | null;
  destinationLabel: string | null;
  request: LtlQuoteRequest | null;
  missingFields: string[];
  summary: string;
};

export type AssistantRateResponse = {
  answer: string;
  sources: Array<{
    sourceKind: AssistantSourceKind;
    sourceId: string | null;
    title: string;
    excerpt: string;
    metadata?: Record<string, unknown>;
  }>;
  metadata: Record<string, unknown>;
};

type ResolvedAssistantRateLocation = {
  label: string | null;
  city: string;
  state: string;
  zipcode: string;
  country: LtlCountryCode;
  resolution: "POSTAL_CODE" | "CITY_LOOKUP";
};

const STATE_NAME_TO_ABBR: Record<string, string> = {
  alabama: "AL",
  alaska: "AK",
  arizona: "AZ",
  arkansas: "AR",
  california: "CA",
  colorado: "CO",
  connecticut: "CT",
  delaware: "DE",
  florida: "FL",
  georgia: "GA",
  illinois: "IL",
  indiana: "IN",
  iowa: "IA",
  kansas: "KS",
  kentucky: "KY",
  louisiana: "LA",
  maryland: "MD",
  massachusetts: "MA",
  michigan: "MI",
  minnesota: "MN",
  mississippi: "MS",
  missouri: "MO",
  nevada: "NV",
  "new jersey": "NJ",
  "new york": "NY",
  "north carolina": "NC",
  ohio: "OH",
  oklahoma: "OK",
  oregon: "OR",
  pennsylvania: "PA",
  tennessee: "TN",
  texas: "TX",
  utah: "UT",
  virginia: "VA",
  washington: "WA",
  wisconsin: "WI",
  ontario: "ON",
  quebec: "QC",
  alberta: "AB",
  "british columbia": "BC",
  manitoba: "MB"
};

const CITY_POSTAL_DEFAULTS: Array<{
  city: string;
  state: string;
  zipcode: string;
  country: LtlCountryCode;
  aliases?: string[];
}> = [
  { city: "Charlotte", state: "NC", zipcode: "28273", country: "US" },
  { city: "Dallas", state: "TX", zipcode: "75201", country: "US" },
  { city: "Houston", state: "TX", zipcode: "77001", country: "US" },
  { city: "Atlanta", state: "GA", zipcode: "30301", country: "US" },
  { city: "Chicago", state: "IL", zipcode: "60601", country: "US" },
  { city: "Los Angeles", state: "CA", zipcode: "90001", country: "US", aliases: ["LA"] },
  { city: "Beverly Hills", state: "CA", zipcode: "90210", country: "US" },
  { city: "New York", state: "NY", zipcode: "10001", country: "US", aliases: ["NYC"] },
  { city: "Miami", state: "FL", zipcode: "33101", country: "US" },
  { city: "Detroit", state: "MI", zipcode: "48201", country: "US" },
  { city: "Columbus", state: "OH", zipcode: "43215", country: "US" },
  { city: "Indianapolis", state: "IN", zipcode: "46204", country: "US" },
  { city: "Nashville", state: "TN", zipcode: "37201", country: "US" },
  { city: "Memphis", state: "TN", zipcode: "38103", country: "US" },
  { city: "Toronto", state: "ON", zipcode: "M5H 2N2", country: "CA" },
  { city: "Mississauga", state: "ON", zipcode: "L5B 3C1", country: "CA" },
  { city: "Brampton", state: "ON", zipcode: "L6T 4A8", country: "CA" },
  { city: "Montreal", state: "QC", zipcode: "H3B 1A7", country: "CA" },
  { city: "Vancouver", state: "BC", zipcode: "V6B 1A1", country: "CA" },
  { city: "Calgary", state: "AB", zipcode: "T2P 1J9", country: "CA" }
];

export async function maybeRunAssistantRateRequest(
  context: AuthenticatedContext,
  prompt: string
): Promise<AssistantRateResponse | null> {
  const parsed = parseAssistantRatePrompt(prompt);

  if (!parsed) {
    return null;
  }

  if (parsed.missingFields.length > 0 || !parsed.request) {
    return {
      answer: [
        "I can route this through 7L once the missing shipment details are provided.",
        `Parsed so far: ${parsed.summary}.`,
        `Still needed: ${parsed.missingFields.join(", ")}.`
      ].join("\n\n"),
      sources: [
        {
          sourceKind: AssistantSourceKind.RATE_TOOL,
          sourceId: null,
          title: "LTL rate intake",
          excerpt: parsed.summary,
          metadata: {
            missingFields: parsed.missingFields
          }
        }
      ],
      metadata: {
        rateRequestHandled: true,
        complete: false,
        missingFields: parsed.missingFields
      }
    };
  }

  try {
    await requireModule(context, ModuleKey.LTL_RATE_PORTAL);
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return {
        answer: "You do not currently have access to the LTL Rate Portal module for live 7L quoting.",
        sources: [],
        metadata: {
          rateRequestHandled: true,
          complete: true,
          quoteBlocked: "unauthorized"
        }
      };
    }

    throw error;
  }
  const shell = await getLtlRatePortalShell(context);
  const account = pickPreferredSevenLAccount(shell.accounts);

  if (!account) {
    return {
      answer: "7L is not configured for this tenant yet. Add an active 7L account before requesting live LTL rates.",
      sources: [],
      metadata: {
        rateRequestHandled: true,
        complete: true,
        quoteBlocked: "missing-account"
      }
    };
  }

  const carrierHashes = account.carriers.filter((carrier) => carrier.enabled).map((carrier) => carrier.carrierHash);
  if (carrierHashes.length === 0) {
    return {
      answer: `The 7L account ${account.name} has no enabled carriers selected for this tenant.`,
      sources: [],
      metadata: {
        rateRequestHandled: true,
        complete: true,
        quoteBlocked: "missing-carriers"
      }
    };
  }

  let response: Awaited<ReturnType<typeof getLtlQuotes>>;
  try {
    response = await getLtlQuotes(account, [parsed.request], carrierHashes);
  } catch (error) {
    return {
      answer: [
        `I could not complete the 7L quote for ${parsed.summary}.`,
        error instanceof Error ? error.message : "7L returned an unknown error.",
        "Check the 7L account credentials, origin/destination ZIP lookup, and enabled carrier setup before trying again."
      ].join("\n\n"),
      sources: [
        {
          sourceKind: AssistantSourceKind.RATE_TOOL,
          sourceId: account.id,
          title: `${account.name} 7L quote failure`,
          excerpt: error instanceof Error ? error.message : "Unknown 7L quote error.",
          metadata: {
            accountId: account.id,
            enabledCarrierCount: carrierHashes.length
          }
        }
      ],
      metadata: {
        rateRequestHandled: true,
        complete: true,
        quoted: false,
        quoteBlocked: "7l-error",
        accountId: account.id,
        enabledCarrierCount: carrierHashes.length
      }
    };
  }
  const sortedQuotes = [...response.data].sort((left, right) => left.total - right.total).slice(0, 3);

  if (sortedQuotes.length === 0) {
    const attemptedCarrierNames = account.carriers
      .filter((carrier) => carrierHashes.includes(carrier.carrierHash))
      .map((carrier) => carrier.name);
    const visibleErrors = response.errors.slice(0, 5);

    return {
      answer: [
        `7L returned no rate results for ${parsed.summary}.`,
        attemptedCarrierNames.length > 0
          ? `Enabled carrier(s) checked: ${attemptedCarrierNames.join(", ")}.`
          : "No enabled carriers were available to check.",
        visibleErrors.length > 0
          ? `Carrier response(s): ${visibleErrors.map((error) => `${error.carrierName}: ${error.errorMessage}`).join(" | ")}.`
          : "7L did not include carrier-level error details.",
        "Next checks: confirm more 7L carriers are enabled for this account, verify the lane is serviceable, and add an explicit freight class or pickup date if the customer provided one."
      ].join("\n\n"),
      sources: visibleErrors.map((error) => ({
        sourceKind: AssistantSourceKind.RATE_TOOL,
        sourceId: error.carrierHash,
        title: `${error.carrierName} rate error`,
        excerpt: error.errorMessage,
        metadata: {
          carrierCode: error.carrierCode
        }
      })),
      metadata: {
        rateRequestHandled: true,
        complete: true,
        quoted: false,
        accountId: account.id,
        enabledCarrierCount: carrierHashes.length,
        errorCount: response.errors.length
      }
    };
  }

  const cheapest = sortedQuotes[0];

  return {
    answer: [
      `7L returned ${response.data.length} quote(s) for ${parsed.summary}.`,
      `Lowest rate: ${cheapest.carrierName} at ${formatCurrency(cheapest.total)}${cheapest.transitDays ? `, ${cheapest.transitDays} transit day(s)` : ""}.`,
      ...sortedQuotes.map((quote, index) =>
        `${index + 1}. ${quote.carrierName} ${formatCurrency(quote.total)} | transit ${quote.transitDays} day(s) | quote ${quote.quoteNumber}`
      )
    ].join("\n"),
    sources: sortedQuotes.map((quote) => ({
      sourceKind: AssistantSourceKind.RATE_TOOL,
      sourceId: quote.quoteNumber,
      title: `${quote.carrierName} 7L quote`,
      excerpt: `${formatCurrency(quote.total)} | transit ${quote.transitDays} day(s) | ${quote.originZipcode} to ${quote.destinationZipcode}`,
      metadata: {
        quoteNumber: quote.quoteNumber,
        carrierCode: quote.carrierCode,
        total: quote.total
      }
    })),
    metadata: {
      rateRequestHandled: true,
      complete: true,
      quoted: true,
      accountId: account.id,
      carrierCount: response.data.length
    }
  };
}

export function parseAssistantRatePrompt(prompt: string): ParsedAssistantRateRequest | null {
  if (!/\b(rate|quote|ltl|7l|pallet|freight)\b/i.test(prompt)) {
    return null;
  }

  const dimensions = parseDimensions(prompt);
  const weight = parseWeight(prompt);
  const quantity = parseQuantity(prompt);
  const freightClass = parseFreightClass(prompt);
  const postalCodes = parsePostalCodes(prompt);
  const originLabel = parseLocationLabel(prompt, "from", ["to"]);
  const destinationLabel = parseLocationLabel(prompt, "to", [" at ", " weighing", " weight", " class ", " pallet", " skid", " piece"]);
  const originLocation = resolveAssistantRateLocation(originLabel, postalCodes[0] ?? null);
  const destinationLocation = resolveAssistantRateLocation(destinationLabel, postalCodes[1] ?? null);
  const pieces = dimensions && weight
    ? [buildFreightPiece({ dimensions, weight, quantity, freightClass })]
    : null;

  const missingFields = [
    originLocation ? null : "origin ZIP/postal code or city",
    destinationLocation ? null : "destination ZIP/postal code or city",
    dimensions ? null : "dimensions",
    weight ? null : "weight"
  ].filter((value): value is string => Boolean(value));

  const request =
    missingFields.length === 0 && pieces && originLocation && destinationLocation
      ? ({
          customerReference: "ASSIST",
          originCity: originLocation.city,
          originState: originLocation.state,
          originZipcode: originLocation.zipcode,
          originCountry: originLocation.country,
          destinationCity: destinationLocation.city,
          destinationState: destinationLocation.state,
          destinationZipcode: destinationLocation.zipcode,
          destinationCountry: destinationLocation.country,
          pickupDate: "Not scheduled",
          uom: "US",
          accessorialCodes: [],
          pieces
        } satisfies LtlQuoteRequest)
      : null;

  return {
    mode: "LTL",
    originLabel,
    destinationLabel,
    request,
    missingFields,
    summary: buildParsedSummary({
      originLabel,
      destinationLabel,
      originLocation,
      destinationLocation,
      dimensions,
      weight,
      quantity
    })
  };
}

function pickPreferredSevenLAccount(accounts: SevenLAccountConfig[]) {
  return (
    accounts.find((account) => !account.dryRun && account.secretConfigured && account.status === "ACTIVE") ??
    accounts.find((account) => !account.dryRun && account.status === "ACTIVE") ??
    accounts.find((account) => account.status === "ACTIVE") ??
    null
  );
}

function buildFreightPiece({
  dimensions,
  weight,
  quantity,
  freightClass
}: {
  dimensions: { length: number; width: number; height: number };
  weight: number;
  quantity: number;
  freightClass: string;
}): LtlFreightPiece {
  return {
    qty: quantity,
    weight,
    weightType: "each",
    length: dimensions.length,
    width: dimensions.width,
    height: dimensions.height,
    dimType: "PLT",
    freightClass,
    hazmat: false,
    stack: false
  };
}

function parseDimensions(prompt: string) {
  const match = prompt.match(/(\d{1,3}(?:\.\d+)?)\s*[xX]\s*(\d{1,3}(?:\.\d+)?)\s*[xX]\s*(\d{1,3}(?:\.\d+)?)/);
  if (!match) {
    return null;
  }

  return {
    length: Number.parseFloat(match[1]),
    width: Number.parseFloat(match[2]),
    height: Number.parseFloat(match[3])
  };
}

function parseWeight(prompt: string) {
  const match = prompt.match(/(\d{2,5}(?:\.\d+)?)\s*(?:lbs?|pounds?)/i);
  return match ? Number.parseFloat(match[1]) : null;
}

function parseQuantity(prompt: string) {
  const match = prompt.match(/(\d+)\s*(?:pallets?|skids?|pieces?)/i);
  return match ? Number.parseInt(match[1], 10) : 1;
}

function parseFreightClass(prompt: string) {
  const match = prompt.match(/\bclass\s+(\d{2,3}(?:\.\d+)?)\b/i);
  return match ? match[1] : "125";
}

function parsePostalCodes(prompt: string) {
  const matches = prompt.match(/\b(?:\d{5}(?:-\d{4})?|[A-Z]\d[A-Z][ -]?\d[A-Z]\d)\b/gi) ?? [];
  return matches.slice(0, 2).map((value) => value.toUpperCase());
}

function parseLocationLabel(prompt: string, keyword: string, stopTokens: string[]) {
  const lower = prompt.toLowerCase();
  const start = lower.indexOf(`${keyword} `);
  if (start === -1) {
    return null;
  }

  const fromStart = start + keyword.length + 1;
  const remainder = prompt.slice(fromStart);
  const lowerRemainder = remainder.toLowerCase();
  const stopIndexes = stopTokens
    .map((token) => lowerRemainder.indexOf(token))
    .filter((index) => index >= 0);
  const stop = stopIndexes.length > 0 ? Math.min(...stopIndexes) : remainder.length;
  const label = cleanupLocationLabel(remainder.slice(0, stop));

  return label.length > 0 ? label.replace(/[.,;:]$/g, "").trim() : null;
}

function cleanupLocationLabel(value: string) {
  return value
    .replace(/\b(?:\d{5}(?:-\d{4})?|[A-Z]\d[A-Z][ -]?\d[A-Z]\d)\b/gi, "")
    .replace(/\b\d{1,3}(?:\.\d+)?\s*[xX]\s*\d{1,3}(?:\.\d+)?\s*[xX]\s*\d{1,3}(?:\.\d+)?.*$/i, "")
    .replace(/\b(?:rate|quote|ltl|freight|pallets?|skids?|pieces?|lbs?|pounds?)\b.*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function resolveAssistantRateLocation(
  label: string | null,
  postalCode: string | null
): ResolvedAssistantRateLocation | null {
  const parsedLabel = parseCityStateLabel(label);

  if (postalCode) {
    return {
      label,
      city: parsedLabel?.city.toUpperCase() ?? "",
      state: parsedLabel?.state ?? "",
      zipcode: postalCode,
      country: inferCountry(postalCode),
      resolution: "POSTAL_CODE"
    };
  }

  if (!label) {
    return null;
  }

  const cityMatch = lookupCityPostalDefault(label);
  if (!cityMatch) {
    return null;
  }

  return {
    label,
    city: cityMatch.city.toUpperCase(),
    state: cityMatch.state,
    zipcode: cityMatch.zipcode,
    country: cityMatch.country,
    resolution: "CITY_LOOKUP"
  };
}

function lookupCityPostalDefault(label: string) {
  const parsed = parseCityStateLabel(label);
  if (!parsed) {
    return null;
  }

  const cityKey = normalizeLocationToken(parsed.city);
  const matches = CITY_POSTAL_DEFAULTS.filter((entry) => {
    const cityMatches =
      normalizeLocationToken(entry.city) === cityKey ||
      (entry.aliases ?? []).some((alias) => normalizeLocationToken(alias) === cityKey);
    const stateMatches = parsed.state ? entry.state === parsed.state : true;
    return cityMatches && stateMatches;
  });

  return matches[0] ?? null;
}

function parseCityStateLabel(label: string | null) {
  if (!label) {
    return null;
  }

  const normalized = label.replace(/[.,;:]+$/g, "").replace(/\s+/g, " ").trim();
  if (!normalized) {
    return null;
  }

  const commaParts = normalized.split(",").map((part) => part.trim()).filter(Boolean);
  if (commaParts.length >= 2) {
    const state = normalizeState(commaParts.at(-1) ?? "");
    return {
      city: commaParts.slice(0, -1).join(" "),
      state
    };
  }

  const parts = normalized.split(" ");
  for (let stateTokenLength = Math.min(2, parts.length - 1); stateTokenLength >= 1; stateTokenLength -= 1) {
    const stateCandidate = parts.slice(-stateTokenLength).join(" ");
    const state = normalizeState(stateCandidate);
    if (state) {
      return {
        city: parts.slice(0, -stateTokenLength).join(" "),
        state
      };
    }
  }

  return {
    city: normalized,
    state: null
  };
}

function normalizeState(value: string) {
  const cleaned = value.trim().toLowerCase().replace(/\./g, "");
  if (!cleaned) {
    return null;
  }

  if (/^[a-z]{2}$/i.test(cleaned)) {
    return cleaned.toUpperCase();
  }

  return STATE_NAME_TO_ABBR[cleaned] ?? null;
}

function normalizeLocationToken(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function inferCountry(postalCode: string) {
  return /[A-Z]\d[A-Z]/i.test(postalCode) ? "CA" : "US";
}

function buildParsedSummary({
  originLabel,
  destinationLabel,
  originLocation,
  destinationLocation,
  dimensions,
  weight,
  quantity
}: {
  originLabel: string | null;
  destinationLabel: string | null;
  originLocation: ResolvedAssistantRateLocation | null;
  destinationLocation: ResolvedAssistantRateLocation | null;
  dimensions: { length: number; width: number; height: number } | null;
  weight: number | null;
  quantity: number;
}) {
  const origin = formatResolvedLocationSummary(originLabel, originLocation) || "origin pending";
  const destination = formatResolvedLocationSummary(destinationLabel, destinationLocation) || "destination pending";
  const pieceSummary = dimensions
    ? `${quantity} pallet(s) ${dimensions.length}x${dimensions.width}x${dimensions.height}`
    : `${quantity} pallet(s)`;
  const weightSummary = weight ? `${weight} lbs each` : "weight pending";

  return `${origin} to ${destination}, ${pieceSummary}, ${weightSummary}`;
}

function formatResolvedLocationSummary(label: string | null, location: ResolvedAssistantRateLocation | null) {
  if (!location) {
    return label ?? "";
  }

  const cityState = [location.city || label, location.state].filter(Boolean).join(", ");
  return [cityState, location.zipcode].filter(Boolean).join(" ").trim();
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD"
  }).format(value);
}
