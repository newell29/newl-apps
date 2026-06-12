import { PlatformRole } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock Auth.js session resolution and the Prisma client so this test is
// hermetic (no DB, no next-auth runtime). The point is to prove that
// getAuthenticatedContext re-derives tenant + role from the database every
// call and never trusts values carried on the session object.
const authMock = vi.fn();
const userFindFirst = vi.fn();

vi.mock("@/server/auth", () => ({
  auth: () => authMock()
}));

vi.mock("@/server/db", () => ({
  prisma: {
    user: {
      findFirst: (...args: unknown[]) => userFindFirst(...args)
    }
  }
}));

import { UnauthenticatedError, getAuthenticatedContext } from "@/server/tenant-context";

function dbUser(role: PlatformRole) {
  return {
    id: "db-user-1",
    email: "real@example.com",
    name: "Real User",
    memberships: [
      {
        role,
        tenant: { id: "tenant-db", slug: "tenant-db-slug", name: "DB Tenant" }
      }
    ]
  };
}

describe("getAuthenticatedContext", () => {
  beforeEach(() => {
    authMock.mockReset();
    userFindFirst.mockReset();
  });

  it("throws UnauthenticatedError when there is no session", async () => {
    authMock.mockResolvedValue(null);
    await expect(getAuthenticatedContext()).rejects.toBeInstanceOf(UnauthenticatedError);
    expect(userFindFirst).not.toHaveBeenCalled();
  });

  it("looks the user up by session user id and resolves role/tenant from the DB", async () => {
    authMock.mockResolvedValue({ user: { id: "session-user-id" } });
    userFindFirst.mockResolvedValue(dbUser(PlatformRole.SALES));

    const ctx = await getAuthenticatedContext();

    const arg = userFindFirst.mock.calls[0][0] as { where: Record<string, unknown> };
    expect(arg.where).toEqual({ id: "session-user-id" });
    expect(ctx.role).toBe(PlatformRole.SALES);
    expect(ctx.tenantId).toBe("tenant-db");
    expect(ctx.userId).toBe("db-user-1");
  });

  it("IGNORES role/tenant tampered onto the session and uses DB values (anti-privilege-escalation)", async () => {
    authMock.mockResolvedValue({
      user: {
        id: "session-user-id",
        // Attacker-tampered claims that must NOT be trusted:
        role: PlatformRole.ADMIN,
        tenantId: "tenant-attacker"
      }
    });
    userFindFirst.mockResolvedValue(dbUser(PlatformRole.READ_ONLY));

    const ctx = await getAuthenticatedContext();

    expect(ctx.role).toBe(PlatformRole.READ_ONLY);
    expect(ctx.tenantId).toBe("tenant-db");
    expect(ctx.tenantId).not.toBe("tenant-attacker");
  });

  it("falls back to email lookup when the session has no id", async () => {
    authMock.mockResolvedValue({ user: { email: "real@example.com" } });
    userFindFirst.mockResolvedValue(dbUser(PlatformRole.MANAGER));

    await getAuthenticatedContext();

    const arg = userFindFirst.mock.calls[0][0] as { where: Record<string, unknown> };
    expect(arg.where).toEqual({ email: "real@example.com" });
  });

  it("throws when the authenticated user no longer exists in the DB", async () => {
    authMock.mockResolvedValue({ user: { id: "ghost" } });
    userFindFirst.mockResolvedValue(null);
    await expect(getAuthenticatedContext()).rejects.toBeInstanceOf(UnauthenticatedError);
  });

  it("throws when the user has no tenant membership", async () => {
    authMock.mockResolvedValue({ user: { id: "db-user-1" } });
    userFindFirst.mockResolvedValue({
      id: "db-user-1",
      email: "real@example.com",
      name: "Real User",
      memberships: []
    });
    await expect(getAuthenticatedContext()).rejects.toBeInstanceOf(UnauthenticatedError);
  });
});
