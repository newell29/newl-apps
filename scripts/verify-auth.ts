/**
 * Live-DB verification for the auth + tenant-isolation work. Unlike the hermetic
 * Vitest suite, this script runs against a real (seeded) database to prove the
 * security-critical behaviors end-to-end at the service/DB layer:
 *
 *   1. Seeded users exist with the expected roles + bcrypt password hashes
 *      (the dev-login credential path).
 *   2. Cross-tenant query isolation: a tenant-scoped lookup cannot reach another
 *      tenant's row (the IDOR protection used by every lead-gen mutation).
 *   3. Module entitlement (requireModule) is tenant-scoped and role-gated.
 *   4. Role mutation gating (READ_ONLY blocked, SALES/ADMIN allowed).
 *
 * Run with:  npm run verify:auth        (requires DATABASE_URL + a seeded DB)
 *            SEED_ADMIN_PASSWORD=... npm run verify:auth   (to also check the hash)
 *
 * The script creates and then deletes a temporary second tenant; it makes no
 * other writes and never touches the seeded "newl-group" data.
 */
import { ModuleKey, PlatformRole } from "@prisma/client";

import { prisma } from "@/server/db";
import { AuthorizationError, requireModule, requireMutationAccess } from "@/server/auth/authorization";
import { verifyPassword } from "@/server/auth/password";
import type { AuthenticatedContext } from "@/server/tenant-context";

let passed = 0;
let failed = 0;

function check(name: string, condition: boolean, detail = "") {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failed += 1;
    console.error(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function expectThrow(name: string, fn: () => Promise<unknown>, expectAuthError = true) {
  try {
    await fn();
    check(name, false, "expected an error but none was thrown");
  } catch (error) {
    const ok = expectAuthError ? error instanceof AuthorizationError : true;
    check(name, ok, `threw ${error instanceof Error ? error.name : typeof error}`);
  }
}

function ctxFor(role: PlatformRole, tenantId: string): AuthenticatedContext {
  return {
    userId: "verify-script-user",
    userEmail: "verify@example.com",
    userName: "Verify Script",
    role,
    tenantId,
    tenantSlug: "verify",
    tenantName: "Verify"
  };
}

async function main() {
  console.log("\n=== Live-DB auth/tenant verification ===\n");

  const tenant = await prisma.tenant.findUnique({ where: { slug: "newl-group" } });
  check("seeded tenant 'newl-group' exists", Boolean(tenant));
  if (!tenant) {
    throw new Error("Seed the database first: SEED_ADMIN_PASSWORD=... npm run prisma:seed");
  }

  console.log("\n[1] Seeded users + roles + password hash");
  const expectedRoles: Record<string, PlatformRole> = {
    "admin@example.com": PlatformRole.ADMIN,
    "sales@example.com": PlatformRole.SALES,
    "readonly@example.com": PlatformRole.READ_ONLY
  };

  const seedPassword = process.env.SEED_ADMIN_PASSWORD;
  for (const [email, role] of Object.entries(expectedRoles)) {
    const user = await prisma.user.findUnique({
      where: { email },
      include: { memberships: { include: { tenant: true } } }
    });
    check(`${email} exists`, Boolean(user));
    if (!user) continue;
    const membership = user.memberships.find((m) => m.tenantId === tenant.id);
    check(`${email} has membership in newl-group`, Boolean(membership));
    check(`${email} role is ${role}`, membership?.role === role, `got ${membership?.role}`);
    check(`${email} has a stored bcrypt passwordHash`, Boolean(user.passwordHash));

    if (seedPassword && user.passwordHash) {
      const ok = await verifyPassword(seedPassword, user.passwordHash);
      check(`${email} password verifies against SEED_ADMIN_PASSWORD`, ok);
      const wrong = await verifyPassword(`${seedPassword}-WRONG`, user.passwordHash);
      check(`${email} rejects a wrong password`, wrong === false);
    } else {
      console.log(`  SKIP  password hash check for ${email} (SEED_ADMIN_PASSWORD not set)`);
    }
  }

  console.log("\n[2] Cross-tenant query isolation (IDOR)");
  // Create an isolated temporary tenant + company that the seeded tenant must
  // never be able to read or mutate via a tenant-scoped query.
  const otherTenant = await prisma.tenant.create({
    data: { name: "Verify Tenant B", slug: `verify-tenant-b-${Date.now()}` }
  });
  try {
    const foreignCompany = await prisma.company.create({
      data: {
        tenantId: otherTenant.id,
        name: "Foreign Co",
        normalizedName: `foreign-co-${Date.now()}`
      }
    });

    // This mirrors exactly what every lead-gen mutation does before writing:
    // findFirst scoped by { id, tenantId }. Scoped to the WRONG tenant -> null.
    const leaked = await prisma.company.findFirst({
      where: { id: foreignCompany.id, tenantId: tenant.id }
    });
    check("tenant A cannot read tenant B's company by id (scoped findFirst returns null)", leaked === null);

    // Scoped to the correct tenant -> found (sanity that the scope is real).
    const reachable = await prisma.company.findFirst({
      where: { id: foreignCompany.id, tenantId: otherTenant.id }
    });
    check("tenant B can read its own company when correctly scoped", reachable !== null);

    // A blanket findMany scoped to tenant A must not include tenant B's company.
    const tenantACompanies = await prisma.company.findMany({ where: { tenantId: tenant.id } });
    check(
      "tenant A company list excludes tenant B's company",
      tenantACompanies.every((c) => c.id !== foreignCompany.id)
    );

    console.log("\n[3] requireModule entitlement is tenant-scoped + role-gated");
    // newl-group has LEAD_GEN enabled (seed) and SALES may access it.
    await requireModule(ctxFor(PlatformRole.SALES, tenant.id), ModuleKey.LEAD_GEN);
    check("SALES in newl-group passes requireModule(LEAD_GEN)", true);

    // The temp tenant has NO module access rows -> entitlement check must fail
    // even for ADMIN (proves the check is tenant-scoped, not global).
    await expectThrow(
      "ADMIN in a tenant without LEAD_GEN entitlement is blocked",
      () => requireModule(ctxFor(PlatformRole.ADMIN, otherTenant.id), ModuleKey.LEAD_GEN)
    );

    // FINANCE lacks role access to LEAD_GEN regardless of entitlement.
    await expectThrow(
      "FINANCE is blocked from LEAD_GEN by role (no DB lookup needed)",
      () => requireModule(ctxFor(PlatformRole.FINANCE, tenant.id), ModuleKey.LEAD_GEN)
    );

    console.log("\n[4] Mutation gating by role");
    await expectThrow("READ_ONLY blocked from mutations", async () =>
      requireMutationAccess(ctxFor(PlatformRole.READ_ONLY, tenant.id))
    );
    requireMutationAccess(ctxFor(PlatformRole.SALES, tenant.id));
    check("SALES allowed to mutate", true);
    requireMutationAccess(ctxFor(PlatformRole.ADMIN, tenant.id));
    check("ADMIN allowed to mutate", true);
  } finally {
    // Cascade delete removes the temp tenant + its company.
    await prisma.tenant.delete({ where: { id: otherTenant.id } });
    console.log("\n  (cleaned up temporary verification tenant)");
  }

  console.log(`\n=== Result: ${passed} passed, ${failed} failed ===\n`);
  if (failed > 0) {
    process.exitCode = 1;
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
