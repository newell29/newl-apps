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
    async signIn({ user }) {
      const email = user?.email;
      if (!email) {
        return false;
      }

      const membershipCount = await prisma.membership.count({
        where: {
          user: {
            email
          }
        }
      });

      if (membershipCount === 0) {
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
