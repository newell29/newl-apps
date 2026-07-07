// Shared auth constants used across the Auth.js config, the dev-only login
// route, and middleware. Keeping these in one edge-safe module (no Prisma, no
// Node-only imports) means middleware can import them without pulling in the
// database client.

const THIRTY_DAYS_SECONDS = 60 * 60 * 24 * 30;
const PLACEHOLDER_PATTERN = /PLACEHOLDER|CHANGE_ME|<.+>/i;

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

export function isMicrosoftEntraConfigured(): boolean {
  return Boolean(
    readUsableEnv("AUTH_MICROSOFT_ENTRA_ID_ID", "AZURE_AD_CLIENT_ID") &&
      readUsableEnv("AUTH_MICROSOFT_ENTRA_ID_SECRET", "AZURE_AD_CLIENT_SECRET") &&
      (readUsableEnv("AUTH_MICROSOFT_ENTRA_ID_ISSUER") || readUsableEnv("AZURE_AD_TENANT_ID"))
  );
}

export function isLocalPasswordLoginFallbackEnabled(): boolean {
  return process.env.NODE_ENV !== "production" && !isMicrosoftEntraConfigured();
}

/**
 * Temporary password login for deployed/internal testing while Microsoft Entra
 * is being configured. This is intentionally separate from AUTH_DEV_BYPASS so
 * production can never accidentally inherit the local-dev bypass.
 */
export function isTemporaryPasswordLoginEnabled(): boolean {
  return process.env.AUTH_TEMP_PASSWORD_LOGIN === "true";
}

export function isPasswordLoginEnabled(): boolean {
  return isDevLoginEnabled() || isLocalPasswordLoginFallbackEnabled() || isTemporaryPasswordLoginEnabled();
}

export function readUsableEnv(...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = process.env[key]?.trim();
    if (value && !PLACEHOLDER_PATTERN.test(value)) {
      return value;
    }
  }

  return undefined;
}
