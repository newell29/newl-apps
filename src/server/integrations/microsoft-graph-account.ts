export const MICROSOFT_ENTRA_PROVIDER_ID = "microsoft-entra-id";

export const MICROSOFT_GRAPH_DELEGATED_SCOPES = [
  "openid",
  "profile",
  "email",
  "offline_access",
  "User.Read",
  "Mail.Read",
  "Files.Read.All",
  "Sites.Read.All"
];

export const MICROSOFT_GRAPH_DELEGATED_SCOPE_STRING = MICROSOFT_GRAPH_DELEGATED_SCOPES.join(" ");

export type MicrosoftGraphDelegatedConnection = {
  connected: boolean;
  hasRefreshToken: boolean;
  scopes: string[];
  missingScopes: string[];
  expiresAt: string | null;
  runtimeNotes: string;
};

export type MicrosoftAccountRecord = {
  id?: string;
  access_token: string | null;
  refresh_token: string | null;
  expires_at: number | null;
  scope: string | null;
};

export function parseMicrosoftGraphDelegatedConnection(
  account?: MicrosoftAccountRecord | null
): MicrosoftGraphDelegatedConnection {
  const scopes = parseScopeString(account?.scope ?? null);
  const missingScopes = MICROSOFT_GRAPH_DELEGATED_SCOPES.filter((scope) => !scopes.includes(scope));
  const connected = Boolean(account?.access_token || account?.refresh_token) && missingScopes.length === 0;
  const hasRefreshToken = Boolean(account?.refresh_token);
  const expiresAt = account?.expires_at ? new Date(account.expires_at * 1000).toISOString() : null;

  return {
    connected,
    hasRefreshToken,
    scopes,
    missingScopes,
    expiresAt,
    runtimeNotes: buildRuntimeNotes({
      connected,
      hasRefreshToken,
      missingScopes,
      expiresAt
    })
  };
}

function parseScopeString(value: string | null) {
  if (!value) {
    return [];
  }

  return value
    .split(" ")
    .map((scope) => scope.trim())
    .filter((scope, index, array) => scope.length > 0 && array.indexOf(scope) === index);
}

function buildRuntimeNotes({
  connected,
  hasRefreshToken,
  missingScopes,
  expiresAt
}: {
  connected: boolean;
  hasRefreshToken: boolean;
  missingScopes: string[];
  expiresAt: string | null;
}) {
  if (!connected) {
    if (missingScopes.length > 0) {
      return `Reconnect Microsoft 365 to grant the delegated scopes still missing for assistant sync: ${missingScopes.join(", ")}.`;
    }

    return "Connect Microsoft 365 to allow the assistant to read the current user's Outlook and SharePoint content.";
  }

  if (!hasRefreshToken) {
    return "The current Microsoft 365 grant is missing a refresh token. Reconnect to keep long-running assistant syncs working.";
  }

  if (expiresAt) {
    return `Delegated Microsoft 365 access is connected. The current access token expires at ${expiresAt}.`;
  }

  return "Delegated Microsoft 365 access is connected for this user.";
}

export async function ensureFreshMicrosoftGraphAccessToken(account: MicrosoftAccountRecord) {
  if (account.access_token && !isTokenExpiringSoon(account.expires_at)) {
    return {
      accessToken: account.access_token,
      refreshed: false
    };
  }

  if (!account.refresh_token) {
    throw new Error("Microsoft 365 delegated access is missing a refresh token.");
  }

  const refreshed = await refreshMicrosoftGraphAccessToken(account.refresh_token);
  return {
    accessToken: refreshed.accessToken,
    refreshed: true,
    nextRefreshToken: refreshed.refreshToken,
    expiresAt: refreshed.expiresAt,
    scope: refreshed.scope,
    tokenType: refreshed.tokenType
  };
}

async function refreshMicrosoftGraphAccessToken(refreshToken: string) {
  const clientId = process.env.AUTH_MICROSOFT_ENTRA_ID_ID ?? process.env.AZURE_AD_CLIENT_ID;
  const clientSecret = process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET ?? process.env.AZURE_AD_CLIENT_SECRET;
  const tenantId = process.env.AZURE_AD_TENANT_ID ?? readTenantIdFromIssuer(process.env.AUTH_MICROSOFT_ENTRA_ID_ISSUER);

  if (!clientId || !clientSecret || !tenantId) {
    throw new Error("Microsoft Entra client credentials are not configured for delegated token refresh.");
  }

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    scope: MICROSOFT_GRAPH_DELEGATED_SCOPE_STRING
  });

  const response = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded"
    },
    body: body.toString(),
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(`Microsoft Entra token refresh failed with status ${response.status}.`);
  }

  const json = (await response.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
    token_type?: string;
  };

  if (!json.access_token) {
    throw new Error("Microsoft Entra refresh response did not include an access token.");
  }

  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token ?? refreshToken,
    expiresAt: Math.floor(Date.now() / 1000) + Math.max(0, json.expires_in ?? 3600),
    scope: json.scope ?? MICROSOFT_GRAPH_DELEGATED_SCOPE_STRING,
    tokenType: json.token_type ?? "Bearer"
  };
}

function isTokenExpiringSoon(expiresAt: number | null) {
  if (!expiresAt) {
    return true;
  }

  return expiresAt - Math.floor(Date.now() / 1000) <= 300;
}

function readTenantIdFromIssuer(issuer: string | undefined) {
  if (!issuer) {
    return null;
  }

  const match = issuer.match(/login\.microsoftonline\.com\/([^/]+)\/v2\.0/i);
  return match?.[1] ?? null;
}
