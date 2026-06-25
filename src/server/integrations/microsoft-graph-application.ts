const MICROSOFT_GRAPH_APPLICATION_SCOPE = "https://graph.microsoft.com/.default";

export async function getMicrosoftGraphApplicationAccessToken() {
  const clientId = process.env.MICROSOFT_GRAPH_APP_CLIENT_ID?.trim();
  const clientSecret = process.env.MICROSOFT_GRAPH_APP_CLIENT_SECRET?.trim();
  const tenantId = process.env.MICROSOFT_GRAPH_APP_TENANT_ID?.trim();

  if (!clientId || !clientSecret || !tenantId) {
    throw new Error(
      "Microsoft Graph application credentials are incomplete. Set MICROSOFT_GRAPH_APP_CLIENT_ID, MICROSOFT_GRAPH_APP_CLIENT_SECRET, and MICROSOFT_GRAPH_APP_TENANT_ID."
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
