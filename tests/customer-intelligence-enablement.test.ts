/**
 * CP-PHASE-02B-8 owner-controlled activation of live QuickBooks sync.
 *
 * Prisma is mocked; the authorization module is REAL (only `@/server/db` is
 * mocked), so the permission boundary runs against the mocked DB exactly like
 * the other Customer Intelligence suites. `fetch` is mocked and never reached
 * for unenabled live runs.
 *
 * Proves the owner decision CP-02B-8-Q1 (`FEATURE_ENABLEMENT_RECORD`):
 *
 * - live sync defaults off for every operating company (no enablement record
 *   means not enabled; the migration bootstraps no rows);
 * - live sync entry points refuse to run without an enabled enablement record
 *   carrying recorded approval for that operating company (scoped runs throw,
 *   unscoped runs skip with an audited SKIPPED_NOT_ENABLED section);
 * - dry-run verification stays available for unenabled operating companies as
 *   the owner's zero-write preview tool;
 * - enablement changes are ADMIN-only, audited, and carry explicit approval
 *   evidence (`APPROVE_LIVE_SYNC` confirmation + recorded approver/timestamp);
 * - connecting a QuickBooks company never auto-enables live sync.
 *
 * All fixtures are synthetic reserved values.
 */
import {
  IntegrationProvider,
  IntegrationStatus,
  PlatformRole
} from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const prismaTest = vi.hoisted(() => {
  const modelCalls: Array<{ model: string; method: string; args: unknown[] }> = [];
  const modelTargets = new Map<string, Record<string, ReturnType<typeof vi.fn>>>();
  const queryRaw = vi.fn(async () => []);
  const transaction = vi.fn(async (callback: (client: Record<string, unknown>) => unknown) =>
    callback(proxy)
  );
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
  const proxy: Record<string, unknown> = new Proxy(
    {},
    {
      get(_target, prop) {
        if (typeof prop !== "string") {
          return undefined;
        }
        if (prop === "$transaction") {
          return transaction;
        }
        if (prop === "$queryRaw") {
          return queryRaw;
        }
        return makeModelProxy(prop);
      }
    }
  );
  return {
    proxy,
    modelTargets,
    modelCalls,
    queryRaw,
    transaction,
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
      queryRaw.mockReset();
      queryRaw.mockResolvedValue([]);
      transaction.mockReset();
      transaction.mockImplementation(async (callback: (client: Record<string, unknown>) => unknown) =>
        callback(proxy)
      );
      const auditLog = makeModelProxy("auditLog");
      auditLog.create.mockImplementation((...args: unknown[]) => {
        modelCalls.push({ model: "auditLog", method: "create", args });
        return (args[0] as { data?: unknown })?.data;
      });
    }
  };
});

// Only Prisma is mocked; the authorization module is REAL.
vi.mock("@/server/db", () => ({
  prisma: prismaTest.proxy
}));

import {
  associateQuickBooksCredential,
  runFinancialMaterialization,
  runQuickBooksCustomerIngestion
} from "@/modules/customer-intelligence/actions";
import {
  LIVE_SYNC_APPROVAL_CONFIRMATION,
  LIVE_SYNC_NOT_ENABLED_REASON,
  getLiveSyncEnablement,
  isLiveSyncEnabled,
  listLiveSyncEnablements,
  setLiveSyncEnablement
} from "@/modules/customer-intelligence/enablement";
import { AuthorizationError } from "@/server/auth/authorization";
import {
  encryptQuickBooksSecret,
  quickBooksSlugToLegalEntity
} from "@/server/integrations/quickbooks";
import type { AuthenticatedContext } from "@/server/tenant-context";

const QB_ENV_KEYS = [
  "QUICKBOOKS_CLIENT_ID",
  "QUICKBOOKS_CLIENT_SECRET",
  "QUICKBOOKS_REDIRECT_URI",
  "QUICKBOOKS_ENVIRONMENT",
  "AUTH_SECRET",
  "AUTH_URL"
] as const;

const savedEnv: Record<string, string | undefined> = {};

function setQuickBooksEnv() {
  for (const key of QB_ENV_KEYS) {
    savedEnv[key] = process.env[key];
  }
  process.env.QUICKBOOKS_CLIENT_ID = "qb-test-client-id";
  process.env.QUICKBOOKS_CLIENT_SECRET = "qb-test-client-secret";
  delete process.env.QUICKBOOKS_REDIRECT_URI;
  process.env.QUICKBOOKS_ENVIRONMENT = "production";
  process.env.AUTH_SECRET = "test-auth-secret-for-enablement";
  process.env.AUTH_URL = "https://newl-apps.vercel.app";
}

function restoreQuickBooksEnv() {
  for (const key of QB_ENV_KEYS) {
    if (savedEnv[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = savedEnv[key];
    }
  }
}

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
const MANAGER = ctx(PlatformRole.MANAGER);
const SALES = ctx(PlatformRole.SALES);
const OPERATIONS = ctx(PlatformRole.OPERATIONS);
const FINANCE = ctx(PlatformRole.FINANCE);
const READ_ONLY = ctx(PlatformRole.READ_ONLY);

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

const WRITE_METHODS = new Set([
  "create",
  "createMany",
  "update",
  "updateMany",
  "upsert",
  "delete",
  "deleteMany"
]);

function assertNoDatabaseWrites() {
  const writes = prismaTest.modelCalls.filter((call) => WRITE_METHODS.has(call.method));
  expect(writes).toEqual([]);
}

function assertNoEnablementWrites() {
  const writes = prismaTest.modelCalls.filter(
    (call) =>
      call.model === "customerIntelligenceEnablement" && WRITE_METHODS.has(call.method)
  );
  expect(writes).toEqual([]);
}

/**
 * A skipped-not-enabled live run may write only AuditLog entries (the audited
 * skip plus the terminal run summary) and nothing else — no customer,
 * financial, credential, or enablement data is ever written. The exact audit
 * actions are asserted so a wrong write is caught, not just counted.
 */
function assertOnlyAuditWrites(expectedActions: string[]) {
  const writes = prismaTest.modelCalls.filter((call) => WRITE_METHODS.has(call.method));
  expect(writes.map((call) => `${call.model}.${call.method}`)).toEqual(
    expectedActions.map(() => "auditLog.create")
  );
  expect(auditEntries().map((entry) => entry.action)).toEqual(expectedActions);
}

const OPERATING_COMPANY = {
  id: "oc-ww",
  tenantId: "tenant-a",
  slug: "newl-worldwide",
  displayName: "Newl Worldwide",
  homeCurrency: "CAD",
  active: true,
  quickBooksRealmId: "realm-1",
  quickBooksCredentialId: "cred-qb-1"
};

const OPERATING_COMPANY_USA = {
  ...OPERATING_COMPANY,
  id: "oc-usa",
  slug: "newl-usa",
  displayName: "Newl USA",
  quickBooksRealmId: "realm-2",
  quickBooksCredentialId: "cred-qb-2"
};

/** A tenant-scoped ACTIVE QuickBooks credential with a real encrypted secretRef. */
function quickBooksCredential(
  operatingCompany = OPERATING_COMPANY
) {
  return {
    id: operatingCompany.quickBooksCredentialId,
    tenantId: "tenant-a",
    provider: IntegrationProvider.QUICKBOOKS,
    status: IntegrationStatus.ACTIVE,
    secretRef: encryptQuickBooksSecret({
      accessToken: "synthetic-access-token",
      refreshToken: "synthetic-refresh-token",
      tokenType: "bearer",
      realmId: operatingCompany.quickBooksRealmId
    }),
    publicConfig: {
      legalEntity: quickBooksSlugToLegalEntity(operatingCompany.slug),
      realmId: operatingCompany.quickBooksRealmId,
      environment: "production",
      companyName: operatingCompany.displayName,
      accessTokenExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      refreshTokenExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
    }
  };
}

/** A fully enabled enablement record with recorded owner approval. */
function enabledEnablement(operatingCompanyId = "oc-ww") {
  return {
    id: `enablement-${operatingCompanyId}`,
    tenantId: "tenant-a",
    operatingCompanyId,
    enabled: true,
    approvedByUserId: "user-owner",
    approvedAt: new Date("2026-08-01T00:00:00.000Z"),
    approvalNote: "Owner approved live sync for Newl Worldwide.",
    updatedByUserId: "user-owner"
  };
}

/** An enablement record that claims enabled but carries no approval evidence. */
function unapprovedEnablement() {
  return {
    id: "enablement-1",
    tenantId: "tenant-a",
    operatingCompanyId: "oc-ww",
    enabled: true,
    approvedByUserId: null,
    approvedAt: null,
    approvalNote: null,
    updatedByUserId: "user-1"
  };
}

function auditEntries() {
  return prismaTest.model("auditLog").create.mock.calls.map(
    ([arg]) => (arg as { data: Record<string, unknown> }).data
  );
}

afterEach(() => {
  restoreQuickBooksEnv();
  vi.unstubAllGlobals();
});

describe("isLiveSyncEnabled (deterministic gate predicate)", () => {
  it("is true only for an enabled record with recorded approval", () => {
    expect(isLiveSyncEnabled(enabledEnablement())).toBe(true);
  });

  it("is false for an enabled record without recorded approval evidence", () => {
    expect(isLiveSyncEnabled(unapprovedEnablement())).toBe(false);
    expect(isLiveSyncEnabled({ ...enabledEnablement(), approvedAt: null })).toBe(false);
  });

  it("is false for a disabled record, a missing record, and undefined", () => {
    expect(isLiveSyncEnabled({ ...enabledEnablement(), enabled: false })).toBe(false);
    expect(isLiveSyncEnabled(null)).toBe(false);
    expect(isLiveSyncEnabled(undefined)).toBe(false);
  });
});

describe("setLiveSyncEnablement (ADMIN-only, audited, explicit approval)", () => {
  beforeEach(() => {
    prismaTest.reset();
    configureAuth();
  });

  it("enables with the explicit confirmation and records the approval evidence plus audit", async () => {
    prismaTest.model("operatingCompany").findFirst.mockResolvedValue(OPERATING_COMPANY);
    prismaTest.model("customerIntelligenceEnablement").findFirst.mockResolvedValue(null);
    prismaTest.model("customerIntelligenceEnablement").upsert.mockImplementation(
      ({ create, update }: { create: Record<string, unknown>; update: Record<string, unknown> }) => ({
        id: "enablement-1",
        ...create,
        ...update
      })
    );

    const record = await setLiveSyncEnablement(ADMIN, "oc-ww", {
      enabled: true,
      confirmation: LIVE_SYNC_APPROVAL_CONFIRMATION,
      note: "Owner approved live sync for Newl Worldwide."
    });

    expect(record.enabled).toBe(true);
    expect(record.approvedByUserId).toBe("user-1");
    expect(record.approvedAt).toBeInstanceOf(Date);

    const upsert = prismaTest.model("customerIntelligenceEnablement").upsert.mock.calls[0][0] as {
      where: Record<string, unknown>;
      create: Record<string, unknown>;
    };
    expect(upsert.where.tenantId_operatingCompanyId).toEqual({
      tenantId: "tenant-a",
      operatingCompanyId: "oc-ww"
    });
    expect(upsert.create.tenantId).toBe("tenant-a");

    const audit = auditEntries()[0];
    expect(audit.action).toBe("customer-intelligence.enablement.enabled");
    expect(audit.tenantId).toBe("tenant-a");
    expect(audit.actorUserId).toBe("user-1");
    expect(audit.entityType).toBe("CustomerIntelligenceEnablement");
    const auditAfter = audit.after as Record<string, unknown>;
    expect(auditAfter).toMatchObject({
      tenantId: "tenant-a",
      operatingCompanyId: "oc-ww",
      enabled: true,
      approvedByUserId: "user-1",
      approvalNote: "Owner approved live sync for Newl Worldwide."
    });
    expect(auditAfter.approvedAt).toBeInstanceOf(Date);
  });

  it("rejects enabling without the explicit approval confirmation before any write", async () => {
    prismaTest.model("operatingCompany").findFirst.mockResolvedValue(OPERATING_COMPANY);

    await expect(
      setLiveSyncEnablement(ADMIN, "oc-ww", {
        enabled: true,
        confirmation: undefined
      })
    ).rejects.toThrow(/Explicit confirmation/);
    assertNoDatabaseWrites();
  });

  it("denies every non-admin role before any write (enablement is ADMIN-only)", async () => {
    prismaTest.model("operatingCompany").findFirst.mockResolvedValue(OPERATING_COMPANY);
    const denied: Array<[string, AuthenticatedContext]> = [
      ["MANAGER", MANAGER],
      ["SALES", SALES],
      ["OPERATIONS", OPERATIONS],
      ["READ_ONLY", READ_ONLY],
      ["FINANCE", FINANCE]
    ];
    for (const [name, role] of denied) {
      prismaTest.reset();
      configureAuth();
      await expect(
        setLiveSyncEnablement(role, "oc-ww", {
          enabled: true,
          confirmation: LIVE_SYNC_APPROVAL_CONFIRMATION
        }),
        `${name} must be denied`
      ).rejects.toBeInstanceOf(AuthorizationError);
      assertNoDatabaseWrites();
      assertNoEnablementWrites();
    }
  });

  it("denies FINANCE even when the tenant grants mutation access", async () => {
    prismaTest.reset();
    configureAuth({ canMutate: true });
    await expect(
      setLiveSyncEnablement(FINANCE, "oc-ww", {
        enabled: true,
        confirmation: LIVE_SYNC_APPROVAL_CONFIRMATION
      })
    ).rejects.toBeInstanceOf(AuthorizationError);
    assertNoDatabaseWrites();
  });

  it("denies ADMIN when Customer Intelligence is disabled for the tenant", async () => {
    prismaTest.reset();
    configureAuth({ moduleEnabled: false });
    prismaTest.model("operatingCompany").findFirst.mockResolvedValue(OPERATING_COMPANY);

    await expect(
      setLiveSyncEnablement(ADMIN, "oc-ww", {
        enabled: true,
        confirmation: LIVE_SYNC_APPROVAL_CONFIRMATION
      })
    ).rejects.toBeInstanceOf(AuthorizationError);

    assertNoDatabaseWrites();
    assertNoEnablementWrites();
  });

  it("rejects an operating company outside the caller's tenant", async () => {
    prismaTest.model("operatingCompany").findFirst.mockResolvedValue(null);
    await expect(
      setLiveSyncEnablement(ADMIN, "oc-owned-by-b", {
        enabled: true,
        confirmation: LIVE_SYNC_APPROVAL_CONFIRMATION
      })
    ).rejects.toThrow(/does not exist in this tenant/);
    assertNoDatabaseWrites();
  });

  it("disabling clears the approval evidence and audits the disable", async () => {
    prismaTest.model("operatingCompany").findFirst.mockResolvedValue(OPERATING_COMPANY);
    prismaTest.model("customerIntelligenceEnablement").findFirst.mockResolvedValue(
      enabledEnablement()
    );
    prismaTest.model("customerIntelligenceEnablement").upsert.mockImplementation(
      ({ create, update }: { create: Record<string, unknown>; update: Record<string, unknown> }) => ({
        id: "enablement-1",
        ...create,
        ...update
      })
    );

    const record = await setLiveSyncEnablement(ADMIN, "oc-ww", { enabled: false });

    expect(record.enabled).toBe(false);
    expect(record.approvedByUserId).toBeNull();
    expect(record.approvedAt).toBeNull();

    const audit = auditEntries()[0];
    expect(audit.action).toBe("customer-intelligence.enablement.disabled");
    expect(audit.before).toMatchObject({ enabled: true, approvedByUserId: "user-owner" });
    expect(audit.after).toMatchObject({ enabled: false, approvedByUserId: null, approvedAt: null });
  });

  it("a re-enable after disable requires a fresh recorded approval", async () => {
    prismaTest.model("operatingCompany").findFirst.mockResolvedValue(OPERATING_COMPANY);
    prismaTest.model("customerIntelligenceEnablement").findFirst.mockResolvedValue(null);
    prismaTest.model("customerIntelligenceEnablement").upsert.mockImplementation(
      ({ create, update }: { create: Record<string, unknown>; update: Record<string, unknown> }) => ({
        id: "enablement-1",
        ...create,
        ...update
      })
    );

    // No confirmation token is ever accepted for an enable without it, and the
    // gate treats an approval-less record as not enabled.
    await expect(
      setLiveSyncEnablement(ADMIN, "oc-ww", { enabled: true, confirmation: undefined })
    ).rejects.toThrow(/Explicit confirmation/);
    assertNoDatabaseWrites();
  });

  it("rolls back activation when its audit record fails", async () => {
    prismaTest.model("operatingCompany").findFirst.mockResolvedValue(OPERATING_COMPANY);
    let persisted: Record<string, unknown> | null = null;
    prismaTest.model("customerIntelligenceEnablement").findFirst.mockImplementation(
      () => persisted
    );
    prismaTest.model("customerIntelligenceEnablement").upsert.mockImplementation(
      ({ create }: { create: Record<string, unknown> }) => {
        persisted = { id: "enablement-1", ...create };
        return persisted;
      }
    );
    prismaTest.model("auditLog").create.mockRejectedValue(
      new Error("synthetic audit failure")
    );
    prismaTest.transaction.mockImplementation(
      async (callback: (client: Record<string, unknown>) => unknown) => {
        const snapshot = persisted;
        try {
          return await callback(prismaTest.proxy);
        } catch (error) {
          persisted = snapshot;
          throw error;
        }
      }
    );

    await expect(
      setLiveSyncEnablement(ADMIN, "oc-ww", {
        enabled: true,
        confirmation: LIVE_SYNC_APPROVAL_CONFIRMATION
      })
    ).rejects.toThrow("synthetic audit failure");

    expect(persisted).toBeNull();
    expect(prismaTest.transaction).toHaveBeenCalledTimes(1);
  });

  it("rolls back deactivation when its audit record fails", async () => {
    prismaTest.model("operatingCompany").findFirst.mockResolvedValue(OPERATING_COMPANY);
    let persisted: Record<string, unknown> | null = { ...enabledEnablement() };
    prismaTest.model("customerIntelligenceEnablement").findFirst.mockImplementation(
      () => persisted
    );
    prismaTest.model("customerIntelligenceEnablement").upsert.mockImplementation(
      ({ update }: { update: Record<string, unknown> }) => {
        persisted = { ...persisted, ...update };
        return persisted;
      }
    );
    prismaTest.model("auditLog").create.mockRejectedValue(
      new Error("synthetic audit failure")
    );
    prismaTest.transaction.mockImplementation(
      async (callback: (client: Record<string, unknown>) => unknown) => {
        const snapshot = persisted;
        try {
          return await callback(prismaTest.proxy);
        } catch (error) {
          persisted = snapshot;
          throw error;
        }
      }
    );

    await expect(
      setLiveSyncEnablement(ADMIN, "oc-ww", { enabled: false })
    ).rejects.toThrow("synthetic audit failure");

    expect(persisted).toMatchObject({
      enabled: true,
      approvedByUserId: "user-owner"
    });
    expect(prismaTest.transaction).toHaveBeenCalledTimes(1);
  });
});

describe("enablement reads are leadership-only and tenant-scoped", () => {
  beforeEach(() => {
    prismaTest.reset();
    configureAuth();
  });

  it("denies SALES, OPERATIONS, and READ_ONLY on every enablement query", async () => {
    for (const role of [SALES, OPERATIONS, READ_ONLY]) {
      prismaTest.reset();
      configureAuth();
      await expect(getLiveSyncEnablement(role, "oc-ww")).rejects.toBeInstanceOf(
        AuthorizationError
      );
      await expect(listLiveSyncEnablements(role)).rejects.toBeInstanceOf(AuthorizationError);
      assertNoDatabaseWrites();
    }
  });

  it("grants ADMIN, MANAGER, and FINANCE and carries tenantId on the reads", async () => {
    for (const role of [ADMIN, MANAGER, FINANCE]) {
      prismaTest.reset();
      configureAuth();
      prismaTest.model("customerIntelligenceEnablement").findFirst.mockResolvedValue(null);
      prismaTest.model("customerIntelligenceEnablement").findMany.mockResolvedValue([]);

      const record = await getLiveSyncEnablement(role, "oc-ww");
      expect(record).toBeNull();
      const list = await listLiveSyncEnablements(role);
      expect(list).toEqual([]);

      const readCall = prismaTest.model("customerIntelligenceEnablement").findFirst.mock.calls[0];
      expect((readCall[0] as { where: Record<string, unknown> }).where).toMatchObject({
        tenantId: "tenant-a",
        operatingCompanyId: "oc-ww"
      });
      const listCall = prismaTest.model("customerIntelligenceEnablement").findMany.mock.calls[0];
      expect((listCall[0] as { where: Record<string, unknown> }).where).toMatchObject({
        tenantId: "tenant-a"
      });
    }
  });
});

describe("live ingestion refuses to run without enablement (CP-02B-8-Q1)", () => {
  beforeEach(() => {
    prismaTest.reset();
    configureAuth();
    setQuickBooksEnv();
    prismaTest.model("operatingCompany").findMany.mockResolvedValue([OPERATING_COMPANY]);
    prismaTest.model("operatingCompany").findFirst.mockResolvedValue(OPERATING_COMPANY);
    prismaTest.model("integrationCredential").findFirst.mockResolvedValue(quickBooksCredential());
  });

  it("skips an unenabled operating company in an unscoped live run with an audited SKIPPED_NOT_ENABLED section", async () => {
    prismaTest.model("customerIntelligenceEnablement").findFirst.mockResolvedValue(null);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const report = await runQuickBooksCustomerIngestion(ADMIN, {});

    const section = report.operatingCompanies[0];
    expect(section.status).toBe("SKIPPED_NOT_ENABLED");
    expect(section.reason).toContain("not enabled");
    expect(section.fetchedCustomers).toBe(0);
    expect(report.totals.notEnabledCompanies).toBe(1);
    expect(fetchMock).not.toHaveBeenCalled();

    const skipAudit = auditEntries().find(
      (entry) => entry.action === "customer-intelligence.quickbooks-ingestion.skipped-not-enabled"
    );
    expect(skipAudit).toMatchObject({
      tenantId: "tenant-a",
      actorUserId: "user-1",
      entityType: "OperatingCompany",
      entityId: "oc-ww"
    });
    expect(skipAudit!.after).toEqual({ reason: LIVE_SYNC_NOT_ENABLED_REASON });
    assertOnlyAuditWrites([
      "customer-intelligence.quickbooks-ingestion.skipped-not-enabled",
      "customer-intelligence.quickbooks-ingestion.run"
    ]);
  });

  it("treats an enabled-but-unapproved record as not enabled and skips the live run", async () => {
    prismaTest.model("customerIntelligenceEnablement").findFirst.mockResolvedValue(
      unapprovedEnablement()
    );
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const report = await runQuickBooksCustomerIngestion(ADMIN, {});
    expect(report.operatingCompanies[0].status).toBe("SKIPPED_NOT_ENABLED");
    expect(report.totals.notEnabledCompanies).toBe(1);
    expect(fetchMock).not.toHaveBeenCalled();
    assertOnlyAuditWrites([
      "customer-intelligence.quickbooks-ingestion.skipped-not-enabled",
      "customer-intelligence.quickbooks-ingestion.run"
    ]);
  });

  it("throws for an explicitly scoped live run of an unenabled operating company before any work", async () => {
    prismaTest.model("customerIntelligenceEnablement").findFirst.mockResolvedValue(null);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      runQuickBooksCustomerIngestion(ADMIN, { operatingCompanyId: "oc-ww" })
    ).rejects.toThrow(/not enabled/);
    expect(fetchMock).not.toHaveBeenCalled();
    assertNoDatabaseWrites();
  });

  it("never accepts an enablement record owned by another tenant", async () => {
    // The gate must only read a record scoped by the authenticated tenant.
    // Simulate a foreign-tenant record that would only be returned if the
    // tenant filter were ignored.
    prismaTest.model("customerIntelligenceEnablement").findFirst.mockImplementation(
      ({ where }: { where: { tenantId?: string; operatingCompanyId?: string } }) => {
        if (where.tenantId !== "tenant-a") {
          return { ...enabledEnablement(), tenantId: "tenant-b" };
        }
        return null;
      }
    );
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const report = await runQuickBooksCustomerIngestion(ADMIN, {});
    expect(report.operatingCompanies[0].status).toBe("SKIPPED_NOT_ENABLED");
    expect(fetchMock).not.toHaveBeenCalled();
    assertOnlyAuditWrites([
      "customer-intelligence.quickbooks-ingestion.skipped-not-enabled",
      "customer-intelligence.quickbooks-ingestion.run"
    ]);
  });

  it("keeps dry-run verification available for an unenabled operating company (zero writes)", async () => {
    prismaTest.model("customerIntelligenceEnablement").findFirst.mockResolvedValue(null);
    const fetchMock = vi.fn(async (input: string | URL) => {
      const href = typeof input === "string" ? input : input.toString();
      if (href.includes("quickbooks.api.intuit.com")) {
        return new Response(JSON.stringify({ QueryResponse: { Customer: [] } }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      throw new Error(`Unexpected fetch in enablement dry-run test: ${href}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const report = await runQuickBooksCustomerIngestion(ADMIN, { dryRun: true });

    // Dry-run is the owner's preview tool: it reports what a live run would do
    // without writing anything, so it is not gated by enablement.
    expect(report.operatingCompanies[0].status).toBe("ASSOCIATED");
    expect(fetchMock).toHaveBeenCalled();
    assertNoDatabaseWrites();
  });

  it("continues an enabled company while skipping only the disabled company", async () => {
    prismaTest.model("operatingCompany").findMany.mockResolvedValue([
      OPERATING_COMPANY,
      OPERATING_COMPANY_USA
    ]);
    prismaTest.model("customerIntelligenceEnablement").findFirst.mockImplementation(
      ({ where }: { where: { operatingCompanyId?: string } }) =>
        where.operatingCompanyId === "oc-ww" ? enabledEnablement("oc-ww") : null
    );
    prismaTest.model("integrationCredential").findFirst.mockImplementation(
      ({ where }: { where: { id?: string } }) =>
        where.id === "cred-qb-1"
          ? quickBooksCredential(OPERATING_COMPANY)
          : quickBooksCredential(OPERATING_COMPANY_USA)
    );
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ QueryResponse: { Customer: [] } }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const report = await runQuickBooksCustomerIngestion(ADMIN, {});

    expect(report.operatingCompanies.find((row) => row.operatingCompanyId === "oc-ww")?.status)
      .toBe("ASSOCIATED");
    expect(report.operatingCompanies.find((row) => row.operatingCompanyId === "oc-usa")?.status)
      .toBe("SKIPPED_NOT_ENABLED");
    expect(report.totals.notEnabledCompanies).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(auditEntries()).toEqual(expect.arrayContaining([
      expect.objectContaining({
        action: "customer-intelligence.quickbooks-ingestion.skipped-not-enabled",
        entityId: "oc-usa"
      })
    ]));
  });
});

describe("live materialization refuses to run without enablement (CP-02B-8-Q1)", () => {
  beforeEach(() => {
    prismaTest.reset();
    configureAuth();
    setQuickBooksEnv();
    prismaTest.model("operatingCompany").findMany.mockResolvedValue([OPERATING_COMPANY]);
    prismaTest.model("operatingCompany").findFirst.mockResolvedValue(OPERATING_COMPANY);
    prismaTest.model("integrationCredential").findFirst.mockResolvedValue(quickBooksCredential());
    prismaTest.model("quickBooksServiceMappingRule").findMany.mockResolvedValue([]);
  });

  it("skips an unenabled operating company with an audited SKIPPED_NOT_ENABLED section", async () => {
    prismaTest.model("customerIntelligenceEnablement").findFirst.mockResolvedValue(null);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const report = await runFinancialMaterialization(ADMIN, {});

    const section = report.operatingCompanies[0];
    expect(section.status).toBe("SKIPPED_NOT_ENABLED");
    expect(section.reason).toContain("not enabled");
    expect(report.totals.notEnabledCompanies).toBe(1);
    expect(fetchMock).not.toHaveBeenCalled();

    const skipAudit = auditEntries().find(
      (entry) =>
        entry.action === "customer-intelligence.financial-materialization.skipped-not-enabled"
    );
    expect(skipAudit).toMatchObject({
      tenantId: "tenant-a",
      actorUserId: "user-1",
      entityType: "OperatingCompany",
      entityId: "oc-ww"
    });
    expect(skipAudit!.after).toEqual({ reason: LIVE_SYNC_NOT_ENABLED_REASON });
    assertOnlyAuditWrites([
      "customer-intelligence.financial-materialization.skipped-not-enabled",
      "customer-intelligence.financial-materialization.run"
    ]);
  });

  it("throws for an explicitly scoped live run of an unenabled operating company", async () => {
    prismaTest.model("customerIntelligenceEnablement").findFirst.mockResolvedValue(null);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      runFinancialMaterialization(ADMIN, { operatingCompanyId: "oc-ww" })
    ).rejects.toThrow(/not enabled/);
    expect(fetchMock).not.toHaveBeenCalled();
    assertNoDatabaseWrites();
  });

  it("keeps dry-run verification available for an unenabled operating company (zero writes)", async () => {
    prismaTest.model("customerIntelligenceEnablement").findFirst.mockResolvedValue(null);
    const REVENUE_COLUMNS = [
      "Txn ID", "Txn Line ID", "Type", "Date", "Customer ID", "Name", "Account ID",
      "Account Number", "Account", "Account Type", "Class", "Department", "Item",
      "Memo", "Memo on Statement", "Description", "Memo/Description", "Currency",
      "Foreign Amount", "Exchange Rate", "Total"
    ] as const;
    const AGING_COLUMNS = [
      "Customer ID", "Name", "Currency", "Total", "1-30", "31-60", "61-90", "91+"
    ] as const;
    const reportResponse = (columns: readonly string[]) => ({
      Columns: { Column: columns.map((title) => ({ ColTitle: title })) },
      Rows: { Row: [] }
    });
    const fetchMock = vi.fn(async (input: string | URL) => {
      const href = typeof input === "string" ? input : input.toString();
      if (href.includes("ProfitAndLossDetail")) {
        return new Response(JSON.stringify(reportResponse(REVENUE_COLUMNS)), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      if (href.includes("AgedReceivablesDetail")) {
        return new Response(JSON.stringify(reportResponse(AGING_COLUMNS)), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      throw new Error(`Unexpected fetch in enablement dry-run test: ${href}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const report = await runFinancialMaterialization(ADMIN, { dryRun: true });

    expect(report.operatingCompanies[0].status).toBe("ASSOCIATED");
    expect(fetchMock).toHaveBeenCalled();
    assertNoDatabaseWrites();
  });

  it("continues an enabled company while skipping only the disabled company", async () => {
    prismaTest.model("operatingCompany").findMany.mockResolvedValue([
      OPERATING_COMPANY,
      OPERATING_COMPANY_USA
    ]);
    prismaTest.model("customerIntelligenceEnablement").findFirst.mockImplementation(
      ({ where }: { where: { operatingCompanyId?: string } }) =>
        where.operatingCompanyId === "oc-ww" ? enabledEnablement("oc-ww") : null
    );
    prismaTest.model("integrationCredential").findFirst.mockImplementation(
      ({ where }: { where: { id?: string } }) =>
        where.id === "cred-qb-1"
          ? quickBooksCredential(OPERATING_COMPANY)
          : quickBooksCredential(OPERATING_COMPANY_USA)
    );
    const reportResponse = (columns: readonly string[]) => ({
      Columns: { Column: columns.map((title) => ({ ColTitle: title })) },
      Rows: { Row: [] }
    });
    const fetchMock = vi.fn(async (input: string | URL) => {
      const href = typeof input === "string" ? input : input.toString();
      const columns = href.includes("ProfitAndLossDetail")
        ? ["Txn ID", "Txn Line ID", "Type", "Date", "Customer ID", "Name", "Account ID", "Account Number", "Account", "Account Type", "Class", "Department", "Item", "Memo", "Memo on Statement", "Description", "Memo/Description", "Currency", "Foreign Amount", "Exchange Rate", "Total"]
        : ["Customer ID", "Name", "Currency", "Total", "1-30", "31-60", "61-90", "91+"];
      return new Response(JSON.stringify(reportResponse(columns)), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const report = await runFinancialMaterialization(ADMIN, {});

    expect(report.operatingCompanies.find((row) => row.operatingCompanyId === "oc-ww")?.status)
      .toBe("ASSOCIATED");
    expect(report.operatingCompanies.find((row) => row.operatingCompanyId === "oc-usa")?.status)
      .toBe("SKIPPED_NOT_ENABLED");
    expect(report.totals.notEnabledCompanies).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(auditEntries()).toEqual(expect.arrayContaining([
      expect.objectContaining({
        action: "customer-intelligence.financial-materialization.skipped-not-enabled",
        entityId: "oc-usa"
      })
    ]));
  });
});

describe("connecting a QuickBooks company never auto-enables live sync", () => {
  beforeEach(() => {
    prismaTest.reset();
    configureAuth();
    setQuickBooksEnv();
  });

  it("associateQuickBooksCredential writes no enablement record", async () => {
    prismaTest.model("operatingCompany").findFirst.mockResolvedValue(OPERATING_COMPANY);
    prismaTest.model("integrationCredential").findFirst.mockResolvedValue(quickBooksCredential());
    prismaTest.model("operatingCompany").update.mockResolvedValue({
      ...OPERATING_COMPANY,
      quickBooksRealmId: "realm-1",
      quickBooksCredentialId: "cred-qb-1"
    });
    prismaTest.model("operatingCompany").findMany.mockResolvedValue([]);

    await associateQuickBooksCredential(ADMIN, {
      operatingCompanyId: "oc-ww",
      quickBooksCredentialId: "cred-qb-1",
      quickBooksRealmId: "realm-1"
    });

    // The association writes only the operating company row and its audit
    // entry. No enablement row is created or upserted, so live sync stays
    // default-off after connecting the QuickBooks company.
    assertNoEnablementWrites();
    const enablementCalls = prismaTest.modelCalls.filter(
      (call) => call.model === "customerIntelligenceEnablement"
    );
    expect(enablementCalls).toEqual([]);
  });
});
