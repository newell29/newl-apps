import {
  CustomerFinancialPeriodStatus,
  CustomerIntelligenceServiceLine,
  IntegrationProvider,
  IntegrationStatus,
  PlatformRole,
  QuickBooksServiceMappingDimension
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
// boundary runs against the mocked DB exactly like the ingestion suite.
vi.mock("@/server/db", () => ({
  prisma: prismaTest.proxy
}));

import { runFinancialMaterialization } from "@/modules/customer-intelligence/actions";
import {
  buildQuickBooksAgingDetailQueryUrl,
  buildQuickBooksPnlDetailQueryUrl,
  classifyRevenueDetailRow,
  extractFileNumber,
  fetchQuickBooksAgingDetail,
  fetchQuickBooksRevenueDetail,
  FINANCIAL_REPORT_MAX_PAGES,
  FINANCIAL_REPORT_PAGE_SIZE,
  NEWL_WORLDWIDE_DIRECT_COST_ACCOUNT_CODES,
  normalizeAgingDetailRow,
  normalizeRevenueDetailRow,
  newlWorldwideDirectCostAccountCode,
  parseQuickBooksReportRows,
  parseReportAmount,
  parseReportDate,
  revenueLineSourceKey,
  type QuickBooksReportResponse
} from "@/modules/customer-intelligence/financial-materialization";
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
  process.env.AUTH_SECRET = "test-auth-secret-for-financial-materialization";
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
  legalName: "Newell's Express Worldwide Logistics Ltd.",
  homeCurrency: "CAD",
  active: true,
  quickBooksRealmId: "realm-1",
  quickBooksCredentialId: "cred-qb-1"
};

const OPERATING_COMPANY_USA = {
  ...OPERATING_COMPANY,
  id: "oc-usa",
  slug: "newl-usa",
  displayName: "Newl USA"
};

const OPERATING_COMPANY_NEWELLS = {
  ...OPERATING_COMPANY,
  id: "oc-ne",
  slug: "newells-express",
  displayName: "Newell's Express and Warehousing Ltd."
};

const COMPANY = { id: "company-1", tenantId: "tenant-a", name: "Customer ABC", normalizedName: "customer-abc" };

const RELATIONSHIP = {
  id: "rel-1",
  tenantId: "tenant-a",
  companyId: "company-1",
  operatingCompanyId: "oc-ww",
  lifecycle: "PROSPECT",
  status: "ACTIVE"
};

const SOURCE_ACCOUNT = {
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

function nestedReportResponse(
  columns: readonly string[],
  rows: string[][]
): QuickBooksReportResponse {
  return {
    Columns: { Column: columns.map((title) => ({ ColTitle: title })) },
    Rows: {
      Row: [
        {
          type: "Section",
          Header: { ColData: [{ value: "Synthetic report section" }] },
          Rows: {
            Row: rows.map((values) => ({
              type: "Data",
              ColData: values.map((value) => ({ value }))
            }))
          },
          Summary: { ColData: [{ value: "Synthetic subtotal" }] }
        }
      ]
    }
  };
}

function revenueRow(overrides: Partial<Record<(typeof REVENUE_COLUMNS)[number], string>> = {}): string[] {
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

function agingRow(overrides: Partial<Record<(typeof AGING_COLUMNS)[number], string>> = {}): string[] {
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
 * Stub global fetch for the two GET-only report endpoints. Any unexpected
 * request or non-GET method fails the test.
 */
function stubQuickBooksReportFetch(revenueRows: string[][], agingRows: string[][]) {
  const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
    const href = typeof input === "string" ? input : input.toString();
    expect(href.startsWith(getQuickBooksApiBaseUrl())).toBe(true);
    expect(init?.method === undefined || init?.method === "GET").toBe(true);
    const headers = (init?.headers ?? {}) as Record<string, string>;
    expect(headers.Authorization).toMatch(/^Bearer /);
    if (href.includes("ProfitAndLossDetail")) {
      return new Response(JSON.stringify(reportResponse(REVENUE_COLUMNS, revenueRows)), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
    if (href.includes("AgedReceivablesDetail")) {
      return new Response(JSON.stringify(reportResponse(AGING_COLUMNS, agingRows)), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
    throw new Error(`Unexpected fetch in materialization test: ${href}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** Standard DB fixtures for one operating company with one matched customer. */
function configureStandardData(operatingCompany = OPERATING_COMPANY) {
  const relationship = {
    ...RELATIONSHIP,
    operatingCompanyId: operatingCompany.id
  };
  const sourceAccount = {
    ...SOURCE_ACCOUNT,
    operatingCompanyId: operatingCompany.id
  };
  prismaTest.model("operatingCompany").findMany.mockResolvedValue([operatingCompany]);
  prismaTest.model("operatingCompany").findFirst.mockResolvedValue(operatingCompany);
  prismaTest.model("integrationCredential").findFirst.mockResolvedValue(quickBooksCredential());
  prismaTest.model("quickBooksServiceMappingRule").findMany.mockResolvedValue([]);
  prismaTest.model("customerSourceAccount").findMany.mockResolvedValue([sourceAccount]);
  prismaTest.model("companyOperatingRelationship").findFirst.mockResolvedValue(relationship);
  prismaTest.model("customerSourceAccount").findFirst.mockResolvedValue(sourceAccount);
  prismaTest.model("customerRevenueLine").findFirst.mockResolvedValue(null);
  prismaTest.model("company").findFirst.mockResolvedValue(COMPANY);
  prismaTest.model("customerMonthlyFinancial").findFirst.mockResolvedValue(null);
  prismaTest.model("customerRevenueLine").count.mockResolvedValue(1);
  prismaTest.model("customerMonthlyFinancial").count.mockResolvedValue(1);
  prismaTest.model("customerIdentityMatch").count.mockResolvedValue(1);
  prismaTest.model("companyOperatingRelationship").update.mockImplementation(
    ({ data }: { data: Record<string, unknown> }) => ({ ...RELATIONSHIP, ...data })
  );
  // The generic auto-mock returns undefined for write methods, but the real
  // Prisma client returns the created row. recordRevenueLine reads the created
  // record's id for its sanitized audit, so model that contract here (same
  // pattern as the foundation suite's upsert/create mocks).
  prismaTest.model("customerRevenueLine").create.mockImplementation(
    ({ data }: { data: Record<string, unknown> }) => ({
      id: "line-created",
      ...data
    })
  );
}

function auditEntries() {
  return prismaTest.model("auditLog").create.mock.calls.map(
    ([arg]) => (arg as { data: Record<string, unknown> }).data
  );
}

/** Shape of the create payload asserted against upserted CustomerMonthlyFinancial rows. */
type MonthlyFinancialCreateShape = {
  monthKey: string;
  companyId: string;
  operatingCompanyId: string;
  companyOperatingRelationshipId: string;
  sourceAccountId: string | null;
  sourceAccountKey: string;
  serviceLine: CustomerIntelligenceServiceLine;
  currency: string;
  nativeRevenue: number;
  nativeCost: number;
  nativeGrossProfit: number;
  cadRevenue: number | null;
  nativeOpenAr: number;
  cadOpenAr: number | null;
  reconciliationStatus: CustomerFinancialPeriodStatus;
};

function monthlyUpserts(): MonthlyFinancialCreateShape[] {
  return prismaTest.model("customerMonthlyFinancial").upsert.mock.calls.map(
    ([arg]) => (arg as { create: MonthlyFinancialCreateShape }).create
  );
}

function revenueCreates() {
  return prismaTest.model("customerRevenueLine").create.mock.calls.map(
    ([arg]) => (arg as { data: Record<string, unknown> }).data
  );
}

/** First day of the month `offset` months before/after the current month, as YYYY-MM-DD. */
function monthDate(monthOffset: number): string {
  const now = new Date();
  const day = monthOffset === 0 ? Math.min(now.getUTCDate(), 15) : 15;
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + monthOffset, day));
  return date.toISOString().slice(0, 10);
}

function approvedWindowDates(): { startDate: string; endDate: string } {
  const now = new Date();
  const start = new Date(now);
  start.setUTCMonth(start.getUTCMonth() - 24);
  return {
    startDate: start.toISOString().slice(0, 10),
    endDate: now.toISOString().slice(0, 10)
  };
}

function addUtcDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

afterEach(() => {
  vi.useRealTimers();
  restoreQuickBooksEnv();
  vi.unstubAllGlobals();
});

describe("report normalization (partial and completely missing evidence)", () => {
  it("maps a complete revenue detail row deterministically", () => {
    const parsed = parseQuickBooksReportRows(
      reportResponse(REVENUE_COLUMNS, [
        revenueRow({
          "Txn ID": "9001",
          Type: "Invoice",
          Date: "2026-06-15",
          Name: "Customer ABC",
          Account: "Shipping Income",
          Class: "Freight",
          Item: "Ocean Freight",
          "Memo/Description": "TR0121N1",
          Total: "1250.00"
        })
      ])
    );
    const normalized = normalizeRevenueDetailRow(parsed.rows[0]);

    expect(normalized.transactionId).toBe("9001");
    expect(normalized.transactionType).toBe("Invoice");
    expect(normalized.transactionDate).toBe("2026-06-15");
    expect(normalized.customerName).toBe("Customer ABC");
    expect(normalized.accountName).toBe("Shipping Income");
    expect(normalized.classRef).toBe("Freight");
    expect(normalized.itemRef).toBe("Ocean Freight");
    expect(normalized.memoDescription).toBe("TR0121N1");
    expect(normalized.amount).toBe("1250.00");
  });

  it("normalizes file evidence supplied only by Memo on Statement", () => {
    const parsed = parseQuickBooksReportRows(
      reportResponse(REVENUE_COLUMNS, [
        revenueRow({
          "Txn ID": "memo-statement-1",
          "Memo on Statement": "Shipment OE123456N1",
          "Memo/Description": "",
          Total: "125.00"
        })
      ])
    );
    const normalized = normalizeRevenueDetailRow(parsed.rows[0]);

    expect(normalized.memo).toBeNull();
    expect(normalized.memoOnStatement).toBe("Shipment OE123456N1");
    expect(extractFileNumber(normalized.memoOnStatement)).toBe("OE123456N1");
    expect(normalized.description).toBeNull();
  });

  it("stores partially populated rows as null, never invented", () => {
    const parsed = parseQuickBooksReportRows(
      reportResponse(REVENUE_COLUMNS, [revenueRow({ "Txn ID": "9001", Total: "10.00" })])
    );
    const normalized = normalizeRevenueDetailRow(parsed.rows[0]);
    expect(normalized.transactionDate).toBeNull();
    expect(normalized.customerName).toBeNull();
    expect(normalized.accountName).toBeNull();
    expect(normalized.classRef).toBeNull();
    expect(normalized.itemRef).toBeNull();
    expect(normalized.memo).toBeNull();
    expect(normalized.memoOnStatement).toBeNull();
    expect(normalized.memoDescription).toBeNull();
    expect(normalized.description).toBeNull();
    expect(normalized.amount).toBe("10.00");
  });

  it("stores a completely missing row as all-null", () => {
    const normalized = normalizeRevenueDetailRow({});
    expect(normalized.transactionId).toBeNull();
    expect(normalized.amount).toBeNull();
  });

  it("excludes total/subtotal rows from transaction detail", () => {
    const json: QuickBooksReportResponse = {
      Columns: { Column: [{ ColTitle: "Txn ID" }, { ColTitle: "Total" }] },
      Rows: {
        Row: [
          { type: "Data", ColData: [{ value: "9001" }, { value: "10.00" }] },
          { type: "Total", ColData: [{ value: "" }, { value: "10.00" }] }
        ]
      }
    };
    const parsed = parseQuickBooksReportRows(json);
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]["Txn ID"]).toBe("9001");
  });

  it("traverses representative nested ProfitAndLossDetail and aging sections", () => {
    const revenue = parseQuickBooksReportRows(
      nestedReportResponse(REVENUE_COLUMNS, [
        revenueRow({ "Txn ID": "nested-1", Date: "2026-06-15", Total: "125.00" })
      ])
    );
    const aging = parseQuickBooksReportRows(
      nestedReportResponse(AGING_COLUMNS, [agingRow({ Total: "75.00" })])
    );

    expect(normalizeRevenueDetailRow(revenue.rows[0])).toMatchObject({
      transactionId: "nested-1",
      currency: "CAD",
      amount: "125.00"
    });
    expect(normalizeAgingDetailRow(aging.rows[0])).toMatchObject({
      customerId: "1001",
      currency: "CAD",
      total: "75.00"
    });
  });

  it("fails closed when nested detail cannot be read instead of returning an empty report", () => {
    const unsupported: QuickBooksReportResponse = {
      Columns: { Column: REVENUE_COLUMNS.map((title) => ({ ColTitle: title })) },
      Rows: {
        Row: [
          {
            type: "Section",
            Rows: { Row: [{ type: "Data" }] }
          }
        ]
      }
    };

    expect(() => parseQuickBooksReportRows(unsupported)).toThrow(/nested detail/);
  });

  it("normalizes aging detail rows and keeps bucket amounts as reported", () => {
    const parsed = parseQuickBooksReportRows(
      reportResponse(AGING_COLUMNS, [
        agingRow({ Name: "Customer ABC", Total: "750.00", "1-30": "750.00", "91+": "0.00" })
      ])
    );
    const normalized = normalizeAgingDetailRow(parsed.rows[0]);
    expect(normalized.customerName).toBe("Customer ABC");
    expect(normalized.total).toBe("750.00");
    expect(normalized.bucketAmounts).toEqual({ "1-30": "750.00", "91+": "0.00" });
  });

  it("uses only supported aging monetary columns and prefers authoritative Open Balance", () => {
    const normalized = normalizeAgingDetailRow({
      "Customer ID": "1001",
      Currency: "CAD",
      "Open Balance": "425.00",
      Total: "999.00",
      Current: "125.00",
      "31 - 60": "300.00",
      Date: "2026-07-15",
      "Due Date": "2026-06-15",
      Num: "INV-1001"
    });

    expect(normalized.total).toBe("425.00");
    expect(normalized.bucketAmounts).toEqual({ Current: "125.00", "31 - 60": "300.00" });
    expect(normalized.bucketAmounts).not.toHaveProperty("Due Date");
    expect(normalized.bucketAmounts).not.toHaveProperty("Num");
  });

  it("treats an unparseable amount as null (never invented)", () => {
    expect(parseReportAmount("1250.00")).toBe(1250);
    expect(parseReportAmount("$1,250.00")).toBe(1250);
    expect(parseReportAmount("-400.00")).toBe(-400);
    expect(parseReportAmount("abc")).toBeNull();
    expect(parseReportAmount("")).toBeNull();
    expect(parseReportAmount(null)).toBeNull();
  });

  it("parses only ISO-style report dates", () => {
    expect(parseReportDate("2026-06-15")?.toISOString().slice(0, 10)).toBe("2026-06-15");
    expect(parseReportDate("2026-02-31")).toBeNull();
    expect(parseReportDate("2026-13-01")).toBeNull();
    expect(parseReportDate("06/15/2026")).toBeNull();
    expect(parseReportDate("")).toBeNull();
    expect(parseReportDate(null)).toBeNull();
  });
});

describe("deterministic source key and file number extraction", () => {
  it("preserves the source transaction identifier in the sourceKey", () => {
    expect(revenueLineSourceKey("realm-1", "9001", "9001-line-1")).toBe(
      "pnl-detail:realm-1:9001:9001-line-1"
    );
    expect(revenueLineSourceKey("realm-1", "9001", "line-a")).toBe(
      "pnl-detail:realm-1:9001:line-a"
    );
  });

  it("extracts shipment file numbers from memo/description text", () => {
    expect(extractFileNumber("TR0121N1")).toBe("TR0121N1");
    expect(extractFileNumber("File OE123456N1 on this invoice")).toBe("OE123456N1");
    expect(extractFileNumber("tr0121n1")).toBe("TR0121N1");
    expect(extractFileNumber("no file here")).toBeNull();
    expect(extractFileNumber(null)).toBeNull();
  });
});

describe("deterministic transaction and account classification", () => {
  it("treats customer credits as signed revenue rather than vendor cost", () => {
    expect(
      classifyRevenueDetailRow({
        transactionType: "Credit Memo",
        accountType: "Income",
        amount: "125.00"
      })
    ).toEqual({ kind: "CUSTOMER_REVENUE", amount: -125 });
  });

  it("accepts vendor bills only for a finance-documented Worldwide direct-cost account", () => {
    expect([...NEWL_WORLDWIDE_DIRECT_COST_ACCOUNT_CODES]).toEqual([
      "5014",
      "5015",
      "5020",
      "5030",
      "5115",
      "5205",
      "5300",
      "5400",
      "5401",
      "5590"
    ]);
    expect(
      classifyRevenueDetailRow({
        transactionType: "Bill",
        accountType: "Cost of Goods Sold",
        accountName: "5015 Trucking Rate",
        amount: "400.00"
      })
    ).toEqual({ kind: "VENDOR_COST", amount: 400 });
    expect(
      newlWorldwideDirectCostAccountCode({
        accountNumber: null,
        accountName: "5590 Shipping Expense"
      })
    ).toBe("5590");
    expect(
      newlWorldwideDirectCostAccountCode({
        accountNumber: "5014",
        accountName: "Warehouse Rate"
      })
    ).toBe("5014");
  });

  it("never treats an opaque QuickBooks Account ID as a finance account code", () => {
    const normalized = normalizeRevenueDetailRow({
      Type: "Bill",
      "Account ID": "5014",
      Account: "6999 Synthetic Office Expense",
      "Account Type": "Expense",
      Total: "400.00"
    });

    expect(normalized.accountId).toBe("5014");
    expect(normalized.accountNumber).toBeNull();
    expect(
      newlWorldwideDirectCostAccountCode({
        accountNumber: normalized.accountNumber,
        accountName: normalized.accountName
      })
    ).toBeNull();
    expect(classifyRevenueDetailRow(normalized)).toEqual({ kind: "EXCLUDED" });
  });

  it("excludes arbitrary COGS and Expense accounts outside the finance reference", () => {
    expect(
      classifyRevenueDetailRow({
        transactionType: "Bill",
        accountType: "Cost of Goods Sold",
        accountName: "5999 Synthetic Cost",
        amount: "400.00"
      })
    ).toEqual({ kind: "EXCLUDED" });
    expect(
      classifyRevenueDetailRow({
        transactionType: "Bill",
        accountType: "Expense",
        accountName: "6999 Synthetic Expense",
        amount: "400.00"
      })
    ).toEqual({ kind: "EXCLUDED" });
  });

  it("fails closed for unapproved income-bearing transaction types", () => {
    expect(
      classifyRevenueDetailRow({
        transactionType: "Journal Entry",
        accountType: "Income",
        amount: "-50.00"
      })
    ).toMatchObject({ kind: "LIMITATION" });
  });

  it("does not infer unrelated excluded accounts from sign", () => {
    expect(
      classifyRevenueDetailRow({
        transactionType: "Bill",
        accountType: "Accounts Payable",
        amount: "-50.00"
      })
    ).toEqual({ kind: "EXCLUDED" });
  });

  it("excludes operating-cost account types without an approved account code", () => {
    expect(
      classifyRevenueDetailRow({
        transactionType: "Bill",
        accountType: "Expense",
        amount: "400.00"
      })
    ).toEqual({ kind: "EXCLUDED" });
  });
});

describe("GET-only report transport and pagination", () => {
  it("builds GET-only report query URLs with the 24-month window", () => {
    const pnl = buildQuickBooksPnlDetailQueryUrl({
      realmId: "realm-1",
      startDate: "2024-07-15",
      endDate: "2026-07-15",
      startPosition: 1,
      maxResults: 1000
    });
    expect(pnl.startsWith(`${getQuickBooksApiBaseUrl()}/v3/company/realm-1/reports/ProfitAndLossDetail`)).toBe(
      true
    );
    const pnlParams = new URL(pnl).searchParams;
    expect(pnlParams.get("start_date")).toBe("2024-07-15");
    expect(pnlParams.get("end_date")).toBe("2026-07-15");
    expect(pnlParams.get("accounting_method")).toBe("Accrual");
    expect(pnlParams.get("start_position")).toBe("1");
    expect(pnl).not.toContain("token");

    const aging = buildQuickBooksAgingDetailQueryUrl({
      realmId: "realm-1",
      asOfDate: "2026-07-15",
      startPosition: 1,
      maxResults: 1000
    });
    expect(
      aging.startsWith(`${getQuickBooksApiBaseUrl()}/v3/company/realm-1/reports/AgedReceivablesDetail`)
    ).toBe(true);
    expect(new URL(aging).searchParams.get("as_of_date")).toBe("2026-07-15");
    expect(new URL(aging).searchParams.get("aging_method")).toBe("AgeByDueDate");
  });

  it("fetches every revenue and aging page with GET requests and Bearer auth", async () => {
    const revenueFirst = Array.from({ length: FINANCIAL_REPORT_PAGE_SIZE }, (_, index) =>
      revenueRow({
        "Txn ID": String(5000 + index),
        Date: "2026-06-15",
        Name: `Bulk Customer ${index}`,
        Total: "10.00"
      })
    );
    const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const href = typeof input === "string" ? input : input.toString();
      expect(init?.method === undefined || init?.method === "GET").toBe(true);
      const headers = (init?.headers ?? {}) as Record<string, string>;
      expect(headers.Authorization).toMatch(/^Bearer /);
      if (href.includes("ProfitAndLossDetail")) {
        const position = Number(new URL(href).searchParams.get("start_position"));
        const rows = position >= 1001 ? [revenueRow({ "Txn ID": "6001", Date: "2026-06-15" })] : revenueFirst;
        return new Response(JSON.stringify(reportResponse(REVENUE_COLUMNS, rows)), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      if (href.includes("AgedReceivablesDetail")) {
        return new Response(JSON.stringify(reportResponse(AGING_COLUMNS, [])), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      throw new Error(`Unexpected fetch: ${href}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const revenue = await fetchQuickBooksRevenueDetail({
      realmId: "realm-1",
      accessToken: "synthetic-access-token",
      startDate: "2024-07-15",
      endDate: "2026-07-15"
    });
    const aging = await fetchQuickBooksAgingDetail({
      realmId: "realm-1",
      accessToken: "synthetic-access-token",
      asOfDate: "2026-07-15"
    });

    expect(revenue).toHaveLength(FINANCIAL_REPORT_PAGE_SIZE + 1);
    expect(revenue[0].transactionId).toBe("5000");
    expect(revenue[FINANCIAL_REPORT_PAGE_SIZE].transactionId).toBe("6001");
    expect(aging).toEqual([]);
    const positions = fetchMock.mock.calls
      .filter(([input]) => String(input).includes("ProfitAndLossDetail"))
      .map(([input]) => Number(new URL(String(input)).searchParams.get("start_position")));
    expect(positions).toEqual([1, 1001]);
  });

  it("stops with a limitation when revenue pagination repeats a full page", async () => {
    const repeated = Array.from({ length: FINANCIAL_REPORT_PAGE_SIZE }, (_, index) =>
      revenueRow({ "Txn ID": `repeated-revenue-${index}`, Date: "2026-06-15", Total: "10.00" })
    );
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify(reportResponse(REVENUE_COLUMNS, repeated)), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchQuickBooksRevenueDetail({
        realmId: "realm-1",
        accessToken: "synthetic-access-token",
        startDate: "2024-07-15",
        endDate: "2026-07-15"
      })
    ).rejects.toThrow(/repeated a full page without progress/);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(FINANCIAL_REPORT_MAX_PAGES).toBeGreaterThan(1);
  });

  it("stops with a limitation when aging pagination repeats a full page", async () => {
    const repeated = Array.from({ length: FINANCIAL_REPORT_PAGE_SIZE }, (_, index) =>
      agingRow({ "Customer ID": `repeated-aging-${index}`, Total: "10.00" })
    );
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify(reportResponse(AGING_COLUMNS, repeated)), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchQuickBooksAgingDetail({
        realmId: "realm-1",
        accessToken: "synthetic-access-token",
        asOfDate: "2026-07-15"
      })
    ).rejects.toThrow(/repeated a full page without progress/);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("normalizes detail rows from nested QuickBooks report sections", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        const href = String(input);
        const response = href.includes("ProfitAndLossDetail")
          ? nestedReportResponse(REVENUE_COLUMNS, [
              revenueRow({ "Txn ID": "nested-fetch", Date: "2026-06-15", Total: "100.00" })
            ])
          : nestedReportResponse(AGING_COLUMNS, [agingRow({ Total: "50.00" })]);
        return new Response(JSON.stringify(response), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      })
    );

    const revenue = await fetchQuickBooksRevenueDetail({
      realmId: "realm-1",
      accessToken: "synthetic-access-token",
      startDate: "2024-07-15",
      endDate: "2026-07-15"
    });
    const aging = await fetchQuickBooksAgingDetail({
      realmId: "realm-1",
      accessToken: "synthetic-access-token",
      asOfDate: "2026-07-15"
    });

    expect(revenue).toHaveLength(1);
    expect(revenue[0]).toMatchObject({ transactionId: "nested-fetch", currency: "CAD" });
    expect(aging).toHaveLength(1);
    expect(aging[0]).toMatchObject({ customerId: "1001", currency: "CAD", total: "50.00" });
  });

  it("accepts the authoritative Open Balance aging layout", async () => {
    const columns = ["Customer ID", "Currency", "Date", "Due Date", "Num", "Open Balance"];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify(
            reportResponse(columns, [["1001", "CAD", "2026-07-01", "2026-07-31", "INV-1", "75.00"]])
          ),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      )
    );

    await expect(
      fetchQuickBooksAgingDetail({
        realmId: "realm-1",
        accessToken: "synthetic-access-token",
        asOfDate: "2026-07-15"
      })
    ).resolves.toMatchObject([{ customerId: "1001", total: "75.00", bucketAmounts: {} }]);
  });

  it.each([
    ["descriptive non-monetary columns", ["Customer ID", "Currency", "Date", "Due Date", "Num"]],
    ["completely missing monetary evidence", ["Customer ID", "Currency"]]
  ] as const)("rejects an aging layout with %s", async (_label, columns) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify(reportResponse(columns, [])), {
          status: 200,
          headers: { "content-type": "application/json" }
        })
      )
    );

    await expect(
      fetchQuickBooksAgingDetail({
        realmId: "realm-1",
        accessToken: "synthetic-access-token",
        asOfDate: "2026-07-15"
      })
    ).rejects.toThrow(/required classification fields/);
  });

  it("fails closed with a bounded error when a report query is not OK", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("SYNTHETIC_PRIVATE_VALUE", { status: 503 }))
    );
    await expect(
      fetchQuickBooksRevenueDetail({
        realmId: "realm-1",
        accessToken: "synthetic-access-token",
        startDate: "2024-07-15",
        endDate: "2026-07-15"
      })
    ).rejects.toThrow("QuickBooks report query failed with status 503");
  });
});

describe("approved inclusive 24-month report window", () => {
  beforeEach(() => {
    prismaTest.reset();
    configureAuth();
    setQuickBooksEnv();
    configureStandardData();
  });

  it("materializes rows exactly on both approved window boundaries", async () => {
    const { startDate, endDate } = approvedWindowDates();
    stubQuickBooksReportFetch(
      [
        revenueRow({ "Txn ID": "window-start", Date: startDate, Total: "100.00" }),
        revenueRow({ "Txn ID": "window-end", Date: endDate, Total: "200.00" })
      ],
      []
    );

    const report = await runFinancialMaterialization(ADMIN, {});

    expect(report.operatingCompanies[0]).toMatchObject({
      status: "ASSOCIATED",
      revenueMaterialized: 2,
      reportRowsSkippedOutsideWindow: 0,
      incompleteMonths: 0,
      relationshipsRefreshed: 1
    });
    expect(revenueCreates().map((row) => row.transactionNumber)).toEqual([
      "window-start",
      "window-end"
    ]);
  });

  it.each([
    ["pre-window revenue", "Invoice", -1],
    ["future vendor cost", "Bill", 1]
  ] as const)("skips and marks incomplete a %s row", async (_label, type, dayOffset) => {
    const { startDate, endDate } = approvedWindowDates();
    const date = dayOffset < 0 ? addUtcDays(startDate, dayOffset) : addUtcDays(endDate, dayOffset);
    stubQuickBooksReportFetch(
      [
        revenueRow({
          "Txn ID": `outside-${type}`,
          Type: type,
          "Account Type": type === "Bill" ? "Cost of Goods Sold" : "Income",
          Account: type === "Bill" ? "5015 Trucking Rate" : "Shipping Income",
          Date: date,
          "Memo/Description": "TR0121N1",
          Total: "100.00"
        })
      ],
      []
    );

    const report = await runFinancialMaterialization(ADMIN, {});

    expect(report.operatingCompanies[0]).toMatchObject({
      status: "ASSOCIATED",
      revenueMaterialized: 0,
      reportRowsSkippedOutsideWindow: 1,
      incompleteMonths: 1,
      monthlyRowsWritten: 0,
      relationshipsRefreshed: 0
    });
    expect(report.totals.reportRowsSkippedOutsideWindow).toBe(1);
    expect(revenueCreates()).toEqual([]);
    expect(monthlyUpserts()).toEqual([]);
    expect(prismaTest.model("companyOperatingRelationship").update).not.toHaveBeenCalled();
  });
});

describe("permissions: ADMIN-only guarded materialization entry point", () => {
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
        runFinancialMaterialization(role, { dryRun: true }),
        `${name} must be denied even for a dry run`
      ).rejects.toBeInstanceOf(AuthorizationError);
      assertNoDatabaseWrites();
      expect(fetchMock, `${name} dry run must not reach QuickBooks`).not.toHaveBeenCalled();

      prismaTest.reset();
      configureAuth();
      await expect(
        runFinancialMaterialization(role, { operatingCompanyId: "oc-ww" }),
        `${name} must be denied for a live run`
      ).rejects.toBeInstanceOf(AuthorizationError);
      assertNoDatabaseWrites();
      expect(fetchMock, `${name} live run must not reach QuickBooks`).not.toHaveBeenCalled();
    }
  });

  it("denies FINANCE even when the tenant grants mutation access (materialization is ADMIN-only)", async () => {
    prismaTest.reset();
    configureAuth({ canMutate: true });
    await expect(runFinancialMaterialization(FINANCE, {})).rejects.toBeInstanceOf(
      AuthorizationError
    );
    assertNoDatabaseWrites();
  });

  it("rejects an operating company id from another tenant before any work", async () => {
    prismaTest.model("operatingCompany").findFirst.mockResolvedValue(null);
    await expect(
      runFinancialMaterialization(ADMIN, { operatingCompanyId: "oc-owned-by-b" })
    ).rejects.toThrow(/does not exist in this tenant/);
    assertNoDatabaseWrites();
  });
});

describe("unassociated and failing operating companies are reported without writes", () => {
  beforeEach(() => {
    prismaTest.reset();
    configureAuth();
    setQuickBooksEnv();
  });

  it("skips an operating company without an associated credential and audits the warning", async () => {
    prismaTest.model("operatingCompany").findMany.mockResolvedValue([
      { ...OPERATING_COMPANY, quickBooksCredentialId: null, quickBooksRealmId: null }
    ]);

    const report = await runFinancialMaterialization(ADMIN, {});

    const section = report.operatingCompanies[0];
    expect(section.status).toBe("SKIPPED_UNASSOCIATED");
    expect(section.reason).toContain("no associated QuickBooks credential");
    expect(report.totals.unassociatedCompanies).toBe(1);
    const audit = auditEntries()[0];
    expect(audit.action).toBe(
      "customer-intelligence.financial-materialization.skipped-unassociated"
    );
    expect(audit.tenantId).toBe("tenant-a");
    expect(audit.entityId).toBe("oc-ww");
    expect(prismaTest.model("customerRevenueLine").create.mock.calls.length).toBe(0);
    expect(prismaTest.model("customerMonthlyFinancial").upsert.mock.calls.length).toBe(0);
  });

  it("reports a token-acquisition failure as ERROR without credentials in the audit", async () => {
    prismaTest.model("operatingCompany").findMany.mockResolvedValue([OPERATING_COMPANY]);
    prismaTest.model("integrationCredential").findFirst.mockResolvedValue(
      quickBooksCredential({ secretRef: null })
    );
    const fetchMock = stubQuickBooksReportFetch([], []);

    const report = await runFinancialMaterialization(ADMIN, {});

    expect(report.operatingCompanies[0].status).toBe("ERROR");
    expect(report.operatingCompanies[0].reason).toContain("usable QuickBooks access token");
    expect(report.totals.erroredCompanies).toBe(1);
    expect(fetchMock).not.toHaveBeenCalled();
    const serialized = JSON.stringify(auditEntries());
    expect(serialized).not.toContain("synthetic-access-token");
    expect(serialized).not.toContain("secretRef");
  });

  it("stops and reports a LIMITATION when the API provides no transaction-level detail", async () => {
    prismaTest.model("operatingCompany").findMany.mockResolvedValue([OPERATING_COMPANY]);
    prismaTest.model("integrationCredential").findFirst.mockResolvedValue(quickBooksCredential());
    // Rows exist but carry no transaction identifiers: the report cannot
    // provide reliable transaction detail, so materialization stops.
    stubQuickBooksReportFetch([revenueRow({ Date: "2026-06-15", Name: "Customer ABC" })], []);

    const report = await runFinancialMaterialization(ADMIN, {});

    const section = report.operatingCompanies[0];
    expect(section.status).toBe("LIMITATION");
    expect(section.reason).toContain("transaction-level data");
    expect(report.totals.limitationCompanies).toBe(1);
    // No revenue lines, monthly rows, or lifecycle updates; only the
    // limitation and terminal run audits are written.
    expect(prismaTest.model("customerRevenueLine").create.mock.calls.length).toBe(0);
    expect(prismaTest.model("customerMonthlyFinancial").upsert.mock.calls.length).toBe(0);
    expect(prismaTest.model("companyOperatingRelationship").update.mock.calls.length).toBe(0);
    expect(auditEntries().map((entry) => entry.action)).toEqual([
      "customer-intelligence.financial-materialization.limitation",
      "customer-intelligence.financial-materialization.run"
    ]);
  });

  it("returns LIMITATION for an unapproved income-bearing transaction type", async () => {
    configureStandardData();
    stubQuickBooksReportFetch(
      [
        revenueRow({
          "Txn ID": "income-journal-1",
          Type: "Journal Entry",
          "Account Type": "Income",
          Date: monthDate(-1),
          Total: "100.00"
        })
      ],
      []
    );

    const report = await runFinancialMaterialization(ADMIN, {});

    expect(report.operatingCompanies[0].status).toBe("LIMITATION");
    expect(report.operatingCompanies[0].reason).toContain("supported matrix");
    expect(revenueCreates()).toEqual([]);
    expect(monthlyUpserts()).toEqual([]);
  });
});

describe("full materialization: revenue lines, service lines, monthly aggregation, aging, lifecycle", () => {
  beforeEach(() => {
    prismaTest.reset();
    configureAuth();
    setQuickBooksEnv();
    configureStandardData();
  });

  it("resolves a customer only by the stable tenant/realm/operating-company source id", async () => {
    stubQuickBooksReportFetch(
      [
        revenueRow({
          "Txn ID": "stable-1",
          Date: monthDate(-1),
          "Customer ID": "1001",
          Name: "A changed display label",
          Total: "100.00"
        })
      ],
      []
    );

    const report = await runFinancialMaterialization(ADMIN, {});

    expect(report.operatingCompanies[0].revenueMaterialized).toBe(1);
    const lookup = prismaTest.model("customerSourceAccount").findMany.mock.calls[0][0] as {
      where: Record<string, unknown>;
    };
    expect(lookup.where).toMatchObject({
      tenantId: "tenant-a",
      operatingCompanyId: "oc-ww",
      realmId: "realm-1"
    });
  });

  it("stops with LIMITATION for name-only customer identity even when the name is unique", async () => {
    stubQuickBooksReportFetch(
      [
        revenueRow({
          "Txn ID": "name-only-1",
          Date: monthDate(-1),
          "Customer ID": "",
          Name: "Customer ABC",
          Total: "100.00"
        })
      ],
      []
    );

    const report = await runFinancialMaterialization(ADMIN, {});

    expect(report.operatingCompanies[0].status).toBe("LIMITATION");
    expect(report.operatingCompanies[0].reason).toContain("name-only");
    expect(prismaTest.model("customerRevenueLine").create).not.toHaveBeenCalled();
    expect(prismaTest.model("customerMonthlyFinancial").upsert).not.toHaveBeenCalled();
  });

  it("keeps two transaction detail lines distinct through their stable line ids", async () => {
    stubQuickBooksReportFetch(
      [
        revenueRow({
          "Txn ID": "shared-transaction",
          "Txn Line ID": "line-a",
          Date: monthDate(-1),
          Account: "Shipping Income",
          Total: "100.00"
        }),
        revenueRow({
          "Txn ID": "shared-transaction",
          "Txn Line ID": "line-b",
          Date: monthDate(-1),
          Account: "Shipping Income",
          Total: "250.00"
        })
      ],
      []
    );

    await runFinancialMaterialization(ADMIN, {});

    expect(revenueCreates().map((row) => row.sourceKey)).toEqual([
      "pnl-detail:realm-1:shared-transaction:line-a",
      "pnl-detail:realm-1:shared-transaction:line-b"
    ]);
    expect(monthlyUpserts().find((row) => row.nativeRevenue > 0)?.nativeRevenue).toBe(350);
  });

  it("materializes revenue lines with deterministic sourceKeys and the default service line", async () => {
    // Revenue is dated in the previous month so the open-AR snapshot (as of
    // today) always forms a separate monthly bucket regardless of run date.
    const revenueMonth = monthDate(-1).slice(0, 7);
    stubQuickBooksReportFetch(
      [
        revenueRow({
          "Txn ID": "9001",
          Type: "Invoice",
          Date: monthDate(-1),
          Name: "Customer ABC",
          Account: "Shipping Income",
          "Memo/Description": "TR0121N1",
          Total: "1250.00"
        })
      ],
      [agingRow({ Name: "Customer ABC", Total: "750.00" })]
    );

    const report = await runFinancialMaterialization(ADMIN, {});

    expect(report.cadConsolidation).toContain("Directional management reporting");
    const section = report.operatingCompanies[0];
    expect(section.status).toBe("ASSOCIATED");
    expect(section.fetchedRevenueRows).toBe(1);
    expect(section.revenueMaterialized).toBe(1);
    expect(section.revenuePreserved).toBe(0);
    expect(section.agingMaterialized).toBe(1);
    expect(section.monthlyRowsWritten).toBe(3);

    const created = revenueCreates();
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      tenantId: "tenant-a",
      realmId: "realm-1",
      sourceKey: "pnl-detail:realm-1:9001:9001-line-1",
      sourceAccountId: "acc-1001",
      companyId: "company-1",
      operatingCompanyId: "oc-ww",
      serviceLine: CustomerIntelligenceServiceLine.OTHER,
      nativeAmount: 1250,
      nativeCurrency: "CAD",
      homeCurrency: "CAD",
      cadAmount: 1250,
      fxSource: "NATIVE_CAD"
    });
    expect(created[0].syncMetadata).toMatchObject({ report: "ProfitAndLossDetail" });

    const upserts = monthlyUpserts();
    expect(upserts).toHaveLength(3);
    const revenueBucket = upserts.find((row) => row.nativeRevenue > 0);
    const agingBucket = upserts.find((row) => row.nativeOpenAr > 0);
    const grossProfitBucket = upserts.find((row) => row.sourceAccountKey === "ALL");
    expect(revenueBucket).toMatchObject({
      monthKey: revenueMonth,
      companyOperatingRelationshipId: "rel-1",
      sourceAccountKey: "acc-1001",
      serviceLine: CustomerIntelligenceServiceLine.OTHER,
      currency: "CAD",
      nativeRevenue: 1250,
      nativeCost: 0,
      nativeGrossProfit: 0,
      cadRevenue: 1250,
      nativeOpenAr: 0,
      cadOpenAr: 0,
      reconciliationStatus: CustomerFinancialPeriodStatus.UNRECONCILED
    });
    expect(agingBucket).toMatchObject({
      sourceAccountKey: "acc-1001",
      serviceLine: CustomerIntelligenceServiceLine.OTHER,
      nativeRevenue: 0,
      nativeOpenAr: 750,
      cadOpenAr: 750,
      reconciliationStatus: CustomerFinancialPeriodStatus.UNRECONCILED
    });
    expect(grossProfitBucket).toMatchObject({
      sourceAccountKey: "ALL",
      currency: "CAD",
      nativeRevenue: 0,
      nativeCost: 0,
      nativeGrossProfit: 1250
    });
  });

  it("applies the existing service-mapping-rule precedence per operating company", async () => {
    prismaTest.model("quickBooksServiceMappingRule").findMany.mockResolvedValue([
      {
        dimension: QuickBooksServiceMappingDimension.INCOME_ACCOUNT,
        matchValue: "Shipping Income",
        serviceLine: CustomerIntelligenceServiceLine.OCEAN,
        priority: 5,
        active: true
      },
      {
        dimension: QuickBooksServiceMappingDimension.ITEM,
        matchValue: "Ocean Freight",
        serviceLine: CustomerIntelligenceServiceLine.TRUCKING_DRAYAGE,
        priority: 9,
        active: true
      }
    ]);
    stubQuickBooksReportFetch(
      [
        revenueRow({
          "Txn ID": "9001",
          Date: "2026-06-15",
          Name: "Customer ABC",
          Account: "Shipping Income",
          Item: "Ocean Freight",
          Total: "100.00"
        })
      ],
      []
    );

    const report = await runFinancialMaterialization(ADMIN, {});

    // ITEM beats INCOME_ACCOUNT: the item rule wins.
    expect(revenueCreates()[0].serviceLine).toBe(
      CustomerIntelligenceServiceLine.TRUCKING_DRAYAGE
    );
    expect(report.operatingCompanies[0].revenueMaterialized).toBe(1);
  });

  it("defaults unmatched income to LOCAL_TRUCKING only for Newell's Express", async () => {
    configureStandardData(OPERATING_COMPANY_NEWELLS);
    stubQuickBooksReportFetch(
      [
        revenueRow({
          "Txn ID": "9001",
          Date: "2026-06-15",
          Name: "Customer ABC",
          Account: "Shipping Income",
          Total: "100.00"
        })
      ],
      []
    );

    const report = await runFinancialMaterialization(ADMIN, {});

    expect(revenueCreates()[0].serviceLine).toBe(
      CustomerIntelligenceServiceLine.LOCAL_TRUCKING
    );
    expect(report.operatingCompanies[0].slug).toBe("newells-express");
  });

  it("refreshes lifecycle for the materialized relationship through the guarded action", async () => {
    stubQuickBooksReportFetch(
      [
        revenueRow({
          "Txn ID": "9001",
          Date: "2026-06-15",
          Name: "Customer ABC",
          Total: "100.00"
        })
      ],
      []
    );

    const report = await runFinancialMaterialization(ADMIN, {});

    expect(report.operatingCompanies[0].relationshipsRefreshed).toBe(1);
    // refreshRelationshipLifecycle updated the relationship with the computed
    // lifecycle after observing revenue and an approved mapping.
    const update = prismaTest.model("companyOperatingRelationship").update.mock.calls[0][0] as {
      data: Record<string, unknown>;
    };
    expect(update).toBeDefined();
    expect(update.data.lifecycle).toBe("ACTIVE_CUSTOMER");
    expect(
      auditEntries().some((entry) => entry.action === "customer-intelligence.relationship.lifecycle-refreshed")
    ).toBe(true);
  });
});

describe("cost scope (CP-02B-5-Q2): gross profit only for Newl Worldwide", () => {
  beforeEach(() => {
    prismaTest.reset();
    configureAuth();
    setQuickBooksEnv();
    configureStandardData();
  });

  it("combines multiple customer and vendor invoices by file and materializes Worldwide gross profit", async () => {
    prismaTest.model("quickBooksServiceMappingRule").findMany.mockResolvedValue([
      {
        dimension: QuickBooksServiceMappingDimension.FILE_PREFIX,
        matchValue: "TR",
        serviceLine: CustomerIntelligenceServiceLine.TRUCKING_DRAYAGE,
        priority: 10,
        active: true
      }
    ]);
    stubQuickBooksReportFetch(
      [
        revenueRow({
          "Txn ID": "9001",
          Date: monthDate(-1),
          Name: "Customer ABC",
          Description: "TR0121N1",
          Total: "1000.00"
        }),
        revenueRow({
          "Txn ID": "9002",
          Date: monthDate(-1),
          Name: "Customer ABC",
          "Memo on Statement": "TR0121N1",
          Total: "250.00"
        }),
        revenueRow({
          "Txn ID": "9100",
          Type: "Bill",
          "Account Type": "Cost of Goods Sold",
          Date: monthDate(-1),
          Name: "Fast Freight Ltd",
          Account: "5015 Trucking Rate",
          Memo: "TR0121N1",
          Total: "400.00"
        }),
        revenueRow({
          "Txn ID": "9101",
          Type: "Bill",
          "Account Type": "Expense",
          Date: monthDate(-1),
          Name: "Synthetic Carrier Ltd",
          Account: "5590 Shipping Expense",
          Memo: "TR0121N1",
          Total: "100.00"
        })
      ],
      []
    );

    const report = await runFinancialMaterialization(ADMIN, {});

    const section = report.operatingCompanies[0];
    expect(section.status).toBe("ASSOCIATED");
    expect(section.costRowsPaired).toBe(2);
    expect(section.costRowsAmbiguous).toBe(0);
    expect(revenueCreates()).toHaveLength(4);
    expect(
      revenueCreates()
        .filter((row) => row.transactionType === "Bill")
        .map((row) => row.sourceKey)
    ).toEqual([
      "pnl-detail:realm-1:9100:9100-line-1",
      "pnl-detail:realm-1:9101:9101-line-1"
    ]);
    const financials = monthlyUpserts();
    const revenueBucket = financials.find((row) => row.sourceAccountKey === "acc-1001");
    const costBucket = financials.find((row) => row.sourceAccountKey === "ALL");
    expect(revenueBucket).toMatchObject({
      serviceLine: CustomerIntelligenceServiceLine.TRUCKING_DRAYAGE,
      nativeRevenue: 1250,
      nativeCost: 0,
      nativeGrossProfit: 0
    });
    expect(costBucket).toMatchObject({
      sourceAccountKey: "ALL",
      sourceAccountId: null,
      serviceLine: CustomerIntelligenceServiceLine.TRUCKING_DRAYAGE,
      currency: "CAD",
      nativeRevenue: 0,
      nativeCost: 500,
      nativeGrossProfit: 750
    });
    expect(
      financials.reduce((total, row) => total + row.nativeGrossProfit, 0)
    ).toBe(750);
  });

  it("pairs vendor cost when unrelated Memo text precedes the file in Memo on Statement", async () => {
    stubQuickBooksReportFetch(
      [
        revenueRow({
          "Txn ID": "memo-statement-customer",
          Date: monthDate(-1),
          Memo: "Synthetic unrelated invoice note",
          "Memo on Statement": "Shipment TR0121N1",
          Total: "500.00"
        }),
        revenueRow({
          "Txn ID": "memo-statement-vendor",
          Type: "Bill",
          "Account Type": "Cost of Goods Sold",
          Date: monthDate(-1),
          Account: "5015 Trucking Rate",
          Description: "Carrier cost for TR0121N1",
          Total: "200.00"
        })
      ],
      []
    );

    const report = await runFinancialMaterialization(ADMIN, {});

    expect(report.operatingCompanies[0]).toMatchObject({
      status: "ASSOCIATED",
      costRowsPaired: 1,
      costRowsAmbiguous: 0
    });
    expect(revenueCreates()[0]).toMatchObject({ fileRef: "TR0121N1" });
    expect(monthlyUpserts().find((row) => row.sourceAccountKey === "ALL")).toMatchObject({
      currency: "CAD",
      nativeCost: 200,
      nativeGrossProfit: 300
    });
  });

  it("does not use customer Memo or combined Memo/Description as file evidence", async () => {
    stubQuickBooksReportFetch(
      [
        revenueRow({
          "Txn ID": "customer-unapproved-file-field",
          Date: monthDate(-1),
          Memo: "TR0121N1",
          "Memo/Description": "TR0121N1",
          Total: "500.00"
        }),
        revenueRow({
          "Txn ID": "vendor-for-unapproved-customer-field",
          Type: "Bill",
          "Account Type": "Cost of Goods Sold",
          Date: monthDate(-1),
          Account: "5015 Trucking Rate",
          Memo: "TR0121N1",
          Total: "200.00"
        })
      ],
      []
    );

    const report = await runFinancialMaterialization(ADMIN, {});

    expect(report.operatingCompanies[0]).toMatchObject({
      status: "ASSOCIATED",
      costRowsPaired: 0,
      costRowsAmbiguous: 1
    });
    expect(
      revenueCreates().find((row) => row.transactionNumber === "customer-unapproved-file-field")
    ).toMatchObject({ fileRef: null });
  });

  it("does not use vendor Memo on Statement or combined Memo/Description as file evidence", async () => {
    stubQuickBooksReportFetch(
      [
        revenueRow({
          "Txn ID": "customer-for-unapproved-vendor-field",
          Date: monthDate(-1),
          Description: "TR0121N1",
          Total: "500.00"
        }),
        revenueRow({
          "Txn ID": "vendor-unapproved-file-field",
          Type: "Bill",
          "Account Type": "Cost of Goods Sold",
          Date: monthDate(-1),
          Account: "5015 Trucking Rate",
          "Memo on Statement": "TR0121N1",
          "Memo/Description": "TR0121N1",
          Total: "200.00"
        })
      ],
      []
    );

    const report = await runFinancialMaterialization(ADMIN, {});

    expect(report.operatingCompanies[0]).toMatchObject({
      status: "ASSOCIATED",
      costRowsPaired: 0,
      costRowsAmbiguous: 1
    });
    expect(
      revenueCreates().some((row) => row.transactionNumber === "vendor-unapproved-file-field")
    ).toBe(false);
  });

  it("fails closed when customer Description and Memo on Statement disagree", async () => {
    stubQuickBooksReportFetch(
      [
        revenueRow({
          "Txn ID": "customer-conflicting-file-fields",
          Date: monthDate(-1),
          Description: "TR0121N1",
          "Memo on Statement": "OE123456N1",
          Total: "500.00"
        })
      ],
      []
    );

    const report = await runFinancialMaterialization(ADMIN, {});

    expect(report.operatingCompanies[0]).toMatchObject({ status: "LIMITATION" });
    expect(report.operatingCompanies[0].reason).toContain("conflicting file numbers");
    expect(revenueCreates()).toEqual([]);
    expect(monthlyUpserts()).toEqual([]);
  });

  it("fails closed when vendor Description and Memo disagree", async () => {
    stubQuickBooksReportFetch(
      [
        revenueRow({
          "Txn ID": "customer-for-conflicting-vendor-fields",
          Date: monthDate(-1),
          Description: "TR0121N1",
          Total: "500.00"
        }),
        revenueRow({
          "Txn ID": "vendor-conflicting-file-fields",
          Type: "Bill",
          "Account Type": "Cost of Goods Sold",
          Date: monthDate(-1),
          Account: "5015 Trucking Rate",
          Description: "TR0121N1",
          Memo: "OE123456N1",
          Total: "200.00"
        })
      ],
      []
    );

    const report = await runFinancialMaterialization(ADMIN, {});

    expect(report.operatingCompanies[0]).toMatchObject({ status: "LIMITATION" });
    expect(report.operatingCompanies[0].reason).toContain("conflicting file numbers");
    expect(revenueCreates()).toEqual([]);
    expect(monthlyUpserts()).toEqual([]);
  });

  it("keeps vendor cost in the authoritative bill month instead of reallocating it to the invoice month", async () => {
    stubQuickBooksReportFetch(
      [
        revenueRow({
          "Txn ID": "invoice-prior-month",
          Date: monthDate(-1),
          Description: "TR0121N1",
          Total: "500.00"
        }),
        revenueRow({
          "Txn ID": "bill-current-month",
          Type: "Bill",
          "Account Type": "Cost of Goods Sold",
          Date: monthDate(0),
          Account: "5015 Trucking Rate",
          Memo: "TR0121N1",
          Total: "200.00"
        })
      ],
      []
    );

    await runFinancialMaterialization(ADMIN, {});

    expect(
      monthlyUpserts().find(
        (row) =>
          row.sourceAccountKey === "ALL" && row.monthKey === monthDate(0).slice(0, 7)
      )
    ).toMatchObject({
      monthKey: monthDate(0).slice(0, 7),
      nativeCost: 200,
      nativeGrossProfit: -200
    });
    expect(monthlyUpserts().find((row) => row.sourceAccountKey === "acc-1001")).toMatchObject({
      monthKey: monthDate(-1).slice(0, 7),
      nativeRevenue: 500
    });
  });

  it("excludes non-allowlisted expenses without aborting eligible revenue and direct costs", async () => {
    stubQuickBooksReportFetch(
      [
        revenueRow({
          "Txn ID": "9001",
          Date: monthDate(-1),
          Description: "TR0121N1",
          Total: "1250.00"
        }),
        revenueRow({
          "Txn ID": "expense-1",
          Type: "Bill",
          "Account Type": "Expense",
          Date: monthDate(-1),
          Account: "6999 Synthetic Office Expense",
          Memo: "TR0121N1",
          Total: "400.00"
        }),
        revenueRow({
          "Txn ID": "approved-cost-1",
          Type: "Bill",
          "Account Type": "Cost of Goods Sold",
          Date: monthDate(-1),
          Account: "5015 Trucking Rate",
          Memo: "TR0121N1",
          Total: "250.00"
        })
      ],
      []
    );

    const report = await runFinancialMaterialization(ADMIN, {});

    expect(report.operatingCompanies[0]).toMatchObject({
      status: "ASSOCIATED",
      revenueMaterialized: 1,
      costRowsPaired: 1
    });
    expect(revenueCreates().map((row) => row.transactionNumber)).toEqual(["9001", "approved-cost-1"]);
    expect(revenueCreates().some((row) => row.transactionNumber === "expense-1")).toBe(false);
    expect(monthlyUpserts().find((row) => row.sourceAccountKey === "ALL")).toMatchObject({
      nativeCost: 250,
      nativeGrossProfit: 1000
    });
  });

  it("combines foreign customer revenue and vendor cost into authoritative CAD gross profit", async () => {
    prismaTest.model("customerFxRate").findFirst.mockResolvedValue({
      currency: "USD",
      monthKey: monthDate(-1).slice(0, 7),
      rateToCad: 1.35,
      status: "FINAL",
      source: "BANK_OF_CANADA"
    });
    stubQuickBooksReportFetch(
      [
        revenueRow({
          "Txn ID": "customer-usd",
          Date: monthDate(-1),
          Currency: "USD",
          "Foreign Amount": "100.00",
          "Exchange Rate": "1.25",
          "Memo on Statement": "OE123456N1",
          "Memo/Description": "",
          Total: "125.00"
        }),
        revenueRow({
          "Txn ID": "vendor-cad",
          Type: "Bill",
          "Account Type": "Cost of Goods Sold",
          Date: monthDate(-1),
          Currency: "USD",
          "Foreign Amount": "32.00",
          "Exchange Rate": "1.25",
          Account: "5020 Ocean Freight Rate",
          Memo: "OE123456N1",
          Total: "40.00"
        })
      ],
      []
    );

    const report = await runFinancialMaterialization(ADMIN, {});

    expect(report.operatingCompanies[0]).toMatchObject({ status: "ASSOCIATED", costRowsPaired: 1 });
    const costBucket = monthlyUpserts().find((row) => row.sourceAccountKey === "ALL");
    expect(costBucket).toMatchObject({
      currency: "CAD",
      nativeCost: 40,
      nativeGrossProfit: 85
    });
    expect(monthlyUpserts().find((row) => row.sourceAccountKey === "acc-1001")).toMatchObject({
      currency: "USD",
      nativeRevenue: 100,
      nativeGrossProfit: 0
    });
    expect(
      monthlyUpserts().reduce((total, row) => total + row.nativeGrossProfit, 0)
    ).toBe(85);
  });

  it("uses a foreign vendor bill's authoritative CAD home amount without requiring an exchange rate", async () => {
    stubQuickBooksReportFetch(
      [
        revenueRow({
          "Txn ID": "customer-for-foreign-cost",
          Date: monthDate(-1),
          Description: "OE123456N1",
          Total: "500.00"
        }),
        revenueRow({
          "Txn ID": "foreign-cost-no-rate",
          Type: "Bill",
          "Account Type": "Cost of Goods Sold",
          Date: monthDate(-1),
          Currency: "USD",
          "Foreign Amount": "80.00",
          "Exchange Rate": "",
          Account: "5020 Ocean Freight Rate",
          Memo: "OE123456N1",
          Total: "125.00"
        })
      ],
      []
    );

    const report = await runFinancialMaterialization(ADMIN, {});

    expect(report.operatingCompanies[0]).toMatchObject({ status: "ASSOCIATED", costRowsPaired: 1 });
    expect(revenueCreates().find((row) => row.transactionNumber === "foreign-cost-no-rate")).toMatchObject({
      nativeCurrency: "USD",
      nativeAmount: 80,
      homeCurrency: "CAD",
      homeAmount: 125,
      cadAmount: 125,
      fxSource: "QUICKBOOKS_HOME_CAD"
    });
    expect(monthlyUpserts().find((row) => row.sourceAccountKey === "ALL")).toMatchObject({
      nativeCost: 125,
      nativeGrossProfit: 375
    });
  });

  it("uses a CAD vendor bill's authoritative Amount for native and home cost", async () => {
    stubQuickBooksReportFetch(
      [
        revenueRow({
          "Txn ID": "customer-for-cad-cost",
          Date: monthDate(-1),
          Description: "TR0121N1",
          Total: "500.00"
        }),
        revenueRow({
          "Txn ID": "cad-cost-differing-foreign",
          Type: "Bill",
          "Account Type": "Cost of Goods Sold",
          Date: monthDate(-1),
          Currency: "CAD",
          "Foreign Amount": "999.00",
          Account: "5015 Trucking Rate",
          Memo: "TR0121N1",
          Total: "125.00"
        })
      ],
      []
    );

    await runFinancialMaterialization(ADMIN, {});

    expect(
      revenueCreates().find((row) => row.transactionNumber === "cad-cost-differing-foreign")
    ).toMatchObject({
      nativeCurrency: "CAD",
      nativeAmount: 125,
      homeAmount: 125,
      cadAmount: 125
    });
    expect(monthlyUpserts().find((row) => row.sourceAccountKey === "ALL")).toMatchObject({
      nativeCost: 125,
      nativeGrossProfit: 375
    });
  });

  it("never replaces a foreign vendor bill's authoritative CAD home amount with exchange evidence", async () => {
    stubQuickBooksReportFetch(
      [
        revenueRow({
          "Txn ID": "customer-for-authoritative-home",
          Date: monthDate(-1),
          Description: "OE123456N1",
          Total: "500.00"
        }),
        revenueRow({
          "Txn ID": "foreign-cost-conflicting-rate",
          Type: "Bill",
          "Account Type": "Cost of Goods Sold",
          Date: monthDate(-1),
          Currency: "USD",
          "Foreign Amount": "80.00",
          "Exchange Rate": "9.99",
          Account: "5020 Ocean Freight Rate",
          Memo: "OE123456N1",
          Total: "125.00"
        })
      ],
      []
    );

    await runFinancialMaterialization(ADMIN, {});

    const cost = revenueCreates().find(
      (row) => row.transactionNumber === "foreign-cost-conflicting-rate"
    );
    expect(cost).toMatchObject({ nativeAmount: 80, homeAmount: 125, cadAmount: 125 });
    expect(monthlyUpserts().find((row) => row.sourceAccountKey === "ALL")).toMatchObject({
      nativeCost: 125,
      nativeGrossProfit: 375
    });
  });

  it("does not associate a vendor bill when all customer invoices on the file do not resolve to one relationship", async () => {
    const secondAccount = {
      ...SOURCE_ACCOUNT,
      id: "acc-2002",
      quickBooksCustomerId: "2002",
      companyId: "company-2",
      companyOperatingRelationshipId: "rel-2",
      displayName: "Customer Two"
    };
    prismaTest.model("customerSourceAccount").findMany.mockResolvedValue([
      SOURCE_ACCOUNT,
      secondAccount
    ]);
    prismaTest.model("companyOperatingRelationship").findFirst.mockImplementation(
      ({ where }: { where: { id?: string; companyId?: string } }) =>
        where.id === "rel-2" || where.companyId === "company-2"
          ? { ...RELATIONSHIP, id: "rel-2", companyId: "company-2" }
          : RELATIONSHIP
    );
    stubQuickBooksReportFetch(
      [
        revenueRow({
          "Txn ID": "customer-one",
          Date: monthDate(-1),
          "Customer ID": "1001",
          Description: "TR0121N1",
          Total: "100.00"
        }),
        revenueRow({
          "Txn ID": "customer-two",
          Date: monthDate(-1),
          "Customer ID": "2002",
          Description: "TR0121N1",
          Total: "200.00"
        }),
        revenueRow({
          "Txn ID": "vendor-ambiguous",
          Type: "Bill",
          "Account Type": "Cost of Goods Sold",
          Date: monthDate(-1),
          Account: "5015 Trucking Rate",
          Memo: "TR0121N1",
          Total: "50.00"
        })
      ],
      []
    );

    const report = await runFinancialMaterialization(ADMIN, {});

    expect(report.operatingCompanies[0]).toMatchObject({
      costRowsPaired: 0,
      costRowsAmbiguous: 1
    });
    const grossProfitBuckets = monthlyUpserts().filter((row) => row.sourceAccountKey === "ALL");
    expect(grossProfitBuckets.every((row) => row.currency === "CAD" && row.nativeCost === 0)).toBe(
      true
    );
    expect(grossProfitBuckets.reduce((total, row) => total + row.nativeGrossProfit, 0)).toBe(300);
  });

  it("keeps zero cost and gross profit for Newl USA", async () => {
    configureStandardData(OPERATING_COMPANY_USA);
    stubQuickBooksReportFetch(
      [
        revenueRow({
          "Txn ID": "9001",
          Date: "2026-06-15",
          Name: "Customer ABC",
          "Memo/Description": "TR0121N1",
          Total: "1250.00"
        }),
        revenueRow({
          "Txn ID": "9100",
          Type: "Bill",
          "Account Type": "Cost of Goods Sold",
          Date: "2026-06-20",
          "Memo/Description": "TR0121N1",
          Total: "-400.00"
        })
      ],
      []
    );

    const report = await runFinancialMaterialization(ADMIN, {});

    expect(report.operatingCompanies[0].slug).toBe("newl-usa");
    expect(report.operatingCompanies[0].costRowsPaired).toBe(0);
    const revenueBucket = monthlyUpserts().find((row) => row.nativeRevenue > 0);
    expect(revenueBucket).toMatchObject({ nativeCost: 0, nativeGrossProfit: 0 });
  });

  it("keeps zero cost and gross profit for Newell's Express and Warehousing", async () => {
    configureStandardData(OPERATING_COMPANY_NEWELLS);
    stubQuickBooksReportFetch(
      [
        revenueRow({
          "Txn ID": "warehousing-revenue",
          Date: monthDate(-1),
          "Memo/Description": "TR0121N1",
          Total: "1250.00"
        }),
        revenueRow({
          "Txn ID": "warehousing-bill",
          Type: "Bill",
          "Account Type": "Cost of Goods Sold",
          Date: monthDate(-1),
          Account: "5015 Trucking Rate",
          "Memo/Description": "TR0121N1",
          Total: "400.00"
        })
      ],
      []
    );

    const report = await runFinancialMaterialization(ADMIN, {});

    expect(report.operatingCompanies[0].slug).toBe("newells-express");
    expect(report.operatingCompanies[0].costRowsPaired).toBe(0);
    expect(monthlyUpserts().find((row) => row.nativeRevenue > 0)).toMatchObject({
      nativeCost: 0,
      nativeGrossProfit: 0
    });
  });

});

describe("FX: closed months FINAL, current month PROVISIONAL, missing rates", () => {
  beforeEach(() => {
    prismaTest.reset();
    configureAuth();
    setQuickBooksEnv();
    configureStandardData();
  });

  it("uses authoritative CAD report currency instead of a foreign customer-account label", async () => {
    const usdAccount = { ...SOURCE_ACCOUNT, currency: "USD" };
    prismaTest.model("customerSourceAccount").findMany.mockResolvedValue([usdAccount]);
    prismaTest.model("customerSourceAccount").findFirst.mockResolvedValue(usdAccount);
    stubQuickBooksReportFetch(
      [revenueRow({ "Txn ID": "cad-report", Date: monthDate(-1), Currency: "CAD", Total: "100.00" })],
      []
    );

    const report = await runFinancialMaterialization(ADMIN, {});

    expect(report.operatingCompanies[0].status).toBe("ASSOCIATED");
    expect(revenueCreates()[0]).toMatchObject({
      nativeCurrency: "CAD",
      nativeAmount: 100,
      homeAmount: 100,
      cadAmount: 100,
      fxSource: "NATIVE_CAD"
    });
    expect(prismaTest.model("customerFxRate").findFirst).not.toHaveBeenCalled();
  });

  it("uses a CAD customer invoice's authoritative Amount for native and home revenue", async () => {
    stubQuickBooksReportFetch(
      [
        revenueRow({
          "Txn ID": "cad-revenue-differing-foreign",
          Date: monthDate(-1),
          Currency: "CAD",
          "Foreign Amount": "999.00",
          Total: "100.00"
        })
      ],
      []
    );

    await runFinancialMaterialization(ADMIN, {});

    expect(revenueCreates()[0]).toMatchObject({
      nativeCurrency: "CAD",
      nativeAmount: 100,
      homeAmount: 100,
      cadAmount: 100,
      fxSource: "NATIVE_CAD"
    });
    expect(monthlyUpserts().find((row) => row.sourceAccountKey === "acc-1001")).toMatchObject({
      nativeRevenue: 100,
      cadRevenue: 100
    });
  });

  it("stops when a foreign-currency row lacks authoritative native/home FX evidence", async () => {
    stubQuickBooksReportFetch(
      [
        revenueRow({
          "Txn ID": "foreign-incomplete",
          Date: monthDate(-1),
          Currency: "USD",
          "Foreign Amount": "",
          "Exchange Rate": "",
          Total: "100.00"
        })
      ],
      []
    );

    const report = await runFinancialMaterialization(ADMIN, {});

    expect(report.operatingCompanies[0].status).toBe("LIMITATION");
    expect(report.operatingCompanies[0].reason).toContain("authoritative native currency");
    expect(prismaTest.model("customerRevenueLine").create).not.toHaveBeenCalled();
    expect(prismaTest.model("customerMonthlyFinancial").upsert).not.toHaveBeenCalled();
  });

  it("converts USD at the stored Bank of Canada rate and labels closed months FINAL", async () => {
    const closedMonth = monthDate(-1).slice(0, 7);
    // The mapped source account says CAD; authoritative transaction evidence
    // says USD and must win.
    prismaTest.model("customerFxRate").findFirst.mockResolvedValue({
      currency: "USD",
      monthKey: closedMonth,
      rateToCad: 1.35,
      status: "FINAL",
      source: "BANK_OF_CANADA"
    });
    stubQuickBooksReportFetch(
      [
        revenueRow({
          "Txn ID": "9001",
          Date: monthDate(-1),
          Name: "Customer ABC",
          Currency: "USD",
          "Foreign Amount": "1250.00",
          "Exchange Rate": "1.25",
          Total: "1562.50"
        })
      ],
      []
    );

    const report = await runFinancialMaterialization(ADMIN, {});

    expect(report.operatingCompanies[0].fxRatesApplied).toBe(1);
    const created = revenueCreates()[0];
    expect(created.nativeCurrency).toBe("USD");
    expect(created.nativeAmount).toBe(1250);
    expect(created.homeAmount).toBe(1562.5);
    expect(created.cadAmount).toBe(1687.5);
    expect(created.fxSource).toBe("BANK_OF_CANADA_FINAL");
    expect(monthlyUpserts()[0].cadRevenue).toBe(1687.5);
  });

  it("labels the current month PROVISIONAL", async () => {
    const usdAccount = { ...SOURCE_ACCOUNT, currency: "USD" };
    prismaTest.model("customerSourceAccount").findMany.mockResolvedValue([usdAccount]);
    prismaTest.model("customerSourceAccount").findFirst.mockResolvedValue(usdAccount);
    prismaTest.model("customerFxRate").findFirst.mockResolvedValue({
      currency: "USD",
      monthKey: monthDate(0).slice(0, 7),
      rateToCad: 1.35,
      status: "PROVISIONAL",
      source: "BANK_OF_CANADA"
    });
    stubQuickBooksReportFetch(
      [
        revenueRow({
          "Txn ID": "9001",
          Date: monthDate(0),
          Name: "Customer ABC",
          Currency: "USD",
          "Foreign Amount": "1250.00",
          "Exchange Rate": "1.35",
          Total: "1687.50"
        })
      ],
      []
    );

    const report = await runFinancialMaterialization(ADMIN, {});

    expect(revenueCreates()[0].fxSource).toBe("BANK_OF_CANADA_PROVISIONAL");
    expect(report.operatingCompanies[0].fxRatesApplied).toBe(1);
  });

  it("finalizes monthly CAD aggregation after a provisional line's month closes", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-07T12:00:00.000Z"));
    prismaTest.model("customerFxRate").findFirst.mockResolvedValue({
      currency: "USD",
      monthKey: "2026-08",
      rateToCad: 1.3,
      status: "PROVISIONAL",
      source: "BANK_OF_CANADA"
    });
    const rows = [
      revenueRow({
        "Txn ID": "fx-rollover",
        Date: "2026-08-05",
        Currency: "USD",
        "Foreign Amount": "100.00",
        "Exchange Rate": "1.25",
        Total: "125.00"
      })
    ];
    stubQuickBooksReportFetch(rows, []);

    const provisional = await runFinancialMaterialization(ADMIN, {});
    const provisionalLine = { id: "line-fx-rollover", ...revenueCreates()[0] };
    expect(provisional.operatingCompanies[0]).toMatchObject({ status: "ASSOCIATED" });
    expect(provisionalLine).toMatchObject({
      sourceKey: "pnl-detail:realm-1:fx-rollover:fx-rollover-line-1",
      cadAmount: 130,
      fxSource: "BANK_OF_CANADA_PROVISIONAL"
    });

    prismaTest.reset();
    configureAuth();
    vi.setSystemTime(new Date("2026-09-07T12:00:00.000Z"));
    configureStandardData();
    prismaTest.model("customerFxRate").findFirst.mockResolvedValue({
      currency: "USD",
      monthKey: "2026-08",
      rateToCad: 1.4,
      status: "FINAL",
      source: "BANK_OF_CANADA"
    });
    prismaTest.model("customerRevenueLine").findFirst.mockResolvedValue(provisionalLine);
    prismaTest.model("customerRevenueLine").findMany.mockResolvedValue([provisionalLine]);
    stubQuickBooksReportFetch(rows, []);

    const finalized = await runFinancialMaterialization(ADMIN, {});

    expect(finalized.operatingCompanies[0]).toMatchObject({
      status: "ASSOCIATED",
      revenueMaterialized: 1,
      revenuePreserved: 1,
      fxRatesApplied: 1
    });
    expect(revenueCreates()).toEqual([]);
    expect(monthlyUpserts().find((row) => row.sourceAccountKey === "acc-1001")).toMatchObject({
      monthKey: "2026-08",
      currency: "USD",
      nativeRevenue: 100,
      cadRevenue: 140,
      reconciliationStatus: CustomerFinancialPeriodStatus.UNRECONCILED
    });
    // The immutable transaction row is preserved; only monthly CAD
    // materialization uses the now-applicable FINAL rate.
    expect(prismaTest.model("customerRevenueLine").update).not.toHaveBeenCalled();
  });

  it("never invents a conversion: a missing rate skips the row and marks the month INCOMPLETE", async () => {
    const usdAccount = { ...SOURCE_ACCOUNT, currency: "USD" };
    const cadAccount = {
      ...SOURCE_ACCOUNT,
      id: "acc-1002",
      quickBooksCustomerId: "1002",
      displayName: "Customer Two",
      currency: "CAD"
    };
    prismaTest.model("customerSourceAccount").findMany.mockResolvedValue([
      usdAccount,
      cadAccount
    ]);
    prismaTest.model("customerFxRate").findFirst.mockResolvedValue(null);
    // The USD row has no stored rate; the CAD row in the same month keeps the
    // bucket visible so the INCOMPLETE status is observable on the monthly row.
    stubQuickBooksReportFetch(
      [
        revenueRow({
          "Txn ID": "9001",
          Date: "2026-06-15",
          Name: "Customer ABC",
          Currency: "USD",
          "Foreign Amount": "1000.00",
          "Exchange Rate": "1.25",
          Total: "1250.00"
        }),
        revenueRow({
          "Txn ID": "9002",
          Date: "2026-06-15",
          "Customer ID": "1002",
          Name: "Customer Two",
          Total: "100.00"
        })
      ],
      []
    );

    const report = await runFinancialMaterialization(ADMIN, {});

    const section = report.operatingCompanies[0];
    expect(section.revenueSkippedMissingFx).toBe(1);
    expect(section.fxRatesMissing).toBe(1);
    expect(section.incompleteMonths).toBeGreaterThan(0);
    // Exactly one revenue line survives (the CAD row); the USD row was not
    // invented a rate for.
    expect(revenueCreates()).toHaveLength(1);
    expect(revenueCreates()[0].nativeCurrency).toBe("CAD");
    const cadBucket = monthlyUpserts()[0];
    expect(cadBucket.reconciliationStatus).toBe(CustomerFinancialPeriodStatus.INCOMPLETE);
  });

  it("writes a deterministic INCOMPLETE monthly row when missing FX is the only report evidence", async () => {
    prismaTest.model("customerFxRate").findFirst.mockResolvedValue(null);
    stubQuickBooksReportFetch(
      [
        revenueRow({
          "Txn ID": "missing-fx-only",
          Date: monthDate(-1),
          Currency: "USD",
          "Foreign Amount": "80.00",
          "Exchange Rate": "1.25",
          Total: "100.00"
        })
      ],
      []
    );

    const report = await runFinancialMaterialization(ADMIN, {});

    expect(report.operatingCompanies[0]).toMatchObject({
      revenueSkippedMissingFx: 1,
      monthlyRowsWritten: 1,
      incompleteMonths: 1
    });
    expect(revenueCreates()).toEqual([]);
    expect(monthlyUpserts()[0]).toMatchObject({
      monthKey: monthDate(-1).slice(0, 7),
      companyOperatingRelationshipId: "rel-1",
      sourceAccountKey: "acc-1001",
      currency: "USD",
      nativeRevenue: 0,
      cadRevenue: null,
      reconciliationStatus: CustomerFinancialPeriodStatus.INCOMPLETE
    });
  });

  it("preserves an existing monthly row and marks it INCOMPLETE when missing FX is the only evidence", async () => {
    prismaTest.model("customerFxRate").findFirst.mockResolvedValue(null);
    const existingMonth = {
      id: "monthly-existing-missing-fx",
      tenantId: "tenant-a",
      monthKey: monthDate(-1).slice(0, 7),
      companyId: "company-1",
      operatingCompanyId: "oc-ww",
      companyOperatingRelationshipId: "rel-1",
      sourceAccountId: "acc-1001",
      sourceAccountKey: "acc-1001",
      serviceLine: CustomerIntelligenceServiceLine.OTHER,
      currency: "USD",
      nativeRevenue: 425,
      nativeCost: 25,
      nativeGrossProfit: 400,
      cadRevenue: 575,
      nativeOpenAr: 30,
      cadOpenAr: 40,
      reconciliationStatus: CustomerFinancialPeriodStatus.UNRECONCILED
    };
    prismaTest.model("customerMonthlyFinancial").findFirst.mockResolvedValue(existingMonth);
    prismaTest.model("customerMonthlyFinancial").findMany.mockResolvedValue([existingMonth]);
    stubQuickBooksReportFetch(
      [
        revenueRow({
          "Txn ID": "missing-fx-existing",
          Date: monthDate(-1),
          Currency: "USD",
          "Foreign Amount": "80.00",
          "Exchange Rate": "1.25",
          Total: "100.00"
        })
      ],
      []
    );

    await runFinancialMaterialization(ADMIN, {});

    const upsert = prismaTest.model("customerMonthlyFinancial").upsert.mock.calls[0][0] as {
      update: Record<string, unknown>;
    };
    expect(upsert.update).toMatchObject({
      nativeRevenue: 425,
      nativeCost: 25,
      nativeGrossProfit: 400,
      cadRevenue: 575,
      reconciliationStatus: CustomerFinancialPeriodStatus.INCOMPLETE
    });
    expect(revenueCreates()).toEqual([]);
  });

  it.each([
    ["wrong source", "FINAL", "MANUAL"],
    ["closed month with provisional status", "PROVISIONAL", "BANK_OF_CANADA"]
  ])("rejects %s FX evidence for a closed month", async (_label, status, source) => {
    const usdAccount = { ...SOURCE_ACCOUNT, currency: "USD" };
    const closedMonth = monthDate(-1).slice(0, 7);
    prismaTest.model("customerSourceAccount").findMany.mockResolvedValue([usdAccount]);
    prismaTest.model("customerFxRate").findFirst.mockResolvedValue({
      currency: "USD",
      monthKey: closedMonth,
      rateToCad: 1.35,
      status,
      source
    });
    stubQuickBooksReportFetch(
      [
        revenueRow({
          "Txn ID": "fx-closed",
          Date: monthDate(-1),
          Currency: "USD",
          "Foreign Amount": "80.00",
          "Exchange Rate": "1.25",
          Total: "100.00"
        })
      ],
      []
    );

    const report = await runFinancialMaterialization(ADMIN, {});

    expect(report.operatingCompanies[0].revenueSkippedMissingFx).toBe(1);
    expect(report.operatingCompanies[0].incompleteMonths).toBe(1);
    expect(revenueCreates()).toEqual([]);
  });

  it("rejects a FINAL rate for the current month", async () => {
    const usdAccount = { ...SOURCE_ACCOUNT, currency: "USD" };
    prismaTest.model("customerSourceAccount").findMany.mockResolvedValue([usdAccount]);
    prismaTest.model("customerFxRate").findFirst.mockResolvedValue({
      currency: "USD",
      monthKey: monthDate(0).slice(0, 7),
      rateToCad: 1.35,
      status: "FINAL",
      source: "BANK_OF_CANADA"
    });
    stubQuickBooksReportFetch(
      [
        revenueRow({
          "Txn ID": "fx-current",
          Date: monthDate(0),
          Currency: "USD",
          "Foreign Amount": "80.00",
          "Exchange Rate": "1.25",
          Total: "100.00"
        })
      ],
      []
    );

    const report = await runFinancialMaterialization(ADMIN, {});

    expect(report.operatingCompanies[0].revenueSkippedMissingFx).toBe(1);
    expect(report.operatingCompanies[0].incompleteMonths).toBe(1);
    expect(revenueCreates()).toEqual([]);
  });
});

describe("idempotency: immutable sourceKey re-insert returns the existing row", () => {
  beforeEach(() => {
    prismaTest.reset();
    configureAuth();
    setQuickBooksEnv();
    configureStandardData();
  });

  it("preserves existing revenue lines on a re-run without re-creating them", async () => {
    const rows = [
      revenueRow({
        "Txn ID": "9001",
        Type: "Invoice",
        Date: "2026-06-15",
        Name: "Customer ABC",
        Total: "1250.00"
      })
    ];
    stubQuickBooksReportFetch(rows, []);

    const first = await runFinancialMaterialization(ADMIN, {});
    expect(first.operatingCompanies[0].revenueMaterialized).toBe(1);
    expect(first.operatingCompanies[0].revenuePreserved).toBe(0);
    expect(prismaTest.model("customerRevenueLine").create.mock.calls.length).toBe(1);

    // Simulate the persisted immutable row for the re-run.
    prismaTest.reset();
    configureAuth();
    configureStandardData();
    prismaTest.model("customerRevenueLine").findFirst.mockResolvedValue({
      id: "line-9001",
      sourceKey: "pnl-detail:realm-1:9001:9001-line-1",
      sourceAccountId: "acc-1001",
      companyId: "company-1",
      operatingCompanyId: "oc-ww",
      transactionDate: new Date("2026-06-15T00:00:00.000Z"),
      transactionType: "Invoice",
      transactionNumber: "9001",
      accountRef: null,
      classRef: null,
      itemRef: null,
      fileRef: null,
      serviceLine: CustomerIntelligenceServiceLine.OTHER,
      nativeAmount: 1250,
      nativeCurrency: "CAD",
      homeAmount: 1250,
      homeCurrency: "CAD",
      cadAmount: 1250,
      fxSource: "NATIVE_CAD"
    });
    stubQuickBooksReportFetch(rows, []);

    const second = await runFinancialMaterialization(ADMIN, {});
    expect(second.operatingCompanies[0].revenueMaterialized).toBe(1);
    expect(second.operatingCompanies[0].revenuePreserved).toBe(1);
    expect(prismaTest.model("customerRevenueLine").create.mock.calls.length).toBe(0);
    expect(monthlyUpserts().find((row) => row.nativeRevenue !== 0)?.nativeRevenue).toBe(1250);
  });

  it("canonicalizes higher-precision report amounts to cents before a repeated import", async () => {
    const rows = [
      revenueRow({
        "Txn ID": "higher-precision",
        Date: monthDate(-1),
        Total: "125.005"
      })
    ];
    stubQuickBooksReportFetch(rows, []);

    const first = await runFinancialMaterialization(ADMIN, {});
    const created = revenueCreates()[0];
    expect(first.operatingCompanies[0]).toMatchObject({
      status: "ASSOCIATED",
      revenueMaterialized: 1,
      revenuePreserved: 0
    });
    expect(created).toMatchObject({
      nativeAmount: 125.01,
      homeAmount: 125.01,
      cadAmount: 125.01
    });
    expect(monthlyUpserts().find((row) => row.sourceAccountKey === "acc-1001")).toMatchObject({
      nativeRevenue: 125.01,
      cadRevenue: 125.01
    });

    prismaTest.reset();
    configureAuth();
    configureStandardData();
    prismaTest.model("customerRevenueLine").findFirst.mockResolvedValue({
      id: "line-higher-precision",
      ...created,
      transactionDate: new Date(`${monthDate(-1)}T00:00:00.000Z`)
    });
    stubQuickBooksReportFetch(rows, []);

    const repeated = await runFinancialMaterialization(ADMIN, {});
    expect(repeated.operatingCompanies[0]).toMatchObject({
      status: "ASSOCIATED",
      revenueMaterialized: 1,
      revenuePreserved: 1
    });
    expect(revenueCreates()).toEqual([]);
    expect(monthlyUpserts().find((row) => row.sourceAccountKey === "acc-1001")).toMatchObject({
      nativeRevenue: 125.01,
      cadRevenue: 125.01
    });
  });

  it("recomputes a shared monthly bucket from an absent prior line plus a newly fetched line", async () => {
    const priorDate = new Date(`${monthDate(-1)}T00:00:00.000Z`);
    prismaTest.model("customerRevenueLine").findMany.mockResolvedValue([
      {
        id: "line-prior-absent",
        sourceKey: "pnl-detail:realm-1:prior-absent:prior-line-1",
        sourceAccountId: "acc-1001",
        companyId: "company-1",
        operatingCompanyId: "oc-ww",
        transactionDate: priorDate,
        transactionType: "Invoice",
        transactionNumber: "prior-absent",
        accountRef: null,
        classRef: null,
        itemRef: null,
        fileRef: null,
        serviceLine: CustomerIntelligenceServiceLine.OTHER,
        nativeAmount: 100,
        nativeCurrency: "CAD",
        homeAmount: 100,
        homeCurrency: "CAD",
        cadAmount: 100,
        fxSource: "NATIVE_CAD"
      }
    ]);
    stubQuickBooksReportFetch(
      [revenueRow({ "Txn ID": "new-line", Date: monthDate(-1), Total: "50.00" })],
      []
    );

    await runFinancialMaterialization(ADMIN, {});

    expect(monthlyUpserts().find((row) => row.sourceAccountKey === "acc-1001")).toMatchObject({
      monthKey: monthDate(-1).slice(0, 7),
      nativeRevenue: 150,
      cadRevenue: 150
    });
    const immutableLookup = prismaTest.model("customerRevenueLine").findMany.mock.calls[0][0] as {
      where: Record<string, unknown>;
    };
    expect(immutableLookup.where).toMatchObject({
      tenantId: "tenant-a",
      operatingCompanyId: "oc-ww"
    });
  });

  it("recomputes a prior immutable bucket wholly absent from the latest report", async () => {
    prismaTest.model("customerRevenueLine").findMany.mockResolvedValue([
      {
        id: "line-wholly-absent",
        sourceKey: "pnl-detail:realm-1:wholly-absent:line-1",
        sourceAccountId: "acc-1001",
        companyId: "company-1",
        operatingCompanyId: "oc-ww",
        transactionDate: new Date(`${monthDate(-2)}T00:00:00.000Z`),
        transactionType: "Invoice",
        transactionNumber: "wholly-absent",
        accountRef: null,
        classRef: null,
        itemRef: null,
        fileRef: null,
        serviceLine: CustomerIntelligenceServiceLine.OTHER,
        nativeAmount: 225,
        nativeCurrency: "CAD",
        homeAmount: 225,
        homeCurrency: "CAD",
        cadAmount: 225,
        fxSource: "NATIVE_CAD"
      }
    ]);
    stubQuickBooksReportFetch([], []);

    await runFinancialMaterialization(ADMIN, {});

    expect(monthlyUpserts().find((row) => row.sourceAccountKey === "acc-1001")).toMatchObject({
      monthKey: monthDate(-2).slice(0, 7),
      nativeRevenue: 225,
      cadRevenue: 225
    });
  });

  it("preserves older and boundary-month totals when they fall outside the rolling fetch window", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-07T12:00:00.000Z"));
    const boundaryDate = "2024-08-07";
    stubQuickBooksReportFetch(
      [
        revenueRow({
          "Txn ID": "rolling-boundary-line",
          Date: boundaryDate,
          Total: "125.00"
        })
      ],
      []
    );

    await runFinancialMaterialization(ADMIN, {});

    const firstRunRows = monthlyUpserts()
      .filter((row) => row.monthKey === "2024-08")
      .map((row, index) => ({
        id: `monthly-boundary-${index}`,
        tenantId: "tenant-a",
        ...row,
        nativeOpenAr: row.sourceAccountKey === "acc-1001" ? 75 : 0,
        cadOpenAr: row.sourceAccountKey === "acc-1001" ? 75 : 0
      }));
    expect(firstRunRows.find((row) => row.sourceAccountKey === "acc-1001")).toMatchObject({
      nativeRevenue: 125,
      cadRevenue: 125
    });
    expect(firstRunRows.find((row) => row.sourceAccountKey === "ALL")).toMatchObject({
      nativeGrossProfit: 125
    });

    // Advance the exact rolling boundary by one day. QuickBooks now correctly
    // omits the immutable line because it is outside the approved interval.
    prismaTest.reset();
    configureAuth();
    vi.setSystemTime(new Date("2026-08-08T12:00:00.000Z"));
    configureStandardData();
    prismaTest.model("customerRevenueLine").findMany.mockResolvedValue([]);
    const otherTenant = {
      ...firstRunRows[0],
      id: "monthly-other-tenant",
      tenantId: "tenant-b",
      companyId: "company-b",
      companyOperatingRelationshipId: "rel-b",
      nativeRevenue: 999,
      cadRevenue: 999
    };
    const otherOperatingCompany = {
      ...firstRunRows[0],
      id: "monthly-other-operating-company",
      operatingCompanyId: "oc-usa",
      companyOperatingRelationshipId: "rel-usa",
      nativeRevenue: 888,
      cadRevenue: 888
    };
    const olderHistorical = {
      ...firstRunRows[0],
      id: "monthly-older-authoritative",
      monthKey: "2024-07",
      nativeRevenue: 640,
      cadRevenue: 640
    };
    prismaTest.model("customerMonthlyFinancial").findMany.mockImplementation(
      ({ where }: { where: { monthKey?: string | { lte?: string } } }) =>
        typeof where.monthKey === "object" && where.monthKey?.lte
          ? [olderHistorical, ...firstRunRows, otherTenant, otherOperatingCompany]
          : []
    );
    stubQuickBooksReportFetch([], []);

    const rerun = await runFinancialMaterialization(ADMIN, {});

    expect(rerun.operatingCompanies[0]).toMatchObject({
      status: "ASSOCIATED",
      relationshipsRefreshed: 0
    });
    expect(monthlyUpserts().filter((row) => row.monthKey <= "2024-08")).toEqual([]);
    const boundaryLookup = prismaTest.model("customerMonthlyFinancial").findMany.mock.calls.find(
      ([arg]) =>
        typeof (arg as { where: { monthKey?: unknown } }).where.monthKey === "object" &&
        (arg as { where: { monthKey?: { lte?: string } } }).where.monthKey?.lte === "2024-08"
    );
    expect(boundaryLookup).toBeUndefined();
  });

  it("fails closed when an existing sourceKey conflicts with changed immutable evidence", async () => {
    prismaTest.model("customerRevenueLine").findFirst.mockResolvedValue({
      id: "line-9001",
      sourceKey: "pnl-detail:realm-1:9001:9001-line-1",
      sourceAccountId: "acc-1001",
      companyId: "company-1",
      operatingCompanyId: "oc-ww",
      transactionDate: new Date("2026-06-15T00:00:00.000Z"),
      transactionType: "Invoice",
      transactionNumber: "9001",
      accountRef: null,
      classRef: null,
      itemRef: null,
      fileRef: null,
      serviceLine: CustomerIntelligenceServiceLine.OTHER,
      nativeAmount: 1250,
      nativeCurrency: "CAD",
      homeAmount: 1250,
      homeCurrency: "CAD",
      cadAmount: 1250,
      fxSource: "NATIVE_CAD"
    });
    stubQuickBooksReportFetch(
      [
        revenueRow({
          "Txn ID": "9001",
          Date: "2026-07-15",
          Total: "1500.00"
        })
      ],
      []
    );

    const report = await runFinancialMaterialization(ADMIN, {});

    expect(report.operatingCompanies[0].status).toBe("LIMITATION");
    expect(report.operatingCompanies[0].reason).toContain("conflicting evidence");
    expect(prismaTest.model("customerRevenueLine").create).not.toHaveBeenCalled();
    expect(prismaTest.model("customerMonthlyFinancial").upsert).not.toHaveBeenCalled();
  });

  it("treats a changed account name under the same transaction-line identity as an immutable conflict", async () => {
    prismaTest.model("customerRevenueLine").findFirst.mockResolvedValue({
      id: "line-account-original",
      sourceKey: "pnl-detail:realm-1:stable-account:stable-account-line-1",
      sourceAccountId: "acc-1001",
      companyId: "company-1",
      operatingCompanyId: "oc-ww",
      transactionDate: new Date(`${monthDate(-1)}T00:00:00.000Z`),
      transactionType: "Invoice",
      transactionNumber: "stable-account",
      accountRef: "Original Income Account",
      classRef: null,
      itemRef: null,
      fileRef: null,
      serviceLine: CustomerIntelligenceServiceLine.OTHER,
      nativeAmount: 125,
      nativeCurrency: "CAD",
      homeAmount: 125,
      homeCurrency: "CAD",
      cadAmount: 125,
      fxSource: "NATIVE_CAD"
    });
    stubQuickBooksReportFetch(
      [
        revenueRow({
          "Txn ID": "stable-account",
          "Txn Line ID": "stable-account-line-1",
          Date: monthDate(-1),
          Account: "Renamed Income Account",
          Total: "125.00"
        })
      ],
      []
    );

    const report = await runFinancialMaterialization(ADMIN, {});

    expect(report.operatingCompanies[0].status).toBe("LIMITATION");
    expect(report.operatingCompanies[0].reason).toContain("conflicting evidence");
    const lookup = prismaTest.model("customerRevenueLine").findFirst.mock.calls[0][0] as {
      where: { sourceKey: string };
    };
    expect(lookup.where.sourceKey).toBe(
      "pnl-detail:realm-1:stable-account:stable-account-line-1"
    );
    expect(revenueCreates()).toEqual([]);
    expect(monthlyUpserts()).toEqual([]);
  });

  it("preserves identical immutable vendor-cost evidence on a re-run", async () => {
    const billDate = monthDate(-1);
    prismaTest.model("customerRevenueLine").findFirst.mockImplementation(
      ({ where }: { where: { sourceKey: string } }) => {
        if (where.sourceKey !== "pnl-detail:realm-1:vendor-repeat:vendor-line-1") {
          return null;
        }
        return {
          id: "line-vendor-repeat",
          sourceKey: where.sourceKey,
          sourceAccountId: null,
          companyId: "company-1",
          operatingCompanyId: "oc-ww",
          transactionDate: new Date(`${billDate}T00:00:00.000Z`),
          transactionType: "Bill",
          transactionNumber: "vendor-repeat",
          accountRef: "5015 Trucking Rate",
          classRef: null,
          itemRef: null,
          fileRef: "TR0121N1",
          serviceLine: CustomerIntelligenceServiceLine.OTHER,
          nativeAmount: 200,
          nativeCurrency: "CAD",
          homeAmount: 200,
          homeCurrency: "CAD",
          cadAmount: 200,
          fxSource: "QUICKBOOKS_HOME_CAD"
        };
      }
    );
    stubQuickBooksReportFetch(
      [
        revenueRow({
          "Txn ID": "customer-for-vendor-repeat",
          Date: billDate,
          Description: "TR0121N1",
          Total: "500.00"
        }),
        revenueRow({
          "Txn ID": "vendor-repeat",
          "Txn Line ID": "vendor-line-1",
          Type: "Bill",
          "Account Type": "Cost of Goods Sold",
          Date: billDate,
          Account: "5015 Trucking Rate",
          Memo: "TR0121N1",
          Total: "200.00"
        })
      ],
      []
    );

    const report = await runFinancialMaterialization(ADMIN, {});

    expect(report.operatingCompanies[0]).toMatchObject({
      status: "ASSOCIATED",
      costRowsPaired: 1,
      revenuePreserved: 1
    });
    expect(revenueCreates().map((row) => row.sourceKey)).toEqual([
      "pnl-detail:realm-1:customer-for-vendor-repeat:customer-for-vendor-repeat-line-1"
    ]);
    expect(monthlyUpserts().find((row) => row.sourceAccountKey === "ALL")).toMatchObject({
      nativeCost: 200,
      nativeGrossProfit: 300
    });
  });

  it("fails closed when vendor evidence changes under the same immutable identity", async () => {
    const billDate = monthDate(-1);
    prismaTest.model("customerRevenueLine").findFirst.mockImplementation(
      ({ where }: { where: { sourceKey: string } }) =>
        where.sourceKey === "pnl-detail:realm-1:vendor-changed:vendor-line-1"
          ? {
              id: "line-vendor-changed",
              sourceKey: where.sourceKey,
              sourceAccountId: null,
              companyId: "company-1",
              operatingCompanyId: "oc-ww",
              transactionDate: new Date(`${billDate}T00:00:00.000Z`),
              transactionType: "Bill",
              transactionNumber: "vendor-changed",
              accountRef: "5015 Trucking Rate",
              classRef: null,
              itemRef: null,
              fileRef: "TR0121N1",
              serviceLine: CustomerIntelligenceServiceLine.OTHER,
              nativeAmount: 150,
              nativeCurrency: "CAD",
              homeAmount: 150,
              homeCurrency: "CAD",
              cadAmount: 150,
              fxSource: "QUICKBOOKS_HOME_CAD"
            }
          : null
    );
    stubQuickBooksReportFetch(
      [
        revenueRow({
          "Txn ID": "customer-for-vendor-change",
          Date: billDate,
          Description: "TR0121N1",
          Total: "500.00"
        }),
        revenueRow({
          "Txn ID": "vendor-changed",
          "Txn Line ID": "vendor-line-1",
          Type: "Bill",
          "Account Type": "Cost of Goods Sold",
          Date: billDate,
          Account: "5015 Trucking Rate",
          Memo: "TR0121N1",
          Total: "200.00"
        })
      ],
      []
    );

    const report = await runFinancialMaterialization(ADMIN, {});

    expect(report.operatingCompanies[0].status).toBe("LIMITATION");
    expect(report.operatingCompanies[0].reason).toContain("immutable vendor-cost line");
    expect(revenueCreates()).toEqual([]);
    expect(monthlyUpserts()).toEqual([]);
  });

  it("fails closed when QuickBooks repeats a vendor transaction-line identity", async () => {
    const bill = revenueRow({
      "Txn ID": "vendor-duplicate",
      "Txn Line ID": "vendor-line-1",
      Type: "Bill",
      "Account Type": "Cost of Goods Sold",
      Date: monthDate(-1),
      Account: "5015 Trucking Rate",
      Memo: "TR0121N1",
      Total: "200.00"
    });
    stubQuickBooksReportFetch(
      [
        revenueRow({
          "Txn ID": "customer-for-vendor-duplicate",
          Date: monthDate(-1),
          Description: "TR0121N1",
          Total: "500.00"
        }),
        bill,
        [...bill]
      ],
      []
    );

    const report = await runFinancialMaterialization(ADMIN, {});

    expect(report.operatingCompanies[0].status).toBe("LIMITATION");
    expect(report.operatingCompanies[0].reason).toContain("duplicate transaction-line identity");
    expect(prismaTest.model("customerRevenueLine").findFirst).not.toHaveBeenCalled();
    expect(revenueCreates()).toEqual([]);
    expect(monthlyUpserts()).toEqual([]);
  });
});

describe("atomic operating-company persistence", () => {
  beforeEach(() => {
    prismaTest.reset();
    configureAuth();
    setQuickBooksEnv();
    configureStandardData();
  });

  it("rejects conflicting same-sourceKey evidence committed while a run waits for the lock", async () => {
    const events: string[] = [];
    let revenueLookup = 0;
    prismaTest.queryRaw.mockImplementation(async () => {
      events.push("lock");
      return [];
    });
    prismaTest.model("customerRevenueLine").findFirst.mockImplementation(() => {
      revenueLookup += 1;
      events.push(revenueLookup === 1 ? "pre-lock-lookup" : "post-lock-lookup");
      if (revenueLookup === 1) {
        return null;
      }
      return {
        id: "line-concurrent-winner",
        sourceKey: "pnl-detail:realm-1:concurrent-line:concurrent-line-line-1",
        sourceAccountId: "acc-1001",
        companyId: "company-1",
        operatingCompanyId: "oc-ww",
        transactionDate: new Date(`${monthDate(-1)}T00:00:00.000Z`),
        transactionType: "Invoice",
        transactionNumber: "concurrent-line",
        accountRef: null,
        classRef: null,
        itemRef: null,
        fileRef: null,
        serviceLine: CustomerIntelligenceServiceLine.OTHER,
        nativeAmount: 999,
        nativeCurrency: "CAD",
        homeAmount: 999,
        homeCurrency: "CAD",
        cadAmount: 999,
        fxSource: "NATIVE_CAD"
      };
    });
    stubQuickBooksReportFetch(
      [revenueRow({ "Txn ID": "concurrent-line", Date: monthDate(-1), Total: "100.00" })],
      []
    );

    const report = await runFinancialMaterialization(ADMIN, {});

    expect(events).toEqual(["pre-lock-lookup", "lock", "post-lock-lookup"]);
    expect(report.operatingCompanies[0]).toMatchObject({
      status: "LIMITATION",
      monthlyRowsWritten: 0,
      relationshipsRefreshed: 0
    });
    expect(report.operatingCompanies[0].reason).toContain("conflicting evidence");
    expect(revenueCreates()).toEqual([]);
    expect(monthlyUpserts()).toEqual([]);
    expect(
      auditEntries().some(
        (entry) => entry.action === "customer-intelligence.financial-materialization.committed"
      )
    ).toBe(false);
  });

  it("rolls back an earlier immutable line when a later revenue-line insert fails", async () => {
    const committedLines: string[] = [];
    let stagedLines: string[] = [];
    let createCount = 0;
    prismaTest.model("customerRevenueLine").create.mockImplementation(
      ({ data }: { data: Record<string, unknown> }) => {
        createCount += 1;
        if (createCount === 2) throw new Error("synthetic later line failure");
        stagedLines.push(String(data.sourceKey));
        return { id: `line-${createCount}`, ...data };
      }
    );
    prismaTest.transaction.mockImplementation(async (callback) => {
      stagedLines = [];
      try {
        const result = await callback(prismaTest.proxy);
        committedLines.push(...stagedLines);
        return result;
      } catch (error) {
        stagedLines = [];
        throw error;
      }
    });
    stubQuickBooksReportFetch(
      [
        revenueRow({ "Txn ID": "atomic-line-1", Date: monthDate(-1), Total: "100.00" }),
        revenueRow({ "Txn ID": "atomic-line-2", Date: monthDate(-1), Total: "200.00" })
      ],
      []
    );

    const report = await runFinancialMaterialization(ADMIN, {});

    expect(report.operatingCompanies[0]).toMatchObject({
      status: "ERROR",
      monthlyRowsWritten: 0,
      relationshipsRefreshed: 0
    });
    expect(committedLines).toEqual([]);
    expect(prismaTest.model("customerMonthlyFinancial").upsert).not.toHaveBeenCalled();
  });

  it("rolls back immutable lines and monthly state when a monthly upsert fails", async () => {
    const committed = { lines: [] as string[], months: [] as string[] };
    let staged = { lines: [] as string[], months: [] as string[] };
    prismaTest.model("customerRevenueLine").create.mockImplementation(
      ({ data }: { data: Record<string, unknown> }) => {
        staged.lines.push(String(data.sourceKey));
        return { id: "line-staged", ...data };
      }
    );
    prismaTest.model("customerMonthlyFinancial").upsert.mockImplementation(
      ({ create }: { create: Record<string, unknown> }) => {
        staged.months.push(String(create.monthKey));
        throw new Error("synthetic monthly failure");
      }
    );
    prismaTest.transaction.mockImplementation(async (callback) => {
      staged = { lines: [], months: [] };
      try {
        const result = await callback(prismaTest.proxy);
        committed.lines.push(...staged.lines);
        committed.months.push(...staged.months);
        return result;
      } catch (error) {
        staged = { lines: [], months: [] };
        throw error;
      }
    });
    stubQuickBooksReportFetch(
      [revenueRow({ "Txn ID": "atomic-month-1", Date: monthDate(-1), Total: "100.00" })],
      []
    );

    const report = await runFinancialMaterialization(ADMIN, {});

    expect(report.operatingCompanies[0]).toMatchObject({
      status: "ERROR",
      monthlyRowsWritten: 0,
      relationshipsRefreshed: 0
    });
    expect(committed).toEqual({ lines: [], months: [] });
    expect(prismaTest.model("companyOperatingRelationship").update).not.toHaveBeenCalled();
  });
});

describe("aging independence and incomplete-period propagation", () => {
  beforeEach(() => {
    prismaTest.reset();
    configureAuth();
    setQuickBooksEnv();
    configureStandardData();
  });

  it("materializes positive AR and refreshes lifecycle when a valid revenue report is empty", async () => {
    stubQuickBooksReportFetch([], [agingRow({ Total: "750.00" })]);

    const report = await runFinancialMaterialization(ADMIN, {});

    const section = report.operatingCompanies[0];
    expect(section.status).toBe("ASSOCIATED");
    expect(section.fetchedRevenueRows).toBe(0);
    expect(section.agingMaterialized).toBe(1);
    expect(monthlyUpserts()[0]).toMatchObject({ nativeRevenue: 0, nativeOpenAr: 750 });
    expect(section.relationshipsRefreshed).toBe(1);
  });

  it("replaces settled AR with zero and refreshes the formerly active relationship", async () => {
    const currentMonth = monthDate(0).slice(0, 7);
    prismaTest.model("customerMonthlyFinancial").findMany.mockResolvedValue([
      {
        id: "monthly-prior-ar",
        tenantId: "tenant-a",
        monthKey: currentMonth,
        companyId: "company-1",
        operatingCompanyId: "oc-ww",
        companyOperatingRelationshipId: "rel-1",
        sourceAccountId: "acc-1001",
        sourceAccountKey: "acc-1001",
        serviceLine: CustomerIntelligenceServiceLine.OTHER,
        currency: "CAD",
        nativeRevenue: 0,
        nativeCost: 0,
        nativeGrossProfit: 0,
        cadRevenue: 0,
        nativeOpenAr: 750,
        cadOpenAr: 750,
        reconciliationStatus: CustomerFinancialPeriodStatus.UNRECONCILED
      }
    ]);
    prismaTest.model("customerRevenueLine").count.mockResolvedValue(0);
    prismaTest.model("customerMonthlyFinancial").count.mockResolvedValue(0);
    prismaTest.model("customerIdentityMatch").count.mockResolvedValue(1);
    stubQuickBooksReportFetch([], []);

    const report = await runFinancialMaterialization(ADMIN, {});

    expect(report.operatingCompanies[0]).toMatchObject({
      agingMaterialized: 0,
      monthlyRowsWritten: 1,
      relationshipsRefreshed: 1
    });
    expect(monthlyUpserts()[0]).toMatchObject({
      monthKey: currentMonth,
      operatingCompanyId: "oc-ww",
      sourceAccountKey: "acc-1001",
      nativeOpenAr: 0,
      cadOpenAr: 0
    });
    const staleLookup = prismaTest.model("customerMonthlyFinancial").findMany.mock.calls[0][0] as {
      where: Record<string, unknown>;
    };
    expect(staleLookup.where).toMatchObject({
      tenantId: "tenant-a",
      operatingCompanyId: "oc-ww",
      monthKey: currentMonth,
      nativeOpenAr: { gt: 0 }
    });
    const lifecycleUpdate = prismaTest.model("companyOperatingRelationship").update.mock.calls[0][0] as {
      data: Record<string, unknown>;
    };
    expect(lifecycleUpdate.data.lifecycle).toBe("DORMANT_CUSTOMER");
  });

  it("fails the section without partial financial writes when aging fetch fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        const href = String(input);
        if (href.includes("ProfitAndLossDetail")) {
          return new Response(
            JSON.stringify(
              reportResponse(REVENUE_COLUMNS, [
                revenueRow({ "Txn ID": "revenue-1", Date: monthDate(0), Total: "100.00" })
              ])
            ),
            { status: 200, headers: { "content-type": "application/json" } }
          );
        }
        return new Response("synthetic unavailable", { status: 503 });
      })
    );

    const report = await runFinancialMaterialization(ADMIN, {});

    expect(report.operatingCompanies[0].status).toBe("ERROR");
    expect(prismaTest.model("customerRevenueLine").create).not.toHaveBeenCalled();
    expect(prismaTest.model("customerMonthlyFinancial").upsert).not.toHaveBeenCalled();
  });

  it.each([
    ["unmatched", agingRow({ "Customer ID": "9999", Name: "Unknown", Total: "50.00" })],
    ["completely missing", agingRow({ "Customer ID": "1001", Total: "" })]
  ] as Array<[string, string[]]>)(
    "marks the as-of month INCOMPLETE for %s aging evidence",
    async (_label, agingEvidence) => {
      stubQuickBooksReportFetch(
        [revenueRow({ "Txn ID": "revenue-current", Date: monthDate(0), Total: "100.00" })],
        [agingEvidence]
      );

      const report = await runFinancialMaterialization(ADMIN, {});

      expect(report.operatingCompanies[0].incompleteMonths).toBe(1);
      expect(monthlyUpserts()[0].reconciliationStatus).toBe(
        CustomerFinancialPeriodStatus.INCOMPLETE
      );
      const incompleteLookup = prismaTest.model("customerMonthlyFinancial").findMany.mock
        .calls[0][0] as { where: Record<string, unknown> };
      expect(incompleteLookup.where).toMatchObject({
        tenantId: "tenant-a",
        operatingCompanyId: "oc-ww",
        monthKey: monthDate(0).slice(0, 7)
      });
    }
  );

  it("marks an existing positive-AR row INCOMPLETE and preserves it when aging has no matched bucket", async () => {
    const currentMonth = monthDate(0).slice(0, 7);
    prismaTest.model("customerMonthlyFinancial").findMany.mockResolvedValue([
      {
        id: "monthly-existing-positive-ar",
        tenantId: "tenant-a",
        monthKey: currentMonth,
        companyId: "company-1",
        operatingCompanyId: "oc-ww",
        companyOperatingRelationshipId: "rel-1",
        sourceAccountId: "acc-1001",
        sourceAccountKey: "acc-1001",
        serviceLine: CustomerIntelligenceServiceLine.OTHER,
        currency: "CAD",
        nativeRevenue: 325,
        nativeCost: 0,
        nativeGrossProfit: 0,
        cadRevenue: 325,
        nativeOpenAr: 750,
        cadOpenAr: 750,
        reconciliationStatus: CustomerFinancialPeriodStatus.UNRECONCILED
      }
    ]);
    stubQuickBooksReportFetch(
      [],
      [agingRow({ "Customer ID": "9999", Name: "Unmatched synthetic account", Total: "50.00" })]
    );

    const report = await runFinancialMaterialization(ADMIN, {});

    expect(report.operatingCompanies[0]).toMatchObject({
      agingSkippedUnmatched: 1,
      monthlyRowsWritten: 1,
      relationshipsRefreshed: 1
    });
    expect(monthlyUpserts()[0]).toMatchObject({
      monthKey: currentMonth,
      operatingCompanyId: "oc-ww",
      nativeRevenue: 325,
      cadRevenue: 325,
      nativeOpenAr: 750,
      cadOpenAr: 750,
      reconciliationStatus: CustomerFinancialPeriodStatus.INCOMPLETE
    });
    const lookup = prismaTest.model("customerMonthlyFinancial").findMany.mock.calls[0][0] as {
      where: Record<string, unknown>;
    };
    expect(lookup.where).toMatchObject({
      tenantId: "tenant-a",
      operatingCompanyId: "oc-ww",
      monthKey: currentMonth
    });
    expect(lookup.where).not.toHaveProperty("nativeOpenAr");
  });

  it("merges preserved AR into colliding current revenue without replacing fresh financial evidence", async () => {
    const currentMonth = monthDate(0).slice(0, 7);
    prismaTest.model("customerMonthlyFinancial").findMany.mockResolvedValue([
      {
        id: "monthly-collision",
        tenantId: "tenant-a",
        monthKey: currentMonth,
        companyId: "company-1",
        operatingCompanyId: "oc-ww",
        companyOperatingRelationshipId: "rel-1",
        sourceAccountId: "acc-1001",
        sourceAccountKey: "acc-1001",
        serviceLine: CustomerIntelligenceServiceLine.OTHER,
        currency: "CAD",
        nativeRevenue: 325,
        nativeCost: 10,
        nativeGrossProfit: 315,
        cadRevenue: 325,
        nativeOpenAr: 750,
        cadOpenAr: 750,
        reconciliationStatus: CustomerFinancialPeriodStatus.UNRECONCILED
      }
    ]);
    stubQuickBooksReportFetch(
      [revenueRow({ "Txn ID": "fresh-current-revenue", Date: monthDate(0), Total: "100.00" })],
      [agingRow({ "Customer ID": "9999", Name: "Unmatched synthetic account", Total: "50.00" })]
    );

    await runFinancialMaterialization(ADMIN, {});

    const collision = monthlyUpserts().find(
      (row) => row.sourceAccountKey === "acc-1001" && row.currency === "CAD"
    );
    expect(collision).toMatchObject({
      nativeRevenue: 100,
      nativeCost: 0,
      nativeGrossProfit: 0,
      cadRevenue: 100,
      nativeOpenAr: 750,
      cadOpenAr: 750,
      reconciliationStatus: CustomerFinancialPeriodStatus.INCOMPLETE
    });
  });

  it("clears stale CAD AR when current foreign native AR changes without an approved FX rate", async () => {
    prismaTest.model("customerFxRate").findFirst.mockResolvedValue(null);
    const existingAr = {
      id: "monthly-stale-foreign-ar",
      tenantId: "tenant-a",
      monthKey: monthDate(0).slice(0, 7),
      companyId: "company-1",
      operatingCompanyId: "oc-ww",
      companyOperatingRelationshipId: "rel-1",
      sourceAccountId: "acc-1001",
      sourceAccountKey: "acc-1001",
      serviceLine: CustomerIntelligenceServiceLine.OTHER,
      currency: "USD",
      nativeRevenue: 0,
      nativeCost: 0,
      nativeGrossProfit: 0,
      cadRevenue: null,
      nativeOpenAr: 500,
      cadOpenAr: 675,
      reconciliationStatus: CustomerFinancialPeriodStatus.UNRECONCILED
    };
    prismaTest.model("customerMonthlyFinancial").findFirst.mockResolvedValue(existingAr);
    prismaTest.model("customerMonthlyFinancial").findMany.mockResolvedValue([existingAr]);
    stubQuickBooksReportFetch([], [agingRow({ Currency: "USD", Total: "900.00" })]);

    await runFinancialMaterialization(ADMIN, {});

    const upsert = prismaTest.model("customerMonthlyFinancial").upsert.mock.calls[0][0] as {
      update: Record<string, unknown>;
    };
    expect(upsert.update).toMatchObject({
      nativeOpenAr: 900,
      cadOpenAr: null,
      reconciliationStatus: CustomerFinancialPeriodStatus.INCOMPLETE
    });
  });
});

describe("partial and missing evidence never invents values", () => {
  beforeEach(() => {
    prismaTest.reset();
    configureAuth();
    setQuickBooksEnv();
    configureStandardData();
  });

  it("skips rows missing date, amount, or a stable resolvable customer", async () => {
    stubQuickBooksReportFetch(
      [
        revenueRow({ "Txn ID": "9001", Name: "Customer ABC", Total: "10.00" }),
        revenueRow({ "Txn ID": "9002", Date: "2026-06-15", Total: "not-a-number" }),
        revenueRow({ "Txn ID": "9003", Date: "2026-06-15", "Customer ID": "9999", Name: "Unknown Customer", Total: "10.00" }),
        revenueRow({ "Txn ID": "9004", Date: "2026-06-15", Name: "Customer ABC", Total: "50.00" })
      ],
      [agingRow({ Name: "Customer ABC" })]
    );

    const report = await runFinancialMaterialization(ADMIN, {});

    const section = report.operatingCompanies[0];
    expect(section.revenueSkippedMissingIdentity).toBe(0);
    expect(section.revenueSkippedMissingRequired).toBe(1);
    expect(section.revenueSkippedInvalidAmount).toBe(1);
    expect(section.revenueSkippedUnmatched).toBe(1);
    expect(section.agingSkippedMissingEvidence).toBe(1);
    expect(section.revenueMaterialized).toBe(1);
    expect(section.incompleteMonths).toBeGreaterThan(0);
    // Only the valid row is persisted; nothing is invented for the others.
    const created = revenueCreates();
    expect(created).toHaveLength(1);
    expect(created[0].transactionNumber).toBe("9004");
    expect(created[0].nativeAmount).toBe(50);
    const cadBucket = monthlyUpserts()[0];
    expect(cadBucket.reconciliationStatus).toBe(CustomerFinancialPeriodStatus.INCOMPLETE);
  });

  it("preserves existing revenue when partial FX evidence shares an aging bucket", async () => {
    prismaTest.model("customerMonthlyFinancial").findFirst.mockResolvedValue({
      sourceAccountId: "acc-1001",
      nativeRevenue: 1250,
      nativeCost: 100,
      nativeGrossProfit: 1150,
      cadRevenue: 1687.5,
      nativeOpenAr: 0,
      cadOpenAr: 0,
      reconciliationStatus: CustomerFinancialPeriodStatus.UNRECONCILED
    });
    prismaTest.model("customerFxRate").findFirst.mockResolvedValue(null);
    stubQuickBooksReportFetch(
      [
        revenueRow({
          "Txn ID": "usd-9001",
          Date: monthDate(0),
          Currency: "USD",
          "Foreign Amount": "1000.00",
          "Exchange Rate": "1.25",
          Total: "1250.00"
        })
      ],
      [agingRow({ Currency: "USD", Total: "500.00" })]
    );

    const report = await runFinancialMaterialization(ADMIN, {});

    expect(report.operatingCompanies[0].revenueSkippedMissingFx).toBe(1);
    const upsert = prismaTest.model("customerMonthlyFinancial").upsert.mock.calls[0]?.[0] as {
      update: Record<string, unknown>;
    };
    expect(upsert.update).toMatchObject({
      nativeRevenue: 1250,
      nativeCost: 100,
      nativeGrossProfit: 1150,
      cadRevenue: 1687.5,
      reconciliationStatus: CustomerFinancialPeriodStatus.INCOMPLETE
    });
  });
});

describe("dry-run writes nothing", () => {
  beforeEach(() => {
    prismaTest.reset();
    configureAuth();
    setQuickBooksEnv();
    configureStandardData();
  });

  it("computes the full would-be report with zero database writes and zero audits", async () => {
    stubQuickBooksReportFetch(
      [
        revenueRow({
          "Txn ID": "9001",
          Date: "2026-06-15",
          Name: "Customer ABC",
          Total: "1250.00"
        })
      ],
      [agingRow({ Name: "Customer ABC", Total: "750.00" })]
    );

    const report = await runFinancialMaterialization(ADMIN, { dryRun: true });

    expect(report.dryRun).toBe(true);
    const section = report.operatingCompanies[0];
    expect(section.status).toBe("ASSOCIATED");
    expect(section.revenueMaterialized).toBe(1);
    expect(section.agingMaterialized).toBe(1);
    expect(section.monthlyRowsWritten).toBe(3);
    expect(section.relationshipsRefreshed).toBe(1);
    expect(report.totals.monthlyRowsWritten).toBe(3);
    assertNoDatabaseWrites();
    expect(auditEntries()).toEqual([]);
  });

  it("reports an expired-token dry run as a limitation without refreshing", async () => {
    prismaTest.reset();
    configureAuth();
    prismaTest.model("operatingCompany").findMany.mockResolvedValue([OPERATING_COMPANY]);
    prismaTest.model("integrationCredential").findFirst.mockResolvedValue(
      quickBooksCredential({
        publicConfig: {
          realmId: "realm-1",
          legalEntity: "NEWL_WORLDWIDE",
          environment: "production",
          accessTokenExpiresAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
          refreshTokenExpiresAt: new Date(Date.now() - 60 * 60 * 1000).toISOString()
        }
      })
    );
    const fetchMock = stubQuickBooksReportFetch([], []);

    const report = await runFinancialMaterialization(ADMIN, { dryRun: true });

    expect(report.operatingCompanies[0].status).toBe("ERROR");
    expect(report.operatingCompanies[0].reason).toContain("dry-run");
    expect(fetchMock).not.toHaveBeenCalled();
    assertNoDatabaseWrites();
  });
});

describe("operating-company isolation", () => {
  beforeEach(() => {
    prismaTest.reset();
    configureAuth();
    setQuickBooksEnv();
  });

  it("never resolves or activates a relationship under another operating company", async () => {
    configureStandardData();
    stubQuickBooksReportFetch(
      [
        revenueRow({
          "Txn ID": "9001",
          Date: "2026-06-15",
          Name: "Customer ABC",
          Total: "1250.00"
        })
      ],
      []
    );

    const forWorldwide = await runFinancialMaterialization(ADMIN, {
      operatingCompanyId: "oc-ww"
    });
    expect(forWorldwide.operatingCompanies[0].revenueMaterialized).toBe(1);

    // The same revenue row cannot activate Newl USA: its source accounts are
    // invisible to the oc-usa run, so the row is skipped unmatched.
    prismaTest.reset();
    configureAuth();
    configureStandardData(OPERATING_COMPANY_USA);
    // The only known source account belongs to oc-ww, never oc-usa.
    prismaTest.model("customerSourceAccount").findMany.mockResolvedValue([]);
    stubQuickBooksReportFetch(
      [
        revenueRow({
          "Txn ID": "9001",
          Date: "2026-06-15",
          Name: "Customer ABC",
          Total: "1250.00"
        })
      ],
      []
    );

    const forUsa = await runFinancialMaterialization(ADMIN, { operatingCompanyId: "oc-usa" });
    const section = forUsa.operatingCompanies[0];
    expect(section.revenueSkippedUnmatched).toBe(1);
    expect(section.revenueMaterialized).toBe(0);
    expect(prismaTest.model("customerRevenueLine").create.mock.calls.length).toBe(0);
    expect(prismaTest.model("customerMonthlyFinancial").upsert.mock.calls.length).toBe(0);
    expect(prismaTest.model("companyOperatingRelationship").update.mock.calls.length).toBe(0);
  });
});

describe("audit contract", () => {
  beforeEach(() => {
    prismaTest.reset();
    configureAuth();
    setQuickBooksEnv();
    configureStandardData();
  });

  it("audits a successful run with counts only, never identifiers or secrets", async () => {
    stubQuickBooksReportFetch(
      [
        revenueRow({
          "Txn ID": "9001",
          Date: "2026-06-15",
          Name: "Customer ABC",
          Total: "1250.00"
        })
      ],
      [agingRow({ Name: "Customer ABC", Total: "750.00" })]
    );

    const report = await runFinancialMaterialization(ADMIN, {});
    const entries = auditEntries();
    const terminal = entries.find(
      (entry) => entry.action === "customer-intelligence.financial-materialization.run"
    );
    expect(terminal).toBeDefined();
    expect(terminal).toMatchObject({
      tenantId: "tenant-a",
      actorUserId: "user-1",
      entityType: "FinancialMaterialization",
      after: {
        dryRun: false,
        operatingCompanyCount: 1,
        operatingCompanyStatuses: {
          associated: 1,
          skippedUnassociated: 0,
          error: 0,
          limitation: 0
        },
        totals: report.totals
      }
    });
    const serialized = JSON.stringify(entries);
    expect(serialized).not.toContain("synthetic-access-token");
    expect(serialized).not.toContain("secretRef");
    expect(serialized).not.toContain("9001");
    expect(serialized).not.toContain("Customer ABC");
    expect(serialized).not.toContain("pnl-detail");
    expect(serialized).not.toContain("1250");
  });

  it("writes no audit when dry-run is true", async () => {
    stubQuickBooksReportFetch([], []);
    await runFinancialMaterialization(ADMIN, { dryRun: true });
    expect(auditEntries()).toEqual([]);
  });
});
