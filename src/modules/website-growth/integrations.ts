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
  };
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
  const gscConfigured = missingOauth.length === 0 || missingServiceAccount.length === 0;

  return {
    googleSearchConsole: {
      configured: gscConfigured,
      missing: gscConfigured
        ? []
        : Array.from(new Set([...missingOauth, ...missingServiceAccount])),
      siteUrl: env.GOOGLE_SEARCH_CONSOLE_SITE_URL ?? null,
      mode:
        missingOauth.length === 0
          ? "oauth"
          : missingServiceAccount.length === 0
            ? "service_account"
            : "not_configured"
    },
    ga4: {
      configured:
        Boolean(env.GA4_PROPERTY_ID) &&
        (Boolean(env.GA4_CLIENT_EMAIL && env.GA4_PRIVATE_KEY) ||
          Boolean(env.GA4_CLIENT_ID && env.GA4_CLIENT_SECRET && env.GA4_REFRESH_TOKEN)),
      missing: missingFields(env, ["GA4_PROPERTY_ID"]),
      propertyId: env.GA4_PROPERTY_ID ?? null
    }
  };
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
      ? await fetchGoogleServiceAccountAccessToken({ env, fetcher })
      : await fetchGoogleOauthAccessToken({ env, fetcher });
  const siteUrl = encodeURIComponent(env.GOOGLE_SEARCH_CONSOLE_SITE_URL ?? "");
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

async function fetchGoogleOauthAccessToken({ env, fetcher }: { env: Env; fetcher: typeof fetch }) {
  const response = await fetcher("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      client_id: env.GOOGLE_SEARCH_CONSOLE_CLIENT_ID ?? "",
      client_secret: env.GOOGLE_SEARCH_CONSOLE_CLIENT_SECRET ?? "",
      refresh_token: env.GOOGLE_SEARCH_CONSOLE_REFRESH_TOKEN ?? "",
      grant_type: "refresh_token"
    })
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Google OAuth token request failed (${response.status}): ${detail}`);
  }

  const json = (await response.json()) as { access_token?: string };

  if (!json.access_token) {
    throw new Error("Google OAuth token response did not include an access_token.");
  }

  return json.access_token;
}

async function fetchGoogleServiceAccountAccessToken({ env, fetcher }: { env: Env; fetcher: typeof fetch }) {
  const assertion = createServiceAccountJwt(env);
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
    throw new Error(`Google service-account token request failed (${response.status}): ${detail}`);
  }

  const json = (await response.json()) as { access_token?: string };

  if (!json.access_token) {
    throw new Error("Google service-account token response did not include an access_token.");
  }

  return json.access_token;
}

function createServiceAccountJwt(env: Env) {
  const email = env.GOOGLE_SEARCH_CONSOLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = env.GOOGLE_SEARCH_CONSOLE_PRIVATE_KEY?.replace(/\\n/g, "\n");

  if (!email || !privateKey) {
    throw new Error("Google Search Console service-account email and private key are required.");
  }

  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64Url(
    JSON.stringify({
      iss: email,
      scope: "https://www.googleapis.com/auth/webmasters.readonly",
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

function missingFields(env: Env, keys: string[]) {
  return keys.filter((key) => !env[key]);
}
