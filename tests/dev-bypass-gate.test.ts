import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  getTemporaryPasswordLoginEmail,
  getTemporaryPasswordLoginPassword,
  getSessionMaxAgeSeconds,
  isDevLoginEnabled,
  isPasswordLoginEnabled,
  isTemporaryPasswordLoginEnabled
} from "@/server/auth/constants";

const originalNodeEnv = process.env.NODE_ENV;
const originalBypass = process.env.AUTH_DEV_BYPASS;
const originalTemporaryPasswordLogin = process.env.AUTH_TEMP_PASSWORD_LOGIN;
const originalTemporaryPasswordEmail = process.env.AUTH_TEMP_PASSWORD_EMAIL;
const originalSeedAdminPassword = process.env.SEED_ADMIN_PASSWORD;
const originalMaxAge = process.env.SESSION_MAX_AGE_DAYS;

function setNodeEnv(value: string | undefined) {
  // NODE_ENV is typed as readonly in some setups; assign through a cast.
  (process.env as Record<string, string | undefined>).NODE_ENV = value;
}

afterEach(() => {
  setNodeEnv(originalNodeEnv);
  process.env.AUTH_DEV_BYPASS = originalBypass;
  process.env.AUTH_TEMP_PASSWORD_LOGIN = originalTemporaryPasswordLogin;
  process.env.AUTH_TEMP_PASSWORD_EMAIL = originalTemporaryPasswordEmail;
  process.env.SEED_ADMIN_PASSWORD = originalSeedAdminPassword;
  process.env.SESSION_MAX_AGE_DAYS = originalMaxAge;
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
      process.env.AUTH_DEV_BYPASS = value as string | undefined;
      expect(isDevLoginEnabled()).toBe(false);
    }
  });
});

describe("temporary password login gate", () => {
  it("is disabled in production even when its explicit temporary env var is true", () => {
    setNodeEnv("production");
    process.env.AUTH_DEV_BYPASS = "true";
    process.env.AUTH_TEMP_PASSWORD_LOGIN = undefined;

    expect(isDevLoginEnabled()).toBe(false);
    expect(isTemporaryPasswordLoginEnabled()).toBe(false);
    expect(isPasswordLoginEnabled()).toBe(false);

    process.env.AUTH_TEMP_PASSWORD_LOGIN = "true";

    expect(isDevLoginEnabled()).toBe(false);
    expect(isTemporaryPasswordLoginEnabled()).toBe(false);
    expect(isPasswordLoginEnabled()).toBe(false);
  });

  it("can be enabled for local development through its explicit temporary env var", () => {
    setNodeEnv("development");
    process.env.AUTH_TEMP_PASSWORD_LOGIN = "true";

    expect(isTemporaryPasswordLoginEnabled()).toBe(true);
    expect(isPasswordLoginEnabled()).toBe(true);
  });

  it("does not treat truthy-looking values as enabling temporary password login", () => {
    for (const value of ["1", "TRUE", "yes", "false", undefined]) {
      process.env.AUTH_TEMP_PASSWORD_LOGIN = value as string | undefined;
      expect(isTemporaryPasswordLoginEnabled()).toBe(false);
    }
  });

  it("reads the temporary login email and password from the local auth env names", () => {
    process.env.AUTH_TEMP_PASSWORD_EMAIL = " Local.Admin@Example.Com ";
    process.env.SEED_ADMIN_PASSWORD = "configured-local-password";

    expect(getTemporaryPasswordLoginEmail()).toBe("local.admin@example.com");
    expect(getTemporaryPasswordLoginPassword()).toBe("configured-local-password");
  });

  it("falls back to the seeded local admin credentials when optional env names are omitted", () => {
    process.env.AUTH_TEMP_PASSWORD_EMAIL = undefined;
    process.env.SEED_ADMIN_PASSWORD = undefined;

    expect(getTemporaryPasswordLoginEmail()).toBe("admin@example.com");
    expect(getTemporaryPasswordLoginPassword()).toBe("newl-dev-password");
  });
});

describe("getSessionMaxAgeSeconds", () => {
  beforeEach(() => {
    process.env.SESSION_MAX_AGE_DAYS = undefined;
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
