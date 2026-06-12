import { ModuleKey, PlatformRole } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthenticatedContext } from "@/server/tenant-context";

// requireModule reads tenant entitlements from the DB, so mock the client.
const findFirst = vi.fn();
vi.mock("@/server/db", () => ({
  prisma: {
    tenantModuleAccess: {
      findFirst: (...args: unknown[]) => findFirst(...args)
    }
  }
}));

import {
  AuthorizationError,
  ROLE_MATRIX,
  accessibleModuleKeys,
  requireAdmin,
  requireModule,
  requireMutationAccess,
  requireRole,
  roleCanMutate,
  roleHasModuleAccess
} from "@/server/auth/authorization";

function ctx(role: PlatformRole, tenantId = "tenant-a"): AuthenticatedContext {
  return {
    userId: "user-1",
    userEmail: "user@example.com",
    userName: "User",
    role,
    tenantId,
    tenantSlug: "tenant-a-slug",
    tenantName: "Tenant A"
  };
}

describe("ROLE_MATRIX", () => {
  it("defines a policy for every PlatformRole", () => {
    for (const role of Object.values(PlatformRole)) {
      expect(ROLE_MATRIX[role]).toBeDefined();
    }
  });

  it("grants ADMIN and MANAGER all modules + mutation", () => {
    expect(ROLE_MATRIX[PlatformRole.ADMIN]).toEqual({ modules: "ALL", canMutate: true });
    expect(ROLE_MATRIX[PlatformRole.MANAGER]).toEqual({ modules: "ALL", canMutate: true });
  });

  it("limits SALES to LEAD_GEN with mutation", () => {
    expect(roleHasModuleAccess(PlatformRole.SALES, ModuleKey.LEAD_GEN)).toBe(true);
    expect(roleHasModuleAccess(PlatformRole.SALES, ModuleKey.INVOICE_VERIFICATION)).toBe(false);
    expect(roleCanMutate(PlatformRole.SALES)).toBe(true);
  });

  it("limits FINANCE to finance modules only (no LEAD_GEN)", () => {
    expect(roleHasModuleAccess(PlatformRole.FINANCE, ModuleKey.INVOICE_VERIFICATION)).toBe(true);
    expect(roleHasModuleAccess(PlatformRole.FINANCE, ModuleKey.QUICKBOOKS_POSTING)).toBe(true);
    expect(roleHasModuleAccess(PlatformRole.FINANCE, ModuleKey.LEAD_GEN)).toBe(false);
  });

  it("gives OPERATIONS lead-gen + operational modules", () => {
    expect(roleHasModuleAccess(PlatformRole.OPERATIONS, ModuleKey.LEAD_GEN)).toBe(true);
    expect(roleHasModuleAccess(PlatformRole.OPERATIONS, ModuleKey.UPS_TOOLS)).toBe(true);
    expect(roleHasModuleAccess(PlatformRole.OPERATIONS, ModuleKey.TRANSIT_LOOKUP)).toBe(true);
    expect(roleHasModuleAccess(PlatformRole.OPERATIONS, ModuleKey.QUICKBOOKS_POSTING)).toBe(false);
  });

  it("lets READ_ONLY view all modules but never mutate", () => {
    expect(roleHasModuleAccess(PlatformRole.READ_ONLY, ModuleKey.LEAD_GEN)).toBe(true);
    expect(roleHasModuleAccess(PlatformRole.READ_ONLY, ModuleKey.QUICKBOOKS_POSTING)).toBe(true);
    expect(roleCanMutate(PlatformRole.READ_ONLY)).toBe(false);
  });

  it("accessibleModuleKeys returns a defensive copy of all keys for ALL roles", () => {
    const keys = accessibleModuleKeys(PlatformRole.ADMIN);
    expect(new Set(keys)).toEqual(new Set(Object.values(ModuleKey)));
    keys.pop();
    // Mutating the returned array must not corrupt the matrix.
    expect(accessibleModuleKeys(PlatformRole.ADMIN).length).toBe(Object.values(ModuleKey).length);
  });
});

describe("requireRole / requireAdmin", () => {
  it("passes when the role is allowed", () => {
    expect(() => requireRole(ctx(PlatformRole.SALES), [PlatformRole.SALES])).not.toThrow();
  });

  it("throws AuthorizationError (403) when the role is not allowed", () => {
    try {
      requireRole(ctx(PlatformRole.READ_ONLY), [PlatformRole.ADMIN]);
      throw new Error("expected to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(AuthorizationError);
      expect((error as AuthorizationError).status).toBe(403);
    }
  });

  it("requireAdmin only allows ADMIN", () => {
    expect(() => requireAdmin(ctx(PlatformRole.ADMIN))).not.toThrow();
    expect(() => requireAdmin(ctx(PlatformRole.MANAGER))).toThrow(AuthorizationError);
  });
});

describe("requireMutationAccess", () => {
  it("blocks READ_ONLY", () => {
    expect(() => requireMutationAccess(ctx(PlatformRole.READ_ONLY))).toThrow(AuthorizationError);
  });

  it("allows every non-READ_ONLY role", () => {
    for (const role of Object.values(PlatformRole)) {
      if (role === PlatformRole.READ_ONLY) continue;
      expect(() => requireMutationAccess(ctx(role))).not.toThrow();
    }
  });
});

describe("requireModule", () => {
  beforeEach(() => {
    findFirst.mockReset();
  });

  it("rejects before any DB lookup when the role lacks module access", async () => {
    await expect(requireModule(ctx(PlatformRole.FINANCE), ModuleKey.LEAD_GEN)).rejects.toBeInstanceOf(
      AuthorizationError
    );
    expect(findFirst).not.toHaveBeenCalled();
  });

  it("scopes the entitlement lookup to the caller's tenant and requires enabled=true", async () => {
    findFirst.mockResolvedValue({ id: "tma-1" });
    await expect(requireModule(ctx(PlatformRole.SALES, "tenant-xyz"), ModuleKey.LEAD_GEN)).resolves.toBeUndefined();

    expect(findFirst).toHaveBeenCalledTimes(1);
    const arg = findFirst.mock.calls[0][0] as { where: Record<string, unknown> };
    expect(arg.where.tenantId).toBe("tenant-xyz");
    expect(arg.where.enabled).toBe(true);
    expect(arg.where.module).toEqual({ key: ModuleKey.LEAD_GEN });
  });

  it("throws when the module is not enabled for the tenant", async () => {
    findFirst.mockResolvedValue(null);
    await expect(requireModule(ctx(PlatformRole.SALES), ModuleKey.LEAD_GEN)).rejects.toBeInstanceOf(
      AuthorizationError
    );
  });
});
