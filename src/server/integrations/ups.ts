import { readFile } from "node:fs/promises";
import { Buffer } from "node:buffer";
import { getServiceCode, inferProvinceFromPostalCode, roundMoney } from "@/modules/ups-tools/engine";
import type { QuoteRequest, QuoteResult, UpsAccountConfig } from "@/modules/ups-tools/types";

const TOKEN_URL = "https://onlinetools.ups.com/security/v1/oauth/token";
const RATING_API_URL = "https://onlinetools.ups.com/api/rating/v1/Rate";

type LocalUpsCredential = {
  name: string;
  client_id: string;
  client_secret: string;
  shipper_number: string;
  country_code?: string;
};

type RuntimeUpsCredential = {
  clientId: string;
  clientSecret: string;
  shipperNumber: string;
  countryCode: "US" | "CA";
};

export type LocalUpsAccountMetadata = {
  name: string;
  shipperNumber: string;
  countryCode: "US" | "CA";
  originPostalCode: string;
  originLabel: string;
  originStateProvince: string;
};

let cachedAccountsFile: LocalUpsCredential[] | null = null;

export async function getLocalUpsAccountMetadata(): Promise<LocalUpsAccountMetadata[]> {
  const path = process.env.UPS_DEV_ACCOUNTS_FILE;
  if (!path) {
    return [];
  }

  const accountsFile = await loadLocalAccountsFile();
  return accountsFile.map((record) => {
    const countryCode = record.country_code === "CA" ? "CA" : "US";
    const origin = getDefaultOriginForCountry(countryCode);

    return {
      name: record.name,
      shipperNumber: record.shipper_number,
      countryCode,
      originPostalCode: origin.originPostalCode,
      originLabel: origin.originLabel,
      originStateProvince: origin.originStateProvince
    };
  });
}

export async function getUpsQuote(account: UpsAccountConfig, request: QuoteRequest): Promise<QuoteResult> {
  const credential = await resolveRuntimeCredential(account);
  if (!credential) {
    throw new Error(`No local UPS credentials were found for shipper number ${account.shipperNumber}.`);
  }

  const accessToken = await getAccessToken(credential.clientId, credential.clientSecret);
  const serviceCode = getServiceCode(request.service, request.destinationCountryCode);
  const billableWeight = calculateBillableWeight(request);
  const originStateProvince = resolveOriginStateProvince(account, request.originPostalCode);
  const payload = {
    RateRequest: {
      RequestOption: "Rate",
      Shipment: {
        Shipper: {
          ShipperNumber: credential.shipperNumber,
          Address: {
            PostalCode: request.originPostalCode,
            CountryCode: credential.countryCode,
            StateProvinceCode: originStateProvince
          }
        },
        ShipFrom: {
          Address: {
            PostalCode: request.originPostalCode,
            CountryCode: credential.countryCode,
            StateProvinceCode: originStateProvince
          }
        },
        ShipTo: {
          Address: {
            PostalCode: request.destinationPostalCode,
            CountryCode: request.destinationCountryCode,
            ...(request.isResidential ? { ResidentialAddressIndicator: "" } : {})
          }
        },
        Service: {
          Code: serviceCode
        },
        ShipmentRatingOptions: {
          NegotiatedRatesIndicator: ""
        },
        Package: {
          PackagingType: { Code: "02" },
          PackageWeight: {
            UnitOfMeasurement: { Code: "LBS" },
            Weight: String(roundMoney(billableWeight))
          },
          ...(request.length > 0 && request.width > 0 && request.height > 0
            ? {
                Dimensions: {
                  UnitOfMeasurement: { Code: "IN" },
                  Length: String(request.length),
                  Width: String(request.width),
                  Height: String(request.height)
                }
              }
            : {})
        },
        PaymentInformation: {
          ShipmentCharge: {
            Type: "01",
            BillShipper: {
              AccountNumber: credential.shipperNumber
            }
          }
        }
      }
    }
  };

  const response = await fetch(RATING_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`
    },
    body: JSON.stringify(payload),
    cache: "no-store"
  });

  const json = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(extractUpsError(json) ?? `UPS rating request failed with status ${response.status}.`);
  }

  const ratedShipment = Array.isArray(json?.RateResponse?.RatedShipment)
    ? json.RateResponse.RatedShipment[0]
    : json?.RateResponse?.RatedShipment;

  if (!ratedShipment) {
    throw new Error("UPS rating response did not include a rated shipment.");
  }

  const standardRate = Number.parseFloat(ratedShipment?.TotalCharges?.MonetaryValue ?? "0");
  const negotiatedRate = Number.parseFloat(
    ratedShipment?.NegotiatedRateCharges?.TotalCharge?.MonetaryValue ??
      ratedShipment?.TotalCharges?.MonetaryValue ??
      "0"
  );
  const destinationProvince = inferProvinceFromPostalCode(request.destinationPostalCode);
  const taxRate = getTaxRate(destinationProvince);
  const taxAmount = roundMoney(negotiatedRate * taxRate);
  const totalWithTax = roundMoney(negotiatedRate + taxAmount);
  const transitDays = parseTransitDays(ratedShipment);

  return {
    ...request,
    dims: `${request.length}x${request.width}x${request.height}`,
    billableWeight: roundMoney(billableWeight),
    standardRate: roundMoney(standardRate),
    negotiatedRate: roundMoney(negotiatedRate),
    taxAmount,
    totalWithTax,
    transitDays,
    destinationProvince,
    accountId: account.id,
    accountName: account.name,
    accountShipperNumber: account.shipperNumber,
    mode: "live"
  };
}

function resolveOriginStateProvince(account: UpsAccountConfig, originPostalCode: string) {
  if (account.originStateProvince) {
    return account.originStateProvince;
  }

  const trimmed = originPostalCode.trim().toUpperCase();
  if (account.countryCode === "US") {
    if (trimmed === "28273") return "NC";
  }

  if (account.countryCode === "CA") {
    const province = inferProvinceFromPostalCode(trimmed);
    if (province) {
      return province;
    }
  }

  return "";
}

async function resolveRuntimeCredential(account: UpsAccountConfig): Promise<RuntimeUpsCredential | null> {
  const accountsFile = await loadLocalAccountsFile();
  const match = accountsFile.find((record) => record.shipper_number === account.shipperNumber);
  if (!match) {
    return null;
  }

  return {
    clientId: match.client_id,
    clientSecret: match.client_secret,
    shipperNumber: match.shipper_number,
    countryCode: match.country_code === "CA" ? "CA" : "US"
  };
}

function getDefaultOriginForCountry(countryCode: "US" | "CA") {
  if (countryCode === "CA") {
    return {
      originPostalCode: "L5T1Z3",
      originLabel: "Mississauga, ON",
      originStateProvince: "ON"
    };
  }

  return {
    originPostalCode: "28273",
    originLabel: "Charlotte, NC",
    originStateProvince: "NC"
  };
}

async function loadLocalAccountsFile() {
  if (cachedAccountsFile) {
    return cachedAccountsFile;
  }

  const path = process.env.UPS_DEV_ACCOUNTS_FILE;
  if (!path) {
    throw new Error("UPS_DEV_ACCOUNTS_FILE is not configured in the local environment.");
  }

  const file = await readFile(path, "utf8");
  const parsed = JSON.parse(file) as LocalUpsCredential[];
  cachedAccountsFile = parsed;
  return parsed;
}

async function getAccessToken(clientId: string, clientSecret: string) {
  const authHeader = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${authHeader}`
    },
    body: new URLSearchParams({
      grant_type: "client_credentials"
    }),
    cache: "no-store"
  });

  const json = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(extractUpsError(json) ?? `UPS token request failed with status ${response.status}.`);
  }

  const accessToken = json?.access_token;
  if (!accessToken || typeof accessToken !== "string") {
    throw new Error("UPS token response did not include an access token.");
  }

  return accessToken;
}

function calculateBillableWeight(request: QuoteRequest) {
  const dimensionalWeight =
    request.length > 0 && request.width > 0 && request.height > 0
      ? (request.length * request.width * request.height) / 139
      : 0;

  return Math.max(request.weight, dimensionalWeight);
}

function parseTransitDays(ratedShipment: Record<string, unknown>) {
  const guaranteed = ratedShipment?.GuaranteedDelivery as { BusinessDaysInTransit?: string } | undefined;
  const businessDays = guaranteed?.BusinessDaysInTransit;
  const parsed = Number.parseInt(businessDays ?? "", 10);
  if (Number.isFinite(parsed)) {
    return parsed;
  }

  return 0;
}

function extractUpsError(json: unknown): string | null {
  const description =
    (json as { response?: { errors?: Array<{ message?: string }> } })?.response?.errors?.[0]?.message ??
    (json as { response?: { errors?: Array<{ code?: string; message?: string }> } })?.response?.errors?.[0]?.code;

  return typeof description === "string" ? description : null;
}

function getTaxRate(province: string) {
  if (province === "ON") return 0.13;
  if (province === "NB" || province === "NL" || province === "PE") return 0.15;
  if (province === "NS") return 0.14;
  if (province === "BC" || province === "MB" || province === "QC" || province === "SK" || province === "AB") {
    return 0.05;
  }

  return 0;
}
