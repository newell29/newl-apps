const MICROSOFT_GRAPH_APPLICATION_SCOPE = "https://graph.microsoft.com/.default";

export async function getMicrosoftGraphApplicationAccessToken() {
  const clientId =
    process.env.MICROSOFT_GRAPH_APP_CLIENT_ID?.trim() ||
    process.env.AUTH_MICROSOFT_ENTRA_ID_ID?.trim() ||
    process.env.AZURE_AD_CLIENT_ID?.trim();
  const clientSecret =
    process.env.MICROSOFT_GRAPH_APP_CLIENT_SECRET?.trim() ||
    process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET?.trim() ||
    process.env.AZURE_AD_CLIENT_SECRET?.trim();
  const tenantId =
    process.env.MICROSOFT_GRAPH_APP_TENANT_ID?.trim() ||
    process.env.AZURE_AD_TENANT_ID?.trim() ||
    readTenantIdFromIssuer(process.env.AUTH_MICROSOFT_ENTRA_ID_ISSUER);

  if (!clientId || !clientSecret || !tenantId) {
    throw new Error(
      "Microsoft Graph application credentials are incomplete. Set MICROSOFT_GRAPH_APP_CLIENT_ID, MICROSOFT_GRAPH_APP_CLIENT_SECRET, and MICROSOFT_GRAPH_APP_TENANT_ID, or reuse the Microsoft Entra auth app credentials in AUTH_MICROSOFT_ENTRA_ID_* / AZURE_AD_*."
    );
  }

  const response = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "client_credentials",
      scope: MICROSOFT_GRAPH_APPLICATION_SCOPE
    }),
    cache: "no-store"
  });

  const json = (await response.json().catch(() => null)) as
    | {
        access_token?: string;
        error?: string;
        error_description?: string;
      }
    | null;

  if (!response.ok || !json?.access_token) {
    throw new Error(
      json?.error_description ??
        json?.error ??
        `Microsoft Graph application token request failed with status ${response.status}.`
    );
  }

  return json.access_token;
}

function readTenantIdFromIssuer(issuer: string | undefined) {
  if (!issuer) {
    return null;
  }

  const match = issuer.match(/login\.microsoftonline\.com\/([^/]+)\/v2\.0/i);
  return match?.[1] ?? null;
}
