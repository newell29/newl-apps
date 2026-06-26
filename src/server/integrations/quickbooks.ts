import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from "crypto";
import { IntegrationProvider, IntegrationStatus } from "@prisma/client";

const QUICKBOOKS_STATE_VERSION = "v1";
const QUICKBOOKS_SECRET_PREFIX = "enc:v1";
const QUICKBOOKS_ACCOUNTING_SCOPE = "com.intuit.quickbooks.accounting";

export type QuickBooksLegalEntity = "NEWL_WORLDWIDE" | "NEWL_USA";
export type QuickBooksEnvironment = "sandbox" | "production";

type QuickBooksStatePayload = {
  tenantId: string;
  legalEntity: QuickBooksLegalEntity;
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

export function getQuickBooksEnvironment(): QuickBooksEnvironment {
  return process.env.QUICKBOOKS_ENVIRONMENT === "sandbox" ? "sandbox" : "production";
}

export function getQuickBooksRedirectUri() {
  const value = process.env.QUICKBOOKS_REDIRECT_URI?.trim();
  if (!value) {
    throw new Error("QUICKBOOKS_REDIRECT_URI is not configured.");
  }

  return value;
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

export function getQuickBooksConnectionName(legalEntity: QuickBooksLegalEntity) {
  return legalEntity === "NEWL_USA" ? "QuickBooks - Newl USA" : "QuickBooks - Newl Worldwide";
}

export function buildQuickBooksAuthorizationUrl({
  tenantId,
  legalEntity,
  returnTo
}: {
  tenantId: string;
  legalEntity: QuickBooksLegalEntity;
  returnTo: string;
}) {
  const state = signQuickBooksState({
    tenantId,
    legalEntity,
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

export async function fetchQuickBooksCompanyInfo({
  realmId,
  accessToken
}: {
  realmId: string;
  accessToken: string;
}) {
  const baseUrl =
    getQuickBooksEnvironment() === "sandbox"
      ? "https://sandbox-quickbooks.api.intuit.com"
      : "https://quickbooks.api.intuit.com";
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

  const expectedSignature = createHmac("sha256", getQuickBooksEncryptionSecret()).update(encoded).digest("base64url");
  if (signature !== expectedSignature) {
    throw new Error("QuickBooks OAuth state signature is invalid.");
  }

  return JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as QuickBooksStatePayload;
}

function signQuickBooksState(payload: QuickBooksStatePayload) {
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = createHmac("sha256", getQuickBooksEncryptionSecret()).update(encoded).digest("base64url");
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
