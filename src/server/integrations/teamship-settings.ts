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
  updatedAt: string | null;
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
    updatedAt:
      typeof config.updatedAt === "string" && config.updatedAt.trim().length > 0 ? config.updatedAt.trim() : null
  };
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
