import {
  CashflowLegalEntity,
  CustomerIdentityMatchKind,
  CustomerIdentityMatchStatus,
  CustomerLifecycle,
  CustomerSourceAccountStatus,
  PlatformRole
} from "@prisma/client";
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/auth/authorization", () => ({
  requireModule: vi.fn(),
  requireMutationAccess: vi.fn(),
  requireRole: vi.fn()
}));

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

vi.mock("@/server/db", () => ({
  prisma: prismaTest.proxy
}));

import {
  proposeIdentityMatch,
  refreshRelationshipLifecycle,
  registerOperatingCompany,
  reviewIdentityMatch,
  upsertCompanyOperatingRelationship,
  upsertSourceAccount
} from "@/modules/customer-intelligence/actions";
import {
  cashflowLegalEntityToOperatingCompanySlug,
  resolveOperatingCompanyForLegalEntity
} from "@/modules/customer-intelligence/cashflow-compatibility";
import {
  getCompanyIntelligenceSummary,
  getRelationship,
  listSourceAccountsForRelationship
} from "@/modules/customer-intelligence/queries";
import type { AuthenticatedContext } from "@/server/tenant-context";

function adminCtx(tenantId: string): AuthenticatedContext {
  return {
    userId: "user-1",
    userEmail: "user@example.com",
    userName: "User",
    role: PlatformRole.ADMIN,
    tenantId,
    tenantSlug: `${tenantId}-slug`,
    tenantName: `Tenant ${tenantId}`
  };
}

const RELATIONSHIP = {
  id: "rel-1",
  tenantId: "tenant-a",
  companyId: "company-1",
  operatingCompanyId: "oc-newl-worldwide",
  lifecycle: CustomerLifecycle.PROSPECT,
  status: "ACTIVE"
};

describe("Customer Intelligence foundation (tenant-safe actions)", () => {
  beforeEach(() => {
    prismaTest.reset();
  });

  it("registers an operating company with the caller's tenantId and audits it", async () => {
    prismaTest.model("operatingCompany")!.findFirst.mockResolvedValue(null);
    prismaTest.model("operatingCompany")!.upsert.mockImplementation(
      ({ create }: { create: Record<string, unknown> }) => ({
        id: "oc-1",
        ...create
      })
    );

    const record = await registerOperatingCompany(adminCtx("tenant-a"), {
      slug: "newell-s-express",
      displayName: "Newell's Express and Warehousing Ltd."
    });

    expect(record.tenantId).toBe("tenant-a");
    const whereArg = prismaTest.modelTargets
      .get("operatingCompany")!
      .findFirst.mock.calls[0][0] as { where: Record<string, unknown> };
    expect(whereArg.where.tenantId).toBe("tenant-a");
    const audit = prismaTest.model("auditLog")!.create.mock.calls[0][0] as {
      data: Record<string, unknown>;
    };
    expect(audit.data.action).toBe("customer-intelligence.operating-company.created");
    expect(audit.data.tenantId).toBe("tenant-a");
  });

  it("supports one customer shared across three operating companies with a rolled-up lifecycle", async () => {
    const companies = {
      "oc-ww": { id: "oc-ww", displayName: "Newl Worldwide", slug: "newl-worldwide" },
      "oc-usa": { id: "oc-usa", displayName: "Newl USA", slug: "newl-usa" },
      "oc-newells": { id: "oc-newells", displayName: "Newell's Express", slug: "newells-express" }
    };

    prismaTest.model("company")!.findFirst.mockResolvedValue({
      id: "company-1",
      name: "Acme Global"
    });
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

    const ctx = adminCtx("tenant-a");
    for (const operatingCompanyId of Object.keys(companies)) {
      await upsertCompanyOperatingRelationship(ctx, {
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
      expect(arg.create.companyId).toBe("company-1");
      expect(arg.create.tenantId).toBe("tenant-a");
    }

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

    const summary = await getCompanyIntelligenceSummary(ctx, "company-1");

    expect(summary).not.toBeNull();
    expect(summary!.relationships).toHaveLength(3);
    expect(summary!.lifecycle).toBe(CustomerLifecycle.ACTIVE_CUSTOMER);
    expect(summary!.sourceAccountCount).toBe(3);
    expect(summary!.activeSourceAccountCount).toBe(2);
    expect(summary!.hasApprovedMapping).toBe(true);
  });

  it("maps multiple CAD/USD QuickBooks accounts to one canonical customer relationship", async () => {
    prismaTest.model("companyOperatingRelationship")!.findFirst.mockResolvedValue({
      ...RELATIONSHIP,
      id: "rel-1",
      companyId: "company-1",
      operatingCompanyId: "oc-ww"
    });
    prismaTest.model("customerSourceAccount")!.findFirst.mockResolvedValue(null);
    prismaTest.model("customerSourceAccount")!.upsert.mockImplementation(
      ({ create }: { create: Record<string, unknown> }) => ({
        id: `account-${create.quickBooksCustomerId}`,
        ...create
      })
    );

    const ctx = adminCtx("tenant-a");
    const cad = await upsertSourceAccount(ctx, {
      realmId: "realm-1",
      quickBooksCustomerId: "1001",
      companyId: "company-1",
      operatingCompanyId: "oc-ww",
      companyOperatingRelationshipId: "rel-1",
      currency: "CAD",
      displayName: "Customer ABC"
    });
    const usd = await upsertSourceAccount(ctx, {
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
    expect(cad.companyId).toBe("company-1");

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
    const uniqueWhere = upsertCalls[0][0] as {
      where: { tenantId_realmId_quickBooksCustomerId: Record<string, string> };
    };
    expect(uniqueWhere.where.tenantId_realmId_quickBooksCustomerId).toEqual({
      tenantId: "tenant-a",
      realmId: "realm-1",
      quickBooksCustomerId: "1001"
    });
  });

  it("keeps same-name companies isolated across tenants on every query and write", async () => {
    const ctxA = adminCtx("tenant-a");
    const ctxB = adminCtx("tenant-b");

    prismaTest.model("company")!.findFirst.mockResolvedValue({
      id: "company-a",
      name: "Acme Global"
    });
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
    const ctxB = adminCtx("tenant-b");

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

  it("preserves reviewed match decisions across re-runs", async () => {
    const ctx = adminCtx("tenant-a");
    prismaTest.model("company")!.findFirst.mockResolvedValue({
      id: "company-1",
      name: "Acme Global"
    });
    prismaTest.model("customerIdentityMatch")!.findFirst.mockResolvedValue({
      id: "match-1",
      tenantId: "tenant-a",
      kind: CustomerIdentityMatchKind.QUICKBOOKS_ACCOUNT,
      companyId: "company-1",
      sourceRecordKey: "realm-1:1001",
      status: CustomerIdentityMatchStatus.REJECTED,
      score: 100
    });

    const result = await proposeIdentityMatch(ctx, {
      kind: CustomerIdentityMatchKind.QUICKBOOKS_ACCOUNT,
      companyId: "company-1",
      sourceRecordKey: "realm-1:1001",
      sourceLabel: "Customer ABC",
      exactPersistedMapping: true,
      compatibleName: true,
      uniqueDomain: false,
      phoneOrAddressMatch: false,
      previouslyApprovedStableId: false,
      domainIsFreeMail: false
    });

    expect(result.status).toBe(CustomerIdentityMatchStatus.REJECTED);
    expect(
      prismaTest.model("customerIdentityMatch")!.create.mock.calls.length
    ).toBe(0);
  });

  it("auto-approves a high-score match and defers a low-score match to human review", async () => {
    const ctx = adminCtx("tenant-a");
    prismaTest.model("customerIdentityMatch")!.findFirst.mockResolvedValue(null);
    prismaTest.model("customerIdentityMatch")!.create.mockImplementation(
      ({ data }: { data: Record<string, unknown> }) => ({ id: "match-new", ...data })
    );

    const auto = await proposeIdentityMatch(ctx, {
      kind: CustomerIdentityMatchKind.EMAIL_DOMAIN,
      companyId: "company-1",
      sourceRecordKey: "acmecorp.example",
      uniqueDomain: true,
      compatibleName: true,
      domainIsFreeMail: false,
      exactPersistedMapping: false,
      phoneOrAddressMatch: false,
      previouslyApprovedStableId: false
    });
    expect(auto.status).toBe(CustomerIdentityMatchStatus.APPROVED);
    expect(auto.score).toBe(95);

    const review = await proposeIdentityMatch(ctx, {
      kind: CustomerIdentityMatchKind.EMAIL_DOMAIN,
      companyId: "company-2",
      sourceRecordKey: "beta.example",
      uniqueDomain: true,
      compatibleName: true,
      domainIsFreeMail: true,
      exactPersistedMapping: false,
      phoneOrAddressMatch: false,
      previouslyApprovedStableId: false
    });
    expect(review.status).toBe(CustomerIdentityMatchStatus.PROPOSED);
    expect(review.score).toBe(0);
  });

  it("does not auto-link when the source record is already approved to another company", async () => {
    const ctx = adminCtx("tenant-a");
    prismaTest.model("customerIdentityMatch")!.findFirst.mockResolvedValueOnce(null);
    prismaTest.model("customerIdentityMatch")!.findFirst.mockResolvedValueOnce({
      id: "existing-approval",
      tenantId: "tenant-a",
      kind: CustomerIdentityMatchKind.QUICKBOOKS_ACCOUNT,
      companyId: "company-1",
      sourceRecordKey: "realm-1:1001",
      status: CustomerIdentityMatchStatus.APPROVED
    });
    prismaTest.model("customerIdentityMatch")!.create.mockImplementation(
      ({ data }: { data: Record<string, unknown> }) => ({ id: "match-new", ...data })
    );

    const result = await proposeIdentityMatch(ctx, {
      kind: CustomerIdentityMatchKind.QUICKBOOKS_ACCOUNT,
      companyId: "company-2",
      sourceRecordKey: "realm-1:1001",
      sourceLabel: "Customer ABC",
      exactPersistedMapping: true,
      compatibleName: false,
      uniqueDomain: false,
      phoneOrAddressMatch: false,
      previouslyApprovedStableId: false,
      domainIsFreeMail: false
    });

    expect(result.status).toBe(CustomerIdentityMatchStatus.PROPOSED);
  });

  it("refreshes a relationship lifecycle from tenant-scoped revenue and account evidence", async () => {
    const ctx = adminCtx("tenant-a");
    prismaTest.model("companyOperatingRelationship")!.findFirst.mockResolvedValue({
      ...RELATIONSHIP,
      id: "rel-1"
    });
    prismaTest.model("customerRevenueLine")!.count.mockResolvedValue(3);
    prismaTest.model("customerSourceAccount")!.findMany.mockResolvedValue([
      { id: "account-1", active: true, status: CustomerSourceAccountStatus.ACTIVE }
    ]);
    prismaTest.model("customerIdentityMatch")!.count.mockResolvedValue(1);
    prismaTest.model("companyOperatingRelationship")!.update.mockImplementation(
      ({ data }: { data: Record<string, unknown> }) => ({ ...RELATIONSHIP, ...data })
    );

    const updated = await refreshRelationshipLifecycle(ctx, "rel-1");

    expect(updated.lifecycle).toBe(CustomerLifecycle.ACTIVE_CUSTOMER);
    const revenueWhere = prismaTest.modelTargets
      .get("customerRevenueLine")!
      .count.mock.calls[0][0] as { where: Record<string, unknown> };
    expect(revenueWhere.where.tenantId).toBe("tenant-a");
    expect(revenueWhere.where.companyId).toBe("company-1");
    const updateWhere = prismaTest.modelTargets
      .get("companyOperatingRelationship")!
      .update.mock.calls[0][0] as { where: { tenantId_id: Record<string, unknown> } };
    expect(updateWhere.where.tenantId_id.tenantId).toBe("tenant-a");
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
      { tenantId: "tenant-a", tenantSlug: "a", tenantName: "A" },
      CashflowLegalEntity.NEWL_WORLDWIDE
    );
    expect(resolved?.slug).toBe("newl-worldwide");
    const whereArg = prismaTest.modelTargets
      .get("operatingCompany")!
      .findFirst.mock.calls[0][0] as { where: Record<string, unknown> };
    expect(whereArg.where.tenantId).toBe("tenant-a");

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

    const migrationPath =
      "prisma/migrations/20260805120000_add_customer_intelligence_foundation/migration.sql";
    const migration = readFileSync(migrationPath, "utf8");
    expect(migration).not.toContain("CashflowCustomer");
    expect(migration).not.toContain("CashflowLegalEntity");
    expect(migration).toContain("CREATE TYPE \"CustomerLifecycle\"");
    expect(migration).toContain("ALTER TYPE \"ModuleKey\" ADD VALUE 'CUSTOMER_INTELLIGENCE'");
  });

  it("lists source accounts for a relationship only within the tenant", async () => {
    prismaTest.model("customerSourceAccount")!.findMany.mockResolvedValue([
      { id: "account-1", companyOperatingRelationshipId: "rel-1" }
    ]);
    const accounts = await listSourceAccountsForRelationship(
      { tenantId: "tenant-a", tenantSlug: "a", tenantName: "A" },
      "rel-1"
    );
    expect(accounts).toHaveLength(1);
    const whereArg = prismaTest.modelTargets
      .get("customerSourceAccount")!
      .findMany.mock.calls[0][0] as { where: Record<string, unknown> };
    expect(whereArg.where.tenantId).toBe("tenant-a");
    expect(whereArg.where.companyOperatingRelationshipId).toBe("rel-1");
  });
});
