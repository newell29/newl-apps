import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from "crypto";
import { IntegrationProvider, IntegrationStatus } from "@prisma/client";

const QUICKBOOKS_STATE_VERSION = "v1";
const QUICKBOOKS_SECRET_PREFIX = "enc:v1";
const QUICKBOOKS_ACCOUNTING_SCOPE = "com.intuit.quickbooks.accounting";

/**
 * Approved production redirect URL for the single QuickBooks OAuth app shared
 * by all three operating companies (owner decision CP-02B-1-Q2, SAME_APP).
 */
export const QUICKBOOKS_APPROVED_REDIRECT_URI =
  "https://newl-apps.vercel.app/api/integrations/quickbooks/callback";

/**
 * Legacy legal-entity keys retained in the stored credential publicConfig so
 * the existing Newl Worldwide and Newl USA connections keep working. The
 * connect API and OAuth state are keyed by operating-company slug instead
 * (owner decision CP-02B-1-Q1, OPERATING_COMPANY_KEYED); these enum keys only
 * bridge to the legacy storage representation.
 */
export type QuickBooksLegalEntity = "NEWL_WORLDWIDE" | "NEWL_USA" | "NEWELLS_EXPRESS";

export const QUICKBOOKS_OPERATING_COMPANY_SLUGS = [
  "newl-worldwide",
  "newl-usa",
  "newells-express"
] as const;

export type QuickBooksOperatingCompanySlug = (typeof QUICKBOOKS_OPERATING_COMPANY_SLUGS)[number];

export const QUICKBOOKS_LEGAL_ENTITY_TO_SLUG: Record<
  QuickBooksLegalEntity,
  QuickBooksOperatingCompanySlug
> = {
  NEWL_WORLDWIDE: "newl-worldwide",
  NEWL_USA: "newl-usa",
  NEWELLS_EXPRESS: "newells-express"
};

export const QUICKBOOKS_SLUG_TO_LEGAL_ENTITY: Record<
  QuickBooksOperatingCompanySlug,
  QuickBooksLegalEntity
> = {
  "newl-worldwide": "NEWL_WORLDWIDE",
  "newl-usa": "NEWL_USA",
  "newells-express": "NEWELLS_EXPRESS"
};

export const QUICKBOOKS_LEGAL_ENTITY_DISPLAY_NAMES: Record<QuickBooksLegalEntity, string> = {
  NEWL_WORLDWIDE: "Newl Worldwide",
  NEWL_USA: "Newl USA",
  NEWELLS_EXPRESS: "Newell's Express and Warehousing Ltd."
};

export type QuickBooksEnvironment = "sandbox" | "production";

type QuickBooksStatePayload = {
  tenantId: string;
  operatingCompanySlug: QuickBooksOperatingCompanySlug;
  returnTo: string;
  nonce: string;
};

export type QuickBooksConnectionMetadata = {
  legalEntity: QuickBooksLegalEntity;
  realmId: string;
  environment: QuickBooksEnvironment;
  companyName: string | null;
  accessTokenExpiresAt: string | null;
  refreshTokenExpiresAt: string | null;
  connectedAt: string;
  scopes: string[];
};

type QuickBooksTokenResponse = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  x_refresh_token_expires_in: number;
  token_type: string;
  realmId?: string;
};

export type QuickBooksRefreshTokenResponse = {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: string;
  refreshTokenExpiresAt: string;
  tokenType: string;
};

export function getQuickBooksEnvironment(): QuickBooksEnvironment {
  return process.env.QUICKBOOKS_ENVIRONMENT === "sandbox" ? "sandbox" : "production";
}

export function getQuickBooksApiBaseUrl() {
  return getQuickBooksEnvironment() === "sandbox"
    ? "https://sandbox-quickbooks.api.intuit.com"
    : "https://quickbooks.api.intuit.com";
}

export function getQuickBooksRedirectUri() {
  // One shared OAuth app for every operating company (CP-02B-1-Q2). The env
  // override supports preview/sandbox runs; the approved production URL is the
  // default so an unset value can never break the OAuth decision.
  const value = process.env.QUICKBOOKS_REDIRECT_URI?.trim();
  return value || QUICKBOOKS_APPROVED_REDIRECT_URI;
}

function getQuickBooksClientId() {
  const value = process.env.QUICKBOOKS_CLIENT_ID?.trim();
  if (!value || value === "QUICKBOOKS_CLIENT_ID_PLACEHOLDER") {
    throw new Error("QUICKBOOKS_CLIENT_ID is not configured.");
  }

  return value;
}

function getQuickBooksClientSecret() {
  const value = process.env.QUICKBOOKS_CLIENT_SECRET?.trim();
  if (!value || value === "QUICKBOOKS_CLIENT_SECRET_PLACEHOLDER") {
    throw new Error("QUICKBOOKS_CLIENT_SECRET is not configured.");
  }

  return value;
}

function getQuickBooksEncryptionSecret() {
  const value = process.env.AUTH_SECRET?.trim();
  if (!value) {
    throw new Error("AUTH_SECRET is required to encrypt QuickBooks OAuth secrets.");
  }

  return value;
}

function getQuickBooksStateSecret() {
  return process.env.QUICKBOOKS_STATE_SECRET?.trim() || getQuickBooksEncryptionSecret();
}

export function getQuickBooksConnectionName(legalEntity: QuickBooksLegalEntity) {
  // Keeps the exact legacy names ("QuickBooks - Newl USA", "QuickBooks - Newl
  // Worldwide") while adding the third operating company.
  return `QuickBooks - ${QUICKBOOKS_LEGAL_ENTITY_DISPLAY_NAMES[legalEntity]}`;
}

export function isQuickBooksOperatingCompanySlug(value: string): value is QuickBooksOperatingCompanySlug {
  return value in QUICKBOOKS_SLUG_TO_LEGAL_ENTITY;
}

/** Stable operating-company slug for a legacy stored legal-entity key. */
export function quickBooksLegalEntityToSlug(
  legalEntity: string
): QuickBooksOperatingCompanySlug | null {
  return QUICKBOOKS_LEGAL_ENTITY_TO_SLUG[legalEntity as QuickBooksLegalEntity] ?? null;
}

/** Legacy stored legal-entity key for a stable operating-company slug. */
export function quickBooksSlugToLegalEntity(
  slug: string
): QuickBooksLegalEntity | null {
  return isQuickBooksOperatingCompanySlug(slug) ? QUICKBOOKS_SLUG_TO_LEGAL_ENTITY[slug] : null;
}

export function buildQuickBooksAuthorizationUrl({
  tenantId,
  operatingCompanySlug,
  returnTo
}: {
  tenantId: string;
  operatingCompanySlug: QuickBooksOperatingCompanySlug;
  returnTo: string;
}) {
  const state = signQuickBooksState({
    tenantId,
    operatingCompanySlug,
    returnTo,
    nonce: randomBytes(12).toString("hex")
  });
  const url = new URL("https://appcenter.intuit.com/connect/oauth2");

  url.searchParams.set("client_id", getQuickBooksClientId());
  url.searchParams.set("scope", QUICKBOOKS_ACCOUNTING_SCOPE);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", getQuickBooksRedirectUri());
  url.searchParams.set("state", state);

  return url.toString();
}

export async function exchangeQuickBooksAuthorizationCode({
  code,
  realmId
}: {
  code: string;
  realmId: string;
}) {
  const credentials = Buffer.from(`${getQuickBooksClientId()}:${getQuickBooksClientSecret()}`).toString("base64");
  const response = await fetch("https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer", {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json"
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: getQuickBooksRedirectUri()
    })
  });

  if (!response.ok) {
    const message = await readQuickBooksError(response);
    throw new Error(message ?? `QuickBooks token exchange failed with status ${response.status}.`);
  }

  const json = (await response.json()) as QuickBooksTokenResponse;
  return {
    realmId,
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    accessTokenExpiresAt: new Date(Date.now() + json.expires_in * 1000).toISOString(),
    refreshTokenExpiresAt: new Date(Date.now() + json.x_refresh_token_expires_in * 1000).toISOString(),
    tokenType: json.token_type
  };
}

export async function refreshQuickBooksAccessToken({ refreshToken }: { refreshToken: string }): Promise<QuickBooksRefreshTokenResponse> {
  const credentials = Buffer.from(`${getQuickBooksClientId()}:${getQuickBooksClientSecret()}`).toString("base64");
  const response = await fetch("https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer", {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json"
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken
    })
  });

  if (!response.ok) {
    const message = await readQuickBooksError(response);
    throw new Error(message ?? `QuickBooks token refresh failed with status ${response.status}.`);
  }

  const json = (await response.json()) as QuickBooksTokenResponse;
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    accessTokenExpiresAt: new Date(Date.now() + json.expires_in * 1000).toISOString(),
    refreshTokenExpiresAt: new Date(Date.now() + json.x_refresh_token_expires_in * 1000).toISOString(),
    tokenType: json.token_type
  };
}

export async function fetchQuickBooksCompanyInfo({
  realmId,
  accessToken
}: {
  realmId: string;
  accessToken: string;
}) {
  const baseUrl = getQuickBooksApiBaseUrl();
  const response = await fetch(`${baseUrl}/v3/company/${realmId}/companyinfo/${realmId}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json"
    }
  });

  if (!response.ok) {
    const message = await readQuickBooksError(response);
    throw new Error(message ?? `QuickBooks company info request failed with status ${response.status}.`);
  }

  const json = (await response.json()) as {
    CompanyInfo?: {
      CompanyName?: string;
      LegalName?: string;
    };
  };

  return {
    companyName: json.CompanyInfo?.CompanyName ?? json.CompanyInfo?.LegalName ?? null
  };
}

export function buildQuickBooksCredentialRecord({
  legalEntity,
  realmId,
  companyName,
  environment,
  accessTokenExpiresAt,
  refreshTokenExpiresAt,
  connectedAt,
  scopes
}: QuickBooksConnectionMetadata) {
  return {
    provider: IntegrationProvider.QUICKBOOKS,
    name: getQuickBooksConnectionName(legalEntity),
    status: IntegrationStatus.ACTIVE,
    publicConfig: {
      legalEntity,
      realmId,
      environment,
      companyName,
      accessTokenExpiresAt,
      refreshTokenExpiresAt,
      connectedAt,
      scopes
    }
  };
}

export function encryptQuickBooksSecret(payload: Record<string, string>) {
  const key = createHash("sha256").update(getQuickBooksEncryptionSecret()).digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `${QUICKBOOKS_SECRET_PREFIX}:${iv.toString("base64url")}:${tag.toString("base64url")}:${encrypted.toString("base64url")}`;
}

export function decryptQuickBooksSecret(secretRef: string) {
  const parts = secretRef.split(":");
  if (parts.length !== 5) {
    throw new Error("QuickBooks secretRef is not in the expected encrypted format.");
  }
  const [prefixA, prefixB, ivValue, tagValue, encryptedValue] = parts;
  if (`${prefixA}:${prefixB}` !== QUICKBOOKS_SECRET_PREFIX) {
    throw new Error("QuickBooks secretRef is not in the expected encrypted format.");
  }

  const key = createHash("sha256").update(getQuickBooksEncryptionSecret()).digest();
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivValue, "base64url"));
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedValue, "base64url")),
    decipher.final()
  ]);

  return JSON.parse(decrypted.toString("utf8")) as Record<string, string>;
}

export function parseQuickBooksState(state: string): QuickBooksStatePayload {
  const [version, encoded, signature] = state.split(".");
  if (version !== QUICKBOOKS_STATE_VERSION || !encoded || !signature) {
    throw new Error("QuickBooks OAuth state is invalid.");
  }

  const expectedSignature = createHmac("sha256", getQuickBooksStateSecret()).update(encoded).digest("base64url");
  if (signature !== expectedSignature) {
    throw new Error("QuickBooks OAuth state signature is invalid.");
  }

  return JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as QuickBooksStatePayload;
}

function signQuickBooksState(payload: QuickBooksStatePayload) {
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = createHmac("sha256", getQuickBooksStateSecret()).update(encoded).digest("base64url");
  return `${QUICKBOOKS_STATE_VERSION}.${encoded}.${signature}`;
}

async function readQuickBooksError(response: Response) {
  try {
    const text = await response.text();
    return text.slice(0, 500);
  } catch {
    return null;
  }
}
