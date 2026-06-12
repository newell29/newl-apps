import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getSessionMaxAgeSeconds, isDevLoginEnabled } from "@/server/auth/constants";

const originalNodeEnv = process.env.NODE_ENV;
const originalBypass = process.env.AUTH_DEV_BYPASS;
const originalMaxAge = process.env.SESSION_MAX_AGE_DAYS;

function setNodeEnv(value: string | undefined) {
  // NODE_ENV is typed as readonly in some setups; assign through a cast.
  (process.env as Record<string, string | undefined>).NODE_ENV = value;
}

afterEach(() => {
  setNodeEnv(originalNodeEnv);
  process.env.AUTH_DEV_BYPASS = originalBypass;
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
