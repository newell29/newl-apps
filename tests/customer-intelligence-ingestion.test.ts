import {
  CustomerIdentityMatchKind,
  CustomerIdentityMatchStatus,
  IntegrationProvider,
  IntegrationStatus,
  PlatformRole,
  Prisma
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
      // CP-PHASE-02B-8: live-run fixtures default to an enabled enablement
      // record with recorded owner approval so the sync behaviour under test
      // is reachable. Enablement-gating tests override this per test.
      const enablement = makeModelProxy("customerIntelligenceEnablement");
      enablement.findFirst.mockResolvedValue({
        id: "enablement-1",
        tenantId: "tenant-a",
        operatingCompanyId: "oc-ww",
        enabled: true,
        approvedByUserId: "user-owner",
        approvedAt: new Date("2026-08-01T00:00:00.000Z")
      });
    }
  };
});

// Only Prisma is mocked; the authorization module is REAL so the permission
// boundary runs against the mocked DB exactly like the foundation suite.
vi.mock("@/server/db", () => ({
  prisma: prismaTest.proxy
}));

import {
  registerOperatingCompany,
  runQuickBooksCustomerIngestion,
  upsertSourceAccount
} from "@/modules/customer-intelligence/actions";
import {
  buildQuickBooksCustomerQueryUrl,
  fetchAllQuickBooksCustomers,
  fetchQuickBooksCustomerPage,
  getUsableQuickBooksAccessToken,
  normalizeQuickBooksCustomer,
  QUICKBOOKS_CUSTOMER_PAGE_SIZE,
  quickBooksSourceRecordKey,
  type QuickBooksCustomerPayload
} from "@/modules/customer-intelligence/quickbooks-ingestion";
import { AuthorizationError } from "@/server/auth/authorization";
import {
  encryptQuickBooksSecret,
  getQuickBooksApiBaseUrl
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
  process.env.AUTH_SECRET = "test-auth-secret-for-quickbooks-ingestion";
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

const RELATIONSHIP = {
  id: "rel-1",
  tenantId: "tenant-a",
  companyId: "company-1",
  operatingCompanyId: "oc-ww",
  lifecycle: "ACTIVE_CUSTOMER",
  status: "ACTIVE"
};

/** A tenant-scoped ACTIVE QuickBooks credential with a real encrypted secretRef. */
function quickBooksCredential(overrides: Record<string, unknown> = {}) {
  return {
    id: "cred-qb-1",
    tenantId: "tenant-a",
    provider: IntegrationProvider.QUICKBOOKS,
    status: IntegrationStatus.ACTIVE,
    secretRef: encryptQuickBooksSecret({
      accessToken: "synthetic-access-token",
      refreshToken: "synthetic-refresh-token",
      tokenType: "bearer",
      realmId: "realm-1"
    }),
    publicConfig: {
      realmId: "realm-1",
      legalEntity: "NEWL_WORLDWIDE",
      environment: "production",
      companyName: "Newl Worldwide",
      accessTokenExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      refreshTokenExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
    },
    ...overrides
  };
}

function completeCustomerPayload(overrides: Partial<QuickBooksCustomerPayload> = {}): QuickBooksCustomerPayload {
  return {
    Id: "1001",
    DisplayName: "Customer ABC",
    CompanyName: "Customer ABC Ltd.",
    GivenName: "Alice",
    FamilyName: "Buyer",
    PrimaryEmailAddr: { Address: "buyer@example.com" },
    PrimaryPhone: { FreeFormNumber: "416-555-0134" },
    BillAddr: {
      Line1: "123 Main St",
      City: "Toronto",
      CountrySubDivisionCode: "ON",
      PostalCode: "M5V 2T6",
      Country: "CA"
    },
    ShipAddr: { Line1: "123 Main St", City: "Toronto", PostalCode: "M5V 2T6" },
    CurrencyRef: { value: "CAD", name: "Canadian Dollar" },
    ParentRef: { value: "900" },
    Active: true,
    Notes: "Warehouse account",
    MetaData: { LastUpdatedTime: "2026-07-01T12:00:00Z" },
    ...overrides
  };
}

/**
 * Stub global fetch for the QuickBooks API. Token refresh (oauth platform) and
 * customer query (quickbooks api) are routed separately; any unexpected request
 * fails the test.
 */
function stubQuickBooksFetch(customers: QuickBooksCustomerPayload[]) {
  const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
    const href = typeof input === "string" ? input : input.toString();
    if (href.includes("oauth.platform.intuit.com")) {
      expect(init?.method).toBe("POST");
      return new Response(
        JSON.stringify({
          access_token: "refreshed-access-token",
          refresh_token: "refreshed-refresh-token",
          expires_in: 3600,
          x_refresh_token_expires_in: 86400,
          token_type: "bearer"
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }
    if (href.includes("quickbooks.api.intuit.com")) {
      // The customer query is GET-only; any other method fails the test.
      expect(init?.method === undefined || init?.method === "GET").toBe(true);
      const headers = (init?.headers ?? {}) as Record<string, string>;
      expect(headers.Authorization).toMatch(/^Bearer /);
      return new Response(
        JSON.stringify({ QueryResponse: { Customer: customers } }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }
    throw new Error(`Unexpected fetch in ingestion test: ${href}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  restoreQuickBooksEnv();
  vi.unstubAllGlobals();
});

describe("normalizeQuickBooksCustomer (partial and completely missing evidence)", () => {
  beforeEach(() => {
    setQuickBooksEnv();
  });

  it("maps a complete QuickBooks customer deterministically", () => {
    const normalized = normalizeQuickBooksCustomer(completeCustomerPayload(), "realm-1");

    expect(normalized.realmId).toBe("realm-1");
    expect(normalized.quickBooksCustomerId).toBe("1001");
    expect(normalized.displayName).toBe("Customer ABC");
    expect(normalized.companyName).toBe("Customer ABC Ltd.");
    expect(normalized.email).toBe("buyer@example.com");
    expect(normalized.phone).toBe("416-555-0134");
    expect(normalized.currency).toBe("CAD");
    expect(normalized.parentQuickBooksCustomerId).toBe("900");
    expect(normalized.active).toBe(true);
    expect(normalized.notes).toBe("Warehouse account");
    expect(normalized.lastUpdatedAt).toBe("2026-07-01T12:00:00Z");
    expect(normalized.billingAddress).not.toBeNull();
    expect(normalized.shippingAddress).not.toBeNull();
  });

  it("stores partially populated evidence as missing (null), never invented", () => {
    const normalized = normalizeQuickBooksCustomer(
      completeCustomerPayload({
        PrimaryEmailAddr: undefined,
        PrimaryPhone: { FreeFormNumber: "   " },
        BillAddr: undefined,
        CurrencyRef: undefined
      }),
      "realm-1"
    );

    expect(normalized.email).toBeNull();
    expect(normalized.phone).toBeNull();
    expect(normalized.billingAddress).toBeNull();
    expect(normalized.currency).toBeNull();
    expect(normalized.displayName).toBe("Customer ABC");
  });

  it("stores a completely missing customer as all-null (never invented)", () => {
    const normalized = normalizeQuickBooksCustomer({}, "realm-1");

    expect(normalized.displayName).toBeNull();
    expect(normalized.email).toBeNull();
    expect(normalized.phone).toBeNull();
    expect(normalized.currency).toBeNull();
    expect(normalized.active).toBeNull();
    expect(normalized.billingAddress).toBeNull();
    expect(normalized.shippingAddress).toBeNull();
  });

  it("derives the idempotent source record key as realm:customer", () => {
    expect(quickBooksSourceRecordKey("realm-1", "1001")).toBe("realm-1:1001");
    expect(quickBooksSourceRecordKey("realm-9", "42")).toBe("realm-9:42");
  });
});

describe("GET-only QuickBooks customer fetch", () => {
  beforeEach(() => {
    setQuickBooksEnv();
  });

  it("builds a GET query URL against the realm query endpoint (token stays out of the URL)", () => {
    const url = buildQuickBooksCustomerQueryUrl({
      realmId: "realm-1",
      startPosition: 1,
      maxResults: 1000
    });
    expect(url.startsWith(`${getQuickBooksApiBaseUrl()}/v3/company/realm-1/query`)).toBe(true);
    const query = new URL(url).searchParams.get("query");
    expect(query).toContain("select * from Customer");
    expect(query).toContain("startposition 1");
    expect(query).toContain("maxresults 1000");
    // The access token is carried by the Authorization header of the request,
    // never embedded in the query URL.
    expect(url).not.toContain("token");
  });

  it("fetches one page with a GET request, Bearer auth, and parses QueryResponse", async () => {
    const customers = [completeCustomerPayload()];
    const fetchMock = stubQuickBooksFetch(customers);

    const page = await fetchQuickBooksCustomerPage({
      realmId: "realm-1",
      accessToken: "synthetic-access-token",
      startPosition: 1
    });

    expect(page).toEqual(customers);
    const queryCall = fetchMock.mock.calls.find(([input]) =>
      String(input).includes("quickbooks.api.intuit.com")
    )!;
    const headers = (queryCall[1]?.headers ?? {}) as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer synthetic-access-token");
  });

  it("paginates until a short page is returned", async () => {
    const firstPage = Array.from({ length: QUICKBOOKS_CUSTOMER_PAGE_SIZE }, (_, index) => ({
      Id: String(1000 + index),
      DisplayName: `Bulk Customer ${index}`
    }));
    const secondPage = [
      { Id: "2001", DisplayName: "Last Customer" },
      { Id: "2002", DisplayName: "Final Customer" }
    ];
    const fetchMock = vi.fn(async (input: string | URL) => {
      const href = typeof input === "string" ? input : input.toString();
      expect(href).toContain("quickbooks.api.intuit.com");
      // URLSearchParams serializes spaces as "+". Read the query parameter
      // through the URL API so the mock observes the requested page instead
      // of returning the first full page forever and growing the result array
      // without bound.
      const query = new URL(href).searchParams.get("query");
      expect(query).not.toBeNull();
      const customers = query!.includes("startposition 1001") ? secondPage : firstPage;
      return new Response(JSON.stringify({ QueryResponse: { Customer: customers } }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const all = await fetchAllQuickBooksCustomers({
      realmId: "realm-1",
      accessToken: "synthetic-access-token"
    });

    expect(all).toHaveLength(QUICKBOOKS_CUSTOMER_PAGE_SIZE + 2);
    expect(fetchMock.mock.calls).toHaveLength(2);
    expect(
      fetchMock.mock.calls.map(([input]) =>
        new URL(String(input)).searchParams.get("query")
      )
    ).toEqual([
      `select * from Customer startposition 1 maxresults ${QUICKBOOKS_CUSTOMER_PAGE_SIZE}`,
      `select * from Customer startposition 1001 maxresults ${QUICKBOOKS_CUSTOMER_PAGE_SIZE}`
    ]);
  });

  it("throws a readable error when the query response is not OK", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response("SYNTHETIC_PRIVATE_VALUE_SHOULD_NOT_PERSIST", { status: 500 })
      )
    );
    await expect(
      fetchQuickBooksCustomerPage({
        realmId: "realm-1",
        accessToken: "synthetic-access-token",
        startPosition: 1
      })
    ).rejects.toThrow("QuickBooks customer query failed with status 500");
  });
});

describe("permissions: ADMIN-only guarded ingestion entry point", () => {
  beforeEach(() => {
    prismaTest.reset();
    configureAuth();
    setQuickBooksEnv();
  });

  it("denies every non-admin role before database writes or QuickBooks fetches", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
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
        runQuickBooksCustomerIngestion(role, { dryRun: true }),
        `${name} must be denied even for a dry run`
      ).rejects.toBeInstanceOf(AuthorizationError);
      assertNoDatabaseWrites();
      expect(fetchMock, `${name} dry run must not reach QuickBooks`).not.toHaveBeenCalled();

      prismaTest.reset();
      configureAuth();
      await expect(
        runQuickBooksCustomerIngestion(role, { operatingCompanyId: "oc-ww" }),
        `${name} must be denied for a live run`
      ).rejects.toBeInstanceOf(AuthorizationError);
      assertNoDatabaseWrites();
      expect(fetchMock, `${name} live run must not reach QuickBooks`).not.toHaveBeenCalled();
    }
  });

  it("denies FINANCE even when the tenant grants mutation access (ingestion is ADMIN-only)", async () => {
    prismaTest.reset();
    configureAuth({ canMutate: true });
    await expect(runQuickBooksCustomerIngestion(FINANCE, {})).rejects.toBeInstanceOf(
      AuthorizationError
    );
    assertNoDatabaseWrites();
  });
});

describe("operating-company QuickBooks association boundary", () => {
  beforeEach(() => {
    prismaTest.reset();
    configureAuth();
  });

  it("cannot write QuickBooks references through registerOperatingCompany", async () => {
    prismaTest.model("operatingCompany").findFirst.mockResolvedValue(null);
    prismaTest.model("operatingCompany").upsert.mockImplementation(
      ({ create }: { create: Record<string, unknown> }) => ({ id: "oc-new", ...create })
    );

    // Simulate an untyped/runtime caller attempting the removed fields. Only
    // associateQuickBooksCredential may persist them after tenant/provider/
    // status/realm validation and its dedicated audit.
    const attemptedBypass = {
      slug: "synthetic-company",
      displayName: "Synthetic Company",
      quickBooksRealmId: "realm-unvalidated",
      quickBooksCredentialId: "credential-unvalidated"
    } as Parameters<typeof registerOperatingCompany>[1];

    await registerOperatingCompany(ADMIN, attemptedBypass);

    const upsert = prismaTest.model("operatingCompany").upsert.mock.calls[0][0] as {
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    };
    expect(upsert.create).not.toHaveProperty("quickBooksRealmId");
    expect(upsert.create).not.toHaveProperty("quickBooksCredentialId");
    expect(upsert.update).not.toHaveProperty("quickBooksRealmId");
    expect(upsert.update).not.toHaveProperty("quickBooksCredentialId");
    expect(prismaTest.model("integrationCredential").findFirst).not.toHaveBeenCalled();
  });
});

describe("unassociated operating companies are skipped with an audited warning", () => {
  beforeEach(() => {
    prismaTest.reset();
    configureAuth();
    setQuickBooksEnv();
  });

  it("skips an operating company without an associated credential and audits the warning", async () => {
    prismaTest.model("operatingCompany").findMany.mockResolvedValue([
      { ...OPERATING_COMPANY, quickBooksCredentialId: null, quickBooksRealmId: null }
    ]);

    const report = await runQuickBooksCustomerIngestion(ADMIN, {});

    expect(report.operatingCompanies).toHaveLength(1);
    const section = report.operatingCompanies[0];
    expect(section.status).toBe("SKIPPED_UNASSOCIATED");
    expect(section.reason).toContain("no associated QuickBooks credential");
    expect(section.fetchedCustomers).toBe(0);
    expect(report.totals.unassociatedCompanies).toBe(1);

    const audit = prismaTest.model("auditLog").create.mock.calls[0][0] as {
      data: Record<string, unknown>;
    };
    expect(audit.data.action).toBe("customer-intelligence.quickbooks-ingestion.skipped-unassociated");
    expect(audit.data.tenantId).toBe("tenant-a");
    expect(audit.data.entityType).toBe("OperatingCompany");
    expect(audit.data.entityId).toBe("oc-ww");
    // No customer persistence of any kind.
    expect(prismaTest.model("customerSourceAccount").upsert.mock.calls.length).toBe(0);
    expect(prismaTest.model("customerIdentityMatch").create.mock.calls.length).toBe(0);
  });

  it("skips an operating company whose associated credential is missing, inactive, or not QuickBooks", async () => {
    for (const credential of [
      null,
      quickBooksCredential({ status: IntegrationStatus.DISABLED }),
      quickBooksCredential({ provider: IntegrationProvider.UPS })
    ]) {
      prismaTest.reset();
      configureAuth();
      prismaTest.model("operatingCompany").findMany.mockResolvedValue([OPERATING_COMPANY]);
      prismaTest.model("integrationCredential").findFirst.mockResolvedValue(credential);

      const report = await runQuickBooksCustomerIngestion(ADMIN, {});
      const section = report.operatingCompanies[0];
      expect(section.status).toBe("SKIPPED_UNASSOCIATED");
      expect(section.reason).toMatch(/missing|not ACTIVE|not a QuickBooks credential/i);
    }
  });

  it("rejects an operating company id from another tenant before any work", async () => {
    prismaTest.model("operatingCompany").findFirst.mockResolvedValue(null);
    await expect(
      runQuickBooksCustomerIngestion(ADMIN, { operatingCompanyId: "oc-owned-by-b" })
    ).rejects.toThrow(/does not exist in this tenant/);
    assertNoDatabaseWrites();
  });
});

describe("ingestion run and error audit contract", () => {
  beforeEach(() => {
    prismaTest.reset();
    configureAuth();
    setQuickBooksEnv();
    prismaTest.model("operatingCompany").findMany.mockResolvedValue([OPERATING_COMPANY]);
    prismaTest.model("integrationCredential").findFirst.mockResolvedValue(quickBooksCredential());
  });

  function auditEntries() {
    return prismaTest.model("auditLog").create.mock.calls.map(
      ([arg]) => (arg as { data: Record<string, unknown> }).data
    );
  }

  function expectNoSecretAuditEvidence(entries: Record<string, unknown>[]) {
    const serialized = JSON.stringify(entries);
    expect(serialized).not.toContain("synthetic-access-token");
    expect(serialized).not.toContain("synthetic-refresh-token");
    expect(serialized).not.toContain("secretRef");
    expect(serialized).not.toContain("Authorization");
  }

  it("audits a successful non-dry run with only authenticated ownership and aggregate results", async () => {
    stubQuickBooksFetch([]);

    const report = await runQuickBooksCustomerIngestion(ADMIN, {});
    const entries = auditEntries();

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      tenantId: "tenant-a",
      actorUserId: "user-1",
      action: "customer-intelligence.quickbooks-ingestion.run",
      entityType: "QuickBooksIngestion",
      entityId: null,
      after: {
        dryRun: false,
        startedAt: report.startedAt,
        completedAt: report.completedAt,
        operatingCompanyCount: 1,
        operatingCompanyStatuses: {
          associated: 1,
          skippedUnassociated: 0,
          error: 0
        },
        totals: report.totals
      }
    });
    expect(report.totals.erroredCompanies).toBe(0);
    expectNoSecretAuditEvidence(entries);
  });

  it("audits token-acquisition failure and the final run without exposing credentials", async () => {
    prismaTest.model("integrationCredential").findFirst.mockResolvedValue(
      quickBooksCredential({ secretRef: null })
    );
    const fetchMock = stubQuickBooksFetch([]);

    const report = await runQuickBooksCustomerIngestion(ADMIN, {});
    const entries = auditEntries();

    expect(report.operatingCompanies[0].status).toBe("ERROR");
    expect(report.operatingCompanies[0].reason).toContain("usable QuickBooks access token");
    expect(report.totals.erroredCompanies).toBe(1);
    expect(entries.map((entry) => entry.action)).toEqual([
      "customer-intelligence.quickbooks-ingestion.error",
      "customer-intelligence.quickbooks-ingestion.run"
    ]);
    expect(entries[0]).toMatchObject({
      tenantId: "tenant-a",
      actorUserId: "user-1",
      entityType: "OperatingCompany",
      entityId: "oc-ww"
    });
    expect(entries[1]).toMatchObject({
      tenantId: "tenant-a",
      actorUserId: "user-1",
      entityType: "QuickBooksIngestion",
      after: { totals: report.totals }
    });
    expect(entries[1].after).not.toHaveProperty("operatingCompanies");
    expect(fetchMock).not.toHaveBeenCalled();
    expectNoSecretAuditEvidence(entries);
  });

  it("audits a QuickBooks fetch failure without persisting arbitrary upstream content", async () => {
    const upstreamBody =
      "SYNTHETIC_PRIVATE_VALUE_SHOULD_NOT_PERSIST synthetic-customer@example.com";
    const fetchMock = vi.fn(async () =>
      new Response(upstreamBody, { status: 503 })
    );
    vi.stubGlobal("fetch", fetchMock);

    const report = await runQuickBooksCustomerIngestion(ADMIN, {});
    const entries = auditEntries();

    expect(report.operatingCompanies[0].status).toBe("ERROR");
    expect(report.operatingCompanies[0].reason).toContain("QuickBooks customer fetch failed");
    expect(report.totals.erroredCompanies).toBe(1);
    expect(entries.map((entry) => entry.action)).toEqual([
      "customer-intelligence.quickbooks-ingestion.error",
      "customer-intelligence.quickbooks-ingestion.run"
    ]);
    expect(entries[0]).toMatchObject({
      tenantId: "tenant-a",
      actorUserId: "user-1",
      entityType: "OperatingCompany",
      entityId: "oc-ww"
    });
    expect(entries[1]).toMatchObject({
      tenantId: "tenant-a",
      actorUserId: "user-1",
      entityType: "QuickBooksIngestion",
      after: { totals: report.totals }
    });
    expect(entries[1].after).not.toHaveProperty("operatingCompanies");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expectNoSecretAuditEvidence(entries);
    expect(JSON.stringify({ report, entries })).not.toContain(upstreamBody);
    expect(JSON.stringify({ report, entries })).not.toContain("synthetic-customer@example.com");
  });

  it("continues after a record persistence failure and audits a sanitized terminal summary", async () => {
    prismaTest.model("customerIdentityMatch").findFirst.mockResolvedValue(null);
    prismaTest.model("customerSourceAccount").findFirst.mockResolvedValue(null);
    prismaTest.model("customerIdentityMatch").create.mockImplementation(
      ({ data }: { data: Record<string, unknown> }) => {
        if (data.sourceRecordKey === "realm-1:2002") {
          throw new Error(
            "SYNTHETIC_PRIVATE_VALUE_SHOULD_NOT_PERSIST failed-customer@example.com"
          );
        }
        return { id: "match-first", ...data };
      }
    );
    stubQuickBooksFetch([
      completeCustomerPayload({ Id: "1001", DisplayName: "Synthetic First Customer" }),
      completeCustomerPayload({
        Id: "2002",
        DisplayName: "Synthetic Failed Customer",
        PrimaryEmailAddr: { Address: "failed-customer@example.com" }
      })
    ]);

    const report = await runQuickBooksCustomerIngestion(ADMIN, {});
    const entries = auditEntries();
    const terminal = entries.find(
      (entry) => entry.action === "customer-intelligence.quickbooks-ingestion.run"
    );

    expect(report.totals.unmatchedProposed).toBe(1);
    expect(report.totals.recordErrors).toBe(1);
    expect(report.totals.skipped).toBe(1);
    expect(report.operatingCompanies[0].recordErrors).toBe(1);
    expect(report.operatingCompanies[0].warnings).toContain(
      "A QuickBooks customer record failed during local processing; skipped."
    );
    expect(terminal).toMatchObject({
      tenantId: "tenant-a",
      actorUserId: "user-1",
      entityType: "QuickBooksIngestion",
      after: {
        totals: {
          unmatchedProposed: 1,
          recordErrors: 1,
          skipped: 1
        }
      }
    });
    expect(terminal?.after).not.toHaveProperty("operatingCompanies");
    const serialized = JSON.stringify(entries);
    expect(serialized).not.toContain("realm-1:2002");
    expect(serialized).not.toContain("Synthetic Failed Customer");
    expect(serialized).not.toContain("failed-customer@example.com");
    expect(serialized).not.toContain("SYNTHETIC_PRIVATE_VALUE_SHOULD_NOT_PERSIST");
  });
});

describe("matched customers: idempotent source-account upsert and lastSyncedAt", () => {
  beforeEach(() => {
    prismaTest.reset();
    configureAuth();
    setQuickBooksEnv();
    prismaTest.model("operatingCompany").findMany.mockResolvedValue([OPERATING_COMPANY]);
    prismaTest.model("integrationCredential").findFirst.mockResolvedValue(quickBooksCredential());
    prismaTest.model("companyOperatingRelationship").findFirst.mockResolvedValue(RELATIONSHIP);
  });

  it("upserts a source account keyed by (tenantId, realmId, quickBooksCustomerId) with lastSyncedAt for an APPROVED match", async () => {
    prismaTest.model("customerIdentityMatch").findFirst.mockResolvedValue({
      id: "match-approved",
      tenantId: "tenant-a",
      kind: CustomerIdentityMatchKind.QUICKBOOKS_ACCOUNT,
      companyId: "company-1",
      operatingCompanyId: "oc-ww",
      sourceRecordKey: "realm-1:1001",
      status: CustomerIdentityMatchStatus.APPROVED
    });
    prismaTest.model("customerSourceAccount").findFirst.mockResolvedValue(null);
    prismaTest.model("customerSourceAccount").upsert.mockImplementation(
      ({ create }: { create: Record<string, unknown> }) => ({ id: "account-1001", ...create })
    );

    stubQuickBooksFetch([completeCustomerPayload()]);
    const report = await runQuickBooksCustomerIngestion(ADMIN, {});

    expect(report.totals.matched).toBe(1);
    expect(report.totals.unmatchedProposed).toBe(0);

    const upsertArg = prismaTest.model("customerSourceAccount").upsert.mock.calls[0][0] as {
      where: { tenantId_realmId_quickBooksCustomerId: Record<string, unknown> };
      create: Record<string, unknown>;
    };
    expect(upsertArg.where.tenantId_realmId_quickBooksCustomerId).toEqual({
      tenantId: "tenant-a",
      realmId: "realm-1",
      quickBooksCustomerId: "1001"
    });
    expect(upsertArg.create.tenantId).toBe("tenant-a");
    expect(upsertArg.create.companyId).toBe("company-1");
    expect(upsertArg.create.operatingCompanyId).toBe("oc-ww");
    expect(upsertArg.create.companyOperatingRelationshipId).toBe("rel-1");
    expect(upsertArg.create.displayName).toBe("Customer ABC");
    expect(upsertArg.create.email).toBe("buyer@example.com");
    expect(upsertArg.create.phone).toBe("416-555-0134");
    expect(upsertArg.create.currency).toBe("CAD");
    expect(upsertArg.create.lastSyncedAt).toBeInstanceOf(Date);
    expect(upsertArg.create.billingAddress).not.toBeNull();

    // The APPROVED identity decision is never rewritten by ingestion.
    expect(prismaTest.model("customerIdentityMatch").update.mock.calls.length).toBe(0);
    expect(prismaTest.model("customerIdentityMatch").create.mock.calls.length).toBe(0);
  });

  it("re-runs are idempotent: lastSyncedAt refreshes and reviewed decisions stay untouched", async () => {
    prismaTest.model("customerIdentityMatch").findFirst.mockResolvedValue({
      id: "match-approved",
      tenantId: "tenant-a",
      kind: CustomerIdentityMatchKind.QUICKBOOKS_ACCOUNT,
      companyId: "company-1",
      operatingCompanyId: "oc-ww",
      sourceRecordKey: "realm-1:1001",
      status: CustomerIdentityMatchStatus.APPROVED
    });
    const existingAccount = {
      id: "account-1001",
      tenantId: "tenant-a",
      realmId: "realm-1",
      quickBooksCustomerId: "1001",
      companyId: "company-1",
      operatingCompanyId: "oc-ww",
      companyOperatingRelationshipId: "rel-1",
      currency: "CAD",
      displayName: "Customer ABC",
      active: true,
      email: "buyer@example.com",
      lastSyncedAt: new Date("2020-01-01T00:00:00.000Z")
    };
    prismaTest.model("customerSourceAccount").findFirst.mockImplementation(() => existingAccount);
    prismaTest.model("customerSourceAccount").upsert.mockImplementation(
      ({ update, create }: { update: Record<string, unknown>; create: Record<string, unknown> }) => ({
        id: "account-1001",
        ...create,
        ...update
      })
    );

    stubQuickBooksFetch([completeCustomerPayload()]);
    const first = await runQuickBooksCustomerIngestion(ADMIN, {});
    const second = await runQuickBooksCustomerIngestion(ADMIN, {});

    expect(first.totals.matched).toBe(1);
    expect(second.totals.matched).toBe(1);
    expect(prismaTest.model("customerSourceAccount").upsert.mock.calls).toHaveLength(2);

    const secondUpsert = prismaTest.model("customerSourceAccount").upsert.mock.calls[1][0] as {
      update: Record<string, unknown>;
    };
    expect(secondUpsert.update.lastSyncedAt).toBeInstanceOf(Date);
    expect(secondUpsert.update.displayName).toBe("Customer ABC");
    // A reviewed APPROVED match is returned unchanged: no identity row writes.
    expect(prismaTest.model("customerIdentityMatch").update.mock.calls.length).toBe(0);
    expect(prismaTest.model("customerIdentityMatch").create.mock.calls.length).toBe(0);
  });

  it("treats an existing source account as an exact persisted mapping (no identity write)", async () => {
    prismaTest.model("customerIdentityMatch").findFirst.mockResolvedValue(null);
    prismaTest.model("customerSourceAccount").findFirst.mockResolvedValue({
      id: "account-1001",
      tenantId: "tenant-a",
      realmId: "realm-1",
      quickBooksCustomerId: "1001",
      companyId: "company-1",
      operatingCompanyId: "oc-ww"
    });
    prismaTest.model("customerSourceAccount").upsert.mockImplementation(
      ({ create }: { create: Record<string, unknown> }) => ({ id: "account-1001", ...create })
    );

    stubQuickBooksFetch([completeCustomerPayload()]);
    const report = await runQuickBooksCustomerIngestion(ADMIN, {});

    expect(report.totals.matched).toBe(1);
    expect(prismaTest.model("customerIdentityMatch").create.mock.calls.length).toBe(0);
  });

  it("clears nullable source-account evidence when QuickBooks removes it", async () => {
    prismaTest.model("customerIdentityMatch").findFirst.mockResolvedValue({
      id: "match-approved",
      tenantId: "tenant-a",
      kind: CustomerIdentityMatchKind.QUICKBOOKS_ACCOUNT,
      companyId: "company-1",
      operatingCompanyId: "oc-ww",
      sourceRecordKey: "realm-1:1001",
      status: CustomerIdentityMatchStatus.APPROVED
    });
    const existingAccount = {
      id: "account-1001",
      tenantId: "tenant-a",
      realmId: "realm-1",
      quickBooksCustomerId: "1001",
      companyId: "company-1",
      operatingCompanyId: "oc-ww",
      email: "old@example.com",
      phone: "416-555-0100",
      billingAddress: { Line1: "Old address" },
      shippingAddress: { Line1: "Old shipping address" },
      parentQuickBooksCustomerId: "900",
      active: true,
      currency: "CAD"
    };
    prismaTest.model("customerSourceAccount").findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValue(existingAccount);
    prismaTest.model("customerSourceAccount").upsert.mockImplementation(
      ({ create, update }: { create: Record<string, unknown>; update: Record<string, unknown> }) => ({
        id: "account-1001",
        ...create,
        ...update
      })
    );

    stubQuickBooksFetch([
      completeCustomerPayload({
        DisplayName: "Minimal Customer",
        PrimaryEmailAddr: undefined,
        PrimaryPhone: undefined,
        BillAddr: undefined,
        ShipAddr: undefined,
        ParentRef: undefined
      })
    ]);
    const report = await runQuickBooksCustomerIngestion(ADMIN, {});

    expect(report.totals.matched).toBe(1);
    const upsertArg = prismaTest.model("customerSourceAccount").upsert.mock.calls[0][0] as {
      update: Record<string, unknown>;
    };
    expect(upsertArg.update.email).toBeNull();
    expect(upsertArg.update.phone).toBeNull();
    expect(upsertArg.update.parentQuickBooksCustomerId).toBeNull();
    expect(upsertArg.update.currency).toBe("CAD");
    // Missing address objects are stored as JSON NULL, never empty objects.
    expect(upsertArg.update.billingAddress).toBe(Prisma.JsonNull);
    expect(upsertArg.update.shippingAddress).toBe(Prisma.JsonNull);
  });

  it("skips refresh when required active and currency evidence becomes missing", async () => {
    prismaTest.model("customerIdentityMatch").findFirst.mockResolvedValue({
      id: "match-approved",
      tenantId: "tenant-a",
      kind: CustomerIdentityMatchKind.QUICKBOOKS_ACCOUNT,
      companyId: "company-1",
      operatingCompanyId: "oc-ww",
      sourceRecordKey: "realm-1:1001",
      status: CustomerIdentityMatchStatus.APPROVED
    });
    prismaTest.model("customerSourceAccount").findFirst.mockImplementation(
      ({ where }: { where: Record<string, unknown> }) =>
        "operatingCompanyId" in where && typeof where.operatingCompanyId === "object"
          ? null
          : {
              id: "account-1001",
              tenantId: "tenant-a",
              realmId: "realm-1",
              quickBooksCustomerId: "1001",
              operatingCompanyId: "oc-ww",
              email: "old@example.com",
              phone: "416-555-0100",
              billingAddress: { Line1: "Old address" },
              active: true,
              currency: "CAD"
            }
    );

    stubQuickBooksFetch([
      completeCustomerPayload({
        PrimaryEmailAddr: undefined,
        PrimaryPhone: undefined,
        BillAddr: undefined,
        ShipAddr: undefined,
        Active: undefined,
        CurrencyRef: undefined
      })
    ]);
    const report = await runQuickBooksCustomerIngestion(ADMIN, {});

    expect(report.totals.matched).toBe(0);
    expect(report.totals.skipped).toBe(1);
    expect(report.operatingCompanies[0].warnings[0]).toMatch(/currency and active status/);
    expect(prismaTest.model("customerSourceAccount").upsert).not.toHaveBeenCalled();
  });

  it("does not resolve, move, or update a source account owned by another operating company", async () => {
    prismaTest.model("customerIdentityMatch").findFirst.mockResolvedValue({
      id: "match-approved-current",
      companyId: "company-1",
      operatingCompanyId: "oc-ww",
      status: CustomerIdentityMatchStatus.APPROVED
    });
    prismaTest.model("customerSourceAccount").findFirst.mockResolvedValue({
      id: "account-other",
      tenantId: "tenant-a",
      realmId: "realm-1",
      quickBooksCustomerId: "1001",
      companyId: "company-other",
      operatingCompanyId: "oc-usa"
    });

    stubQuickBooksFetch([completeCustomerPayload()]);
    const report = await runQuickBooksCustomerIngestion(ADMIN, {});

    expect(report.totals.skipped).toBe(1);
    expect(report.operatingCompanies[0].warnings[0]).toContain("another operating company");
    expect(prismaTest.model("customerSourceAccount").upsert).not.toHaveBeenCalled();
    const conflictWhere = prismaTest.model("customerSourceAccount").findFirst.mock.calls[0][0]
      .where as Record<string, unknown>;
    expect(conflictWhere.tenantId).toBe("tenant-a");
    expect(conflictWhere.operatingCompanyId).toEqual({ not: "oc-ww" });
  });

  it("atomically prevents concurrent source-account ownership from moving across operating companies", async () => {
    let persistedAccount: Record<string, unknown> | null = null;
    let lockTail = Promise.resolve();
    prismaTest.transaction.mockImplementation(
      async (callback: (client: Record<string, unknown>) => unknown) => {
        const previous = lockTail;
        let release!: () => void;
        lockTail = new Promise<void>((resolve) => {
          release = resolve;
        });
        await previous;
        try {
          return await callback(prismaTest.proxy as Record<string, unknown>);
        } finally {
          release();
        }
      }
    );
    prismaTest.model("companyOperatingRelationship").findFirst.mockImplementation(
      ({ where }: { where: Record<string, unknown> }) => ({
        id: where.operatingCompanyId === "oc-ww" ? "rel-ww" : "rel-usa",
        tenantId: "tenant-a",
        companyId: where.companyId,
        operatingCompanyId: where.operatingCompanyId
      })
    );
    prismaTest.model("customerSourceAccount").findFirst.mockImplementation(
      () => persistedAccount
    );
    prismaTest.model("customerSourceAccount").upsert.mockImplementation(
      ({ create, update }: { create: Record<string, unknown>; update: Record<string, unknown> }) => {
        persistedAccount = persistedAccount
          ? { ...persistedAccount, ...update }
          : { id: "account-authoritative", ...create };
        return persistedAccount;
      }
    );

    const worldwide = upsertSourceAccount(ADMIN, {
      realmId: "realm-shared",
      quickBooksCustomerId: "customer-shared",
      companyId: "company-ww",
      operatingCompanyId: "oc-ww",
      companyOperatingRelationshipId: "rel-ww",
      displayName: "Synthetic Worldwide Customer"
    });
    const usa = upsertSourceAccount(ADMIN, {
      realmId: "realm-shared",
      quickBooksCustomerId: "customer-shared",
      companyId: "company-usa",
      operatingCompanyId: "oc-usa",
      companyOperatingRelationshipId: "rel-usa",
      displayName: "Synthetic USA Customer"
    });

    const [worldwideResult, usaResult] = await Promise.allSettled([worldwide, usa]);

    expect(worldwideResult.status).toBe("fulfilled");
    expect(usaResult.status).toBe("rejected");
    if (usaResult.status === "rejected") {
      expect(usaResult.reason).toBeInstanceOf(Error);
      expect((usaResult.reason as Error).message).toContain("another operating company");
    }
    expect(prismaTest.transaction).toHaveBeenCalledTimes(2);
    expect(prismaTest.queryRaw).toHaveBeenCalledTimes(2);
    expect(prismaTest.model("customerSourceAccount").upsert).toHaveBeenCalledTimes(1);
    expect(persistedAccount).toMatchObject({
      id: "account-authoritative",
      tenantId: "tenant-a",
      realmId: "realm-shared",
      quickBooksCustomerId: "customer-shared",
      companyId: "company-ww",
      operatingCompanyId: "oc-ww",
      companyOperatingRelationshipId: "rel-ww"
    });
  });

  it("skips a matched customer whose operating-company relationship is missing (reported, not invented)", async () => {
    prismaTest.model("customerIdentityMatch").findFirst.mockResolvedValue({
      id: "match-approved",
      tenantId: "tenant-a",
      kind: CustomerIdentityMatchKind.QUICKBOOKS_ACCOUNT,
      companyId: "company-1",
      operatingCompanyId: "oc-ww",
      sourceRecordKey: "realm-1:1001",
      status: CustomerIdentityMatchStatus.APPROVED
    });
    prismaTest.model("customerSourceAccount").findFirst.mockResolvedValue(null);
    prismaTest.model("companyOperatingRelationship").findFirst.mockResolvedValue(null);

    stubQuickBooksFetch([completeCustomerPayload()]);
    const report = await runQuickBooksCustomerIngestion(ADMIN, {});

    expect(report.totals.matched).toBe(0);
    expect(report.totals.skipped).toBe(1);
    expect(report.operatingCompanies[0].warnings[0]).toContain("no operating-company relationship");
    expect(prismaTest.model("customerSourceAccount").upsert.mock.calls.length).toBe(0);
  });
});

describe("unmatched customers: proposed matches with evidence (CP-02B-2-Q1 MATCH_EVIDENCE)", () => {
  beforeEach(() => {
    prismaTest.reset();
    configureAuth();
    setQuickBooksEnv();
    prismaTest.model("operatingCompany").findMany.mockResolvedValue([OPERATING_COMPANY]);
    prismaTest.model("operatingCompany").findFirst.mockResolvedValue(OPERATING_COMPANY);
    prismaTest.model("integrationCredential").findFirst.mockResolvedValue(quickBooksCredential());
    prismaTest.model("customerIdentityMatch").findFirst.mockResolvedValue(null);
    prismaTest.model("customerSourceAccount").findFirst.mockResolvedValue(null);
    prismaTest.model("customerIdentityMatch").create.mockImplementation(
      ({ data }: { data: Record<string, unknown> }) => ({ id: "match-new", ...data })
    );
  });

  it("keeps an unmatched customer as a PROPOSED match with the available evidence", async () => {
    stubQuickBooksFetch([completeCustomerPayload()]);
    const report = await runQuickBooksCustomerIngestion(ADMIN, {});

    expect(report.totals.unmatchedProposed).toBe(1);
    expect(report.totals.matched).toBe(0);

    const createArg = prismaTest.model("customerIdentityMatch").create.mock.calls[0][0] as {
      data: Record<string, unknown>;
    };
    expect(createArg.data.tenantId).toBe("tenant-a");
    expect(createArg.data.kind).toBe(CustomerIdentityMatchKind.QUICKBOOKS_ACCOUNT);
    expect(createArg.data.companyId).toBeNull();
    expect(createArg.data.operatingCompanyId).toBe("oc-ww");
    expect(createArg.data.sourceRecordKey).toBe("realm-1:1001");
    expect(createArg.data.sourceLabel).toBe("Customer ABC");
    // MATCH_EVIDENCE: never auto-created or auto-approved (CP-02B-3-Q1 MANUAL_ONLY).
    expect(createArg.data.status).toBe(CustomerIdentityMatchStatus.PROPOSED);
    const evidence = createArg.data.evidence as Record<string, unknown>;
    expect(evidence.source).toBe("QUICKBOOKS");
    expect(evidence.displayName).toBe("Customer ABC");
    expect(evidence.companyName).toBe("Customer ABC Ltd.");
    expect(evidence.givenName).toBe("Alice");
    expect(evidence.familyName).toBe("Buyer");
    expect(evidence.email).toBe("buyer@example.com");
    expect(evidence.phone).toBe("416-555-0134");
    expect(evidence.parentQuickBooksCustomerId).toBe("900");
    expect(evidence.notes).toBe("Warehouse account");
    expect(evidence.active).toBe(true);
    expect(evidence.lastUpdatedAt).toBe("2026-07-01T12:00:00Z");
  });

  it("includes only present evidence for a partially populated unmatched customer", async () => {
    stubQuickBooksFetch([
      completeCustomerPayload({
        DisplayName: "Sparse Customer",
        PrimaryEmailAddr: undefined,
        PrimaryPhone: undefined,
        BillAddr: undefined,
        CurrencyRef: undefined,
        MetaData: undefined
      })
    ]);
    await runQuickBooksCustomerIngestion(ADMIN, {});

    const createArg = prismaTest.model("customerIdentityMatch").create.mock.calls[0][0] as {
      data: Record<string, unknown>;
    };
    const evidence = createArg.data.evidence as Record<string, unknown>;
    // Missing evidence is omitted entirely; nothing is invented.
    expect(evidence.displayName).toBe("Sparse Customer");
    expect(evidence.email).toBeUndefined();
    expect(evidence.phone).toBeUndefined();
    expect(evidence.lastUpdatedAt).toBeUndefined();
  });

  it("persists a customer with only required Id/display identity and no other evidence", async () => {
    stubQuickBooksFetch([{ Id: "1001", DisplayName: "Identity Only Customer" }]);

    const report = await runQuickBooksCustomerIngestion(ADMIN, {});

    expect(report.totals.unmatchedProposed).toBe(1);
    const createArg = prismaTest.model("customerIdentityMatch").create.mock.calls[0][0] as {
      data: Record<string, unknown>;
    };
    expect(createArg.data).toMatchObject({
      tenantId: "tenant-a",
      companyId: null,
      operatingCompanyId: "oc-ww",
      sourceRecordKey: "realm-1:1001",
      sourceLabel: "Identity Only Customer",
      status: CustomerIdentityMatchStatus.PROPOSED
    });
    expect(createArg.data.evidence).toEqual({
      source: "QUICKBOOKS",
      displayName: "Identity Only Customer"
    });
  });

  it("persists a valid customer Id with no descriptive evidence for human review", async () => {
    stubQuickBooksFetch([{ Id: "1001" }]);

    const report = await runQuickBooksCustomerIngestion(ADMIN, {});

    expect(report.totals.unmatchedProposed).toBe(1);
    expect(report.totals.skipped).toBe(0);
    const createArg = prismaTest.model("customerIdentityMatch").create.mock.calls[0][0] as {
      data: Record<string, unknown>;
    };
    expect(createArg.data).toMatchObject({
      tenantId: "tenant-a",
      companyId: null,
      operatingCompanyId: "oc-ww",
      sourceRecordKey: "realm-1:1001",
      sourceLabel: null,
      status: CustomerIdentityMatchStatus.PROPOSED,
      evidence: { source: "QUICKBOOKS" }
    });
  });

  it("reports a valid customer Id with no descriptive evidence in dry-run without writes", async () => {
    stubQuickBooksFetch([{ Id: "1001" }]);

    const report = await runQuickBooksCustomerIngestion(ADMIN, { dryRun: true });

    expect(report.totals.unmatchedProposed).toBe(1);
    expect(report.totals.skipped).toBe(0);
    assertNoDatabaseWrites();
  });

  it("reuses a PROPOSED match with a reviewer-selected companyId without duplicating it", async () => {
    const selectedProposal = {
      id: "match-selected",
      tenantId: "tenant-a",
      kind: CustomerIdentityMatchKind.QUICKBOOKS_ACCOUNT,
      companyId: "company-reviewer-selected",
      operatingCompanyId: "oc-ww",
      sourceRecordKey: "realm-1:1001",
      sourceLabel: "Identity Only Customer",
      candidateCompanyId: "company-reviewer-candidate",
      score: 82,
      status: CustomerIdentityMatchStatus.PROPOSED,
      evidence: { source: "QUICKBOOKS", displayName: "Identity Only Customer" },
      reviewerUserId: "reviewer-1",
      reviewedAt: null,
      createdAt: new Date("2026-07-01T00:00:00Z"),
      updatedAt: new Date("2026-07-01T00:00:00Z")
    };
    prismaTest.model("customerIdentityMatch").findFirst.mockImplementation(
      ({ where }: { where: Record<string, unknown> }) => {
        if (where.status === CustomerIdentityMatchStatus.APPROVED) return null;
        if (where.status === CustomerIdentityMatchStatus.PROPOSED) return selectedProposal;
        return null;
      }
    );
    stubQuickBooksFetch([{ Id: "1001", DisplayName: "Identity Only Customer" }]);

    const report = await runQuickBooksCustomerIngestion(ADMIN, {});

    expect(report.totals.unmatchedProposed).toBe(0);
    expect(report.totals.unmatchedUnchanged).toBe(1);
    expect(prismaTest.model("customerIdentityMatch").create).not.toHaveBeenCalled();
    expect(prismaTest.model("customerIdentityMatch").update).not.toHaveBeenCalled();
    const proposalLookup = prismaTest.model("customerIdentityMatch").findFirst.mock.calls.find(
      ([arg]) =>
        (arg as { where: Record<string, unknown> }).where.status ===
        CustomerIdentityMatchStatus.PROPOSED
    )?.[0] as { where: Record<string, unknown> };
    expect(proposalLookup.where).not.toHaveProperty("companyId");
    expect(selectedProposal.companyId).toBe("company-reviewer-selected");
    expect(selectedProposal.candidateCompanyId).toBe("company-reviewer-candidate");
  });

  it("preserves a deferred review note across changed, partial, and missing source evidence", async () => {
    let proposal = {
      id: "match-refresh",
      tenantId: "tenant-a",
      kind: CustomerIdentityMatchKind.QUICKBOOKS_ACCOUNT,
      companyId: "company-reviewer-selected",
      operatingCompanyId: "oc-ww",
      sourceRecordKey: "realm-1:1001",
      sourceLabel: "Old Source Label",
      candidateCompanyId: "company-reviewer-candidate",
      score: 74,
      status: CustomerIdentityMatchStatus.PROPOSED,
      evidence: {
        source: "QUICKBOOKS",
        displayName: "Old Source Label",
        givenName: "Old Given",
        familyName: "Old Family",
        email: "old@example.com",
        phone: "416-555-0100",
        parentQuickBooksCustomerId: "old-parent",
        notes: "Old notes",
        reviewNote: "Owner needs to confirm this customer"
      },
      reviewerUserId: "reviewer-1",
      reviewedAt: null,
      createdAt: new Date("2026-07-01T00:00:00Z"),
      updatedAt: new Date("2026-07-01T00:00:00Z")
    };
    prismaTest.model("customerIdentityMatch").findFirst.mockImplementation(
      ({ where }: { where: Record<string, unknown> }) => {
        if (where.status === CustomerIdentityMatchStatus.APPROVED) return null;
        if (where.status === CustomerIdentityMatchStatus.PROPOSED) return proposal;
        return null;
      }
    );
    prismaTest.model("customerIdentityMatch").update.mockImplementation(
      ({ data }: { data: Record<string, unknown> }) => {
        proposal = { ...proposal, ...data, updatedAt: new Date() } as typeof proposal;
        return proposal;
      }
    );

    stubQuickBooksFetch([
      completeCustomerPayload({
        DisplayName: "Current Source Label",
        PrimaryEmailAddr: { Address: "current@example.com" }
      })
    ]);
    const changed = await runQuickBooksCustomerIngestion(ADMIN, {});

    expect(changed.totals.unmatchedRefreshed).toBe(1);
    expect(proposal.updatedAt.getTime()).toBeGreaterThan(
      new Date("2026-07-01T00:00:00Z").getTime()
    );
    expect(proposal.evidence).toMatchObject({
      displayName: "Current Source Label",
      givenName: "Alice",
      familyName: "Buyer",
      email: "current@example.com",
      parentQuickBooksCustomerId: "900",
      notes: "Warehouse account",
      reviewNote: "Owner needs to confirm this customer"
    });

    stubQuickBooksFetch([{ Id: "1001", DisplayName: "Current Source Label" }]);
    const partial = await runQuickBooksCustomerIngestion(ADMIN, {});

    expect(partial.totals.unmatchedRefreshed).toBe(1);
    expect(proposal.evidence).toEqual({
      source: "QUICKBOOKS",
      displayName: "Current Source Label",
      reviewNote: "Owner needs to confirm this customer"
    });

    stubQuickBooksFetch([{ Id: "1001" }]);
    const missing = await runQuickBooksCustomerIngestion(ADMIN, {});

    expect(missing.totals.unmatchedRefreshed).toBe(1);
    expect(proposal.sourceLabel).toBeNull();
    expect(proposal.evidence).toEqual({
      source: "QUICKBOOKS",
      reviewNote: "Owner needs to confirm this customer"
    });
    expect(proposal.companyId).toBe("company-reviewer-selected");
    expect(proposal.candidateCompanyId).toBe("company-reviewer-candidate");
    expect(proposal.score).toBe(74);
    expect(proposal.reviewerUserId).toBe("reviewer-1");
    expect(prismaTest.model("customerIdentityMatch").create).not.toHaveBeenCalled();
    expect(prismaTest.model("customerIdentityMatch").update).toHaveBeenCalledTimes(3);
    for (const [arg] of prismaTest.model("customerIdentityMatch").update.mock.calls) {
      expect(arg.where).toEqual({ tenantId_id: { tenantId: "tenant-a", id: "match-refresh" } });
      expect(Object.keys(arg.data).sort()).toEqual(["evidence", "sourceLabel"]);
    }
  });

  it("never overwrites a reviewed decision on re-run (REJECTED stays REJECTED, no write)", async () => {
    prismaTest.model("customerIdentityMatch").findFirst.mockImplementation(
      ({ where }: { where: Record<string, unknown> }) => {
        // resolveCanonicalTarget only matches APPROVED; the independent
        // reviewed-decision lookup finds the REJECTED decision.
        if (where.status === CustomerIdentityMatchStatus.APPROVED) {
          return null;
        }
        return Promise.resolve({
          id: "match-rejected",
          tenantId: "tenant-a",
          kind: CustomerIdentityMatchKind.QUICKBOOKS_ACCOUNT,
          companyId: null,
          operatingCompanyId: "oc-ww",
          sourceRecordKey: "realm-1:1001",
          sourceLabel: "Customer ABC",
          status: CustomerIdentityMatchStatus.REJECTED,
          score: 0
        });
      }
    );

    stubQuickBooksFetch([completeCustomerPayload()]);
    const report = await runQuickBooksCustomerIngestion(ADMIN, {});
    const second = await runQuickBooksCustomerIngestion(ADMIN, {});

    expect(report.totals.unmatchedProposed).toBe(0);
    expect(second.totals.unmatchedProposed).toBe(0);
    expect(report.totals.reviewedDecisionsPreserved).toBe(1);
    expect(second.totals.reviewedDecisionsPreserved).toBe(1);
    // The reviewed REJECTED decision is returned unchanged: no create/update.
    expect(prismaTest.model("customerIdentityMatch").create.mock.calls.length).toBe(0);
    expect(prismaTest.model("customerIdentityMatch").update.mock.calls.length).toBe(0);
  });

  it("preserves a REJECTED decision with a non-null canonical companyId", async () => {
    const rejected = {
      id: "match-rejected-with-company",
      tenantId: "tenant-a",
      kind: CustomerIdentityMatchKind.QUICKBOOKS_ACCOUNT,
      companyId: "company-reviewed",
      operatingCompanyId: "oc-ww",
      sourceRecordKey: "realm-1:1001",
      sourceLabel: "Customer ABC",
      status: CustomerIdentityMatchStatus.REJECTED,
      score: 0
    };
    prismaTest.model("customerIdentityMatch").findFirst.mockImplementation(
      ({ where }: { where: Record<string, unknown> }) => {
        if (where.status === CustomerIdentityMatchStatus.APPROVED) {
          return null;
        }
        const status = where.status as { in?: CustomerIdentityMatchStatus[] } | undefined;
        return status?.in?.includes(CustomerIdentityMatchStatus.REJECTED) ? rejected : null;
      }
    );

    stubQuickBooksFetch([completeCustomerPayload()]);
    const report = await runQuickBooksCustomerIngestion(ADMIN, {});

    expect(report.totals.reviewedDecisionsPreserved).toBe(1);
    expect(report.totals.unmatchedProposed).toBe(0);
    const reviewedLookup = prismaTest.model("customerIdentityMatch").findFirst.mock.calls.find(
      ([arg]) => {
        const where = (arg as { where: Record<string, unknown> }).where;
        const status = where.status as { in?: unknown[] } | undefined;
        return Array.isArray(status?.in);
      }
    )?.[0] as { where: Record<string, unknown> };
    expect(reviewedLookup.where).not.toHaveProperty("companyId");
    expect(prismaTest.model("customerIdentityMatch").create).not.toHaveBeenCalled();
    expect(prismaTest.model("customerIdentityMatch").update).not.toHaveBeenCalled();
    // Live resolution is performed under the source-key advisory lock so a
    // concurrent rerun cannot race this reviewed decision.
    expect(prismaTest.transaction).toHaveBeenCalledTimes(1);
    expect(prismaTest.queryRaw).toHaveBeenCalledTimes(1);
  });

  it("serializes concurrent unmatched reruns and returns the authoritative proposal", async () => {
    let persistedProposal: Record<string, unknown> | null = null;
    let lockTail = Promise.resolve();
    prismaTest.transaction.mockImplementation(
      async (callback: (client: Record<string, unknown>) => unknown) => {
        const previous = lockTail;
        let release!: () => void;
        lockTail = new Promise<void>((resolve) => {
          release = resolve;
        });
        await previous;
        try {
          return await callback(prismaTest.proxy as Record<string, unknown>);
        } finally {
          release();
        }
      }
    );
    prismaTest.model("customerIdentityMatch").findFirst.mockImplementation(
      ({ where }: { where: Record<string, unknown> }) => {
        if (where.status === CustomerIdentityMatchStatus.APPROVED) {
          return null;
        }
        if (where.status === CustomerIdentityMatchStatus.PROPOSED) {
          return persistedProposal;
        }
        return null;
      }
    );
    prismaTest.model("customerIdentityMatch").create.mockImplementation(
      ({ data }: { data: Record<string, unknown> }) => {
        persistedProposal = { id: "match-authoritative", ...data };
        return persistedProposal;
      }
    );

    stubQuickBooksFetch([completeCustomerPayload()]);
    const [first, second] = await Promise.all([
      runQuickBooksCustomerIngestion(ADMIN, {}),
      runQuickBooksCustomerIngestion(ADMIN, {})
    ]);

    expect(first.totals.unmatchedProposed).toBe(1);
    expect(second.totals.unmatchedProposed).toBe(0);
    expect(second.totals.unmatchedUnchanged).toBe(1);
    expect(prismaTest.transaction).toHaveBeenCalledTimes(2);
    expect(prismaTest.queryRaw).toHaveBeenCalledTimes(2);
    expect(prismaTest.model("customerIdentityMatch").create).toHaveBeenCalledTimes(1);
    expect(persistedProposal).toMatchObject({
      id: "match-authoritative",
      tenantId: "tenant-a",
      companyId: null,
      operatingCompanyId: "oc-ww",
      sourceRecordKey: "realm-1:1001",
      status: CustomerIdentityMatchStatus.PROPOSED
    });
  });

  it("does not reuse or update a REJECTED proposal from another operating company", async () => {
    prismaTest.model("customerIdentityMatch").findFirst.mockImplementation(
      ({ where }: { where: Record<string, unknown> }) => {
        expect(where.operatingCompanyId).toBe("oc-ww");
        return null;
      }
    );
    prismaTest.model("customerIdentityMatch").create.mockImplementation(
      ({ data }: { data: Record<string, unknown> }) => ({ id: "match-current", ...data })
    );

    stubQuickBooksFetch([completeCustomerPayload()]);
    const report = await runQuickBooksCustomerIngestion(ADMIN, {});

    expect(report.totals.unmatchedProposed).toBe(1);
    expect(report.totals.reviewedDecisionsPreserved).toBe(0);
    expect(prismaTest.model("customerIdentityMatch").update).not.toHaveBeenCalled();
    expect(prismaTest.model("customerIdentityMatch").create.mock.calls[0][0].data.operatingCompanyId)
      .toBe("oc-ww");
  });

  it("does not resolve or update an APPROVED match from another operating company", async () => {
    prismaTest.model("customerIdentityMatch").findFirst.mockImplementation(
      ({ where }: { where: Record<string, unknown> }) => {
        if (where.status === CustomerIdentityMatchStatus.APPROVED) {
          expect(where.operatingCompanyId).toBe("oc-ww");
          return {
            id: "match-approved-other",
            companyId: "company-other",
            operatingCompanyId: "oc-usa",
            status: CustomerIdentityMatchStatus.APPROVED
          };
        }
        return null;
      }
    );

    stubQuickBooksFetch([completeCustomerPayload()]);
    const report = await runQuickBooksCustomerIngestion(ADMIN, {});

    expect(report.totals.matched).toBe(0);
    expect(report.totals.unmatchedProposed).toBe(1);
    expect(prismaTest.model("companyOperatingRelationship").findFirst).not.toHaveBeenCalled();
    expect(prismaTest.model("customerSourceAccount").upsert).not.toHaveBeenCalled();
    expect(prismaTest.model("customerIdentityMatch").update).not.toHaveBeenCalled();
  });
});

describe("dry-run: zero writes with reporting", () => {
  beforeEach(() => {
    prismaTest.reset();
    configureAuth();
    setQuickBooksEnv();
    prismaTest.model("operatingCompany").findMany.mockResolvedValue([OPERATING_COMPANY]);
    prismaTest.model("integrationCredential").findFirst.mockResolvedValue(quickBooksCredential());
  });

  it("computes the would-be report without writing anything", async () => {
    // One customer matches via an APPROVED decision; one is unmatched.
    prismaTest.model("customerIdentityMatch").findFirst.mockImplementation(
      ({ where }: { where: Record<string, unknown> }) => {
        if (where.sourceRecordKey === "realm-1:1001") {
          return Promise.resolve({
            id: "match-approved",
            tenantId: "tenant-a",
            kind: CustomerIdentityMatchKind.QUICKBOOKS_ACCOUNT,
            companyId: "company-1",
            operatingCompanyId: "oc-ww",
            sourceRecordKey: "realm-1:1001",
            status: CustomerIdentityMatchStatus.APPROVED
          });
        }
        return null;
      }
    );
    prismaTest.model("customerSourceAccount").findFirst.mockResolvedValue(null);
    prismaTest.model("companyOperatingRelationship").findFirst.mockResolvedValue(RELATIONSHIP);

    stubQuickBooksFetch([
      completeCustomerPayload(),
      completeCustomerPayload({ Id: "2002", DisplayName: "Unmatched Corp" })
    ]);

    const report = await runQuickBooksCustomerIngestion(ADMIN, { dryRun: true });

    expect(report.dryRun).toBe(true);
    expect(report.tenantId).toBe("tenant-a");
    expect(report.totals.fetchedCustomers).toBe(2);
    expect(report.totals.matched).toBe(1);
    expect(report.totals.unmatchedProposed).toBe(1);
    expect(report.totals.reviewedDecisionsPreserved).toBe(0);
    expect(report.totals.skipped).toBe(0);
    assertNoDatabaseWrites();
  });

  it("writes nothing for an unassociated operating company in dry-run (no audit either)", async () => {
    prismaTest.model("operatingCompany").findMany.mockResolvedValue([
      { ...OPERATING_COMPANY, quickBooksCredentialId: null, quickBooksRealmId: null }
    ]);

    const report = await runQuickBooksCustomerIngestion(ADMIN, { dryRun: true });

    expect(report.operatingCompanies[0].status).toBe("SKIPPED_UNASSOCIATED");
    expect(prismaTest.model("auditLog").create.mock.calls.length).toBe(0);
    assertNoDatabaseWrites();
  });

  it("reports an expired token limitation in dry-run instead of refreshing (zero writes)", async () => {
    prismaTest.model("operatingCompany").findMany.mockResolvedValue([
      { ...OPERATING_COMPANY, quickBooksRealmId: "realm-2", quickBooksCredentialId: "cred-qb-2" }
    ]);
    prismaTest.model("integrationCredential").findFirst.mockResolvedValue(
      quickBooksCredential({
        id: "cred-qb-2",
        publicConfig: {
          realmId: "realm-2",
          legalEntity: "NEWL_WORLDWIDE",
          environment: "production",
          accessTokenExpiresAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
          refreshTokenExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
        }
      })
    );

    const report = await runQuickBooksCustomerIngestion(ADMIN, { dryRun: true });

    expect(report.operatingCompanies[0].status).toBe("ERROR");
    expect(report.operatingCompanies[0].reason).toContain("dry-run");
    expect(report.totals.erroredCompanies).toBe(1);
    expect(report.totals.fetchedCustomers).toBe(0);
    // No refresh persisted, no customer write, no audit.
    expect(prismaTest.model("integrationCredential").updateMany.mock.calls.length).toBe(0);
    expect(prismaTest.model("auditLog").create.mock.calls.length).toBe(0);
    assertNoDatabaseWrites();
  });

  it("reports a preserved REJECTED decision as unchanged, not a would-propose write", async () => {
    prismaTest.model("customerIdentityMatch").findFirst.mockImplementation(
      ({ where }: { where: Record<string, unknown> }) =>
        where.status === CustomerIdentityMatchStatus.APPROVED
          ? null
          : {
              id: "match-rejected",
              tenantId: "tenant-a",
              kind: CustomerIdentityMatchKind.QUICKBOOKS_ACCOUNT,
              companyId: null,
              operatingCompanyId: "oc-ww",
              sourceRecordKey: "realm-1:1001",
              status: CustomerIdentityMatchStatus.REJECTED
            }
    );
    prismaTest.model("customerSourceAccount").findFirst.mockResolvedValue(null);
    stubQuickBooksFetch([completeCustomerPayload()]);

    const report = await runQuickBooksCustomerIngestion(ADMIN, { dryRun: true });

    expect(report.totals.unmatchedProposed).toBe(0);
    expect(report.totals.reviewedDecisionsPreserved).toBe(1);
    assertNoDatabaseWrites();
  });

  it("reports an existing unchanged proposal separately from a new write", async () => {
    const existing = {
      id: "match-existing",
      tenantId: "tenant-a",
      kind: CustomerIdentityMatchKind.QUICKBOOKS_ACCOUNT,
      companyId: "company-reviewer-selected",
      operatingCompanyId: "oc-ww",
      sourceRecordKey: "realm-1:1001",
      sourceLabel: "Identity Only Customer",
      candidateCompanyId: null,
      score: 0,
      status: CustomerIdentityMatchStatus.PROPOSED,
      evidence: { displayName: "Identity Only Customer", source: "QUICKBOOKS" }
    };
    prismaTest.model("customerIdentityMatch").findFirst.mockImplementation(
      ({ where }: { where: Record<string, unknown> }) => {
        if (where.status === CustomerIdentityMatchStatus.APPROVED) return null;
        if (where.status === CustomerIdentityMatchStatus.PROPOSED) return existing;
        return null;
      }
    );
    prismaTest.model("customerSourceAccount").findFirst.mockResolvedValue(null);
    stubQuickBooksFetch([{ Id: "1001", DisplayName: "Identity Only Customer" }]);

    const report = await runQuickBooksCustomerIngestion(ADMIN, { dryRun: true });

    expect(report.totals.unmatchedProposed).toBe(0);
    expect(report.totals.unmatchedRefreshed).toBe(0);
    expect(report.totals.unmatchedUnchanged).toBe(1);
    expect(report.totals.reviewedDecisionsPreserved).toBe(0);
    assertNoDatabaseWrites();
  });

  it("reports an existing changed proposal as a refresh without writing it", async () => {
    prismaTest.model("customerIdentityMatch").findFirst.mockImplementation(
      ({ where }: { where: Record<string, unknown> }) => {
        if (where.status === CustomerIdentityMatchStatus.APPROVED) return null;
        if (where.status === CustomerIdentityMatchStatus.PROPOSED) {
          return {
            id: "match-stale",
            companyId: "company-reviewer-selected",
            operatingCompanyId: "oc-ww",
            sourceRecordKey: "realm-1:1001",
            sourceLabel: "Stale Label",
            status: CustomerIdentityMatchStatus.PROPOSED,
            evidence: { source: "QUICKBOOKS", displayName: "Stale Label" }
          };
        }
        return null;
      }
    );
    prismaTest.model("customerSourceAccount").findFirst.mockResolvedValue(null);
    stubQuickBooksFetch([{ Id: "1001", DisplayName: "Current Label" }]);

    const report = await runQuickBooksCustomerIngestion(ADMIN, { dryRun: true });

    expect(report.totals.unmatchedProposed).toBe(0);
    expect(report.totals.unmatchedRefreshed).toBe(1);
    expect(report.totals.unmatchedUnchanged).toBe(0);
    assertNoDatabaseWrites();
  });
});

describe("token refresh reuses refreshQuickBooksAccessToken", () => {
  beforeEach(() => {
    prismaTest.reset();
    configureAuth();
    setQuickBooksEnv();
    prismaTest.model("operatingCompany").findMany.mockResolvedValue([OPERATING_COMPANY]);
    prismaTest.model("operatingCompany").findFirst.mockResolvedValue(OPERATING_COMPANY);
    prismaTest.model("companyOperatingRelationship").findFirst.mockResolvedValue(RELATIONSHIP);
  });

  it("refreshes an expired token through refreshQuickBooksAccessToken and persists the rotation", async () => {
    prismaTest.model("integrationCredential").findFirst.mockResolvedValue(
      quickBooksCredential({
        publicConfig: {
          realmId: "realm-1",
          legalEntity: "NEWL_WORLDWIDE",
          environment: "production",
          accessTokenExpiresAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
          refreshTokenExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
        }
      })
    );
    prismaTest.model("customerIdentityMatch").findFirst.mockResolvedValue(null);
    prismaTest.model("customerSourceAccount").findFirst.mockResolvedValue(null);
    prismaTest.model("customerIdentityMatch").create.mockImplementation(
      ({ data }: { data: Record<string, unknown> }) => ({ id: "match-new", ...data })
    );
    prismaTest.model("integrationCredential").updateMany.mockResolvedValue({ count: 1 });

    const fetchMock = stubQuickBooksFetch([completeCustomerPayload()]);
    const report = await runQuickBooksCustomerIngestion(ADMIN, {});

    expect(report.totals.fetchedCustomers).toBe(1);
    // The refresh endpoint was called through refreshQuickBooksAccessToken.
    const refreshCall = fetchMock.mock.calls.find(([input]) =>
      String(input).includes("oauth.platform.intuit.com")
    )!;
    expect(refreshCall).toBeDefined();
    const body = refreshCall[1]?.body as URLSearchParams | undefined;
    expect(body?.get("grant_type")).toBe("refresh_token");
    expect(body?.get("refresh_token")).toBe("synthetic-refresh-token");

    // The rotated tokens were persisted back to the tenant-scoped credential.
    const updateArg = prismaTest.model("integrationCredential").updateMany.mock.calls[0][0] as {
      where: { id: string; tenantId: string };
      data: Record<string, unknown>;
    };
    expect(updateArg.where.id).toBe("cred-qb-1");
    expect(updateArg.where.tenantId).toBe("tenant-a");
    const nextPublicConfig = updateArg.data.publicConfig as Record<string, unknown>;
    expect(nextPublicConfig.realmId).toBe("realm-1");
    expect(String(updateArg.data.secretRef)).toContain("enc:v1");
    // The refreshed access token was used for the customer query.
    const queryCall = fetchMock.mock.calls.find(([input]) =>
      String(input).includes("quickbooks.api.intuit.com")
    )!;
    const headers = (queryCall[1]?.headers ?? {}) as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer refreshed-access-token");
  });

  it("uses a fresh token without refreshing (no credential write)", async () => {
    prismaTest.model("integrationCredential").findFirst.mockResolvedValue(quickBooksCredential());
    prismaTest.model("customerIdentityMatch").findFirst.mockResolvedValue(null);
    prismaTest.model("customerSourceAccount").findFirst.mockResolvedValue(null);
    prismaTest.model("customerIdentityMatch").create.mockImplementation(
      ({ data }: { data: Record<string, unknown> }) => ({ id: "match-new", ...data })
    );

    const fetchMock = stubQuickBooksFetch([completeCustomerPayload()]);
    await runQuickBooksCustomerIngestion(ADMIN, {});

    expect(
      fetchMock.mock.calls.some(([input]) => String(input).includes("oauth.platform.intuit.com"))
    ).toBe(false);
    expect(prismaTest.model("integrationCredential").updateMany.mock.calls.length).toBe(0);
  });
});

describe("getUsableQuickBooksAccessToken (unit)", () => {
  beforeEach(() => {
    prismaTest.reset();
    setQuickBooksEnv();
  });

  it("rejects a realm that does not match the operating company association", async () => {
    await expect(
      getUsableQuickBooksAccessToken({
        credential: quickBooksCredential(),
        tenantId: "tenant-a",
        expectedRealmId: "realm-other",
        dryRun: false
      })
    ).rejects.toThrow(/does not match/);
  });

  it("throws when the credential stores no realm or no refresh token", async () => {
    await expect(
      getUsableQuickBooksAccessToken({
        credential: quickBooksCredential({ publicConfig: { legalEntity: "NEWL_WORLDWIDE" } }),
        tenantId: "tenant-a",
        expectedRealmId: "realm-1",
        dryRun: false
      })
    ).rejects.toThrow(/missing a realm ID/);

    await expect(
      getUsableQuickBooksAccessToken({
        credential: quickBooksCredential({
          // Force the token through the refresh branch so the missing refresh
          // token is the failure, not the fresh-token fast path.
          publicConfig: {
            realmId: "realm-1",
            legalEntity: "NEWL_WORLDWIDE",
            environment: "production",
            accessTokenExpiresAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
            refreshTokenExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
          },
          secretRef: encryptQuickBooksSecret({
            accessToken: "synthetic-access-token",
            tokenType: "bearer",
            realmId: "realm-1"
          })
        }),
        tenantId: "tenant-a",
        expectedRealmId: "realm-1",
        dryRun: false
      })
    ).rejects.toThrow(/missing a refresh token/);
  });

  it("rejects a foreign-tenant credential before refresh or persistence", async () => {
    const fetchMock = stubQuickBooksFetch([]);
    await expect(
      getUsableQuickBooksAccessToken({
        credential: quickBooksCredential({ tenantId: "tenant-b" }),
        tenantId: "tenant-a",
        expectedRealmId: "realm-1",
        dryRun: false
      })
    ).rejects.toThrow(/authenticated tenant/);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(prismaTest.model("integrationCredential").updateMany).not.toHaveBeenCalled();
  });

  it("fails closed unless refresh updates exactly one tenant-owned credential", async () => {
    prismaTest.model("integrationCredential").updateMany.mockResolvedValue({ count: 0 });
    stubQuickBooksFetch([]);

    await expect(
      getUsableQuickBooksAccessToken({
        credential: quickBooksCredential({
          publicConfig: {
            realmId: "realm-1",
            accessTokenExpiresAt: new Date(Date.now() - 60_000).toISOString()
          }
        }),
        tenantId: "tenant-a",
        expectedRealmId: "realm-1",
        dryRun: false
      })
    ).rejects.toThrow(/exactly one tenant-owned credential/);
    expect(prismaTest.model("integrationCredential").updateMany.mock.calls[0][0].where).toEqual({
      id: "cred-qb-1",
      tenantId: "tenant-a"
    });
  });
});
