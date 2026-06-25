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

type MicrosoftAccountRecord = {
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
