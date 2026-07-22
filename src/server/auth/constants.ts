// Shared auth constants used across the Auth.js config, the dev-only login
// route, and middleware. Keeping these in one edge-safe module (no Prisma, no
// Node-only imports) means middleware can import them without pulling in the
// database client.

const THIRTY_DAYS_SECONDS = 60 * 60 * 24 * 30;
export const DEFAULT_LOCAL_ADMIN_EMAIL = "admin@example.com";
const DEFAULT_LOCAL_ADMIN_PASSWORD = "newl-dev-password";

/**
 * Database session lifetime in seconds. Configurable via SESSION_MAX_AGE_DAYS,
 * defaulting to ~30 days per the auth plan.
 */
export function getSessionMaxAgeSeconds(): number {
  const days = Number(process.env.SESSION_MAX_AGE_DAYS);

  if (Number.isFinite(days) && days > 0) {
    return Math.floor(days * 24 * 60 * 60);
  }

  return THIRTY_DAYS_SECONDS;
}

/**
 * Auth.js v5 cookie names for the database session token. The `__Secure-`
 * prefixed variant is used when the app is served over HTTPS.
 */
export const SESSION_COOKIE_NAME = "authjs.session-token";
export const SECURE_SESSION_COOKIE_NAME = "__Secure-authjs.session-token";

/**
 * True only when the dev-only local login path is explicitly enabled. This is
 * impossible to enable in production: NODE_ENV must not be "production".
 */
export function isDevLoginEnabled(): boolean {
  return process.env.NODE_ENV !== "production" && process.env.AUTH_DEV_BYPASS === "true";
}

/**
 * Temporary password login for deployed/internal testing while Microsoft Entra
 * is being configured. This is intentionally separate from AUTH_DEV_BYPASS so
 * production can never accidentally inherit the local-dev bypass.
 */
export function isTemporaryPasswordLoginEnabled(): boolean {
  return process.env.NODE_ENV !== "production" && process.env.AUTH_TEMP_PASSWORD_LOGIN === "true";
}

export function isPasswordLoginEnabled(): boolean {
  return isDevLoginEnabled() || isTemporaryPasswordLoginEnabled();
}

export function getTemporaryPasswordLoginEmail(): string {
  return readOptionalEnv("AUTH_TEMP_PASSWORD_EMAIL")?.toLowerCase() ?? DEFAULT_LOCAL_ADMIN_EMAIL;
}

export function getTemporaryPasswordLoginPassword(): string {
  return readOptionalEnv("SEED_ADMIN_PASSWORD") ?? DEFAULT_LOCAL_ADMIN_PASSWORD;
}

function readOptionalEnv(key: string): string | undefined {
  const value = process.env[key]?.trim();
  if (!value || value === "undefined") {
    return undefined;
  }
  return value;
}
