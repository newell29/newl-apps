const MICROSOFT_ENTRA_PROVIDER = "microsoft-entra-id";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type MicrosoftEntraIdentity = {
  tenantId: string;
  objectId: string;
};

type ProvisionedUserIdentity = {
  id: string;
  microsoftEntraTenantId: string | null;
  microsoftEntraObjectId: string | null;
};

type MicrosoftEntraIdentityStore = {
  findByIdentity(identity: MicrosoftEntraIdentity): Promise<{ id: string } | null>;
  linkIdentity(userId: string, identity: MicrosoftEntraIdentity): Promise<void>;
};

export type MicrosoftEntraIdentityLinkResult =
  | "not-microsoft"
  | "missing-claims"
  | "matched"
  | "linked"
  | "conflict";

export function readMicrosoftEntraIdentity(profile: unknown): MicrosoftEntraIdentity | null {
  if (!profile || typeof profile !== "object") {
    return null;
  }

  const record = profile as Record<string, unknown>;
  const tenantId = normalizeMicrosoftEntraId(record.tid);
  const objectId = normalizeMicrosoftEntraId(record.oid);
  return tenantId && objectId ? { tenantId, objectId } : null;
}

export function normalizeMicrosoftEntraId(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  return UUID_PATTERN.test(normalized) ? normalized : null;
}

export async function ensureMicrosoftEntraIdentityLink({
  provider,
  profile,
  user,
  store
}: {
  provider: string | null;
  profile: unknown;
  user: ProvisionedUserIdentity;
  store: MicrosoftEntraIdentityStore;
}): Promise<MicrosoftEntraIdentityLinkResult> {
  if (provider !== MICROSOFT_ENTRA_PROVIDER) {
    return "not-microsoft";
  }

  const identity = readMicrosoftEntraIdentity(profile);
  if (!identity) {
    return "missing-claims";
  }

  const storedTenantId = normalizeMicrosoftEntraId(user.microsoftEntraTenantId);
  const storedObjectId = normalizeMicrosoftEntraId(user.microsoftEntraObjectId);
  if (storedTenantId || storedObjectId) {
    return storedTenantId === identity.tenantId && storedObjectId === identity.objectId
      ? "matched"
      : "conflict";
  }

  const existing = await store.findByIdentity(identity);
  if (existing && existing.id !== user.id) {
    return "conflict";
  }

  await store.linkIdentity(user.id, identity);
  return "linked";
}
