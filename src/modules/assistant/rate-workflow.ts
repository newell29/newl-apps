import { AssistantSourceKind, ModuleKey } from "@prisma/client";

import { getLtlRatePortalShell } from "@/modules/ltl-rate-portal/queries";
import type { LtlFreightPiece, LtlQuoteRequest, SevenLAccountConfig } from "@/modules/ltl-rate-portal/types";
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
  const pieces = dimensions && weight
    ? [buildFreightPiece({ dimensions, weight, quantity, freightClass })]
    : null;

  const missingFields = [
    postalCodes[0] ? null : "origin ZIP/postal code",
    postalCodes[1] ? null : "destination ZIP/postal code",
    dimensions ? null : "dimensions",
    weight ? null : "weight"
  ].filter((value): value is string => Boolean(value));

  const request =
    missingFields.length === 0 && pieces
      ? ({
          customerReference: "ASSIST",
          originCity: "",
          originState: "",
          originZipcode: postalCodes[0],
          originCountry: inferCountry(postalCodes[0]),
          destinationCity: "",
          destinationState: "",
          destinationZipcode: postalCodes[1],
          destinationCountry: inferCountry(postalCodes[1]),
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
      postalCodes,
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
  const label = remainder.slice(0, stop).replace(/\b(?:\d{5}(?:-\d{4})?|[A-Z]\d[A-Z][ -]?\d[A-Z]\d)\b/gi, "").trim();

  return label.length > 0 ? label.replace(/[.,;:]$/g, "").trim() : null;
}

function inferCountry(postalCode: string) {
  return /[A-Z]\d[A-Z]/i.test(postalCode) ? "CA" : "US";
}

function buildParsedSummary({
  originLabel,
  destinationLabel,
  postalCodes,
  dimensions,
  weight,
  quantity
}: {
  originLabel: string | null;
  destinationLabel: string | null;
  postalCodes: string[];
  dimensions: { length: number; width: number; height: number } | null;
  weight: number | null;
  quantity: number;
}) {
  const origin = [originLabel, postalCodes[0]].filter(Boolean).join(" ").trim() || "origin pending";
  const destination = [destinationLabel, postalCodes[1]].filter(Boolean).join(" ").trim() || "destination pending";
  const pieceSummary = dimensions
    ? `${quantity} pallet(s) ${dimensions.length}x${dimensions.width}x${dimensions.height}`
    : `${quantity} pallet(s)`;
  const weightSummary = weight ? `${weight} lbs each` : "weight pending";

  return `${origin} to ${destination}, ${pieceSummary}, ${weightSummary}`;
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD"
  }).format(value);
}
