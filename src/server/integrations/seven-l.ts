import { readFile } from "node:fs/promises";
import { Buffer } from "node:buffer";
import { estimateLtlQuotes, serializeFreightInfo } from "@/modules/ltl-rate-portal/engine";
import type {
  LtlCarrierErrorResult,
  LtlCountryCode,
  LtlQuoteRequest,
  LtlQuoteResult,
  SevenLAccountConfig
} from "@/modules/ltl-rate-portal/types";

const DEFAULT_BASE_URL = "https://restapi.my7l.com";

type LocalSevenLCredential = {
  name: string;
  username: string;
  password: string;
  baseUrl?: string;
};

type RuntimeSevenLCredential = {
  username: string;
  password: string;
  baseUrl: string;
};

type SevenLLoginResponse = {
  data?: {
    accessToken?: string;
    exp?: number;
    message?: string;
  };
};

type SevenLZipLookupResponse = {
  data?: {
    results?: Array<{
      City?: string;
      StateAbbr?: string;
      Country?: string;
      Zipcode?: string;
    }>;
    message?: string;
  };
};

type SevenLRateResponse = {
  data?: {
    results?: Array<{
      InternalRef?: string | number;
      Name?: string;
      Code?: string;
      SCAC?: string;
      Error?: string;
      ServiceLevel?: string;
      TransitDays?: string | number;
      QuoteNumber?: string;
      RateBreakdown?: Array<Record<string, string | number>> | Record<string, string | number>;
      RateRemarks?: string[];
      Total?: string;
    }>;
    message?: string;
  };
};

type SevenLCarrierLookupResponse = {
  data?: {
    results?:
      | Array<{
          Name?: string;
          Code?: string;
          CarrierHash?: string;
          SCAC?: string;
          Defaulted?: boolean;
        }>
      | {
          Name?: string;
          Code?: string;
          CarrierHash?: string;
          SCAC?: string;
          Defaulted?: boolean;
        };
    message?: string;
  };
};

type ResolvedLocation = {
  city: string;
  state: string;
  country: LtlCountryCode;
  zipcode: string;
};

type TokenCacheEntry = {
  accessToken: string;
  exp: number;
};

let cachedAccountsFile: LocalSevenLCredential[] | null = null;
const tokenCache = new Map<string, TokenCacheEntry>();

export async function getLocalSevenLAccountNames(): Promise<Set<string>> {
  const path = process.env.SEVEN_L_DEV_ACCOUNTS_FILE;
  if (!path) {
    return new Set();
  }

  const accounts = await loadLocalAccountsFile();
  return new Set(accounts.map((account) => account.name));
}

export async function getLtlQuotes(
  account: SevenLAccountConfig,
  requests: LtlQuoteRequest[],
  carrierHashes?: string[]
): Promise<{ data: LtlQuoteResult[]; errors: LtlCarrierErrorResult[] }> {
  if (requests.length === 0) {
    return { data: [], errors: [] };
  }

  const selectedCarriers =
    carrierHashes && carrierHashes.length > 0
      ? account.carriers.filter((candidate) => carrierHashes.includes(candidate.carrierHash))
      : account.carriers.filter((candidate) => candidate.enabled);

  const credential = await resolveRuntimeCredential(account);
  if (!credential) {
    if (!account.dryRun) {
      throw new Error(
        `Live 7L credentials are not available for account ${account.name}. Reconnect the local 7L runtime before requesting live rates.`
      );
    }

    return {
      data: requests.flatMap((request) =>
        estimateLtlQuotes(
          {
            ...account,
            carriers: selectedCarriers
          },
          request
        )
      ),
      errors: []
    };
  }

  const accessToken = await getAccessToken(credential);
  const locationCache = new Map<string, ResolvedLocation>();
  const results: LtlQuoteResult[] = [];
  const errors: LtlCarrierErrorResult[] = [];

  for (const request of requests) {
    const resolvedRequest = await enrichRequestWithLocations(credential.baseUrl, accessToken, request, locationCache);
    for (const carrier of selectedCarriers) {
      try {
        results.push(await getCarrierQuote(account, credential.baseUrl, accessToken, carrier, resolvedRequest));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn("7L carrier quote skipped", {
          carrierHash: carrier.carrierHash,
          carrierName: carrier.name,
          customerReference: request.customerReference,
          message
        });

        errors.push({
          ...resolvedRequest,
          carrierHash: carrier.carrierHash,
          carrierName: carrier.name,
          carrierCode: carrier.code,
          scac: carrier.scac,
          errorMessage: message,
          mode: "live"
        });
      }
    }
  }

  if (results.length === 0 && errors.length > 0) {
    return { data: [], errors };
  }

  return { data: results, errors };
}

export async function fetchSevenLAvailableCarriers(account: SevenLAccountConfig) {
  const credential = await resolveRuntimeCredential(account);
  if (!credential) {
    throw new Error(`No local 7L runtime credentials were found for account ${account.name}.`);
  }

  const accessToken = await getAccessToken(credential);
  const params = new URLSearchParams();
  params.append("carrierType[]", "LTL");

  const response = await fetch(`${credential.baseUrl}/api/v1/database/ltlaccount?${params.toString()}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`
    },
    cache: "no-store"
  });

  const json = (await response.json().catch(() => null)) as SevenLCarrierLookupResponse | null;
  if (!response.ok) {
    throw new Error(extractSevenLError(json) ?? `7L carrier lookup failed with status ${response.status}.`);
  }

  const rawResults = json?.data?.results;
  const carriers = Array.isArray(rawResults) ? rawResults : rawResults ? [rawResults] : [];

  return carriers
    .map((carrier) => {
      const carrierHash = carrier.CarrierHash?.trim();
      const name = carrier.Name?.trim();
      const code = carrier.Code?.trim();
      const scac = carrier.SCAC?.trim();

      if (!carrierHash || !name || !code || !scac) {
        return null;
      }

      return {
        carrierHash,
        name,
        code,
        scac,
        defaulted: carrier.Defaulted === true,
        enabled: true
      };
    })
    .filter((carrier): carrier is SevenLAccountConfig["carriers"][number] => carrier !== null)
    .sort((left, right) => left.name.localeCompare(right.name));
}

async function getCarrierQuote(
  account: SevenLAccountConfig,
  baseUrl: string,
  accessToken: string,
  carrier: SevenLAccountConfig["carriers"][number],
  request: LtlQuoteRequest
): Promise<LtlQuoteResult> {
  const params = new URLSearchParams({
    carrierHash: carrier.carrierHash,
    originCity: request.originCity,
    originState: request.originState,
    originZipcode: request.originZipcode,
    originCountry: request.originCountry,
    destinationCity: request.destinationCity,
    destinationState: request.destinationState,
    destinationZipcode: request.destinationZipcode,
    destinationCountry: request.destinationCountry,
    freightInfo: serializeFreightInfo(request.pieces),
    UOM: request.uom,
    strictResult: String(account.strictResult),
    harmonizedCharges: String(account.harmonizedCharges)
  });

  if (request.pickupDate !== "Not scheduled") {
    params.set("pickupDate", request.pickupDate);
  }

  for (const accessorialCode of request.accessorialCodes) {
    params.append("accessorialsList[]", accessorialCode);
  }

  const response = await fetch(`${baseUrl}/api/v1/ltl/ltlrates?${params.toString()}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`
    },
    cache: "no-store"
  });

  const json = (await response.json().catch(() => null)) as SevenLRateResponse | null;
  if (!response.ok) {
    throw new Error(extractSevenLError(json) ?? `7L rate request failed with status ${response.status}.`);
  }

  const ratedResult = json?.data?.results?.[0];
  if (!ratedResult) {
    throw new Error(`7L returned no rate results for carrier ${carrier.name}.`);
  }

  if (ratedResult.Error) {
    throw new Error(ratedResult.Error);
  }

  const total = parseMoney(ratedResult.Total);
  const breakdown = flattenBreakdown(ratedResult.RateBreakdown);
  const linehaulCharge = pickCharge(breakdown, ["LINEHAUL", "MINIMUM", "DEFICIT", "RATE"]);
  const fuelCharge = pickCharge(breakdown, ["FUEL"]);
  const accessorialCharge = roundCurrency(Math.max(0, total - linehaulCharge - fuelCharge));

  return {
    ...request,
    carrierHash: carrier.carrierHash,
    carrierName: ratedResult.Name || carrier.name,
    carrierCode: ratedResult.Code || carrier.code,
    scac: ratedResult.SCAC || carrier.scac,
    serviceLevel: ratedResult.ServiceLevel || "Less than Truckload",
    transitDays: normalizeTransitDays(ratedResult.TransitDays),
    quoteNumber: ratedResult.QuoteNumber || String(ratedResult.InternalRef ?? ""),
    total,
    fuelCharge,
    accessorialCharge,
    linehaulCharge,
    rateRemarks: ratedResult.RateRemarks ?? [],
    mode: "live"
  };
}

async function enrichRequestWithLocations(
  baseUrl: string,
  accessToken: string,
  request: LtlQuoteRequest,
  locationCache: Map<string, ResolvedLocation>
): Promise<LtlQuoteRequest> {
  const origin =
    request.originCity && request.originState
      ? {
          city: request.originCity,
          state: request.originState,
          country: request.originCountry,
          zipcode: request.originZipcode
        }
      : await resolveZipLocation(
          baseUrl,
          accessToken,
          request.originZipcode,
          request.originCountry,
          locationCache
        );

  const destination =
    request.destinationCity && request.destinationState
      ? {
          city: request.destinationCity,
          state: request.destinationState,
          country: request.destinationCountry,
          zipcode: request.destinationZipcode
        }
      : await resolveZipLocation(
          baseUrl,
          accessToken,
          request.destinationZipcode,
          request.destinationCountry,
          locationCache
        );

  return {
    ...request,
    originCity: origin.city,
    originState: origin.state,
    originCountry: origin.country,
    destinationCity: destination.city,
    destinationState: destination.state,
    destinationCountry: destination.country
  };
}

async function resolveZipLocation(
  baseUrl: string,
  accessToken: string,
  zipcode: string,
  country: LtlCountryCode,
  locationCache: Map<string, ResolvedLocation>
) {
  const cacheKey = `${country}:${zipcode.trim().toUpperCase()}`;
  const cached = locationCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const params = new URLSearchParams({
    zipcode: zipcode.trim(),
    zipcodeSearchType: "exact",
    country
  });
  const response = await fetch(`${baseUrl}/api/v1/tools/zipcodes?${params.toString()}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`
    },
    cache: "no-store"
  });

  const json = (await response.json().catch(() => null)) as SevenLZipLookupResponse | null;
  if (!response.ok) {
    throw new Error(extractSevenLError(json) ?? `7L zipcode lookup failed with status ${response.status}.`);
  }

  const match = json?.data?.results?.find((result) => normalizeCountry(result.Country) === country);
  if (!match?.City || !match.StateAbbr) {
    throw new Error(`7L zipcode lookup did not return city/state for ${zipcode}.`);
  }

  const resolved = {
    city: match.City.trim().toUpperCase(),
    state: match.StateAbbr.trim().toUpperCase(),
    country,
    zipcode: match.Zipcode?.trim() || zipcode.trim()
  } satisfies ResolvedLocation;
  locationCache.set(cacheKey, resolved);
  return resolved;
}

async function resolveRuntimeCredential(account: SevenLAccountConfig): Promise<RuntimeSevenLCredential | null> {
  const accounts = await loadLocalAccountsFile().catch(() => null);
  if (!accounts) {
    return null;
  }

  const match = accounts.find((candidate) => candidate.name === account.name);
  if (!match) {
    return null;
  }

  return {
    username: match.username,
    password: match.password,
    baseUrl: match.baseUrl?.trim() || account.baseUrl || DEFAULT_BASE_URL
  };
}

async function loadLocalAccountsFile() {
  if (cachedAccountsFile) {
    return cachedAccountsFile;
  }

  const path = process.env.SEVEN_L_DEV_ACCOUNTS_FILE;
  if (!path) {
    throw new Error("SEVEN_L_DEV_ACCOUNTS_FILE is not configured in the local environment.");
  }

  const file = await readFile(path, "utf8");
  const parsed = JSON.parse(file) as LocalSevenLCredential[];
  cachedAccountsFile = parsed;
  return parsed;
}

async function getAccessToken(credential: RuntimeSevenLCredential) {
  const cacheKey = `${credential.baseUrl}:${credential.username}`;
  const cached = tokenCache.get(cacheKey);
  const now = Math.floor(Date.now() / 1000);
  if (cached && cached.exp > now + 30) {
    return cached.accessToken;
  }

  const response = await fetch(`${credential.baseUrl}/api/v1/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${Buffer.from(`${credential.username}:${credential.password}`).toString("base64")}`
    },
    body: JSON.stringify({
      username: credential.username,
      password: credential.password
    }),
    cache: "no-store"
  });

  const json = (await response.json().catch(() => null)) as SevenLLoginResponse | null;
  if (!response.ok) {
    throw new Error(extractSevenLError(json) ?? `7L login failed with status ${response.status}.`);
  }

  const accessToken = json?.data?.accessToken;
  if (!accessToken) {
    throw new Error("7L login response did not include an access token.");
  }

  tokenCache.set(cacheKey, {
    accessToken,
    exp: typeof json?.data?.exp === "number" ? json.data.exp : now + 300
  });

  return accessToken;
}

function flattenBreakdown(items: unknown) {
  const normalizedItems = Array.isArray(items)
    ? items
    : items && typeof items === "object"
      ? [items as Record<string, string | number>]
      : [];

  return normalizedItems.reduce<Record<string, number>>((accumulator, item) => {
    for (const [key, value] of Object.entries(item)) {
      const normalizedValue =
        typeof value === "number" ? String(value) : typeof value === "string" ? value : undefined;
      accumulator[key] = parseMoney(normalizedValue);
    }
    return accumulator;
  }, {});
}

function pickCharge(charges: Record<string, number>, fragments: string[]) {
  const value = Object.entries(charges)
    .filter(([key]) => fragments.some((fragment) => key.toUpperCase().includes(fragment)))
    .reduce((sum, [, amount]) => sum + amount, 0);
  return roundCurrency(value);
}

function normalizeTransitDays(value: string | number | undefined) {
  const parsed =
    typeof value === "number" ? value : typeof value === "string" ? Number.parseFloat(value) : Number.NaN;
  return Number.isFinite(parsed) ? Math.max(1, Math.round(parsed)) : 0;
}

function parseMoney(value: string | undefined) {
  const parsed = Number.parseFloat(value ?? "0");
  return roundCurrency(Number.isFinite(parsed) ? parsed : 0);
}

function roundCurrency(value: number) {
  return Math.round(value * 100) / 100;
}

function extractSevenLError(payload: unknown) {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const maybeMessage =
    (payload as { data?: { message?: unknown } }).data?.message ??
    (payload as { message?: unknown }).message;

  return typeof maybeMessage === "string" && maybeMessage.trim().length > 0 ? maybeMessage : null;
}

function normalizeCountry(value: string | undefined) {
  return value === "CA" || value === "MX" ? value : "US";
}
