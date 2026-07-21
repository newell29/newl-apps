import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";
import { IntegrationProvider, IntegrationStatus } from "@prisma/client";

import { prisma } from "@/server/db";
import { tenantWhere } from "@/server/tenant-query";
import type { TenantContext } from "@/server/tenant-context";

const TEAMSHIP_CREDENTIAL_NAME = "Teamship WMS";
const TEAMSHIP_SECRET_PREFIX = "teamship:enc:v1";

type TeamshipCredentialRecord = {
  id: string;
  provider: IntegrationProvider;
  name: string;
  status: IntegrationStatus;
  publicConfig: unknown;
  secretRef: string | null;
};

export type TeamshipSettings = {
  email: string | null;
  apiBaseUrl: string | null;
  status: IntegrationStatus;
  passwordConfigured: boolean;
  syncEnabled: boolean;
  syncCadenceMinutes: number;
  garlandInventoryUserId: string | null;
  garlandInventoryLocationId: string | null;
  readOnlySearchEnabled: boolean;
  readOnlyScopes: TeamshipReadScope[];
  updatedAt: string | null;
};

export type TeamshipReadScope = {
  customerId: string;
  customerName: string;
  warehouseId: string;
  warehouseName: string;
  inventoryUserId: string;
  inventoryLocationId: string;
};

export type TeamshipStoredCredentials = {
  email: string;
  password: string;
  apiBaseUrl: string | null;
};

export { TEAMSHIP_CREDENTIAL_NAME };

export function parseTeamshipSettings(credential?: TeamshipCredentialRecord | null): TeamshipSettings {
  const config =
    credential?.publicConfig && typeof credential.publicConfig === "object"
      ? (credential.publicConfig as Record<string, unknown>)
      : {};

  return {
    email: typeof config.email === "string" && config.email.trim() ? config.email.trim() : null,
    apiBaseUrl: typeof config.apiBaseUrl === "string" && config.apiBaseUrl.trim() ? config.apiBaseUrl.trim() : null,
    status: credential?.status ?? IntegrationStatus.DISABLED,
    passwordConfigured: Boolean(credential?.secretRef),
    syncEnabled: config.syncEnabled === true,
    syncCadenceMinutes: readSyncCadenceMinutes(config.syncCadenceMinutes),
    garlandInventoryUserId: readOptionalConfigString(config.garlandInventoryUserId),
    garlandInventoryLocationId: readOptionalConfigString(config.garlandInventoryLocationId),
    readOnlySearchEnabled: config.readOnlySearchEnabled === true,
    readOnlyScopes: parseTeamshipReadScopes(config.readOnlyScopes),
    updatedAt:
      typeof config.updatedAt === "string" && config.updatedAt.trim().length > 0 ? config.updatedAt.trim() : null
  };
}

export function parseTeamshipReadScopeUpload(value: unknown): TeamshipReadScope[] {
  const candidates = Array.isArray(value)
    ? value
    : value && typeof value === "object" && Array.isArray((value as Record<string, unknown>).readOnlyScopes)
      ? (value as Record<string, unknown>).readOnlyScopes as unknown[]
      : null;

  if (!candidates || candidates.length === 0) {
    throw new Error("The Teamship scope file must contain a non-empty readOnlyScopes array.");
  }
  if (candidates.length > 500) {
    throw new Error("The Teamship scope file cannot contain more than 500 entries.");
  }

  const seen = new Set<string>();
  return candidates.map((candidate, index) => {
    if (!candidate || typeof candidate !== "object") {
      throw new Error(`Teamship scope entry ${index + 1} must be an object.`);
    }

    const record = candidate as Record<string, unknown>;
    const scope = {
      customerId: requireScopeUploadString(record.customerId, "customerId", index),
      customerName: requireScopeUploadString(record.customerName, "customerName", index),
      warehouseId: requireScopeUploadString(record.warehouseId, "warehouseId", index),
      warehouseName: requireScopeUploadString(record.warehouseName, "warehouseName", index),
      inventoryUserId: requireScopeUploadString(record.inventoryUserId, "inventoryUserId", index),
      inventoryLocationId: requireScopeUploadString(record.inventoryLocationId, "inventoryLocationId", index)
    };
    const key = `${scope.customerId}::${scope.warehouseId}`;
    if (seen.has(key)) {
      throw new Error(`Teamship scope entry ${index + 1} duplicates customer ${scope.customerId} and warehouse ${scope.warehouseId}.`);
    }
    seen.add(key);
    return scope;
  });
}

export async function getTeamshipSyncEnabledCredentials() {
  const credentials = await prisma.integrationCredential.findMany({
    where: {
      provider: IntegrationProvider.TEAMSHIP,
      name: TEAMSHIP_CREDENTIAL_NAME,
      status: IntegrationStatus.ACTIVE
    },
    select: {
      tenantId: true,
      publicConfig: true,
      secretRef: true
    }
  });

  return credentials
    .map((credential) => ({
      tenantId: credential.tenantId,
      settings: parseTeamshipSettings({
        id: "",
        provider: IntegrationProvider.TEAMSHIP,
        name: TEAMSHIP_CREDENTIAL_NAME,
        status: IntegrationStatus.ACTIVE,
        publicConfig: credential.publicConfig,
        secretRef: credential.secretRef
      })
    }))
    .filter((credential) => credential.settings.syncEnabled && credential.settings.passwordConfigured && credential.settings.email);
}

export async function getTenantTeamshipSettings(tenant: Pick<TenantContext, "tenantId">) {
  const credential = await prisma.integrationCredential.findFirst({
    where: tenantWhere(tenant, {
      provider: IntegrationProvider.TEAMSHIP,
      name: TEAMSHIP_CREDENTIAL_NAME
    })
  });

  return parseTeamshipSettings(credential as TeamshipCredentialRecord | null);
}

export async function resolveTenantTeamshipCredentials(
  tenant: Pick<TenantContext, "tenantId"> | null | undefined
): Promise<TeamshipStoredCredentials | null> {
  if (!tenant?.tenantId) {
    return null;
  }

  const credential = await prisma.integrationCredential.findFirst({
    where: tenantWhere(tenant, {
      provider: IntegrationProvider.TEAMSHIP,
      name: TEAMSHIP_CREDENTIAL_NAME,
      status: IntegrationStatus.ACTIVE
    })
  });

  if (!credential?.secretRef) {
    return null;
  }

  const settings = parseTeamshipSettings(credential as TeamshipCredentialRecord);
  const secret = decryptTeamshipSecret(credential.secretRef);
  const password = typeof secret.password === "string" ? secret.password.trim() : "";

  if (!settings.email || !password) {
    return null;
  }

  return {
    email: settings.email,
    password,
    apiBaseUrl: settings.apiBaseUrl
  };
}

export function buildTeamshipCredentialRecord({
  email,
  apiBaseUrl,
  password
}: {
  email: string;
  apiBaseUrl?: string | null;
  password: string;
}) {
  return {
    provider: IntegrationProvider.TEAMSHIP,
    name: TEAMSHIP_CREDENTIAL_NAME,
    status: IntegrationStatus.ACTIVE,
    publicConfig: {
      email,
      apiBaseUrl: apiBaseUrl?.trim() || null,
      syncEnabled: false,
      syncCadenceMinutes: 15,
      garlandInventoryUserId: null,
      garlandInventoryLocationId: null,
      readOnlySearchEnabled: false,
      readOnlyScopes: [],
      updatedAt: new Date().toISOString()
    },
    secretRef: encryptTeamshipSecret({ password })
  };
}

export function encryptTeamshipSecret(payload: Record<string, string>) {
  const key = createHash("sha256").update(getTeamshipEncryptionSecret()).digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `${TEAMSHIP_SECRET_PREFIX}:${iv.toString("base64url")}:${tag.toString("base64url")}:${encrypted.toString("base64url")}`;
}

function decryptTeamshipSecret(secretRef: string) {
  const parts = secretRef.split(":");
  if (parts.length !== 6) {
    throw new Error("Teamship secretRef is not in the expected encrypted format.");
  }

  const [prefixA, prefixB, prefixC, ivValue, tagValue, encryptedValue] = parts;
  if (`${prefixA}:${prefixB}:${prefixC}` !== TEAMSHIP_SECRET_PREFIX) {
    throw new Error("Teamship secretRef is not in the expected encrypted format.");
  }

  const key = createHash("sha256").update(getTeamshipEncryptionSecret()).digest();
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivValue, "base64url"));
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedValue, "base64url")),
    decipher.final()
  ]);

  return JSON.parse(decrypted.toString("utf8")) as Record<string, string>;
}

function getTeamshipEncryptionSecret() {
  const value = process.env.AUTH_SECRET?.trim();
  if (!value) {
    throw new Error("AUTH_SECRET is required to encrypt Teamship credentials.");
  }

  return value;
}

function readSyncCadenceMinutes(value: unknown) {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : 15;
  return [15, 30, 60, 120].includes(parsed) ? parsed : 15;
}

function readOptionalConfigString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function requireScopeUploadString(value: unknown, field: string, index: number) {
  const normalized = readOptionalConfigString(value);
  if (!normalized || normalized.length > 200 || /[\u0000-\u001f\u007f]/.test(normalized)) {
    throw new Error(`Teamship scope entry ${index + 1} has an invalid ${field}.`);
  }
  return normalized;
}

function parseTeamshipReadScopes(value: unknown): TeamshipReadScope[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object") {
      return [];
    }

    const record = candidate as Record<string, unknown>;
    const customerId = readOptionalConfigString(record.customerId);
    const customerName = readOptionalConfigString(record.customerName);
    const warehouseId = readOptionalConfigString(record.warehouseId);
    const warehouseName = readOptionalConfigString(record.warehouseName);
    const inventoryUserId = readOptionalConfigString(record.inventoryUserId);
    const inventoryLocationId = readOptionalConfigString(record.inventoryLocationId);
    if (
      !customerId ||
      !customerName ||
      !warehouseId ||
      !warehouseName ||
      !inventoryUserId ||
      !inventoryLocationId
    ) {
      return [];
    }

    return [{
      customerId,
      customerName,
      warehouseId,
      warehouseName,
      inventoryUserId,
      inventoryLocationId
    }];
  });
}
