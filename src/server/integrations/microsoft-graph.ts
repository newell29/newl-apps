import { IntegrationProvider, IntegrationStatus } from "@prisma/client";

export const MICROSOFT_GRAPH_CREDENTIAL_NAME = "Microsoft 365 Assistant";

export type MicrosoftGraphMailboxAccessMode = "SIGNED_IN_USER" | "ADMIN_SELECTED_MAILBOXES";

export type MicrosoftGraphSettings = {
  scopes: string[];
  adminMailboxTargets: string[];
  mailboxAccessMode: MicrosoftGraphMailboxAccessMode;
  mailLookbackDays: number;
  maxMailMessagesPerMailbox: number;
  mailSyncEnabled: boolean;
  fileSyncEnabled: boolean;
  draftingEnabled: boolean;
  status: IntegrationStatus;
  runtimeReady: boolean;
  runtimeNotes: string;
  consentConfigured: boolean;
  crossMailboxReady: boolean;
};

type MicrosoftGraphCredentialRecord = {
  provider: IntegrationProvider;
  status: IntegrationStatus;
  publicConfig: unknown;
};

type MicrosoftGraphConfigInput = {
  scopes: string[];
  adminMailboxTargets: string[];
  mailboxAccessMode: MicrosoftGraphMailboxAccessMode;
  mailLookbackDays: number;
  maxMailMessagesPerMailbox: number;
  mailSyncEnabled: boolean;
  fileSyncEnabled: boolean;
  draftingEnabled: boolean;
};

export const DEFAULT_MICROSOFT_GRAPH_MAIL_LOOKBACK_DAYS = 90;
export const DEFAULT_MICROSOFT_GRAPH_MAX_MAIL_MESSAGES_PER_MAILBOX = 500;

export const DEFAULT_MICROSOFT_GRAPH_SCOPES = [
  "User.Read",
  "offline_access",
  "Mail.Read",
  "Files.Read.All",
  "Sites.Read.All"
];

export function parseMicrosoftGraphSettings(
  credential?: MicrosoftGraphCredentialRecord | null
): MicrosoftGraphSettings {
  const config =
    credential?.publicConfig && typeof credential.publicConfig === "object"
      ? (credential.publicConfig as Record<string, unknown>)
      : {};

  const scopes = readStringArray(config.scopes, DEFAULT_MICROSOFT_GRAPH_SCOPES);
  const adminMailboxTargets = readStringArray(config.adminMailboxTargets, []);
  const mailboxAccessMode = readMailboxAccessMode(config.mailboxAccessMode);
  const mailLookbackDays = readInteger(
    config.mailLookbackDays,
    DEFAULT_MICROSOFT_GRAPH_MAIL_LOOKBACK_DAYS,
    1,
    365
  );
  const maxMailMessagesPerMailbox = readInteger(
    config.maxMailMessagesPerMailbox,
    DEFAULT_MICROSOFT_GRAPH_MAX_MAIL_MESSAGES_PER_MAILBOX,
    1,
    2_000
  );
  const mailSyncEnabled = readBoolean(config.mailSyncEnabled) ?? true;
  const fileSyncEnabled = readBoolean(config.fileSyncEnabled) ?? true;
  const draftingEnabled = readBoolean(config.draftingEnabled) ?? false;
  const status = credential?.status ?? IntegrationStatus.DISABLED;
  const runtimeReady = hasDelegatedGraphRuntimeConfigured();
  const consentConfigured = scopes.length > 0;
  const crossMailboxReady =
    mailboxAccessMode === "ADMIN_SELECTED_MAILBOXES" &&
    adminMailboxTargets.length > 0 &&
    hasApplicationMailboxRuntimeConfigured();

  return {
    scopes,
    adminMailboxTargets,
    mailboxAccessMode,
    mailLookbackDays,
    maxMailMessagesPerMailbox,
    mailSyncEnabled,
    fileSyncEnabled,
    draftingEnabled,
    status,
    runtimeReady,
    runtimeNotes: buildRuntimeNotes({
      runtimeReady,
      mailboxAccessMode,
      draftingEnabled,
      adminMailboxTargets
    }),
    consentConfigured,
    crossMailboxReady
  };
}

export function buildMicrosoftGraphConfig(input: MicrosoftGraphConfigInput) {
  return {
    scopes: Array.from(new Set(input.scopes.filter((scope) => scope.trim().length > 0))),
    adminMailboxTargets: Array.from(new Set(input.adminMailboxTargets.filter((target) => target.trim().length > 0))),
    mailboxAccessMode: input.mailboxAccessMode,
    mailLookbackDays: input.mailLookbackDays,
    maxMailMessagesPerMailbox: input.maxMailMessagesPerMailbox,
    mailSyncEnabled: input.mailSyncEnabled,
    fileSyncEnabled: input.fileSyncEnabled,
    draftingEnabled: input.draftingEnabled
  };
}

function buildRuntimeNotes({
  runtimeReady,
  mailboxAccessMode,
  draftingEnabled,
  adminMailboxTargets
}: {
  runtimeReady: boolean;
  mailboxAccessMode: MicrosoftGraphMailboxAccessMode;
  draftingEnabled: boolean;
  adminMailboxTargets: string[];
}) {
  if (!runtimeReady) {
    return "Microsoft delegated auth is not fully configured in the server environment yet. Set the Entra app env values in Vercel before enabling live sync.";
  }

  if (mailboxAccessMode === "ADMIN_SELECTED_MAILBOXES") {
    if (adminMailboxTargets.length === 0) {
      return "Admin mailbox insight mode selected. Add one or more mailbox addresses to enable cross-mailbox Microsoft Graph sync.";
    }

    return draftingEnabled
      ? "Admin mailbox insight mode selected. Live cross-mailbox sync and sending still require Microsoft Graph application permissions plus an Exchange mailbox access policy."
      : "Admin mailbox insight mode selected. Live cross-mailbox sync requires Microsoft Graph application permissions plus an Exchange mailbox access policy that limits which mailboxes the app can read.";
  }

  return draftingEnabled
    ? "Configured for signed-in user access. Mail drafting still requires Mail.Send to be granted before live send is enabled."
    : "Configured for signed-in user delegated access using the current Microsoft Graph consent set.";
}

function hasDelegatedGraphRuntimeConfigured() {
  const clientId = process.env.AUTH_MICROSOFT_ENTRA_ID_ID?.trim() || process.env.AZURE_AD_CLIENT_ID?.trim();
  const tenantId = process.env.AZURE_AD_TENANT_ID?.trim();
  const issuer = process.env.AUTH_MICROSOFT_ENTRA_ID_ISSUER?.trim();
  const authUrl = process.env.AUTH_URL?.trim() || process.env.NEXTAUTH_URL?.trim();

  return Boolean(clientId && authUrl && (tenantId || issuer));
}

function hasApplicationMailboxRuntimeConfigured() {
  return Boolean(
    (
      process.env.MICROSOFT_GRAPH_APP_CLIENT_ID?.trim() ||
      process.env.AUTH_MICROSOFT_ENTRA_ID_ID?.trim() ||
      process.env.AZURE_AD_CLIENT_ID?.trim()
    ) &&
      (
        process.env.MICROSOFT_GRAPH_APP_CLIENT_SECRET?.trim() ||
        process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET?.trim() ||
        process.env.AZURE_AD_CLIENT_SECRET?.trim()
      ) &&
      (
        process.env.MICROSOFT_GRAPH_APP_TENANT_ID?.trim() ||
        process.env.AZURE_AD_TENANT_ID?.trim() ||
        readTenantIdFromIssuer(process.env.AUTH_MICROSOFT_ENTRA_ID_ISSUER)
      )
  );
}

function readTenantIdFromIssuer(issuer: string | undefined) {
  if (!issuer) {
    return null;
  }

  const match = issuer.match(/login\.microsoftonline\.com\/([^/]+)\/v2\.0/i);
  return match?.[1] ?? null;
}

function readMailboxAccessMode(value: unknown): MicrosoftGraphMailboxAccessMode {
  return value === "ADMIN_SELECTED_MAILBOXES" ? "ADMIN_SELECTED_MAILBOXES" : "SIGNED_IN_USER";
}

function readBoolean(value: unknown) {
  return typeof value === "boolean" ? value : undefined;
}

function readInteger(value: unknown, fallback: number, min: number, max: number) {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number.parseInt(value, 10)
        : Number.NaN;

  if (!Number.isInteger(parsed)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, parsed));
}

function readStringArray(value: unknown, fallback: string[]) {
  if (!Array.isArray(value)) {
    return fallback;
  }

  const parsed = value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter((entry, index, array) => entry.length > 0 && array.indexOf(entry) === index);

  return parsed.length > 0 ? parsed : fallback;
}
