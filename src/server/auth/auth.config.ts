import type { NextAuthConfig } from "next-auth";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";

import { getSessionMaxAgeSeconds, isMicrosoftEntraConfigured, readUsableEnv } from "@/server/auth/constants";

// Resolve the Entra issuer either from an explicit issuer URL or a tenant id.
// Real values are never committed; see .env.example for placeholders.
function resolveEntraIssuer(): string | undefined {
  const explicitIssuer = readUsableEnv("AUTH_MICROSOFT_ENTRA_ID_ISSUER");
  if (explicitIssuer) {
    return explicitIssuer;
  }

  const tenantId = readUsableEnv("AZURE_AD_TENANT_ID");
  if (tenantId) {
    return `https://login.microsoftonline.com/${tenantId}/v2.0`;
  }

  return undefined;
}

/**
 * Base Auth.js configuration shared by the full server instance.
 *
 * Production login is Microsoft Entra ID SSO with admin-provisioned accounts:
 * users are matched by email to an existing User + Membership. We use database
 * sessions (~30 day max age) backed by the Prisma adapter (wired up in
 * `src/server/auth/index.ts`). The dev-only local credentials path is handled
 * outside Auth.js (see `src/app/api/auth/dev-login/route.ts`) so that it does
 * not force the JWT session strategy that the Credentials provider requires.
 */
export const authConfig = {
  // Trust the host header for self-hosted/internal deployments. AUTH_URL can
  // also be set explicitly via env for stricter setups.
  trustHost: true,
  session: {
    strategy: "database",
    maxAge: getSessionMaxAgeSeconds()
  },
  pages: {
    signIn: "/login"
  },
  providers: [
    ...(isMicrosoftEntraConfigured()
      ? [
          MicrosoftEntraID({
            clientId: readUsableEnv("AUTH_MICROSOFT_ENTRA_ID_ID", "AZURE_AD_CLIENT_ID"),
            clientSecret: readUsableEnv("AUTH_MICROSOFT_ENTRA_ID_SECRET", "AZURE_AD_CLIENT_SECRET"),
            issuer: resolveEntraIssuer(),
            // Accounts are admin-provisioned: a User row already exists for the
            // employee. We trust Entra's verified email and link the new SSO Account
            // to the existing User by email instead of failing with
            // OAuthAccountNotLinked.
            allowDangerousEmailAccountLinking: true
          })
        ]
      : [])
  ]
} satisfies NextAuthConfig;
