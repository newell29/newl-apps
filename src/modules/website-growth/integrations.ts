import { createSign } from "node:crypto";

export type WebsiteGrowthIntegrationStatus = {
  googleSearchConsole: {
    configured: boolean;
    missing: string[];
    siteUrl: string | null;
    mode: "oauth" | "service_account" | "not_configured";
  };
  ga4: {
    configured: boolean;
    missing: string[];
    propertyId: string | null;
    mode: "oauth" | "service_account" | "not_configured";
  };
};

export type Ga4LandingPageRow = {
  page: string;
  sessions: number;
  engagedSessions: number;
  engagementRate: number | null;
  eventCount: number;
  raw: Record<string, unknown>;
};

type Env = Record<string, string | undefined>;

export function getWebsiteGrowthIntegrationStatus(env: Env = process.env): WebsiteGrowthIntegrationStatus {
  const gscOauthFields = [
    "GOOGLE_SEARCH_CONSOLE_CLIENT_ID",
    "GOOGLE_SEARCH_CONSOLE_CLIENT_SECRET",
    "GOOGLE_SEARCH_CONSOLE_REFRESH_TOKEN",
    "GOOGLE_SEARCH_CONSOLE_SITE_URL"
  ];
  const gscServiceAccountFields = [
    "GOOGLE_SEARCH_CONSOLE_SERVICE_ACCOUNT_EMAIL",
    "GOOGLE_SEARCH_CONSOLE_PRIVATE_KEY",
    "GOOGLE_SEARCH_CONSOLE_SITE_URL"
  ];
  const missingOauth = missingFields(env, gscOauthFields);
  const missingServiceAccount = missingFields(env, gscServiceAccountFields);
  const hasOauthCredentials = missingOauth.length === 0;
  const hasServiceAccountCredentials = missingServiceAccount.length === 0;
  const gscConfigured = hasOauthCredentials || hasServiceAccountCredentials;
  const gscMode =
    hasServiceAccountCredentials
        ? "service_account"
        : hasOauthCredentials
          ? "oauth"
          : "not_configured";
  const searchConsoleSiteUrl = normalizeSearchConsoleSiteUrl(env.GOOGLE_SEARCH_CONSOLE_SITE_URL);
  const ga4OauthFields = ["GA4_PROPERTY_ID", "GA4_CLIENT_ID", "GA4_CLIENT_SECRET", "GA4_REFRESH_TOKEN"];
  const ga4ServiceAccountFields = ["GA4_PROPERTY_ID", "GA4_CLIENT_EMAIL", "GA4_PRIVATE_KEY"];
  const missingGa4Oauth = missingFields(env, ga4OauthFields);
  const missingGa4ServiceAccount = missingFields(env, ga4ServiceAccountFields);
  const hasGa4Oauth = missingGa4Oauth.length === 0;
  const hasGa4ServiceAccount = missingGa4ServiceAccount.length === 0;

  return {
    googleSearchConsole: {
      configured: gscConfigured,
      missing: gscConfigured ? [] : getMissingSearchConsoleFields(env, missingOauth, missingServiceAccount),
      siteUrl: searchConsoleSiteUrl,
      mode: gscMode
    },
    ga4: {
      configured: hasGa4ServiceAccount || hasGa4Oauth,
      missing:
        hasGa4ServiceAccount || hasGa4Oauth
          ? []
          : getMissingGa4Fields(env, missingGa4Oauth, missingGa4ServiceAccount),
      propertyId: normalizeGa4PropertyId(env.GA4_PROPERTY_ID),
      mode: hasGa4ServiceAccount ? "service_account" : hasGa4Oauth ? "oauth" : "not_configured"
    }
  };
}

export async function fetchGa4LandingPageRows({
  env = process.env,
  fetcher = fetch,
  startDate,
  endDate
}: {
  env?: Env;
  fetcher?: typeof fetch;
  startDate: string;
  endDate: string;
}): Promise<Ga4LandingPageRow[]> {
  const status = getWebsiteGrowthIntegrationStatus(env);

  if (!status.ga4.configured || !status.ga4.propertyId) {
    throw new Error(`GA4 is not configured. Missing: ${status.ga4.missing.join(", ")}`);
  }

  const accessToken =
    status.ga4.mode === "service_account"
      ? await fetchGoogleServiceAccountAccessToken({
          env,
          fetcher,
          emailKey: "GA4_CLIENT_EMAIL",
          privateKeyKey: "GA4_PRIVATE_KEY",
          scope: "https://www.googleapis.com/auth/analytics.readonly",
          label: "GA4"
        })
      : await fetchGoogleOauthAccessToken({
          env,
          fetcher,
          clientIdKey: "GA4_CLIENT_ID",
          clientSecretKey: "GA4_CLIENT_SECRET",
          refreshTokenKey: "GA4_REFRESH_TOKEN",
          label: "GA4"
        });
  const response = await fetcher(
    `https://analyticsdata.googleapis.com/v1beta/properties/${encodeURIComponent(status.ga4.propertyId)}:runReport`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        dateRanges: [{ startDate, endDate }],
        dimensions: [{ name: "landingPagePlusQueryString" }],
        metrics: [
          { name: "sessions" },
          { name: "engagedSessions" },
          { name: "engagementRate" },
          { name: "eventCount" }
        ],
        limit: "10000",
        keepEmptyRows: false
      })
    }
  );

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`GA4 Data API request failed (${response.status}): ${detail}`);
  }

  const json = (await response.json()) as {
    rows?: Array<{
      dimensionValues?: Array<{ value?: string }>;
      metricValues?: Array<{ value?: string }>;
    }>;
  };

  return (json.rows ?? []).map((row) => ({
    page: row.dimensionValues?.[0]?.value?.trim() || "/",
    sessions: readGa4Number(row.metricValues?.[0]?.value),
    engagedSessions: readGa4Number(row.metricValues?.[1]?.value),
    engagementRate: readGa4NullableNumber(row.metricValues?.[2]?.value),
    eventCount: readGa4Number(row.metricValues?.[3]?.value),
    raw: row as Record<string, unknown>
  }));
}

export async function fetchSearchConsoleRows({
  env = process.env,
  fetcher = fetch,
  startDate,
  endDate,
  dimensions
}: {
  env?: Env;
  fetcher?: typeof fetch;
  startDate: string;
  endDate: string;
  dimensions: string[];
}) {
  const status = getWebsiteGrowthIntegrationStatus(env);

  if (!status.googleSearchConsole.configured) {
    throw new Error(
      `Google Search Console is not configured. Missing: ${status.googleSearchConsole.missing.join(", ")}`
    );
  }

  const accessToken =
    status.googleSearchConsole.mode === "service_account"
      ? await fetchGoogleServiceAccountAccessToken({
          env,
          fetcher,
          emailKey: "GOOGLE_SEARCH_CONSOLE_SERVICE_ACCOUNT_EMAIL",
          privateKeyKey: "GOOGLE_SEARCH_CONSOLE_PRIVATE_KEY",
          scope: "https://www.googleapis.com/auth/webmasters.readonly",
          label: "Google Search Console"
        })
      : await fetchGoogleOauthAccessToken({
          env,
          fetcher,
          clientIdKey: "GOOGLE_SEARCH_CONSOLE_CLIENT_ID",
          clientSecretKey: "GOOGLE_SEARCH_CONSOLE_CLIENT_SECRET",
          refreshTokenKey: "GOOGLE_SEARCH_CONSOLE_REFRESH_TOKEN",
          label: "Google Search Console"
        });
  const normalizedSiteUrl = normalizeSearchConsoleSiteUrl(env.GOOGLE_SEARCH_CONSOLE_SITE_URL);

  if (!normalizedSiteUrl) {
    throw new Error("Google Search Console site URL is required.");
  }

  const siteUrl = encodeURIComponent(normalizedSiteUrl);
  const response = await fetcher(
    `https://searchconsole.googleapis.com/webmasters/v3/sites/${siteUrl}/searchAnalytics/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        startDate,
        endDate,
        dimensions,
        rowLimit: 25000,
        searchType: "web"
      })
    }
  );

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Search Console API request failed (${response.status}): ${detail}`);
  }

  const json = (await response.json()) as {
    rows?: Array<{
      keys?: string[];
      clicks?: number;
      impressions?: number;
      ctr?: number;
      position?: number;
    }>;
  };

  return json.rows ?? [];
}

async function fetchGoogleOauthAccessToken({
  env,
  fetcher,
  clientIdKey,
  clientSecretKey,
  refreshTokenKey,
  label
}: {
  env: Env;
  fetcher: typeof fetch;
  clientIdKey: string;
  clientSecretKey: string;
  refreshTokenKey: string;
  label: string;
}) {
  const response = await fetcher("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      client_id: env[clientIdKey] ?? "",
      client_secret: env[clientSecretKey] ?? "",
      refresh_token: env[refreshTokenKey] ?? "",
      grant_type: "refresh_token"
    })
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`${label} OAuth token request failed (${response.status}): ${detail}`);
  }

  const json = (await response.json()) as { access_token?: string };

  if (!json.access_token) {
    throw new Error("Google OAuth token response did not include an access_token.");
  }

  return json.access_token;
}

async function fetchGoogleServiceAccountAccessToken({
  env,
  fetcher,
  emailKey,
  privateKeyKey,
  scope,
  label
}: {
  env: Env;
  fetcher: typeof fetch;
  emailKey: string;
  privateKeyKey: string;
  scope: string;
  label: string;
}) {
  const assertion = createServiceAccountJwt({ env, emailKey, privateKeyKey, scope, label });
  const response = await fetcher("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion
    })
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`${label} service-account token request failed (${response.status}): ${detail}`);
  }

  const json = (await response.json()) as { access_token?: string };

  if (!json.access_token) {
    throw new Error("Google service-account token response did not include an access_token.");
  }

  return json.access_token;
}

function createServiceAccountJwt({
  env,
  emailKey,
  privateKeyKey,
  scope,
  label
}: {
  env: Env;
  emailKey: string;
  privateKeyKey: string;
  scope: string;
  label: string;
}) {
  const email = env[emailKey];
  const privateKey = env[privateKeyKey]?.replace(/\\n/g, "\n");

  if (!email || !privateKey) {
    throw new Error(`${label} service-account email and private key are required.`);
  }

  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64Url(
    JSON.stringify({
      iss: email,
      scope,
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600
    })
  );
  const unsignedToken = `${header}.${payload}`;
  const signature = createSign("RSA-SHA256").update(unsignedToken).sign(privateKey);

  return `${unsignedToken}.${base64Url(signature)}`;
}

function base64Url(value: string | Buffer) {
  return Buffer.from(value).toString("base64").replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

export function normalizeSearchConsoleSiteUrl(value?: string | null) {
  const trimmed = value?.trim();

  if (!trimmed) {
    return null;
  }

  if (trimmed.startsWith("sc-domain:") || /^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }

  const domain = trimmed.split("/")[0]?.replace(/^www\./i, "").toLowerCase();

  return domain ? `sc-domain:${domain}` : null;
}

export function normalizeGa4PropertyId(value?: string | null) {
  const trimmed = value?.trim();
  return trimmed?.replace(/^properties\//i, "") || null;
}

function missingFields(env: Env, keys: string[]) {
  return keys.filter((key) => !env[key]);
}

function getMissingSearchConsoleFields(env: Env, missingOauth: string[], missingServiceAccount: string[]) {
  const serviceAccountFieldsStarted = Boolean(
    env.GOOGLE_SEARCH_CONSOLE_SERVICE_ACCOUNT_EMAIL || env.GOOGLE_SEARCH_CONSOLE_PRIVATE_KEY
  );
  const oauthFieldsStarted = Boolean(
    env.GOOGLE_SEARCH_CONSOLE_CLIENT_ID ||
      env.GOOGLE_SEARCH_CONSOLE_CLIENT_SECRET ||
      env.GOOGLE_SEARCH_CONSOLE_REFRESH_TOKEN
  );

  if (serviceAccountFieldsStarted) {
    return missingServiceAccount;
  }

  if (oauthFieldsStarted) {
    return missingOauth;
  }

  return [
    "GOOGLE_SEARCH_CONSOLE_SITE_URL",
    "GOOGLE_SEARCH_CONSOLE_SERVICE_ACCOUNT_EMAIL",
    "GOOGLE_SEARCH_CONSOLE_PRIVATE_KEY"
  ];
}

function getMissingGa4Fields(env: Env, missingOauth: string[], missingServiceAccount: string[]) {
  if (env.GA4_CLIENT_EMAIL || env.GA4_PRIVATE_KEY) {
    return missingServiceAccount;
  }

  if (env.GA4_CLIENT_ID || env.GA4_CLIENT_SECRET || env.GA4_REFRESH_TOKEN) {
    return missingOauth;
  }

  return ["GA4_PROPERTY_ID", "GA4_CLIENT_EMAIL", "GA4_PRIVATE_KEY"];
}

function readGa4Number(value?: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed) : 0;
}

function readGa4NullableNumber(value?: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
