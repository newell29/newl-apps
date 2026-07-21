import NextAuth from "next-auth";
import { PrismaAdapter } from "@auth/prisma-adapter";

import { prisma } from "@/server/db";
import { authConfig } from "@/server/auth/auth.config";
import {
  ensureMicrosoftEntraIdentityLink,
  type MicrosoftEntraIdentity
} from "@/server/auth/microsoft-entra-identity";

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
    async signIn({ user, profile, account }) {
      const email = normalizeAuthEmail(user?.email ?? readProfileEmail(profile));
      logAuthIdentity({
        email,
        user,
        profile,
        provider: account?.provider ?? null,
        providerAccountId: account?.providerAccountId ?? null
      });

      if (!email) {
        console.warn("[auth] Rejected sign-in: no usable email/UPN claim was returned by the identity provider.");
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
          microsoftEntraTenantId: true,
          microsoftEntraObjectId: true,
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

      const identityResult = await ensureMicrosoftEntraIdentityLink({
        provider: account?.provider ?? null,
        profile,
        user: provisionedUser,
        store: {
          findByIdentity: (identity) => findUserByMicrosoftEntraIdentity(identity),
          linkIdentity: (userId, identity) => linkUserMicrosoftEntraIdentity(userId, identity)
        }
      });
      if (identityResult === "conflict") {
        console.warn(`[auth] Rejected sign-in for ${email}: Microsoft Entra identity conflicts with the provisioned user.`);
        return false;
      }
      if (identityResult === "missing-claims") {
        console.warn(`[auth] Microsoft sign-in for ${email} did not include stable tid/oid claims; Teams identity is not linked.`);
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

async function findUserByMicrosoftEntraIdentity(identity: MicrosoftEntraIdentity) {
  return prisma.user.findFirst({
    where: {
      microsoftEntraTenantId: identity.tenantId,
      microsoftEntraObjectId: identity.objectId
    },
    select: { id: true }
  });
}

async function linkUserMicrosoftEntraIdentity(userId: string, identity: MicrosoftEntraIdentity) {
  await prisma.user.update({
    where: { id: userId },
    data: {
      microsoftEntraTenantId: identity.tenantId,
      microsoftEntraObjectId: identity.objectId
    }
  });
}

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
  if (typeof preferredUsername === "string") {
    return preferredUsername;
  }

  const upn = candidate.upn;
  if (typeof upn === "string") {
    return upn;
  }

  const uniqueName = candidate.unique_name;
  return typeof uniqueName === "string" ? uniqueName : null;
}

function logAuthIdentity({
  email,
  user,
  profile,
  provider,
  providerAccountId
}: {
  email: string | null;
  user: { email?: string | null; name?: string | null } | undefined;
  profile: unknown;
  provider: string | null;
  providerAccountId: string | null;
}) {
  const profileRecord = profile && typeof profile === "object" ? (profile as Record<string, unknown>) : null;
  const sampledClaims = profileRecord
    ? {
        email: typeof profileRecord.email === "string" ? profileRecord.email : null,
        preferred_username:
          typeof profileRecord.preferred_username === "string" ? profileRecord.preferred_username : null,
        upn: typeof profileRecord.upn === "string" ? profileRecord.upn : null,
        unique_name: typeof profileRecord.unique_name === "string" ? profileRecord.unique_name : null,
        tid: typeof profileRecord.tid === "string" ? profileRecord.tid : null
      }
    : null;

  console.warn(
    `[auth] Microsoft sign-in attempt: ${JSON.stringify({
      resolvedEmail: email,
      userEmail: user?.email ?? null,
      userName: user?.name ?? null,
      provider,
      providerAccountId,
      sampledClaims
    })}`
  );
}
