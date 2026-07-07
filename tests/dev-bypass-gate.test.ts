import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  getSessionMaxAgeSeconds,
  isDevLoginEnabled,
  isLocalPasswordLoginFallbackEnabled,
  isMicrosoftEntraConfigured,
  isPasswordLoginEnabled,
  isTemporaryPasswordLoginEnabled
} from "@/server/auth/constants";

const originalNodeEnv = process.env.NODE_ENV;
const originalBypass = process.env.AUTH_DEV_BYPASS;
const originalTemporaryPasswordLogin = process.env.AUTH_TEMP_PASSWORD_LOGIN;
const originalMaxAge = process.env.SESSION_MAX_AGE_DAYS;
const originalAuthMicrosoftClientId = process.env.AUTH_MICROSOFT_ENTRA_ID_ID;
const originalAuthMicrosoftClientSecret = process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET;
const originalAuthMicrosoftIssuer = process.env.AUTH_MICROSOFT_ENTRA_ID_ISSUER;
const originalAzureClientId = process.env.AZURE_AD_CLIENT_ID;
const originalAzureClientSecret = process.env.AZURE_AD_CLIENT_SECRET;
const originalAzureTenantId = process.env.AZURE_AD_TENANT_ID;

function setNodeEnv(value: string | undefined) {
  // NODE_ENV is typed as readonly in some setups; assign through a cast.
  (process.env as Record<string, string | undefined>).NODE_ENV = value;
}

function setEnv(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key];
    return;
  }

  process.env[key] = value;
}

afterEach(() => {
  setNodeEnv(originalNodeEnv);
  setEnv("AUTH_DEV_BYPASS", originalBypass);
  setEnv("AUTH_TEMP_PASSWORD_LOGIN", originalTemporaryPasswordLogin);
  setEnv("SESSION_MAX_AGE_DAYS", originalMaxAge);
  setEnv("AUTH_MICROSOFT_ENTRA_ID_ID", originalAuthMicrosoftClientId);
  setEnv("AUTH_MICROSOFT_ENTRA_ID_SECRET", originalAuthMicrosoftClientSecret);
  setEnv("AUTH_MICROSOFT_ENTRA_ID_ISSUER", originalAuthMicrosoftIssuer);
  setEnv("AZURE_AD_CLIENT_ID", originalAzureClientId);
  setEnv("AZURE_AD_CLIENT_SECRET", originalAzureClientSecret);
  setEnv("AZURE_AD_TENANT_ID", originalAzureTenantId);
});

describe("isDevLoginEnabled (dev-bypass production gate)", () => {
  it("is DISABLED in production even when AUTH_DEV_BYPASS=true (the critical guarantee)", () => {
    setNodeEnv("production");
    process.env.AUTH_DEV_BYPASS = "true";
    expect(isDevLoginEnabled()).toBe(false);
  });

  it("is enabled only in non-production when AUTH_DEV_BYPASS=true", () => {
    setNodeEnv("development");
    process.env.AUTH_DEV_BYPASS = "true";
    expect(isDevLoginEnabled()).toBe(true);

    setNodeEnv("test");
    expect(isDevLoginEnabled()).toBe(true);
  });

  it("is disabled in dev when AUTH_DEV_BYPASS is unset or not exactly 'true'", () => {
    setNodeEnv("development");

    process.env.AUTH_DEV_BYPASS = undefined;
    expect(isDevLoginEnabled()).toBe(false);

    process.env.AUTH_DEV_BYPASS = "false";
    expect(isDevLoginEnabled()).toBe(false);

    // Only the exact string "true" should enable it (no truthy coercion).
    process.env.AUTH_DEV_BYPASS = "1";
    expect(isDevLoginEnabled()).toBe(false);

    process.env.AUTH_DEV_BYPASS = "TRUE";
    expect(isDevLoginEnabled()).toBe(false);
  });

  it("is disabled in production regardless of bypass value", () => {
    setNodeEnv("production");
    for (const value of ["true", "false", "1", undefined]) {
      setEnv("AUTH_DEV_BYPASS", value as string | undefined);
      expect(isDevLoginEnabled()).toBe(false);
    }
  });
});

describe("temporary password login gate", () => {
  it("can be enabled in production only through its explicit temporary env var", () => {
    setNodeEnv("production");
    process.env.AUTH_DEV_BYPASS = "true";
    process.env.AUTH_TEMP_PASSWORD_LOGIN = undefined;

    expect(isDevLoginEnabled()).toBe(false);
    expect(isTemporaryPasswordLoginEnabled()).toBe(false);
    expect(isPasswordLoginEnabled()).toBe(false);

    process.env.AUTH_TEMP_PASSWORD_LOGIN = "true";

    expect(isDevLoginEnabled()).toBe(false);
    expect(isTemporaryPasswordLoginEnabled()).toBe(true);
    expect(isPasswordLoginEnabled()).toBe(true);
  });

  it("does not treat truthy-looking values as enabling temporary password login", () => {
    for (const value of ["1", "TRUE", "yes", "false", undefined]) {
      setEnv("AUTH_TEMP_PASSWORD_LOGIN", value as string | undefined);
      expect(isTemporaryPasswordLoginEnabled()).toBe(false);
    }
  });
});

describe("local password fallback when Microsoft Entra is not configured", () => {
  beforeEach(() => {
    setEnv("AUTH_DEV_BYPASS", undefined);
    setEnv("AUTH_TEMP_PASSWORD_LOGIN", undefined);
    setEnv("AUTH_MICROSOFT_ENTRA_ID_ID", undefined);
    setEnv("AUTH_MICROSOFT_ENTRA_ID_SECRET", undefined);
    setEnv("AUTH_MICROSOFT_ENTRA_ID_ISSUER", undefined);
    setEnv("AZURE_AD_CLIENT_ID", undefined);
    setEnv("AZURE_AD_CLIENT_SECRET", undefined);
    setEnv("AZURE_AD_TENANT_ID", undefined);
  });

  it("enables password login in local development when Entra config is missing", () => {
    setNodeEnv("development");

    expect(isMicrosoftEntraConfigured()).toBe(false);
    expect(isLocalPasswordLoginFallbackEnabled()).toBe(true);
    expect(isPasswordLoginEnabled()).toBe(true);
  });

  it("does not enable the fallback in production", () => {
    setNodeEnv("production");

    expect(isMicrosoftEntraConfigured()).toBe(false);
    expect(isLocalPasswordLoginFallbackEnabled()).toBe(false);
    expect(isPasswordLoginEnabled()).toBe(false);
  });

  it("disables the fallback when a complete usable Entra config exists", () => {
    setNodeEnv("development");
    process.env.AUTH_MICROSOFT_ENTRA_ID_ID = "client-id";
    process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET = "client-secret";
    process.env.AUTH_MICROSOFT_ENTRA_ID_ISSUER = "https://login.microsoftonline.com/tenant/v2.0";

    expect(isMicrosoftEntraConfigured()).toBe(true);
    expect(isLocalPasswordLoginFallbackEnabled()).toBe(false);
    expect(isPasswordLoginEnabled()).toBe(false);
  });

  it("treats copied example placeholders as missing Entra config", () => {
    setNodeEnv("development");
    process.env.AUTH_MICROSOFT_ENTRA_ID_ID = "AZURE_AD_CLIENT_ID_PLACEHOLDER";
    process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET = "AZURE_AD_CLIENT_SECRET_PLACEHOLDER";
    process.env.AUTH_MICROSOFT_ENTRA_ID_ISSUER = "https://login.microsoftonline.com/AZURE_AD_TENANT_ID_PLACEHOLDER/v2.0";

    expect(isMicrosoftEntraConfigured()).toBe(false);
    expect(isLocalPasswordLoginFallbackEnabled()).toBe(true);
    expect(isPasswordLoginEnabled()).toBe(true);
  });
});

describe("getSessionMaxAgeSeconds", () => {
  beforeEach(() => {
    setEnv("SESSION_MAX_AGE_DAYS", undefined);
  });

  it("defaults to ~30 days", () => {
    expect(getSessionMaxAgeSeconds()).toBe(60 * 60 * 24 * 30);
  });

  it("honours a positive SESSION_MAX_AGE_DAYS override", () => {
    process.env.SESSION_MAX_AGE_DAYS = "7";
    expect(getSessionMaxAgeSeconds()).toBe(60 * 60 * 24 * 7);
  });

  it("falls back to the default for invalid/non-positive values", () => {
    for (const bad of ["0", "-5", "abc", ""]) {
      process.env.SESSION_MAX_AGE_DAYS = bad;
      expect(getSessionMaxAgeSeconds()).toBe(60 * 60 * 24 * 30);
    }
  });
});
