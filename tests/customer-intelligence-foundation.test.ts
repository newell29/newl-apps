import {
  CashflowLegalEntity,
  CustomerIdentityMatchKind,
  CustomerIdentityMatchStatus,
  CustomerLifecycle,
  CustomerSourceAccountStatus,
  PlatformRole,
  Prisma
} from "@prisma/client";
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaTest = vi.hoisted(() => {
  const modelCalls: Array<{ model: string; method: string; args: unknown[] }> = [];
  const modelTargets = new Map<string, Record<string, ReturnType<typeof vi.fn>>>();
  const getModel = (model: string) => {
    if (!modelTargets.has(model)) {
      modelTargets.set(model, {});
    }
    return modelTargets.get(model)!;
  };
  const makeModelProxy = (modelName: string) => {
    const model = getModel(modelName);
    return new Proxy(model, {
      get(_modelTarget, method) {
        if (typeof method !== "string") {
          return undefined;
        }
        if (!model[method]) {
          model[method] = vi.fn((...args: unknown[]) => {
            modelCalls.push({ model: modelName, method, args });
            return undefined;
          });
        }
        return model[method];
      }
    });
  };
  const proxy = new Proxy(
    {},
    {
      get(_target, prop) {
        if (typeof prop !== "string") {
          return undefined;
        }
        return makeModelProxy(prop);
      }
    }
  );
  return {
    proxy,
    modelTargets,
    modelCalls,
    model(modelName: string) {
      return makeModelProxy(modelName);
    },
    reset() {
      for (const model of modelTargets.values()) {
        for (const fn of Object.values(model)) {
          fn.mockReset();
        }
      }
      modelCalls.length = 0;
    }
  };
});

// Only Prisma is mocked. The authorization module is REAL, so requireModule /
// requireRole / requireMutationAccess actually run against the mocked DB and
// the tests prove the true permission boundary.
vi.mock("@/server/db", () => ({
  prisma: prismaTest.proxy
}));

import {
  proposeIdentityMatch,
  refreshRelationshipLifecycle,
  registerOperatingCompany,
  reviewIdentityMatch,
  upsertCompanyOperatingRelationship,
  upsertContactEvidence,
  upsertContactPoint,
  upsertFxRate,
  upsertSourceAccount
} from "@/modules/customer-intelligence/actions";
import {
  cashflowLegalEntityToOperatingCompanySlug,
  resolveOperatingCompanyForLegalEntity
} from "@/modules/customer-intelligence/cashflow-compatibility";
import {
  getCompanyIntelligenceSummary,
  getIdentityMatch,
  getOperatingCompany,
  getRelationship,
  getSourceAccount,
  listContactEvidence,
  listContactPoints,
  listFxRates,
  listIdentityMatches,
  listMonthlyFinancials,
  listOperatingCompanies,
  listRelationshipsForCompany,
  listRevenueLines,
  listServiceMappingRules,
  listSourceAccountsForCompany,
  listSourceAccountsForRelationship
} from "@/modules/customer-intelligence/queries";
import { AuthorizationError } from "@/server/auth/authorization";
import type { AuthenticatedContext } from "@/server/tenant-context";

function ctx(role: PlatformRole, tenantId = "tenant-a"): AuthenticatedContext {
  return {
    userId: "user-1",
    userEmail: "user@example.com",
    userName: "User",
    role,
    tenantId,
    tenantSlug: `${tenantId}-slug`,
    tenantName: `Tenant ${tenantId}`
  };
}

const ADMIN = ctx(PlatformRole.ADMIN);
const SALES = ctx(PlatformRole.SALES);
const OPERATIONS = ctx(PlatformRole.OPERATIONS);
const FINANCE = ctx(PlatformRole.FINANCE);
const READ_ONLY = ctx(PlatformRole.READ_ONLY);

const RELATIONSHIP = {
  id: "rel-1",
  tenantId: "tenant-a",
  companyId: "company-1",
  operatingCompanyId: "oc-ww",
  lifecycle: CustomerLifecycle.PROSPECT,
  status: "ACTIVE"
};

/** Configure the real authorization module's DB inputs for the caller's tenant. */
function configureAuth(input: { canMutate?: boolean; moduleEnabled?: boolean } = {}) {
  prismaTest.model("tenantRoleModuleAccess").findMany.mockResolvedValue([]);
  prismaTest.model("tenantModuleAccess").findFirst.mockResolvedValue(
    input.moduleEnabled === false ? null : { id: "tma-customer-intelligence" }
  );
  prismaTest.model("tenantRolePolicy").findUnique.mockResolvedValue({
    canMutate: input.canMutate ?? true
  });
}

describe("entitlement bootstrap is deployable without the development seed", () => {
  beforeEach(() => {
    prismaTest.reset();
  });

  it("bootstraps the module, the Newl entitlement, and the operating companies in the corrections migration", () => {
    const migration = readFileSync(
      "prisma/migrations/20260805150000_customer_intelligence_corrections/migration.sql",
      "utf8"
    );
    expect(migration).toContain("'module_customer_intelligence'");
    expect(migration).toContain("'CUSTOMER_INTELLIGENCE'");
    expect(migration).toContain("TenantModuleAccess");
    expect(migration).toContain("t.\"slug\" = 'newl-group'");
    expect(migration).toContain("'oc_newl_worldwide'");
    expect(migration).toContain("'oc_newl_usa'");
    expect(migration).toContain("'oc_newells_express'");
    // Idempotent, additive, and scoped to the approved Newl tenant.
    expect(migration).toContain("ON CONFLICT");
    expect(migration).toContain("DO NOTHING");
    expect(migration).not.toMatch(/DROP TABLE/);
  });

  it("preview deployment runs migrate deploy without the broad development seed", () => {
    const build = readFileSync("scripts/vercel-build.ts", "utf8");
    expect(build).toContain("prisma:migrate:deploy");
    expect(build).not.toMatch(/prisma:seed/);
  });
});

describe("permissions: real authorization boundary at every entry point", () => {
  beforeEach(() => {
    prismaTest.reset();
    configureAuth();
  });

  it("denies SALES on every exported Customer Intelligence read", async () => {
    // Explicit per-function coverage so the "every read" claim is provable.
    const functions: Array<[name: string, call: () => Promise<unknown>]> = [
      ["listOperatingCompanies", () => listOperatingCompanies(SALES)],
      ["getOperatingCompany", () => getOperatingCompany(SALES, "oc-1")],
      ["listRelationshipsForCompany", () => listRelationshipsForCompany(SALES, "company-1")],
      ["getRelationship", () => getRelationship(SALES, "rel-1")],
      ["listSourceAccountsForCompany", () => listSourceAccountsForCompany(SALES, "company-1")],
      ["listSourceAccountsForRelationship", () => listSourceAccountsForRelationship(SALES, "rel-1")],
      ["getSourceAccount", () => getSourceAccount(SALES, "account-1")],
      ["listContactPoints", () => listContactPoints(SALES, "contact-1")],
      ["listContactEvidence", () => listContactEvidence(SALES, "contact-1")],
      ["listIdentityMatches", () => listIdentityMatches(SALES)],
      ["getIdentityMatch", () => getIdentityMatch(SALES, "match-1")],
      ["listServiceMappingRules", () => listServiceMappingRules(SALES)],
      ["listFxRates", () => listFxRates(SALES)],
      ["listRevenueLines", () => listRevenueLines(SALES)],
      ["listMonthlyFinancials", () => listMonthlyFinancials(SALES)],
      ["getCompanyIntelligenceSummary", () => getCompanyIntelligenceSummary(SALES, "company-1")]
    ];
    for (const [name, call] of functions) {
      await expect(call(), `${name} must enforce leadership access`).rejects.toBeInstanceOf(
        AuthorizationError
      );
    }
  });

  it("denies OPERATIONS and READ_ONLY on reads and grants FINANCE", async () => {
    prismaTest.model("operatingCompany").findMany.mockResolvedValue([{ id: "oc-1" }]);

    await expect(listOperatingCompanies(OPERATIONS)).rejects.toBeInstanceOf(AuthorizationError);
    await expect(listOperatingCompanies(READ_ONLY)).rejects.toBeInstanceOf(AuthorizationError);

    const rows = await listOperatingCompanies(FINANCE);
    expect(rows).toEqual([{ id: "oc-1" }]);
  });

  it("denies SALES and OPERATIONS on every mutation", async () => {
    await expect(
      registerOperatingCompany(SALES, { slug: "acme", displayName: "Acme" })
    ).rejects.toBeInstanceOf(AuthorizationError);
    await expect(
      registerOperatingCompany(OPERATIONS, { slug: "acme", displayName: "Acme" })
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("denies a READ_ONLY mutation and a FINANCE role whose tenant policy sets canMutate=false", async () => {
    await expect(upsertFxRate(READ_ONLY, { currency: "USD", monthKey: "2026-07", rateToCad: 1.3 }))
      .rejects.toBeInstanceOf(AuthorizationError);

    prismaTest.model("tenantRolePolicy").findUnique.mockResolvedValue({ canMutate: false });
    await expect(upsertFxRate(FINANCE, { currency: "USD", monthKey: "2026-07", rateToCad: 1.3 }))
      .rejects.toBeInstanceOf(AuthorizationError);
  });

  it("requires mutation access when refreshing a lifecycle (write path)", async () => {
    prismaTest.model("companyOperatingRelationship").findFirst.mockResolvedValue(RELATIONSHIP);
    await expect(refreshRelationshipLifecycle(READ_ONLY, "rel-1")).rejects.toBeInstanceOf(
      AuthorizationError
    );

    prismaTest.model("tenantRolePolicy").findUnique.mockResolvedValue({ canMutate: false });
    await expect(refreshRelationshipLifecycle(FINANCE, "rel-1")).rejects.toBeInstanceOf(
      AuthorizationError
    );
  });

  it("guards the cashflow operating-company resolver like every other read", async () => {
    await expect(
      resolveOperatingCompanyForLegalEntity(SALES, CashflowLegalEntity.NEWL_WORLDWIDE)
    ).rejects.toBeInstanceOf(AuthorizationError);

    prismaTest.model("operatingCompany").findFirst.mockResolvedValue({
      id: "oc-ww",
      slug: "newl-worldwide"
    });
    const resolved = await resolveOperatingCompanyForLegalEntity(
      ADMIN,
      CashflowLegalEntity.NEWL_WORLDWIDE
    );
    expect(resolved?.slug).toBe("newl-worldwide");
  });
});

describe("lifecycle isolation and open-AR evidence", () => {
  beforeEach(() => {
    prismaTest.reset();
    configureAuth();
  });

  it("scopes recent revenue to the relationship's operating company", async () => {
    prismaTest.model("companyOperatingRelationship").findFirst.mockResolvedValue({
      ...RELATIONSHIP,
      operatingCompanyId: "oc-ww"
    });
    prismaTest.model("customerRevenueLine").count.mockResolvedValue(1);
    prismaTest.model("customerMonthlyFinancial").count.mockResolvedValue(0);
    prismaTest.model("customerSourceAccount").findMany.mockResolvedValue([]);
    prismaTest.model("customerIdentityMatch").count.mockResolvedValue(1);
    prismaTest.model("companyOperatingRelationship").update.mockImplementation(
      ({ data }: { data: Record<string, unknown> }) => ({ ...RELATIONSHIP, ...data })
    );

    const updated = await refreshRelationshipLifecycle(ADMIN, "rel-1");
    expect(updated.lifecycle).toBe(CustomerLifecycle.ACTIVE_CUSTOMER);

    const revenueWhere = prismaTest.model("customerRevenueLine").count.mock.calls[0][0] as {
      where: Record<string, unknown>;
    };
    expect(revenueWhere.where.tenantId).toBe("tenant-a");
    expect(revenueWhere.where.companyId).toBe("company-1");
    expect(revenueWhere.where.operatingCompanyId).toBe("oc-ww");
  });

  it("scopes approved QuickBooks mappings to the relationship's operating company", async () => {
    prismaTest.model("companyOperatingRelationship").findFirst.mockResolvedValue({
      ...RELATIONSHIP,
      operatingCompanyId: "oc-ww"
    });
    prismaTest.model("customerRevenueLine").count.mockResolvedValue(0);
    prismaTest.model("customerMonthlyFinancial").count.mockResolvedValue(0);
    prismaTest.model("customerSourceAccount").findMany.mockResolvedValue([]);
    prismaTest.model("customerIdentityMatch").count.mockResolvedValue(1);
    prismaTest.model("companyOperatingRelationship").update.mockImplementation(
      ({ data }: { data: Record<string, unknown> }) => ({ ...RELATIONSHIP, ...data })
    );

    const updated = await refreshRelationshipLifecycle(ADMIN, "rel-1");
    expect(updated.lifecycle).toBe(CustomerLifecycle.DORMANT_CUSTOMER);

    const mappingWhere = prismaTest.model("customerIdentityMatch").count.mock.calls[0][0] as {
      where: Record<string, unknown>;
    };
    expect(mappingWhere.where.kind).toBe(CustomerIdentityMatchKind.QUICKBOOKS_ACCOUNT);
    expect(mappingWhere.where.status).toBe(CustomerIdentityMatchStatus.APPROVED);
    expect(mappingWhere.where.operatingCompanyId).toBe("oc-ww");
  });

  it("activates a relationship with zero revenue but positive open AR", async () => {
    prismaTest.model("companyOperatingRelationship").findFirst.mockResolvedValue(RELATIONSHIP);
    prismaTest.model("customerRevenueLine").count.mockResolvedValue(0);
    prismaTest.model("customerMonthlyFinancial").count.mockResolvedValue(2);
    prismaTest.model("customerSourceAccount").findMany.mockResolvedValue([
      { id: "account-1", active: true, status: CustomerSourceAccountStatus.ACTIVE }
    ]);
    prismaTest.model("customerIdentityMatch").count.mockResolvedValue(0);
    prismaTest.model("companyOperatingRelationship").update.mockImplementation(
      ({ data }: { data: Record<string, unknown> }) => ({ ...RELATIONSHIP, ...data })
    );

    const updated = await refreshRelationshipLifecycle(ADMIN, "rel-1");
    expect(updated.lifecycle).toBe(CustomerLifecycle.ACTIVE_CUSTOMER);

    const arWhere = prismaTest.model("customerMonthlyFinancial").count.mock.calls[0][0] as {
      where: Record<string, unknown>;
    };
    expect(arWhere.where.companyOperatingRelationshipId).toBe("rel-1");
    expect(arWhere.where.nativeOpenAr).toEqual({ gt: 0 });
    expect(arWhere.where.monthKey).toEqual({ gte: expect.stringMatching(/^\d{4}-\d{2}$/) });
  });

  it("classifies inactive accounts with no revenue or open AR as FORMER_CUSTOMER", async () => {
    prismaTest.model("companyOperatingRelationship").findFirst.mockResolvedValue(RELATIONSHIP);
    prismaTest.model("customerRevenueLine").count.mockResolvedValue(0);
    prismaTest.model("customerMonthlyFinancial").count.mockResolvedValue(0);
    prismaTest.model("customerSourceAccount").findMany.mockResolvedValue([
      { id: "account-1", active: false, status: CustomerSourceAccountStatus.INACTIVE }
    ]);
    prismaTest.model("customerIdentityMatch").count.mockResolvedValue(0);
    prismaTest.model("companyOperatingRelationship").update.mockImplementation(
      ({ data }: { data: Record<string, unknown> }) => ({ ...RELATIONSHIP, ...data })
    );

    const updated = await refreshRelationshipLifecycle(ADMIN, "rel-1");
    expect(updated.lifecycle).toBe(CustomerLifecycle.FORMER_CUSTOMER);
  });

  it("rolls one canonical customer's different states across all three operating companies up correctly", async () => {
    const companies = {
      "oc-ww": { id: "oc-ww", displayName: "Newl Worldwide", slug: "newl-worldwide" },
      "oc-usa": { id: "oc-usa", displayName: "Newl USA", slug: "newl-usa" },
      "oc-newells": { id: "oc-newells", displayName: "Newell's Express", slug: "newells-express" }
    };

    prismaTest.model("company")!.findFirst.mockResolvedValue({
      id: "company-1",
      name: "Acme Global"
    });
    prismaTest.model("companyOperatingRelationship")!.findMany.mockResolvedValue([
      { ...RELATIONSHIP, operatingCompanyId: "oc-ww", lifecycle: CustomerLifecycle.ACTIVE_CUSTOMER, operatingCompany: companies["oc-ww"], sourceAccounts: [] },
      { ...RELATIONSHIP, operatingCompanyId: "oc-usa", lifecycle: CustomerLifecycle.DORMANT_CUSTOMER, operatingCompany: companies["oc-usa"], sourceAccounts: [] },
      { ...RELATIONSHIP, operatingCompanyId: "oc-newells", lifecycle: CustomerLifecycle.FORMER_CUSTOMER, operatingCompany: companies["oc-newells"], sourceAccounts: [] }
    ]);
    prismaTest.model("customerSourceAccount")!.count.mockResolvedValueOnce(3);
    prismaTest.model("customerSourceAccount")!.count.mockResolvedValueOnce(2);

    const summary = await getCompanyIntelligenceSummary(ADMIN, "company-1");

    expect(summary).not.toBeNull();
    expect(summary!.relationships).toHaveLength(3);
    expect(summary!.lifecycle).toBe(CustomerLifecycle.ACTIVE_CUSTOMER);
    expect(summary!.sourceAccountCount).toBe(3);
    expect(summary!.activeSourceAccountCount).toBe(2);
  });
});

describe("identity target integrity", () => {
  beforeEach(() => {
    prismaTest.reset();
    configureAuth();
  });

  const qbMatch = (overrides: Record<string, unknown> = {}) => ({
    kind: CustomerIdentityMatchKind.QUICKBOOKS_ACCOUNT,
    companyId: "company-1",
    operatingCompanyId: "oc-ww",
    sourceRecordKey: "realm-1:1001",
    sourceLabel: "Customer ABC",
    exactPersistedMapping: true,
    compatibleName: true,
    uniqueDomain: false,
    phoneOrAddressMatch: false,
    previouslyApprovedStableId: false,
    domainIsFreeMail: false,
    ...overrides
  });

  it("rejects a companyId from another tenant", async () => {
    prismaTest.model("company").findFirst.mockResolvedValue(null);
    await expect(
      proposeIdentityMatch(ADMIN, qbMatch({ companyId: "company-owned-by-b" }))
    ).rejects.toThrow(/Company does not exist in this tenant/);
  });

  it("rejects a candidateCompanyId from another tenant", async () => {
    prismaTest.model("company").findFirst.mockResolvedValueOnce({ id: "company-1" });
    prismaTest.model("company").findFirst.mockResolvedValueOnce(null);
    await expect(
      proposeIdentityMatch(ADMIN, qbMatch({ candidateCompanyId: "candidate-owned-by-b" }))
    ).rejects.toThrow(/Candidate company does not exist in this tenant/);
  });

  it("requires an operatingCompanyId for QUICKBOOKS_ACCOUNT matches", async () => {
    await expect(
      proposeIdentityMatch(
        ADMIN,
        qbMatch({ operatingCompanyId: undefined })
      )
    ).rejects.toThrow(/operatingCompanyId is required/);
  });

  it("rejects a second manual approval for an already-approved source", async () => {
    prismaTest.model("customerIdentityMatch").findFirst.mockResolvedValueOnce({
      id: "match-proposed",
      tenantId: "tenant-a",
      kind: CustomerIdentityMatchKind.QUICKBOOKS_ACCOUNT,
      companyId: "company-2",
      sourceRecordKey: "realm-1:1001",
      status: CustomerIdentityMatchStatus.PROPOSED
    });
    prismaTest.model("company").findFirst.mockResolvedValue({ id: "company-2" });
    prismaTest.model("customerIdentityMatch").findFirst.mockResolvedValueOnce({
      id: "match-approved-other",
      tenantId: "tenant-a",
      kind: CustomerIdentityMatchKind.QUICKBOOKS_ACCOUNT,
      companyId: "company-1",
      sourceRecordKey: "realm-1:1001",
      status: CustomerIdentityMatchStatus.APPROVED
    });

    await expect(reviewIdentityMatch(ADMIN, "match-proposed", "APPROVE")).rejects.toThrow(
      /already approved to another canonical company/
    );
  });

  it("keeps competing automatic proposals to one approved target", async () => {
    prismaTest.model("company").findFirst.mockResolvedValue({ id: "company-1" });
    prismaTest.model("operatingCompany").findFirst.mockResolvedValue({ id: "oc-ww" });
    prismaTest.model("customerIdentityMatch").findFirst.mockResolvedValue(null);
    prismaTest.model("customerIdentityMatch").create.mockImplementation(
      ({ data }: { data: Record<string, unknown> }) => ({ id: "match-new", ...data })
    );

    // First proposal auto-approves for company-1.
    const first = await proposeIdentityMatch(ADMIN, qbMatch());
    expect(first.status).toBe(CustomerIdentityMatchStatus.APPROVED);

    // A competing proposal for company-2 with a higher score still cannot
    // override the approved canonical target.
    prismaTest.model("customerIdentityMatch").findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: "match-approved-company-1",
        tenantId: "tenant-a",
        kind: CustomerIdentityMatchKind.QUICKBOOKS_ACCOUNT,
        companyId: "company-1",
        sourceRecordKey: "realm-1:1001",
        status: CustomerIdentityMatchStatus.APPROVED
      });
    prismaTest.model("company").findFirst.mockResolvedValue({ id: "company-2" });
    prismaTest.model("customerIdentityMatch").create.mockResolvedValue({
      id: "match-company-2",
      tenantId: "tenant-a",
      kind: CustomerIdentityMatchKind.QUICKBOOKS_ACCOUNT,
      companyId: "company-2",
      sourceRecordKey: "realm-1:1001",
      status: CustomerIdentityMatchStatus.PROPOSED
    });

    const second = await proposeIdentityMatch(ADMIN, qbMatch({ companyId: "company-2" }));
    expect(second.status).toBe(CustomerIdentityMatchStatus.PROPOSED);
  });

  it("falls back to the authoritative approved match when the database rejects a concurrent approve", async () => {
    prismaTest.model("company").findFirst.mockResolvedValue({ id: "company-1" });
    prismaTest.model("operatingCompany").findFirst.mockResolvedValue({ id: "oc-ww" });
    prismaTest.model("customerIdentityMatch").findFirst.mockResolvedValue(null);

    const uniqueViolation = new Prisma.PrismaClientKnownRequestError("conflict", {
      code: "P2002",
      clientVersion: "test"
    });
    prismaTest.model("customerIdentityMatch").create.mockRejectedValue(uniqueViolation);
    prismaTest.model("customerIdentityMatch").findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: "existing-approved",
        tenantId: "tenant-a",
        kind: CustomerIdentityMatchKind.QUICKBOOKS_ACCOUNT,
        companyId: "company-1",
        sourceRecordKey: "realm-1:1001",
        status: CustomerIdentityMatchStatus.APPROVED
      });

    const result = await proposeIdentityMatch(ADMIN, qbMatch());
    expect(result.status).toBe(CustomerIdentityMatchStatus.APPROVED);
    expect(result.id).toBe("existing-approved");
  });

  it("re-running an approved decision is idempotent", async () => {
    prismaTest.model("company").findFirst.mockResolvedValue({ id: "company-1" });
    prismaTest.model("operatingCompany").findFirst.mockResolvedValue({ id: "oc-ww" });
    prismaTest.model("customerIdentityMatch").findFirst.mockResolvedValue({
      id: "match-approved",
      tenantId: "tenant-a",
      kind: CustomerIdentityMatchKind.QUICKBOOKS_ACCOUNT,
      companyId: "company-1",
      operatingCompanyId: "oc-ww",
      sourceRecordKey: "realm-1:1001",
      status: CustomerIdentityMatchStatus.APPROVED,
      score: 100
    });

    const result = await proposeIdentityMatch(ADMIN, qbMatch());
    expect(result.status).toBe(CustomerIdentityMatchStatus.APPROVED);
    expect(prismaTest.model("customerIdentityMatch").create.mock.calls.length).toBe(0);
    expect(prismaTest.model("customerIdentityMatch").update.mock.calls.length).toBe(0);
  });

  it("re-running a rejected decision is idempotent", async () => {
    prismaTest.model("company").findFirst.mockResolvedValue({ id: "company-1" });
    prismaTest.model("operatingCompany").findFirst.mockResolvedValue({ id: "oc-ww" });
    prismaTest.model("customerIdentityMatch").findFirst.mockResolvedValue({
      id: "match-rejected",
      tenantId: "tenant-a",
      kind: CustomerIdentityMatchKind.QUICKBOOKS_ACCOUNT,
      companyId: "company-1",
      sourceRecordKey: "realm-1:1001",
      status: CustomerIdentityMatchStatus.REJECTED,
      score: 100
    });

    const result = await proposeIdentityMatch(ADMIN, qbMatch());
    expect(result.status).toBe(CustomerIdentityMatchStatus.REJECTED);
  });
});

describe("contact point normalization", () => {
  beforeEach(() => {
    prismaTest.reset();
    configureAuth();
    prismaTest.model("contact").findFirst.mockResolvedValue({ id: "contact-1" });
    prismaTest.model("contactPoint").findFirst.mockResolvedValue(null);
    prismaTest.model("contactPoint").upsert.mockImplementation(
      ({ create }: { create: Record<string, unknown> }) => ({ id: "point-1", ...create })
    );
  });

  it("deduplicates equivalent email casing and preserves the display value", async () => {
    await upsertContactPoint(ADMIN, {
      contactId: "contact-1",
      companyId: "company-1",
      type: "EMAIL",
      value: "Buyer@Example.COM",
      source: "EMAIL_SIGNATURE"
    });
    await upsertContactPoint(ADMIN, {
      contactId: "contact-1",
      companyId: "company-1",
      type: "EMAIL",
      value: "buyer@example.com",
      source: "EMAIL_SIGNATURE"
    });

    const calls = prismaTest.model("contactPoint").upsert.mock.calls;
    expect(calls).toHaveLength(2);
    for (const call of calls) {
      const arg = call[0] as {
        where: { tenantId_contactId_type_value: Record<string, unknown> };
        create: Record<string, unknown>;
      };
      expect(arg.where.tenantId_contactId_type_value.value).toBe("buyer@example.com");
      expect(arg.create.value).toBe("buyer@example.com");
    }
    expect((calls[0][0] as { create: Record<string, unknown> }).create.displayValue).toBe(
      "Buyer@Example.COM"
    );
  });

  it("deduplicates equivalent phone formatting", async () => {
    await upsertContactPoint(ADMIN, {
      contactId: "contact-1",
      companyId: "company-1",
      type: "PHONE",
      value: "+1 (416) 555-0134",
      source: "EMAIL_SIGNATURE"
    });
    await upsertContactPoint(ADMIN, {
      contactId: "contact-1",
      companyId: "company-1",
      type: "PHONE",
      value: "416-555-0134",
      source: "EMAIL_SIGNATURE"
    });

    const calls = prismaTest.model("contactPoint").upsert.mock.calls;
    expect(calls).toHaveLength(2);
    for (const call of calls) {
      const arg = call[0] as { create: Record<string, unknown> };
      expect(arg.create.value).toBe("4165550134");
    }
  });

  it("rejects an empty or un-normalizable value", async () => {
    await expect(
      upsertContactPoint(ADMIN, {
        contactId: "contact-1",
        companyId: "company-1",
        type: "PHONE",
        value: "N/A"
      })
    ).rejects.toThrow(/not valid for its type/);
    await expect(
      upsertContactPoint(ADMIN, {
        contactId: "contact-1",
        companyId: "company-1",
        type: "EMAIL",
        value: "   "
      })
    ).rejects.toThrow(/required/);
  });
});

describe("contact evidence preservation", () => {
  beforeEach(() => {
    prismaTest.reset();
    configureAuth();
    prismaTest.model("contact").findFirst.mockResolvedValue({ id: "contact-1" });
  });

  function evidenceInput(overrides: Record<string, unknown> = {}) {
    return {
      contactId: "contact-1",
      companyId: "company-1",
      sourceType: "EMAIL_SIGNATURE" as const,
      sourceRecordKey: "mailbox-msg-1",
      fieldName: "phone",
      fieldValue: "+1 416 555 0134",
      confidence: 80,
      parserVersion: "v1",
      observedAt: new Date("2026-07-01T00:00:00.000Z"),
      ...overrides
    };
  }

  it("never silently overwrites an accepted fact and records the conflict", async () => {
    const existingRecord = {
      id: "evidence-1",
      tenantId: "tenant-a",
      contactId: "contact-1",
      sourceRecordKey: "mailbox-msg-1",
      fieldName: "phone",
      fieldValue: "+1 416 555 0134",
      reviewStatus: "ACCEPTED"
    };
    prismaTest.model("contactEvidence").findFirst.mockResolvedValue(existingRecord);
    prismaTest.model("contactEvidence").update.mockImplementation(
      ({ data }: { data: Record<string, unknown> }) => ({ ...existingRecord, ...data })
    );

    const result = await upsertContactEvidence(
      ADMIN,
      evidenceInput({ fieldValue: "+1 212 555 0199" })
    );

    expect(result.reviewStatus).toBe("CONFLICT");
    expect(result.fieldValue).toBe("+1 416 555 0134");
    expect(result.conflictingValue).toBe("+1 212 555 0199");
  });

  it("keeps an accepted fact stable when the same value is re-observed", async () => {
    const existingRecord = {
      id: "evidence-1",
      tenantId: "tenant-a",
      contactId: "contact-1",
      sourceRecordKey: "mailbox-msg-1",
      fieldName: "phone",
      fieldValue: "+1 416 555 0134",
      reviewStatus: "ACCEPTED"
    };
    prismaTest.model("contactEvidence").findFirst.mockResolvedValue(existingRecord);
    prismaTest.model("contactEvidence").update.mockImplementation(
      ({ data }: { data: Record<string, unknown> }) => ({ ...existingRecord, ...data })
    );

    const result = await upsertContactEvidence(ADMIN, evidenceInput());
    expect(result.reviewStatus).toBe("ACCEPTED");
    expect(result.fieldValue).toBe("+1 416 555 0134");
  });

  it("replaces a pending (unreviewed) value and stays UNREVIEWED", async () => {
    const existingRecord = {
      id: "evidence-1",
      tenantId: "tenant-a",
      contactId: "contact-1",
      sourceRecordKey: "mailbox-msg-1",
      fieldName: "phone",
      fieldValue: "+1 416 555 0134",
      reviewStatus: "UNREVIEWED"
    };
    prismaTest.model("contactEvidence").findFirst.mockResolvedValue(existingRecord);
    prismaTest.model("contactEvidence").update.mockImplementation(
      ({ data }: { data: Record<string, unknown> }) => ({ ...existingRecord, ...data })
    );

    const result = await upsertContactEvidence(
      ADMIN,
      evidenceInput({ fieldValue: "+1 212 555 0199" })
    );
    expect(result.fieldValue).toBe("+1 212 555 0199");
    expect(result.reviewStatus).toBe("UNREVIEWED");
  });

  it("does not create invented values from empty extraction", async () => {
    await expect(
      upsertContactEvidence(ADMIN, evidenceInput({ fieldValue: "   " }))
    ).rejects.toThrow(/required/);
    expect(prismaTest.model("contactEvidence").create.mock.calls.length).toBe(0);
  });
});

describe("foundation behaviour (regression)", () => {
  beforeEach(() => {
    prismaTest.reset();
    configureAuth();
  });

  it("registers an operating company with the caller's tenantId and audits it", async () => {
    prismaTest.model("operatingCompany")!.findFirst.mockResolvedValue(null);
    prismaTest.model("operatingCompany")!.upsert.mockImplementation(
      ({ create }: { create: Record<string, unknown> }) => ({ id: "oc-1", ...create })
    );

    const record = await registerOperatingCompany(ADMIN, {
      slug: "newell-s-express",
      displayName: "Newell's Express and Warehousing Ltd."
    });

    expect(record.tenantId).toBe("tenant-a");
    const audit = prismaTest.model("auditLog")!.create.mock.calls[0][0] as {
      data: Record<string, unknown>;
    };
    expect(audit.data.action).toBe("customer-intelligence.operating-company.created");
    expect(audit.data.tenantId).toBe("tenant-a");
  });

  it("supports one customer shared across three operating companies", async () => {
    const companies = {
      "oc-ww": { id: "oc-ww", displayName: "Newl Worldwide", slug: "newl-worldwide" },
      "oc-usa": { id: "oc-usa", displayName: "Newl USA", slug: "newl-usa" },
      "oc-newells": { id: "oc-newells", displayName: "Newell's Express", slug: "newells-express" }
    };

    prismaTest.model("company")!.findFirst.mockResolvedValue({ id: "company-1", name: "Acme Global" });
    prismaTest.model("operatingCompany")!.findFirst.mockImplementation(
      ({ where }: { where: { id: string } }) => companies[where.id as keyof typeof companies] ?? null
    );
    prismaTest.model("companyOperatingRelationship")!.findFirst.mockResolvedValue(null);
    prismaTest.model("companyOperatingRelationship")!.upsert.mockImplementation(
      ({ create }: { create: Record<string, unknown> }) => ({
        id: `rel-${create.operatingCompanyId}`,
        ...create
      })
    );

    for (const operatingCompanyId of Object.keys(companies)) {
      await upsertCompanyOperatingRelationship(ADMIN, {
        companyId: "company-1",
        operatingCompanyId,
        lifecycle: CustomerLifecycle.ACTIVE_CUSTOMER,
        lastRevenueDate: new Date("2026-07-01T00:00:00.000Z")
      });
    }

    expect(
      prismaTest.model("companyOperatingRelationship")!.upsert.mock.calls.length
    ).toBe(3);
    for (const call of prismaTest.model("companyOperatingRelationship")!.upsert.mock.calls) {
      const arg = call[0] as {
        where: { tenantId_companyId_operatingCompanyId: Record<string, unknown> };
        create: Record<string, unknown>;
      };
      expect(arg.where.tenantId_companyId_operatingCompanyId.tenantId).toBe("tenant-a");
      expect(arg.create.tenantId).toBe("tenant-a");
    }
  });

  it("maps multiple CAD/USD QuickBooks accounts to one canonical customer relationship", async () => {
    prismaTest.model("companyOperatingRelationship")!.findFirst.mockResolvedValue({
      ...RELATIONSHIP,
      id: "rel-1"
    });
    prismaTest.model("customerSourceAccount")!.findFirst.mockResolvedValue(null);
    prismaTest.model("customerSourceAccount")!.upsert.mockImplementation(
      ({ create }: { create: Record<string, unknown> }) => ({
        id: `account-${create.quickBooksCustomerId}`,
        ...create
      })
    );

    const cad = await upsertSourceAccount(ADMIN, {
      realmId: "realm-1",
      quickBooksCustomerId: "1001",
      companyId: "company-1",
      operatingCompanyId: "oc-ww",
      companyOperatingRelationshipId: "rel-1",
      currency: "CAD",
      displayName: "Customer ABC"
    });
    const usd = await upsertSourceAccount(ADMIN, {
      realmId: "realm-1",
      quickBooksCustomerId: "1001-USD",
      companyId: "company-1",
      operatingCompanyId: "oc-ww",
      companyOperatingRelationshipId: "rel-1",
      currency: "USD",
      displayName: "Customer ABC USD"
    });

    expect(cad.currency).toBe("CAD");
    expect(usd.currency).toBe("USD");
    expect(cad.companyOperatingRelationshipId).toBe("rel-1");
    expect(usd.companyOperatingRelationshipId).toBe("rel-1");

    const upsertCalls = prismaTest.model("customerSourceAccount")!.upsert.mock.calls;
    expect(upsertCalls).toHaveLength(2);
    for (const call of upsertCalls) {
      const arg = call[0] as {
        where: { tenantId_realmId_quickBooksCustomerId: Record<string, unknown> };
        create: Record<string, unknown>;
      };
      expect(arg.where.tenantId_realmId_quickBooksCustomerId.tenantId).toBe("tenant-a");
      expect(arg.create.tenantId).toBe("tenant-a");
    }
  });

  it("keeps same-name companies isolated across tenants on queries and writes", async () => {
    const ctxA = ctx(PlatformRole.ADMIN, "tenant-a");
    const ctxB = ctx(PlatformRole.ADMIN, "tenant-b");

    prismaTest.model("company")!.findFirst.mockResolvedValue({ id: "company-a", name: "Acme Global" });
    prismaTest.model("companyOperatingRelationship")!.findMany.mockResolvedValue([]);
    prismaTest.model("customerSourceAccount")!.count.mockResolvedValue(0);

    await getCompanyIntelligenceSummary(ctxA, "company-a");
    await getCompanyIntelligenceSummary(ctxB, "company-a");

    const findFirstCalls = prismaTest.model("company")!.findFirst.mock.calls;
    const tenantIds = findFirstCalls.map((call) => {
      const arg = call[0] as { where: Record<string, unknown> };
      return arg.where.tenantId;
    });
    expect(tenantIds).toEqual(["tenant-a", "tenant-b"]);

    prismaTest.model("company")!.findFirst.mockResolvedValue(null);
    await expect(
      upsertCompanyOperatingRelationship(ctxB, {
        companyId: "company-a-owned-by-a",
        operatingCompanyId: "oc-ww"
      })
    ).rejects.toThrow(/does not exist in this tenant/);
  });

  it("blocks cross-tenant relation-ID reads and writes", async () => {
    const ctxB = ctx(PlatformRole.ADMIN, "tenant-b");

    prismaTest.model("companyOperatingRelationship")!.findFirst.mockResolvedValue(null);
    const leak = await getRelationship(ctxB, "rel-owned-by-tenant-a");
    expect(leak).toBeNull();

    await expect(
      upsertSourceAccount(ctxB, {
        realmId: "realm-1",
        quickBooksCustomerId: "1001",
        companyId: "company-1",
        operatingCompanyId: "oc-ww",
        companyOperatingRelationshipId: "rel-owned-by-tenant-a",
        displayName: "Acme"
      })
    ).rejects.toThrow(/must map to a relationship that exists in this tenant/);

    prismaTest.model("customerIdentityMatch")!.findFirst.mockResolvedValue(null);
    await expect(
      reviewIdentityMatch(ctxB, "match-owned-by-tenant-a", "APPROVE")
    ).rejects.toThrow(/does not exist in this tenant/);
  });

  it("keeps the existing cashflow two-company enum readable and never rewrites cashflow rows", async () => {
    expect(cashflowLegalEntityToOperatingCompanySlug(CashflowLegalEntity.NEWL_WORLDWIDE)).toBe(
      "newl-worldwide"
    );
    expect(cashflowLegalEntityToOperatingCompanySlug(CashflowLegalEntity.NEWL_USA)).toBe("newl-usa");

    prismaTest.model("operatingCompany")!.findFirst.mockResolvedValue({
      id: "oc-ww",
      slug: "newl-worldwide"
    });
    const resolved = await resolveOperatingCompanyForLegalEntity(
      ADMIN,
      CashflowLegalEntity.NEWL_WORLDWIDE
    );
    expect(resolved?.slug).toBe("newl-worldwide");

    expect(
      prismaTest.model("cashflowCustomer")?.update?.mock.calls.length ?? 0
    ).toBe(0);
    expect(
      prismaTest.model("cashflowCustomer")?.create?.mock.calls.length ?? 0
    ).toBe(0);
  });

  it("guards against regressions that delete or rewrite the legacy finance enum", () => {
    const schema = readFileSync("prisma/schema.prisma", "utf8");
    expect(schema).toContain("enum CashflowLegalEntity");
    expect(schema).toContain("NEWL_WORLDWIDE");
    expect(schema).toContain("NEWL_USA");
    expect(schema).toContain("model CashflowCustomer");

    const foundationMigration = readFileSync(
      "prisma/migrations/20260805120000_add_customer_intelligence_foundation/migration.sql",
      "utf8"
    );
    expect(foundationMigration).not.toContain("CashflowCustomer");
    expect(foundationMigration).not.toContain("CashflowLegalEntity");
  });

  it("lists source accounts for a relationship only within the tenant", async () => {
    prismaTest.model("customerSourceAccount")!.findMany.mockResolvedValue([
      { id: "account-1", companyOperatingRelationshipId: "rel-1" }
    ]);
    const accounts = await listSourceAccountsForRelationship(ADMIN, "rel-1");
    expect(accounts).toHaveLength(1);
    const whereArg = prismaTest.model("customerSourceAccount")!.findMany.mock.calls[0][0] as {
      where: Record<string, unknown>;
    };
    expect(whereArg.where.tenantId).toBe("tenant-a");
    expect(whereArg.where.companyOperatingRelationshipId).toBe("rel-1");
  });
});
