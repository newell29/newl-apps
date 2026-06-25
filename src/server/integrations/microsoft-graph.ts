import { IntegrationProvider, IntegrationStatus } from "@prisma/client";

export const MICROSOFT_GRAPH_CREDENTIAL_NAME = "Microsoft 365 Assistant";

export type MicrosoftGraphMailboxAccessMode = "SIGNED_IN_USER" | "ADMIN_SELECTED_MAILBOXES";

export type MicrosoftGraphSettings = {
  clientId: string | null;
  tenantId: string | null;
  redirectUri: string | null;
  scopes: string[];
  adminMailboxTargets: string[];
  mailboxAccessMode: MicrosoftGraphMailboxAccessMode;
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
  clientId: string | null;
  tenantId: string | null;
  redirectUri: string | null;
  scopes: string[];
  adminMailboxTargets: string[];
  mailboxAccessMode: MicrosoftGraphMailboxAccessMode;
  mailSyncEnabled: boolean;
  fileSyncEnabled: boolean;
  draftingEnabled: boolean;
};

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

  const clientId = readString(config.clientId);
  const tenantId = readString(config.tenantId);
  const redirectUri = readString(config.redirectUri);
  const scopes = readStringArray(config.scopes, DEFAULT_MICROSOFT_GRAPH_SCOPES);
  const adminMailboxTargets = readStringArray(config.adminMailboxTargets, []);
  const mailboxAccessMode = readMailboxAccessMode(config.mailboxAccessMode);
  const mailSyncEnabled = readBoolean(config.mailSyncEnabled) ?? true;
  const fileSyncEnabled = readBoolean(config.fileSyncEnabled) ?? true;
  const draftingEnabled = readBoolean(config.draftingEnabled) ?? false;
  const status = credential?.status ?? IntegrationStatus.DISABLED;
  const runtimeReady = Boolean(clientId && tenantId && redirectUri);
  const consentConfigured = scopes.length > 0;
  const crossMailboxReady =
    mailboxAccessMode === "ADMIN_SELECTED_MAILBOXES" &&
    adminMailboxTargets.length > 0 &&
    hasApplicationMailboxRuntimeConfigured();

  return {
    clientId,
    tenantId,
    redirectUri,
    scopes,
    adminMailboxTargets,
    mailboxAccessMode,
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
    clientId: input.clientId,
    tenantId: input.tenantId,
    redirectUri: input.redirectUri,
    scopes: Array.from(new Set(input.scopes.filter((scope) => scope.trim().length > 0))),
    adminMailboxTargets: Array.from(new Set(input.adminMailboxTargets.filter((target) => target.trim().length > 0))),
    mailboxAccessMode: input.mailboxAccessMode,
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
    return "Set the Microsoft app registration values for this tenant before enabling live sync.";
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

function hasApplicationMailboxRuntimeConfigured() {
  return Boolean(
    process.env.MICROSOFT_GRAPH_APP_CLIENT_ID &&
      process.env.MICROSOFT_GRAPH_APP_CLIENT_SECRET &&
      process.env.MICROSOFT_GRAPH_APP_TENANT_ID
  );
}

function readMailboxAccessMode(value: unknown): MicrosoftGraphMailboxAccessMode {
  return value === "ADMIN_SELECTED_MAILBOXES" ? "ADMIN_SELECTED_MAILBOXES" : "SIGNED_IN_USER";
}

function readBoolean(value: unknown) {
  return typeof value === "boolean" ? value : undefined;
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
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
