import NextAuth from "next-auth";
import { PrismaAdapter } from "@auth/prisma-adapter";

import { prisma } from "@/server/db";
import { authConfig } from "@/server/auth/auth.config";

/**
 * Full Auth.js server instance. This runs in the Node.js runtime (server
 * components, route handlers, server actions) because it depends on the Prisma
 * adapter. Middleware must NOT import this module; it uses a lightweight cookie
 * check instead (see `src/middleware.ts`).
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  ...authConfig,
  callbacks: {
    /**
     * Enforce admin-provisioned access. Even though the SSO email is verified
     * by Entra, a user may only sign in if they already have a Membership in a
     * tenant. This prevents self-signup: unknown emails are rejected before any
     * session is established.
     */
    async signIn({ user, profile }) {
      const email = normalizeAuthEmail(user?.email ?? readProfileEmail(profile));
      if (!email) {
        return false;
      }

      const provisionedUser = await prisma.user.findFirst({
        where: {
          email: {
            equals: email,
            mode: "insensitive"
          }
        },
        select: {
          id: true,
          memberships: {
            select: {
              id: true
            },
            take: 1
          }
        }
      });

      if (!provisionedUser || provisionedUser.memberships.length === 0) {
        console.warn(`[auth] Rejected sign-in for ${email}: no tenant membership provisioned.`);
        return false;
      }

      return true;
    },
    /**
     * Surface the database user id on the session so downstream resolution can
     * look up membership. Tenant/role are intentionally NOT cached on the
     * session; they are validated on every request in getAuthenticatedContext.
     */
    async session({ session, user }) {
      if (session.user) {
        session.user.id = user.id;
      }
      return session;
    }
  }
});

function normalizeAuthEmail(value: string | null | undefined) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

function readProfileEmail(profile: unknown) {
  if (!profile || typeof profile !== "object") {
    return null;
  }

  const candidate = profile as Record<string, unknown>;
  const directEmail = candidate.email;
  if (typeof directEmail === "string") {
    return directEmail;
  }

  const preferredUsername = candidate.preferred_username;
  return typeof preferredUsername === "string" ? preferredUsername : null;
}
