import {
  CustomerIdentityMatchKind,
  CustomerIdentityMatchStatus,
  IntegrationProvider,
  IntegrationStatus,
  JobStatus,
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
      transaction.mockImplementation(
        async (callback: (client: Record<string, unknown>) => unknown) => callback(proxy)
      );
    }
  };
});

// Only Prisma is mocked; the authorization module is REAL so the permission
// boundary runs against the mocked DB exactly like the other CI suites.
vi.mock("@/server/db", () => ({
  prisma: prismaTest.proxy
}));

import {
  runFinancialMaterialization,
  runQuickBooksCustomerIngestion
} from "@/modules/customer-intelligence/actions";
import {
  CUSTOMER_INTELLIGENCE_DRY_RUN_JOB_TYPE,
  runCustomerIntelligenceDryRun
} from "@/modules/customer-intelligence/dry-run";
import type { QuickBooksReportResponse } from "@/modules/customer-intelligence/financial-materialization";
import type { QuickBooksCustomerPayload } from "@/modules/customer-intelligence/quickbooks-ingestion";
import {
  evaluateReconciliationDryRun,
  type ReconciliationDryRunMatch
} from "@/modules/customer-intelligence/reconciliation";
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
  process.env.AUTH_SECRET = "test-auth-secret-for-customer-intelligence-dry-run";
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

/** Proves a call never reached any database write (including run records). */
function assertNoDatabaseWrites() {
  const writes = prismaTest.modelCalls.filter((call) => WRITE_METHODS.has(call.method));
  expect(writes).toEqual([]);
}

/**
 * The consolidated dry-run's zero-write proof: no Customer Intelligence data
 * model (or integration credential) is ever written; the only writes are the
 * run record (one AutomationJobRun create + one update) and its single
 * sanitized AuditLog entry.
 */
function assertOnlyRunRecordWrites() {
  const writes = prismaTest.modelCalls.filter((call) => WRITE_METHODS.has(call.method));
  const unexpected = writes.filter(
    (call) => call.model !== "automationJobRun" && call.model !== "auditLog"
  );
  expect(unexpected).toEqual([]);
  expect(
    writes.filter((call) => call.model === "automationJobRun" && call.method === "create")
  ).toHaveLength(1);
  expect(
    writes.filter((call) => call.model === "automationJobRun" && call.method === "update")
  ).toHaveLength(1);
  expect(writes.filter((call) => call.model === "auditLog" && call.method === "create")).toHaveLength(
    1
  );
}

// ---------------------------------------------------------------------------
// Synthetic three-operating-company fixture matrix (CP-PHASE-02B-7). Every
// customer name, email, phone, and amount below is a clearly synthetic
// reserved example; no live customer data is used anywhere in the suite.
// ---------------------------------------------------------------------------

const OPERATING_COMPANIES = [
  {
    id: "oc-ww",
    tenantId: "tenant-a",
    slug: "newl-worldwide",
    displayName: "Newl Worldwide",
    homeCurrency: "CAD",
    active: true,
    quickBooksRealmId: "realm-1",
    quickBooksCredentialId: "cred-1"
  },
  {
    id: "oc-usa",
    tenantId: "tenant-a",
    slug: "newl-usa",
    displayName: "Newl USA",
    homeCurrency: "CAD",
    active: true,
    quickBooksRealmId: "realm-2",
    quickBooksCredentialId: "cred-2"
  },
  {
    id: "oc-ne",
    tenantId: "tenant-a",
    slug: "newells-express",
    displayName: "Newell's Express and Warehousing Ltd.",
    homeCurrency: "CAD",
    active: true,
    quickBooksRealmId: "realm-3",
    quickBooksCredentialId: "cred-3"
  }
];

/** Tenant-scoped ACTIVE QuickBooks credentials keyed by operating-company credential id. */
function quickBooksCredential(overrides: Record<string, unknown> = {}) {
  return {
    id: "cred-1",
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

/**
 * Tenant-scoped ACTIVE QuickBooks credentials keyed by operating-company
 * credential id, built lazily (only once the per-test environment, including
 * `AUTH_SECRET`, is set by `setQuickBooksEnv`). Building the encrypted
 * `secretRef` at module scope would throw before any test could run.
 */
function credentialsById(): Record<string, Record<string, unknown>> {
  return {
    "cred-1": quickBooksCredential(),
    "cred-2": quickBooksCredential({
      id: "cred-2",
      publicConfig: {
        realmId: "realm-2",
        legalEntity: "NEWL_USA",
        environment: "production",
        companyName: "Newl USA",
        accessTokenExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        refreshTokenExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
      }
    }),
    "cred-3": quickBooksCredential({
      id: "cred-3",
      publicConfig: {
        realmId: "realm-3",
        legalEntity: "NEWELLS_EXPRESS",
        environment: "production",
        companyName: "Newell's Express and Warehousing Ltd.",
        accessTokenExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        refreshTokenExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
      }
    })
  };
}

/**
 * Approved identity matches that make some ingestion customers "matched"
 * (persisted canonical targets). Keys are `realm:customer` source record keys.
 */
const APPROVED_MATCHES: Record<string, { companyId: string; operatingCompanyId: string }> = {
  "realm-1:1001": { companyId: "company-1", operatingCompanyId: "oc-ww" },
  "realm-3:4004": { companyId: "company-3", operatingCompanyId: "oc-ne" }
};

/** Source accounts (one per matched/known customer) keyed by realm. */
const SOURCE_ACCOUNTS_BY_REALM: Record<
  string,
  Array<{
    id: string;
    tenantId: string;
    realmId: string;
    quickBooksCustomerId: string;
    companyId: string;
    operatingCompanyId: string;
    companyOperatingRelationshipId: string;
    currency: string;
    displayName: string;
    active: boolean;
    status: string;
    email: string | null;
    phone: string | null;
    billingAddress: unknown;
    shippingAddress: unknown;
  }>
> = {
  "realm-1": [
    {
      id: "acc-1001",
      tenantId: "tenant-a",
      realmId: "realm-1",
      quickBooksCustomerId: "1001",
      companyId: "company-1",
      operatingCompanyId: "oc-ww",
      companyOperatingRelationshipId: "rel-1",
      currency: "CAD",
      displayName: "Customer ABC",
      active: true,
      status: "ACTIVE",
      email: null,
      phone: null,
      billingAddress: null,
      shippingAddress: null
    }
  ],
  "realm-3": [
    {
      id: "acc-4004",
      tenantId: "tenant-a",
      realmId: "realm-3",
      quickBooksCustomerId: "4004",
      companyId: "company-3",
      operatingCompanyId: "oc-ne",
      companyOperatingRelationshipId: "rel-3",
      currency: "CAD",
      displayName: "Customer DEF",
      active: true,
      status: "ACTIVE",
      email: null,
      phone: null,
      billingAddress: null,
      shippingAddress: null
    }
  ]
};

const RELATIONSHIPS = [
  { id: "rel-1", tenantId: "tenant-a", companyId: "company-1", operatingCompanyId: "oc-ww", lifecycle: "PROSPECT", status: "ACTIVE" },
  { id: "rel-2", tenantId: "tenant-a", companyId: "company-2", operatingCompanyId: "oc-usa", lifecycle: "PROSPECT", status: "ACTIVE" },
  { id: "rel-3", tenantId: "tenant-a", companyId: "company-3", operatingCompanyId: "oc-ne", lifecycle: "PROSPECT", status: "ACTIVE" }
];

/** Canonical candidate companies used by reconciliation candidate scoring. */
const CANDIDATE_COMPANIES = [
  {
    id: "company-1",
    name: "Alpha Packing",
    domain: "alphapacking.example",
    customerSourceAccounts: []
  },
  {
    id: "company-2",
    name: "Gamma Group",
    domain: "gamma.example",
    customerSourceAccounts: []
  },
  {
    id: "company-3",
    name: "Delta Distribution",
    domain: "delta.example",
    customerSourceAccounts: []
  }
];

/** Persisted PROPOSED matches in the coherent database snapshot. */
const PROPOSED_MATCHES = [
  {
    id: "match-ww",
    tenantId: "tenant-a",
    kind: CustomerIdentityMatchKind.QUICKBOOKS_ACCOUNT,
    operatingCompanyId: "oc-ww",
    sourceRecordKey: "realm-1:2002",
    sourceLabel: "Prior Source Name",
    score: 0,
    evidence: {
      source: "QUICKBOOKS",
      displayName: "Prior Source Name"
    }
  },
  {
    id: "match-ne",
    tenantId: "tenant-a",
    kind: CustomerIdentityMatchKind.QUICKBOOKS_ACCOUNT,
    operatingCompanyId: "oc-ne",
    sourceRecordKey: "realm-3:5005",
    sourceLabel: "Delta Distribution",
    score: 0,
    evidence: {
      source: "QUICKBOOKS",
      displayName: "Delta Distribution",
      phone: "416-555-0199"
    }
  }
];

/**
 * QuickBooks customer payloads per realm. Realm-1 carries partial customer
 * evidence (a matched record and an existing proposal whose source evidence
 * changed); realm-2 carries a new complete source plus a completely missing
 * customer (Id only); realm-3 carries a matched record
 * with missing required fields and an unmatched partial record.
 */
const CUSTOMERS_BY_REALM: Record<string, QuickBooksCustomerPayload[]> = {
  "realm-1": [
    { Id: "1001", DisplayName: "Customer ABC", CurrencyRef: { value: "CAD" }, Active: true },
    {
      Id: "2002",
      DisplayName: "Alpha Packing Inc.",
      PrimaryEmailAddr: { Address: "purchasing@alphapacking.example" },
      CurrencyRef: { value: "CAD" },
      Active: true
    }
  ],
  "realm-2": [
    {
      Id: "3003",
      DisplayName: "Gamma Group Ltd.",
      PrimaryEmailAddr: { Address: "billing@gamma.example" },
      CurrencyRef: { value: "CAD" },
      Active: true
    },
    { Id: "3004" }
  ],
  "realm-3": [
    { Id: "4004", DisplayName: "Customer DEF", Active: true },
    { Id: "5005", DisplayName: "Delta Distribution", PrimaryPhone: { FreeFormNumber: "416-555-0199" } }
  ]
};

const REVENUE_COLUMNS = [
  "Txn ID",
  "Txn Line ID",
  "Type",
  "Date",
  "Customer ID",
  "Name",
  "Account ID",
  "Account Number",
  "Account",
  "Account Type",
  "Class",
  "Department",
  "Item",
  "Memo",
  "Memo on Statement",
  "Description",
  "Memo/Description",
  "Currency",
  "Foreign Amount",
  "Exchange Rate",
  "Total"
] as const;

const AGING_COLUMNS = [
  "Customer ID",
  "Name",
  "Currency",
  "Total",
  "1-30",
  "31-60",
  "61-90",
  "91+"
] as const;

function reportResponse(columns: readonly string[], rows: string[][]): QuickBooksReportResponse {
  return {
    Columns: { Column: columns.map((title) => ({ ColTitle: title })) },
    Rows: {
      Row: rows.map((values) => ({
        type: "Data",
        ColData: values.map((value) => ({ value }))
      }))
    }
  };
}

function revenueRow(
  overrides: Partial<Record<(typeof REVENUE_COLUMNS)[number], string>> = {}
): string[] {
  const transactionId = overrides["Txn ID"] ?? "";
  const defaults: Partial<Record<(typeof REVENUE_COLUMNS)[number], string>> = {
    "Txn Line ID": transactionId ? `${transactionId}-line-1` : "",
    Type: "Invoice",
    "Customer ID": "1001",
    "Account Type": "Income",
    Currency: "CAD"
  };
  const values: string[] = [];
  for (const column of REVENUE_COLUMNS) {
    values.push(overrides[column] ?? defaults[column] ?? "");
  }
  return values;
}

function agingRow(
  overrides: Partial<Record<(typeof AGING_COLUMNS)[number], string>> = {}
): string[] {
  const values: string[] = [];
  for (const column of AGING_COLUMNS) {
    values.push(
      overrides[column] ??
        (column === "Customer ID" ? "1001" : column === "Currency" ? "CAD" : "")
    );
  }
  return values;
}

/**
 * Report fixtures per realm. Revenue rows are dated in the previous month
 * (matching the materialization suite's documented pattern) so the open-AR
 * snapshot, which is always as-of today, forms a separate monthly bucket: one
 * revenue bucket, one open-AR bucket, plus Newl Worldwide's gross-profit
 * bucket. Realm-1 supplies complete revenue + aging detail; realm-2 supplies
 * revenue for the newly proposed source so the virtual approval mapping is
 * required for materialization; realm-3 supplies
 * complete revenue detail for its own synthetic customer (4004) with a
 * partially populated aging snapshot (one row has no balance evidence).
 */
const REVENUE_ROWS_BY_REALM: Record<string, string[][]> = {
  "realm-1": [revenueRow({ "Txn ID": "9001", Date: monthDate(-1), Name: "Customer ABC", Total: "1250.00" })],
  "realm-2": [revenueRow({ "Txn ID": "9002", Date: monthDate(-1), "Customer ID": "3003", Name: "Gamma Group Ltd.", Total: "300.00" })],
  "realm-3": [revenueRow({ "Txn ID": "9003", Date: monthDate(-1), "Customer ID": "4004", Name: "Customer DEF", Total: "400.00" })]
};

const AGING_ROWS_BY_REALM: Record<string, string[][]> = {
  "realm-1": [agingRow({ "Customer ID": "1001", Name: "Customer ABC", Total: "750.00" })],
  "realm-2": [],
  "realm-3": [
    agingRow({ "Customer ID": "4004", Name: "Customer DEF", Total: "250.00" }),
    agingRow({ "Customer ID": "9999", Name: "Missing Balance" })
  ]
};

/** First day of the month `offset` months before/after the current month, as YYYY-MM-DD. */
function monthDate(monthOffset: number): string {
  const now = new Date();
  const day = monthOffset === 0 ? Math.min(now.getUTCDate(), 15) : 15;
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + monthOffset, day));
  return date.toISOString().slice(0, 10);
}

/**
 * Stub global fetch for the GET-only QuickBooks customer query and the two
 * GET-only report endpoints, routed by realm and path. Any unexpected request
 * or non-GET method fails the test.
 */
function stubConsolidatedQuickBooksFetch(input: {
  customersByRealm: Record<string, QuickBooksCustomerPayload[]>;
  revenueRowsByRealm: Record<string, string[][]>;
  agingRowsByRealm: Record<string, string[][]>;
}) {
  const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
    const href = typeof url === "string" ? url : url.toString();
    expect(href.startsWith(getQuickBooksApiBaseUrl())).toBe(true);
    const parsed = new URL(href);
    const realmId = parsed.pathname.split("/")[3];
    expect(init?.method === undefined || init?.method === "GET").toBe(true);
    const headers = (init?.headers ?? {}) as Record<string, string>;
    expect(headers.Authorization).toMatch(/^Bearer /);
    if (parsed.pathname.endsWith("/query")) {
      return new Response(
        JSON.stringify({ QueryResponse: { Customer: input.customersByRealm[realmId] ?? [] } }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }
    if (parsed.pathname.includes("ProfitAndLossDetail")) {
      return new Response(
        JSON.stringify(
          reportResponse(REVENUE_COLUMNS, input.revenueRowsByRealm[realmId] ?? [])
        ),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }
    if (parsed.pathname.includes("AgedReceivablesDetail")) {
      return new Response(
        JSON.stringify(reportResponse(AGING_COLUMNS, input.agingRowsByRealm[realmId] ?? [])),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }
    throw new Error(`Unexpected fetch in dry-run test: ${href}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/**
 * Configure the mocked database for a consolidated dry-run over the three
 * operating companies. Every read is tenant-scoped; the routing below mirrors
 * the `where` shapes each engine issues.
 */
function configureData(overrides: {
  operatingCompanies?: typeof OPERATING_COMPANIES;
  approvedMatches?: Record<string, { companyId: string; operatingCompanyId: string }>;
  proposedMatches?: typeof PROPOSED_MATCHES;
} = {}) {
  const operatingCompanies = overrides.operatingCompanies ?? OPERATING_COMPANIES;
  const approvedMatches = overrides.approvedMatches ?? APPROVED_MATCHES;
  const proposedMatches = overrides.proposedMatches ?? PROPOSED_MATCHES;

  prismaTest.model("operatingCompany").findMany.mockResolvedValue(operatingCompanies);
  prismaTest.model("operatingCompany").findFirst.mockImplementation(
    ({ where }: { where: { id?: string } }) =>
      operatingCompanies.find((operatingCompany) => operatingCompany.id === where.id) ?? null
  );
  prismaTest.model("integrationCredential").findFirst.mockImplementation(
    ({ where }: { where: { id?: string } }) => credentialsById()[where.id ?? ""] ?? null
  );
  prismaTest.model("quickBooksServiceMappingRule").findMany.mockResolvedValue([]);
  prismaTest.model("customerSourceAccount").findMany.mockImplementation(
    ({ where }: { where: { realmId?: string } }) =>
      SOURCE_ACCOUNTS_BY_REALM[where.realmId ?? ""] ?? []
  );
  prismaTest.model("customerSourceAccount").findFirst.mockImplementation(
    ({ where }: {
      where: {
        id?: string;
        realmId?: string;
        quickBooksCustomerId?: string;
        operatingCompanyId?: string | { not: string };
      };
    }) => {
      if (where.id) return { id: where.id, currency: "CAD" };
      if (typeof where.operatingCompanyId !== "string") return null;
      return (
        (SOURCE_ACCOUNTS_BY_REALM[where.realmId ?? ""] ?? []).find(
          (account) =>
            account.quickBooksCustomerId === where.quickBooksCustomerId &&
            account.operatingCompanyId === where.operatingCompanyId
        ) ?? null
      );
    }
  );
  prismaTest.model("companyOperatingRelationship").findFirst.mockImplementation(
    ({ where }: { where: { id?: string; companyId?: string; operatingCompanyId?: string } }) =>
      RELATIONSHIPS.find(
        (relationship) =>
          (!where.id || relationship.id === where.id) &&
          (!where.companyId || relationship.companyId === where.companyId) &&
          (!where.operatingCompanyId ||
            relationship.operatingCompanyId === where.operatingCompanyId)
      ) ?? null
  );
  prismaTest.model("companyOperatingRelationship").findMany.mockImplementation(
    ({ where }: { where: { operatingCompanyId?: string } }) =>
      RELATIONSHIPS.filter((relationship) => relationship.operatingCompanyId === where.operatingCompanyId)
  );
  prismaTest.model("customerIdentityMatch").findFirst.mockImplementation(
    ({ where }: { where: { status?: unknown; id?: unknown; sourceRecordKey?: string } }) => {
      const status = where.status;
      // Approved-conflict lookup (reconciliation): carries an id exclusion.
      if (
        typeof status === "string" &&
        status === CustomerIdentityMatchStatus.APPROVED &&
        where.id !== undefined
      ) {
        return null;
      }
      // resolveCanonicalTarget (ingestion): a persisted approved match makes
      // the customer "matched".
      if (typeof status === "string" && status === CustomerIdentityMatchStatus.APPROVED) {
        const approved = approvedMatches[where.sourceRecordKey ?? ""];
        return approved
          ? {
              id: `match-approved-${where.sourceRecordKey}`,
              companyId: approved.companyId,
              operatingCompanyId: approved.operatingCompanyId,
              status: CustomerIdentityMatchStatus.APPROVED,
              score: 100
            }
          : null;
      }
      if (status === CustomerIdentityMatchStatus.PROPOSED) {
        return (
          proposedMatches.find(
            (match) =>
              match.sourceRecordKey === where.sourceRecordKey
          ) ?? null
        );
      }
      // Reviewed { in } lookups have none in this synthetic matrix.
      return null;
    }
  );
  prismaTest.model("customerIdentityMatch").findMany.mockImplementation(
    ({ where }: { where: { status?: CustomerIdentityMatchStatus; operatingCompanyId?: string } }) => {
      if (where.status === CustomerIdentityMatchStatus.PROPOSED) {
        return proposedMatches.filter(
          (match) =>
            !where.operatingCompanyId || match.operatingCompanyId === where.operatingCompanyId
        );
      }
      // Approved stable-ID snapshot reads have no rows in this matrix.
      return [];
    }
  );
  prismaTest.model("company").findMany.mockResolvedValue(CANDIDATE_COMPANIES);
  prismaTest.model("company").findFirst.mockResolvedValue(CANDIDATE_COMPANIES[0]);
  prismaTest.model("customerRevenueLine").findFirst.mockResolvedValue(null);
  prismaTest.model("customerRevenueLine").findMany.mockResolvedValue([]);
  prismaTest.model("customerMonthlyFinancial").findMany.mockResolvedValue([]);
  prismaTest.model("customerFxRate").findFirst.mockResolvedValue(null);
  // Run-record and audit mocks must also log into modelCalls. Vitest's
  // mockReset clears the proxy's original recording implementation between
  // tests, so every configured write restores recording explicitly.
  // assertOnlyRunRecordWrites then proves these are the only writes performed.
  prismaTest.model("automationJobRun").create.mockImplementation(
    ({ data }: { data: Record<string, unknown> }) => {
      prismaTest.modelCalls.push({ model: "automationJobRun", method: "create", args: [{ data }] });
      return { id: "dry-run-job-1", ...data };
    }
  );
  prismaTest.model("automationJobRun").update.mockImplementation(
    ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      prismaTest.modelCalls.push({
        model: "automationJobRun",
        method: "update",
        args: [{ where, data }]
      });
      return { id: "dry-run-job-1", ...data };
    }
  );
  prismaTest.model("auditLog").create.mockImplementation(
    ({ data }: { data: Record<string, unknown> }) => {
      prismaTest.modelCalls.push({ model: "auditLog", method: "create", args: [{ data }] });
      return { id: "dry-run-audit-1", ...data };
    }
  );
}

afterEach(() => {
  restoreQuickBooksEnv();
  vi.unstubAllGlobals();
});

describe("per-engine dry-run zero-write proofs (CP-PHASE-02B-7)", () => {
  beforeEach(() => {
    prismaTest.reset();
    configureAuth();
    setQuickBooksEnv();
  });

  it("ingestion dry-run computes the full would-change report with zero database writes", async () => {
    configureData({ operatingCompanies: [OPERATING_COMPANIES[0]] });
    stubConsolidatedQuickBooksFetch({
      customersByRealm: { "realm-1": CUSTOMERS_BY_REALM["realm-1"] },
      revenueRowsByRealm: {},
      agingRowsByRealm: {}
    });

    const report = await runQuickBooksCustomerIngestion(ADMIN, { dryRun: true });

    expect(report.dryRun).toBe(true);
    expect(report.tenantId).toBe("tenant-a");
    expect(report.totals).toMatchObject({
      fetchedCustomers: 2,
      matched: 1,
      unmatchedProposed: 0,
      unmatchedRefreshed: 1,
      reviewedDecisionsPreserved: 0
    });
    assertNoDatabaseWrites();
  });

  it("reconciliation dry-run computes the complete would-change report with zero database writes", async () => {
    configureData();

    const report = await evaluateReconciliationDryRun(ADMIN, {});

    expect(report.dryRun).toBe(true);
    expect(report.tenantId).toBe("tenant-a");
    expect(report.matches).toHaveLength(2);
    expect(report.totals).toMatchObject({
      evaluated: 2,
      autoLinked: 0,
      routedToReview: 2,
      reviewedPreserved: 0,
      errors: 0
    });
    const byMatch = Object.fromEntries(
      report.matches.map((match: ReconciliationDryRunMatch) => [match.matchId, match])
    );
    expect(byMatch["match-ww"].wouldChangeTo).toBe("ROUTED_TO_REVIEW");
    expect(byMatch["match-ne"].wouldChangeTo).toBe("ROUTED_TO_REVIEW");
    assertNoDatabaseWrites();
  });

  it("materialization dry-run computes the full would-change report with zero database writes", async () => {
    configureData({ operatingCompanies: [OPERATING_COMPANIES[0]] });
    stubConsolidatedQuickBooksFetch({
      customersByRealm: {},
      revenueRowsByRealm: { "realm-1": REVENUE_ROWS_BY_REALM["realm-1"] },
      agingRowsByRealm: { "realm-1": AGING_ROWS_BY_REALM["realm-1"] }
    });

    const report = await runFinancialMaterialization(ADMIN, { dryRun: true });

    expect(report.dryRun).toBe(true);
    const section = report.operatingCompanies[0];
    expect(section.status).toBe("ASSOCIATED");
    expect(section.revenueMaterialized).toBe(1);
    expect(section.agingMaterialized).toBe(1);
    expect(section.monthlyRowsWritten).toBe(3);
    expect(section.relationshipsRefreshed).toBe(1);
    assertNoDatabaseWrites();
  });

  it("reconciliation dry-run is ADMIN/FINANCE-only like the live engine", async () => {
    configureData();

    for (const role of [ADMIN, FINANCE]) {
      const report = await evaluateReconciliationDryRun(role, {});
      expect(report.tenantId).toBe("tenant-a");
    }
    for (const role of [MANAGER, SALES, OPERATIONS, READ_ONLY]) {
      await expect(evaluateReconciliationDryRun(role, {})).rejects.toBeInstanceOf(
        AuthorizationError
      );
    }
    assertNoDatabaseWrites();
  });
});

describe("consolidated dry-run verification (CP-PHASE-02B-7)", () => {
  beforeEach(() => {
    prismaTest.reset();
    configureAuth();
    setQuickBooksEnv();
    configureData();
  });

  it("runs all three engines in dry-run and returns the complete would-change report", async () => {
    stubConsolidatedQuickBooksFetch({
      customersByRealm: CUSTOMERS_BY_REALM,
      revenueRowsByRealm: REVENUE_ROWS_BY_REALM,
      agingRowsByRealm: AGING_ROWS_BY_REALM
    });

    const report = await runCustomerIntelligenceDryRun(ADMIN, {});

    expect(report.dryRun).toBe(true);
    expect(report.tenantId).toBe("tenant-a");
    expect(report.scope.operatingCompanyCount).toBe(3);
    expect(report.runRecord).toMatchObject({
      jobRunId: "dry-run-job-1",
      jobType: CUSTOMER_INTELLIGENCE_DRY_RUN_JOB_TYPE,
      status: JobStatus.SUCCESS
    });

    // Ingestion would-change report across all three operating companies.
    expect(report.ingestion.totals).toMatchObject({
      fetchedCustomers: 6,
      matched: 1,
      unmatchedProposed: 2,
      unmatchedRefreshed: 1,
      unmatchedUnchanged: 1,
      skipped: 1,
      unassociatedCompanies: 0,
      erroredCompanies: 0
    });
    expect(report.ingestion.operatingCompanies.map((section) => section.status)).toEqual([
      "ASSOCIATED",
      "ASSOCIATED",
      "ASSOCIATED"
    ]);

    // Reconciliation uses ingestion's virtual state: both the refreshed
    // persisted proposal and the newly proposed source auto-link; partial and
    // completely missing evidence remain routed to review.
    expect(report.reconciliation.totals).toMatchObject({
      evaluated: 4,
      autoLinked: 2,
      routedToReview: 2,
      reviewedPreserved: 0,
      errors: 0
    });

    const reconciliationBySource = Object.fromEntries(
      report.reconciliation.matches.map((match) => [match.sourceRecordKey, match])
    );
    expect(reconciliationBySource["realm-1:2002"]).toMatchObject({
      matchId: "match-ww",
      wouldChangeTo: "AUTO_LINKED",
      wouldScore: 95,
      bestCandidateCompanyId: "company-1"
    });
    expect(reconciliationBySource["realm-2:3003"]).toMatchObject({
      wouldChangeTo: "AUTO_LINKED",
      wouldScore: 95,
      bestCandidateCompanyId: "company-2"
    });

    // Realm-2 has no persisted proposal or source account. Its revenue can be
    // materialized only when reconciliation's would-be mapping is propagated.
    const materializationSections = report.materialization.operatingCompanies;
    expect(materializationSections).toHaveLength(3);
    expect(materializationSections.map((section) => section.status)).toEqual([
      "ASSOCIATED",
      "ASSOCIATED",
      "ASSOCIATED"
    ]);
    expect(
      materializationSections.find((section) => section.operatingCompanyId === "oc-usa")
    ).toMatchObject({ revenueMaterialized: 1, revenueSkippedUnmatched: 0 });

    // The aggregate would-change count matches the fixture matrix.
    expect(report.zeroWrites.provenByContract).toBe(true);
    expect(report.zeroWrites.wouldChangeRecords).toBeGreaterThan(0);
  });

  it("performs zero writes to Customer Intelligence data models (run record only)", async () => {
    stubConsolidatedQuickBooksFetch({
      customersByRealm: CUSTOMERS_BY_REALM,
      revenueRowsByRealm: REVENUE_ROWS_BY_REALM,
      agingRowsByRealm: AGING_ROWS_BY_REALM
    });

    await runCustomerIntelligenceDryRun(ADMIN, {});

    assertOnlyRunRecordWrites();
  });

  it("records the run through the tenant-scoped AutomationJobRun ledger and a sanitized AuditLog", async () => {
    stubConsolidatedQuickBooksFetch({
      customersByRealm: CUSTOMERS_BY_REALM,
      revenueRowsByRealm: REVENUE_ROWS_BY_REALM,
      agingRowsByRealm: AGING_ROWS_BY_REALM
    });

    await runCustomerIntelligenceDryRun(ADMIN, {});

    const createArg = prismaTest.model("automationJobRun").create.mock.calls[0][0] as {
      data: Record<string, unknown>;
    };
    expect(createArg.data).toMatchObject({
      tenantId: "tenant-a",
      jobType: CUSTOMER_INTELLIGENCE_DRY_RUN_JOB_TYPE,
      status: JobStatus.RUNNING,
      input: { mode: "dry-run" }
    });

    const updateArg = prismaTest.model("automationJobRun").update.mock.calls[0][0] as {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    };
    expect(updateArg.where).toEqual({ id: "dry-run-job-1", tenantId: "tenant-a" });
    expect(updateArg.data.status).toBe(JobStatus.SUCCESS);
    expect(updateArg.data.output).toMatchObject({
      dryRun: true,
      scope: { operatingCompanyCount: 3 },
      wouldChangeRecords: expect.any(Number)
    });

    const auditArg = prismaTest.model("auditLog").create.mock.calls[0][0] as {
      data: Record<string, unknown>;
    };
    expect(auditArg.data).toMatchObject({
      tenantId: "tenant-a",
      actorUserId: "user-1",
      action: "customer-intelligence.dry-run.completed",
      entityType: "AutomationJobRun",
      entityId: "dry-run-job-1"
    });

    // The job output and audit carry counts/classifications only — never
    // customer identifiers, source keys, transaction identifiers, amounts,
    // bearer tokens, credential references, or authorization headers.
    const serialized = JSON.stringify([updateArg.data.output, auditArg.data]);
    expect(serialized).not.toContain("synthetic-access-token");
    expect(serialized).not.toContain("secretRef");
    expect(serialized).not.toContain("realm-1");
    expect(serialized).not.toContain("1001");
    expect(serialized).not.toContain("Customer ABC");
    expect(serialized).not.toContain("9001");
    expect(serialized).not.toContain("alphapacking.example");
    expect(serialized).not.toContain("1250");
  });

  it("records a sanitized tenant- and actor-scoped failure audit when an engine fails", async () => {
    stubConsolidatedQuickBooksFetch({
      customersByRealm: CUSTOMERS_BY_REALM,
      revenueRowsByRealm: REVENUE_ROWS_BY_REALM,
      agingRowsByRealm: AGING_ROWS_BY_REALM
    });
    prismaTest.model("customerIdentityMatch").findMany.mockRejectedValueOnce(
      new Error(
        "provider payload customer 3003 Authorization: Bearer leaked-token secretRef cred-2"
      )
    );

    await expect(runCustomerIntelligenceDryRun(ADMIN, {})).rejects.toThrow(
      "Customer Intelligence dry-run verification failed before completing all engines."
    );

    const updateArg = prismaTest.model("automationJobRun").update.mock.calls[0][0] as {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    };
    expect(updateArg.where).toEqual({ id: "dry-run-job-1", tenantId: "tenant-a" });
    expect(updateArg.data).toMatchObject({
      status: JobStatus.ERROR,
      errorMessage:
        "Customer Intelligence dry-run verification failed before completing all engines."
    });

    const auditArg = prismaTest.model("auditLog").create.mock.calls[0][0] as {
      data: Record<string, unknown>;
    };
    expect(auditArg.data).toMatchObject({
      tenantId: "tenant-a",
      actorUserId: "user-1",
      action: "customer-intelligence.dry-run.failed",
      entityType: "AutomationJobRun",
      entityId: "dry-run-job-1",
      after: {
        dryRun: true,
        status: JobStatus.ERROR,
        classification: "ENGINE_EXECUTION_FAILED"
      }
    });
    const serialized = JSON.stringify([updateArg.data, auditArg.data]);
    expect(serialized).not.toContain("provider payload");
    expect(serialized).not.toContain("3003");
    expect(serialized).not.toContain("Authorization");
    expect(serialized).not.toContain("leaked-token");
    expect(serialized).not.toContain("secretRef");
    expect(serialized).not.toContain("cred-2");
    assertOnlyRunRecordWrites();
  });

  it("denies every non-admin role before any database write or QuickBooks fetch", async () => {
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
        runCustomerIntelligenceDryRun(role, {}),
        `${name} must be denied for the consolidated dry-run`
      ).rejects.toBeInstanceOf(AuthorizationError);
      assertNoDatabaseWrites();
      expect(fetchMock, `${name} must not reach QuickBooks`).not.toHaveBeenCalled();
    }
  });

  it("rejects a foreign or nonexistent operatingCompanyId before any write", async () => {
    prismaTest.model("operatingCompany").findFirst.mockResolvedValue(null);

    await expect(
      runCustomerIntelligenceDryRun(ADMIN, { operatingCompanyId: "oc-foreign" })
    ).rejects.toThrow(/Operating company does not exist in this tenant/);

    expect(prismaTest.model("automationJobRun").create).not.toHaveBeenCalled();
    assertNoDatabaseWrites();
  });
});

describe("three-operating-company fixture matrix (partial and completely missing evidence)", () => {
  beforeEach(() => {
    prismaTest.reset();
    configureAuth();
    setQuickBooksEnv();
    configureData();
  });

  type MatrixExpectation = {
    ingestionMatched: number;
    ingestionUnmatchedProposed: number;
    ingestionUnmatchedRefreshed?: number;
    ingestionUnmatchedUnchanged?: number;
    ingestionSkipped?: number;
    reconciliationCount?: number;
    reconciliation: "AUTO_LINKED" | "ROUTED_TO_REVIEW";
    reconciliationScore?: number;
    materializationStatus: string;
    revenueMaterialized: number;
    agingMaterialized?: number;
    agingSkippedMissingEvidence?: number;
    incompleteMonths?: number;
    monthlyRowsWritten?: number;
  };

  const matrix: Array<{ label: string; operatingCompanyId: string; expected: MatrixExpectation }> = [
    {
      label: "Newl Worldwide (realm-1): partial customer evidence, high-confidence reconciliation, complete report evidence",
      operatingCompanyId: "oc-ww",
      expected: {
        ingestionMatched: 1,
        ingestionUnmatchedProposed: 0,
        ingestionUnmatchedRefreshed: 1,
        reconciliation: "AUTO_LINKED",
        reconciliationScore: 95,
        materializationStatus: "ASSOCIATED",
        revenueMaterialized: 1,
        agingMaterialized: 1,
        monthlyRowsWritten: 3
      }
    },
    {
      label: "Newl USA (realm-2): new mappable source plus completely missing customer evidence",
      operatingCompanyId: "oc-usa",
      expected: {
        ingestionMatched: 0,
        ingestionUnmatchedProposed: 2,
        reconciliationCount: 2,
        reconciliation: "AUTO_LINKED",
        reconciliationScore: 95,
        materializationStatus: "ASSOCIATED",
        revenueMaterialized: 1
      }
    },
    {
      label: "Newell's Express (realm-3): partial customer evidence with missing required fields, name-only reconciliation, partial aging snapshot",
      operatingCompanyId: "oc-ne",
      expected: {
        ingestionMatched: 0,
        ingestionUnmatchedProposed: 0,
        ingestionUnmatchedUnchanged: 1,
        ingestionSkipped: 1,
        reconciliation: "ROUTED_TO_REVIEW",
        materializationStatus: "ASSOCIATED",
        revenueMaterialized: 1,
        agingSkippedMissingEvidence: 1,
        incompleteMonths: 1
      }
    }
  ];

  it.each(matrix)("$label", async ({ operatingCompanyId, expected }) => {
    stubConsolidatedQuickBooksFetch({
      customersByRealm: CUSTOMERS_BY_REALM,
      revenueRowsByRealm: REVENUE_ROWS_BY_REALM,
      agingRowsByRealm: AGING_ROWS_BY_REALM
    });

    const report = await runCustomerIntelligenceDryRun(ADMIN, { operatingCompanyId });

    expect(report.scope.operatingCompanyId).toBe(operatingCompanyId);
    expect(report.scope.operatingCompanyCount).toBe(1);

    const ingestionSection = report.ingestion.operatingCompanies[0];
    expect(ingestionSection.operatingCompanyId).toBe(operatingCompanyId);
    expect(ingestionSection.matched).toBe(expected.ingestionMatched);
    expect(ingestionSection.unmatchedProposed).toBe(expected.ingestionUnmatchedProposed);
    if (expected.ingestionUnmatchedRefreshed !== undefined) {
      expect(ingestionSection.unmatchedRefreshed).toBe(expected.ingestionUnmatchedRefreshed);
    }
    if (expected.ingestionUnmatchedUnchanged !== undefined) {
      expect(ingestionSection.unmatchedUnchanged).toBe(expected.ingestionUnmatchedUnchanged);
    }
    if (expected.ingestionSkipped !== undefined) {
      expect(ingestionSection.skipped).toBe(expected.ingestionSkipped);
    }

    expect(report.reconciliation.matches).toHaveLength(expected.reconciliationCount ?? 1);
    const reconciliationMatch = report.reconciliation.matches[0];
    expect(reconciliationMatch.operatingCompanyId).toBe(operatingCompanyId);
    expect(reconciliationMatch.wouldChangeTo).toBe(expected.reconciliation);
    if (expected.reconciliationScore !== undefined) {
      expect(reconciliationMatch.wouldScore).toBe(expected.reconciliationScore);
    }

    const materializationSection = report.materialization.operatingCompanies[0];
    expect(materializationSection.operatingCompanyId).toBe(operatingCompanyId);
    expect(materializationSection.status).toBe(expected.materializationStatus);
    expect(materializationSection.revenueMaterialized).toBe(expected.revenueMaterialized);
    if (expected.agingMaterialized !== undefined) {
      expect(materializationSection.agingMaterialized).toBe(expected.agingMaterialized);
    }
    if (expected.agingSkippedMissingEvidence !== undefined) {
      expect(materializationSection.agingSkippedMissingEvidence).toBe(
        expected.agingSkippedMissingEvidence
      );
    }
    if (expected.incompleteMonths !== undefined) {
      expect(materializationSection.incompleteMonths).toBe(expected.incompleteMonths);
    }
    if (expected.monthlyRowsWritten !== undefined) {
      expect(materializationSection.monthlyRowsWritten).toBe(expected.monthlyRowsWritten);
    }

    // Zero-write proof for every operating-company path: only the run record.
    assertOnlyRunRecordWrites();
  });
});
