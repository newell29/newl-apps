import {
  CustomerFinancialPeriodStatus,
  CustomerIntelligenceServiceLine,
  ModuleKey,
  PlatformRole
} from "@prisma/client";
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

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

// Only Prisma, next/cache, next/navigation, next/link, the tenant-context
// session resolver, and the server auth action are mocked. The authorization
// module is REAL, so the leadership-only boundary runs against the mocked DB
// exactly like the other Customer Intelligence suites. Reporting is strictly
// read-only. The AppShell (client component) is rendered to static markup with
// its navigation hooks and server-action import stubbed.
vi.mock("@/server/db", () => ({
  prisma: prismaTest.proxy
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/server/tenant-context", () => ({
  getAuthenticatedContext: vi.fn()
}));
vi.mock("@/server/auth/actions", () => ({
  signOutAction: vi.fn()
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  // The Customer Intelligence group is active on the directory path, so its
  // children render in the shell (AppShell tests only).
  usePathname: () => "/customer-intelligence"
}));
vi.mock("next/link", async () => {
  const React = await import("react");
  function MockLink(props: Record<string, unknown>) {
    return React.createElement("a", props as never);
  }
  return { default: MockLink };
});

import { renderToStaticMarkup } from "react-dom/server";

import { AppShell } from "@/components/app-shell";
import CustomerIntelligenceReportingOperatingCompanyPage from "@/app/(authenticated)/customer-intelligence/reporting/operating-companies/[operatingCompanyId]/page";
import CustomerIntelligenceReportingPage from "@/app/(authenticated)/customer-intelligence/reporting/page";
import {
  getReportingOperatingCompanyDetail,
  getReportingSummary,
  listReportingOperatingCompanies,
  listReportingServiceLines,
  reportingCadFxLabel,
  reportingCadTotalFx,
  REPORTING_CAD_DISCLOSURE
} from "@/modules/customer-intelligence/reporting-queries";
import { currentMonthKey } from "@/modules/customer-intelligence/fx";
import { AuthorizationError } from "@/server/auth/authorization";
import * as tenantContext from "@/server/tenant-context";
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
const MANAGER = ctx(PlatformRole.MANAGER);
const SALES = ctx(PlatformRole.SALES);
const OPERATIONS = ctx(PlatformRole.OPERATIONS);
const FINANCE = ctx(PlatformRole.FINANCE);
const READ_ONLY = ctx(PlatformRole.READ_ONLY);

/** A pinned reference "now" so month classification is stable across runs. */
const NOW = new Date(Date.UTC(2026, 7, 15, 12, 0, 0));
const CURRENT_MONTH = currentMonthKey(NOW); // "2026-08" with the pinned reference
const CLOSED_MONTH = "2026-06";

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

/** Proves a reporting read never reached a database write. */
function assertNoDatabaseWrites() {
  const writes = prismaTest.modelCalls.filter((call) => WRITE_METHODS.has(call.method));
  expect(writes).toEqual([]);
}

const OPERATING_COMPANIES = [
  { id: "oc-ww", slug: "newl-worldwide", displayName: "Newl Worldwide", active: true },
  { id: "oc-usa", slug: "newl-usa", displayName: "Newl USA", active: true },
  { id: "oc-express", slug: "newells-express", displayName: "Newells Express", active: false }
];

function monthlyRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    monthKey: CURRENT_MONTH,
    operatingCompanyId: "oc-ww",
    serviceLine: CustomerIntelligenceServiceLine.OCEAN,
    reconciliationStatus: CustomerFinancialPeriodStatus.UNRECONCILED,
    currency: "CAD",
    nativeRevenue: 0,
    nativeCost: 0,
    nativeGrossProfit: 0,
    cadRevenue: 0,
    nativeOpenAr: 0,
    cadOpenAr: 0,
    ...overrides
  };
}

function revenueLineRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    sourceKey: "pnl-detail:realm-1:9001:1",
    transactionDate: new Date(Date.UTC(2026, 7, 3)),
    transactionType: "Invoice",
    transactionNumber: "9001",
    companyId: "company-1",
    serviceLine: CustomerIntelligenceServiceLine.OCEAN,
    nativeAmount: 500,
    nativeCurrency: "USD",
    cadAmount: 670.5,
    fxSource: "BANK_OF_CANADA_PROVISIONAL",
    company: { name: "Northstar Outdoor Supply" },
    ...overrides
  };
}

/**
 * The `<td>…</td>` cell containing the anchor text in rendered markup. Anchors
 * on the last occurrence so a table-cell value that also appears in an earlier
 * summary metric resolves to the cell, not the metric.
 */
function cellAround(html: string, anchor: string): string {
  const anchorIndex = html.lastIndexOf(anchor);
  expect(anchorIndex, `anchor "${anchor}" must appear in the rendered markup`).toBeGreaterThanOrEqual(
    0
  );
  const start = html.lastIndexOf("<td", anchorIndex);
  expect(start, `anchor "${anchor}" must sit inside a table cell`).toBeGreaterThanOrEqual(0);
  const end = html.indexOf("</td>", anchorIndex) + "</td>".length;
  return html.slice(start, end);
}

describe("reporting FX labels and disclosure", () => {
  it("never upgrades a stored closed-month conversion to FINAL from calendar position alone", () => {
    const current = reportingCadFxLabel(CURRENT_MONTH, NOW);
    expect(current.cadStatus).toBe("PROVISIONAL");
    expect(current.isCurrentMonth).toBe(true);
    expect(current.fxSource).toBe("BANK_OF_CANADA_PROVISIONAL");

    const closed = reportingCadFxLabel(CLOSED_MONTH, NOW);
    expect(closed.cadStatus).toBe("PROVISIONAL");
    expect(closed.isCurrentMonth).toBe(false);
    expect(closed.fxSource).toBe("MATERIALIZED_FX_STATUS_UNPROVEN");

    const future = reportingCadFxLabel("2026-09", NOW);
    expect(future.cadStatus).toBe("PROVISIONAL");
  });

  it("carries the directional management reporting disclosure", () => {
    expect(REPORTING_CAD_DISCLOSURE).toContain("Directional management reporting");
    expect(REPORTING_CAD_DISCLOSURE).toContain("not a statutory accounting entry");
  });

  it("keeps a provisionally materialized month PROVISIONAL after that month closes", () => {
    const materializedDuringAugust = reportingCadFxLabel(
      "2026-08",
      new Date(Date.UTC(2026, 7, 15))
    );
    const viewedBeforeFinalRematerialization = reportingCadFxLabel(
      "2026-08",
      new Date(Date.UTC(2026, 8, 2))
    );
    expect(materializedDuringAugust.cadStatus).toBe("PROVISIONAL");
    expect(viewedBeforeFinalRematerialization).toMatchObject({
      cadStatus: "PROVISIONAL",
      fxSource: "MATERIALIZED_FX_STATUS_UNPROVEN",
      isCurrentMonth: false
    });
  });
});

describe("reportingCadTotalFx: aggregate labels describe the evidence in each total", () => {
  it("keeps an all-closed stored total PROVISIONAL when final rematerialization is unproven", () => {
    const label = reportingCadTotalFx([CLOSED_MONTH, "2026-05"], NOW);
    expect(label).not.toBeNull();
    expect(label!.cadStatus).toBe("PROVISIONAL");
    expect(label!.finalMonthCount).toBe(0);
    expect(label!.provisionalMonthCount).toBe(2);
    expect(label!.fxSources).toEqual(["MATERIALIZED_FX_STATUS_UNPROVEN"]);
  });

  it("labels a current-month-only total PROVISIONAL", () => {
    const label = reportingCadTotalFx([CURRENT_MONTH], NOW);
    expect(label).not.toBeNull();
    expect(label!.cadStatus).toBe("PROVISIONAL");
    expect(label!.finalMonthCount).toBe(0);
    expect(label!.provisionalMonthCount).toBe(1);
    expect(label!.fxSources).toEqual(["BANK_OF_CANADA_PROVISIONAL"]);
  });

  it("does not claim MIXED when the closed period's final status is unproven", () => {
    const label = reportingCadTotalFx([CLOSED_MONTH, CURRENT_MONTH], NOW);
    expect(label!.cadStatus).toBe("PROVISIONAL");
    expect(label!.finalMonthCount).toBe(0);
    expect(label!.provisionalMonthCount).toBe(2);
    expect(label!.fxSources).toEqual(["BANK_OF_CANADA_PROVISIONAL", "MATERIALIZED_FX_STATUS_UNPROVEN"]);
  });

  it("returns null for an empty total (no materialized months)", () => {
    expect(reportingCadTotalFx([], NOW)).toBeNull();
    expect(reportingCadTotalFx(["2026-05", "2026-05"], NOW)?.provisionalMonthCount).toBe(1);
  });
});

describe("permissions: leadership-only reporting reads", () => {
  beforeEach(() => {
    prismaTest.reset();
    configureAuth();
  });

  it("denies SALES, OPERATIONS, and READ_ONLY on every reporting query", async () => {
    const reads: Array<[name: string, call: () => Promise<unknown>]> = [
      ["getReportingSummary", () => getReportingSummary(SALES)],
      [
        "listReportingOperatingCompanies",
        () => listReportingOperatingCompanies(SALES, { now: NOW })
      ],
      ["listReportingServiceLines", () => listReportingServiceLines(SALES, { now: NOW })],
      [
        "getReportingOperatingCompanyDetail",
        () => getReportingOperatingCompanyDetail(SALES, "oc-ww", { now: NOW })
      ]
    ];
    for (const [name, call] of reads) {
      await expect(call(), `${name} must enforce leadership access`).rejects.toBeInstanceOf(
        AuthorizationError
      );
    }
    for (const denied of [OPERATIONS, READ_ONLY]) {
      await expect(
        getReportingSummary(denied),
        `${denied.role} must be denied the reporting summary`
      ).rejects.toBeInstanceOf(AuthorizationError);
      await expect(
        listReportingOperatingCompanies(denied, { now: NOW }),
        `${denied.role} must be denied operating-company reporting`
      ).rejects.toBeInstanceOf(AuthorizationError);
    }
  });

  it("grants FINANCE and MANAGER read access", async () => {
    prismaTest.model("operatingCompany").findMany.mockResolvedValue([]);
    prismaTest.model("customerMonthlyFinancial").findMany.mockResolvedValue([]);
    await expect(getReportingSummary(FINANCE, { now: NOW })).resolves.toMatchObject({
      operatingCompanyCount: 0
    });
    await expect(listReportingOperatingCompanies(MANAGER, { now: NOW })).resolves.toEqual([]);
  });

  it("never writes: reporting is strictly read-only", async () => {
    prismaTest.model("operatingCompany").findMany.mockResolvedValue(OPERATING_COMPANIES);
    prismaTest.model("customerMonthlyFinancial").findMany.mockResolvedValue([]);
    await getReportingSummary(ADMIN, { now: NOW });
    await listReportingOperatingCompanies(ADMIN, { now: NOW });
    await listReportingServiceLines(ADMIN, { now: NOW });
    await getReportingOperatingCompanyDetail(ADMIN, "oc-ww", { now: NOW });
    assertNoDatabaseWrites();
  });

  it("scopes every reporting read to the authenticated tenant", async () => {
    prismaTest.model("operatingCompany").findMany.mockResolvedValue([]);
    prismaTest.model("customerMonthlyFinancial").findMany.mockResolvedValue([]);
    prismaTest.model("operatingCompany").findFirst.mockResolvedValue({
      id: "oc-ww",
      slug: "newl-worldwide",
      displayName: "Newl Worldwide",
      homeCurrency: "CAD",
      active: true
    });
    prismaTest.model("customerRevenueLine").findMany.mockResolvedValue([]);
    prismaTest.model("customerRevenueLine").count.mockResolvedValue(0);
    await getReportingSummary(ADMIN, { now: NOW });
    await listReportingOperatingCompanies(ADMIN, { now: NOW });
    await listReportingServiceLines(ADMIN, { now: NOW });
    await getReportingOperatingCompanyDetail(ADMIN, "oc-ww", { now: NOW });

    const monthlyWheres = prismaTest.model("customerMonthlyFinancial").findMany.mock.calls.map(
      (call) => (call[0] as { where: Record<string, unknown> }).where
    );
    expect(monthlyWheres.length).toBeGreaterThanOrEqual(3);
    for (const where of monthlyWheres) {
      expect(where.tenantId).toBe("tenant-a");
    }
    const companyWheres = prismaTest.model("operatingCompany").findMany.mock.calls.map(
      (call) => (call[0] as { where: Record<string, unknown> }).where
    );
    for (const where of companyWheres) {
      expect(where.tenantId).toBe("tenant-a");
    }
    const revenueLineWheres = prismaTest.model("customerRevenueLine").findMany.mock.calls.map(
      (call) => (call[0] as { where: Record<string, unknown> }).where
    );
    expect(revenueLineWheres[0].tenantId).toBe("tenant-a");
    expect(revenueLineWheres[0].operatingCompanyId).toBe("oc-ww");
    // The revenue-line evidence count (pagination total) is scoped the same way.
    const revenueLineCountWheres = prismaTest.model("customerRevenueLine").count.mock.calls.map(
      (call) => (call[0] as { where: Record<string, unknown> }).where
    );
    expect(revenueLineCountWheres[0].tenantId).toBe("tenant-a");
    expect(revenueLineCountWheres[0].operatingCompanyId).toBe("oc-ww");
  });
});

describe("listReportingOperatingCompanies: per-operating-company consolidation", () => {
  beforeEach(() => {
    prismaTest.reset();
    configureAuth();
  });

  it("excludes an entire mixed-status month and never adds monthly AR snapshots", async () => {
    prismaTest.model("operatingCompany").findMany.mockResolvedValue(OPERATING_COMPANIES);
    prismaTest.model("customerMonthlyFinancial").findMany.mockResolvedValue([
      monthlyRow({
        monthKey: CURRENT_MONTH,
        serviceLine: CustomerIntelligenceServiceLine.OCEAN,
        currency: "CAD",
        nativeRevenue: 1000,
        cadRevenue: 1000
      }),
      monthlyRow({
        monthKey: CLOSED_MONTH,
        serviceLine: CustomerIntelligenceServiceLine.OCEAN,
        currency: "CAD",
        nativeRevenue: 2000,
        cadRevenue: 2000
      }),
      monthlyRow({
        monthKey: CLOSED_MONTH,
        serviceLine: CustomerIntelligenceServiceLine.OCEAN,
        currency: "USD",
        nativeRevenue: 500,
        cadRevenue: 670.5,
        nativeOpenAr: 100,
        cadOpenAr: 134.1
      }),
      // An INCOMPLETE row must be counted but never folded into the totals.
      monthlyRow({
        monthKey: CLOSED_MONTH,
        serviceLine: CustomerIntelligenceServiceLine.AIR,
        currency: "CAD",
        nativeRevenue: 300,
        cadRevenue: 300,
        reconciliationStatus: CustomerFinancialPeriodStatus.INCOMPLETE
      })
    ]);

    const rows = await listReportingOperatingCompanies(ADMIN, { now: NOW });
    expect(rows).toHaveLength(3);

    const worldwide = rows.find((row) => row.operatingCompanyId === "oc-ww")!;
    expect(worldwide.monthlyRowCount).toBe(4);
    expect(worldwide.materializedMonthCount).toBe(1);
    expect(worldwide.incompleteMonthCount).toBe(1);
    expect(worldwide.incompleteRowCount).toBe(1);
    // One INCOMPLETE AIR row invalidates every row in the closed month, including
    // otherwise non-INCOMPLETE OCEAN rows. No partial period enters headlines.
    expect(worldwide.nativeByCurrency).toEqual([
      {
        currency: "CAD",
        nativeRevenue: 1000,
        nativeCost: 0,
        nativeGrossProfit: 0,
        nativeOpenAr: 0
      }
    ]);
    expect(worldwide.cadRevenue).toBe(1000);
    expect(worldwide.cadRevenuePartial).toBe(false);
    expect(worldwide.cadValuesPartial).toBe(false);
    // AR is only the complete live snapshot for the current month, never
    // the closed-month balance added to it.
    expect(worldwide.cadOpenAr).toBe(0);
    expect(worldwide.cadOpenArPartial).toBe(false);
    expect(worldwide.openArMonthKey).toBe(CURRENT_MONTH);
    expect(worldwide.openArAvailable).toBe(true);
    // The newest materialized month is the current (PROVISIONAL) month.
    expect(worldwide.latestMonthKey).toBe(CURRENT_MONTH);
    expect(worldwide.latestCadFx?.cadStatus).toBe("PROVISIONAL");
    expect(worldwide.totalCadFx?.cadStatus).toBe("PROVISIONAL");
    expect(worldwide.totalCadFx?.finalMonthCount).toBe(0);
    expect(worldwide.totalCadFx?.provisionalMonthCount).toBe(1);

    // An operating company with only INCOMPLETE evidence has zero totals.
    const express = rows.find((row) => row.operatingCompanyId === "oc-express")!;
    expect(express.active).toBe(false);
    expect(express.materializedMonthCount).toBe(0);
    expect(express.nativeByCurrency).toEqual([]);
    expect(express.cadRevenue).toBeNull();
    expect(express.totalCadFx).toBeNull();

    const usa = rows.find((row) => row.operatingCompanyId === "oc-usa")!;
    expect(usa.monthlyRowCount).toBe(0);
    expect(usa.latestCadFx).toBeNull();
    expect(usa.totalCadFx).toBeNull();
  });

  it("filters to a single month key when requested", async () => {
    prismaTest.model("operatingCompany").findMany.mockResolvedValue(OPERATING_COMPANIES);
    prismaTest.model("customerMonthlyFinancial").findMany.mockResolvedValue([]);

    await listReportingOperatingCompanies(ADMIN, { monthKey: CLOSED_MONTH, now: NOW });
    const where = prismaTest.model("customerMonthlyFinancial").findMany.mock.calls[0][0] as {
      where: Record<string, unknown>;
    };
    expect(where.where.tenantId).toBe("tenant-a");
    expect(where.where.monthKey).toBe(CLOSED_MONTH);
  });

  it("never mixes native currencies: native figures stay per currency with correct totals", async () => {
    prismaTest.model("operatingCompany").findMany.mockResolvedValue(OPERATING_COMPANIES);
    prismaTest.model("customerMonthlyFinancial").findMany.mockResolvedValue([
      monthlyRow({
        monthKey: CURRENT_MONTH,
        serviceLine: CustomerIntelligenceServiceLine.OCEAN,
        currency: "CAD",
        nativeRevenue: 2000,
        nativeCost: 500,
        nativeGrossProfit: 1500,
        cadRevenue: 2000,
        nativeOpenAr: 250,
        cadOpenAr: 250
      }),
      monthlyRow({
        monthKey: CURRENT_MONTH,
        serviceLine: CustomerIntelligenceServiceLine.OCEAN,
        currency: "USD",
        nativeRevenue: 500,
        nativeCost: 0,
        nativeGrossProfit: 500,
        cadRevenue: 670.5,
        nativeOpenAr: 100,
        cadOpenAr: 134.1
      })
    ]);

    const rows = await listReportingOperatingCompanies(ADMIN, { now: NOW });
    const worldwide = rows.find((row) => row.operatingCompanyId === "oc-ww")!;
    // CAD 2000 + USD 500 are never summed into a single "native revenue"
    // number; each currency keeps its own revenue/cost/gross-profit/AR.
    expect(worldwide.nativeByCurrency).toEqual([
      {
        currency: "CAD",
        nativeRevenue: 2000,
        nativeCost: 500,
        nativeGrossProfit: 1500,
        nativeOpenAr: 250
      },
      {
        currency: "USD",
        nativeRevenue: 500,
        nativeCost: 0,
        nativeGrossProfit: 500,
        nativeOpenAr: 100
      }
    ]);
    // The CAD consolidation basis is the only cross-currency total and still
    // sums the converted figures.
    expect(worldwide.cadRevenue).toBe(2670.5);
    expect(worldwide.cadOpenAr).toBe(384.1);
  });

  it("makes historical Open AR unavailable when the current-month snapshot is absent", async () => {
    prismaTest.model("operatingCompany").findMany.mockResolvedValue(OPERATING_COMPANIES);
    prismaTest.model("customerMonthlyFinancial").findMany.mockResolvedValue([
      monthlyRow({ monthKey: "2026-05", nativeOpenAr: 900, cadOpenAr: 900 }),
      monthlyRow({ monthKey: CLOSED_MONTH, nativeOpenAr: 125, cadOpenAr: 125 })
    ]);

    const rows = await listReportingOperatingCompanies(ADMIN, { now: NOW });
    const worldwide = rows.find((row) => row.operatingCompanyId === "oc-ww")!;
    expect(worldwide.nativeByCurrency[0].nativeOpenAr).toBe(0);
    expect(worldwide.cadOpenAr).toBeNull();
    expect(worldwide.openArAvailable).toBe(false);
    expect(worldwide.openArMonthKey).toBeNull();
    expect(worldwide.openArCadFx).toBeNull();
  });

  it("fails closed when the latest Open AR snapshot is incomplete", async () => {
    prismaTest.model("operatingCompany").findMany.mockResolvedValue(OPERATING_COMPANIES);
    prismaTest.model("customerMonthlyFinancial").findMany.mockResolvedValue([
      monthlyRow({ monthKey: CLOSED_MONTH, nativeOpenAr: 125, cadOpenAr: 125 }),
      monthlyRow({
        monthKey: CURRENT_MONTH,
        nativeOpenAr: 500,
        cadOpenAr: 500,
        reconciliationStatus: CustomerFinancialPeriodStatus.INCOMPLETE
      })
    ]);

    const rows = await listReportingOperatingCompanies(ADMIN, { now: NOW });
    const worldwide = rows.find((row) => row.operatingCompanyId === "oc-ww")!;
    expect(worldwide.openArAvailable).toBe(false);
    expect(worldwide.openArMonthKey).toBeNull();
    expect(worldwide.cadOpenAr).toBeNull();
    expect(worldwide.nativeByCurrency[0].nativeOpenAr).toBe(0);
  });

  it("ignores an older missing AR conversion when the current snapshot is complete", async () => {
    prismaTest.model("operatingCompany").findMany.mockResolvedValue(OPERATING_COMPANIES);
    prismaTest.model("customerMonthlyFinancial").findMany.mockResolvedValue([
      monthlyRow({
        monthKey: CURRENT_MONTH,
        serviceLine: CustomerIntelligenceServiceLine.OCEAN,
        currency: "USD",
        nativeRevenue: 500,
        cadRevenue: 670.5,
        nativeOpenAr: 100,
        cadOpenAr: 134.1
      }),
      monthlyRow({
        monthKey: "2026-05",
        serviceLine: CustomerIntelligenceServiceLine.OCEAN,
        currency: "CAD",
        nativeRevenue: 2000,
        cadRevenue: 2000,
        nativeOpenAr: 250,
        cadOpenAr: null
      })
    ]);

    const rows = await listReportingOperatingCompanies(ADMIN, { now: NOW });
    const worldwide = rows.find((row) => row.operatingCompanyId === "oc-ww")!;
    // Only the current-month snapshot contributes. The older null does not make
    // the current live AR snapshot partial.
    expect(worldwide.cadOpenAr).toBe(134.1);
    expect(worldwide.cadOpenArPartial).toBe(false);
    expect(worldwide.cadRevenuePartial).toBe(false);
    // The consolidation-level flag covers both revenue and AR conversion gaps.
    expect(worldwide.cadValuesPartial).toBe(false);
  });

  it("keeps CAD revenue and CAD AR null with partial flags when all conversions are missing", async () => {
    prismaTest.model("operatingCompany").findMany.mockResolvedValue(OPERATING_COMPANIES);
    prismaTest.model("customerMonthlyFinancial").findMany.mockResolvedValue([
      monthlyRow({
        monthKey: CURRENT_MONTH,
        serviceLine: CustomerIntelligenceServiceLine.OCEAN,
        currency: "USD",
        nativeRevenue: 500,
        cadRevenue: null,
        nativeOpenAr: 100,
        cadOpenAr: null
      })
    ]);

    const rows = await listReportingOperatingCompanies(ADMIN, { now: NOW });
    const worldwide = rows.find((row) => row.operatingCompanyId === "oc-ww")!;
    // Nothing is invented for missing conversions: CAD values stay null and
    // both partial flags report the gap.
    expect(worldwide.cadRevenue).toBeNull();
    expect(worldwide.cadRevenuePartial).toBe(true);
    expect(worldwide.cadOpenAr).toBeNull();
    expect(worldwide.cadOpenArPartial).toBe(true);
    expect(worldwide.cadValuesPartial).toBe(true);
    expect(worldwide.totalCadFx?.cadStatus).toBe("PROVISIONAL");
  });
});

describe("listReportingServiceLines: per-service-line consolidation", () => {
  beforeEach(() => {
    prismaTest.reset();
    configureAuth();
  });

  it("always returns all seven service lines with materialized totals", async () => {
    prismaTest.model("customerMonthlyFinancial").findMany.mockResolvedValue([
      monthlyRow({
        monthKey: CLOSED_MONTH,
        serviceLine: CustomerIntelligenceServiceLine.OCEAN,
        currency: "CAD",
        nativeRevenue: 2000,
        cadRevenue: 2000
      }),
      monthlyRow({
        monthKey: CLOSED_MONTH,
        serviceLine: CustomerIntelligenceServiceLine.OCEAN,
        currency: "USD",
        nativeRevenue: 500,
        cadRevenue: 670.5
      }),
      monthlyRow({
        monthKey: CLOSED_MONTH,
        serviceLine: CustomerIntelligenceServiceLine.AIR,
        currency: "CAD",
        nativeRevenue: 300,
        cadRevenue: 300,
        reconciliationStatus: CustomerFinancialPeriodStatus.INCOMPLETE
      })
    ]);

    const rows = await listReportingServiceLines(ADMIN, { now: NOW });
    expect(rows).toHaveLength(Object.values(CustomerIntelligenceServiceLine).length);

    const ocean = rows.find((row) => row.serviceLine === CustomerIntelligenceServiceLine.OCEAN)!;
    // Native revenue is grouped per currency: CAD 2000 + USD 500 are never mixed.
    // The incomplete AIR row invalidates this month for every service line.
    expect(ocean.nativeByCurrency).toEqual([]);
    expect(ocean.cadRevenue).toBeNull();
    expect(ocean.cadRevenuePartial).toBe(false);
    expect(ocean.materializedMonthCount).toBe(0);
    expect(ocean.operatingCompanyId).toBeNull();
    // Closed calendar position alone cannot prove final rematerialization.
    expect(ocean.totalCadFx).toBeNull();

    const air = rows.find((row) => row.serviceLine === CustomerIntelligenceServiceLine.AIR)!;
    expect(air.materializedMonthCount).toBe(0);
    expect(air.incompleteMonthCount).toBe(1);
    expect(air.nativeByCurrency).toEqual([]);
    expect(air.totalCadFx).toBeNull();

    const customs = rows.find(
      (row) => row.serviceLine === CustomerIntelligenceServiceLine.CUSTOMS_BROKERAGE
    )!;
    expect(customs.monthlyRowCount).toBe(0);
    expect(customs.latestCadFx).toBeNull();
  });

  it("scopes the service-line read to a tenant operating company", async () => {
    prismaTest.model("customerMonthlyFinancial").findMany.mockResolvedValue([]);

    await listReportingServiceLines(ADMIN, { operatingCompanyId: "oc-usa", now: NOW });
    const where = prismaTest.model("customerMonthlyFinancial").findMany.mock.calls[0][0] as {
      where: Record<string, unknown>;
    };
    expect(where.where.tenantId).toBe("tenant-a");
    expect(where.where.operatingCompanyId).toBe("oc-usa");

    // A foreign operating company never leaks: the same tenant filter applies
    // and simply yields no rows.
    await listReportingServiceLines(ADMIN, { operatingCompanyId: "oc-foreign", now: NOW });
    const foreignWhere = prismaTest.model("customerMonthlyFinancial").findMany.mock.calls[1][0] as {
      where: Record<string, unknown>;
    };
    expect(foreignWhere.where.tenantId).toBe("tenant-a");
    expect(foreignWhere.where.operatingCompanyId).toBe("oc-foreign");
  });

  it("does not attribute a complete OTHER Open AR snapshot to an OCEAN revenue line", async () => {
    prismaTest.model("customerMonthlyFinancial").findMany.mockResolvedValue([
      monthlyRow({
        monthKey: CURRENT_MONTH,
        serviceLine: CustomerIntelligenceServiceLine.OCEAN,
        currency: "USD",
        nativeRevenue: 500,
        cadRevenue: 670.5
      }),
      monthlyRow({
        monthKey: CURRENT_MONTH,
        serviceLine: CustomerIntelligenceServiceLine.OTHER,
        currency: "CAD",
        nativeRevenue: 0,
        cadRevenue: 0,
        nativeOpenAr: 250,
        cadOpenAr: 250
      })
    ]);

    const rows = await listReportingServiceLines(ADMIN, { now: NOW });
    const ocean = rows.find((row) => row.serviceLine === CustomerIntelligenceServiceLine.OCEAN)!;
    expect(ocean.cadRevenue).toBe(670.5);
    expect(ocean.nativeByCurrency[0]).not.toHaveProperty("nativeOpenAr");
    expect(ocean).not.toHaveProperty("cadOpenAr");
    expect(ocean).not.toHaveProperty("openArAvailable");
    expect(ocean.totalCadFx?.cadStatus).toBe("PROVISIONAL");
  });

  it("excludes completeness per operating-company/month without invalidating another company", async () => {
    prismaTest.model("customerMonthlyFinancial").findMany.mockResolvedValue([
      monthlyRow({
        operatingCompanyId: "oc-ww",
        monthKey: CLOSED_MONTH,
        serviceLine: CustomerIntelligenceServiceLine.OCEAN,
        nativeRevenue: 900,
        nativeCost: 300,
        nativeGrossProfit: 600,
        cadRevenue: 900
      }),
      monthlyRow({
        operatingCompanyId: "oc-ww",
        monthKey: CLOSED_MONTH,
        serviceLine: CustomerIntelligenceServiceLine.AIR,
        reconciliationStatus: CustomerFinancialPeriodStatus.INCOMPLETE
      }),
      monthlyRow({
        operatingCompanyId: "oc-usa",
        monthKey: CLOSED_MONTH,
        serviceLine: CustomerIntelligenceServiceLine.OCEAN,
        nativeRevenue: 400,
        nativeCost: 100,
        nativeGrossProfit: 300,
        cadRevenue: 400
      })
    ]);

    const rows = await listReportingServiceLines(ADMIN, { now: NOW });
    const ocean = rows.find((row) => row.serviceLine === CustomerIntelligenceServiceLine.OCEAN)!;
    expect(ocean.nativeByCurrency).toEqual([
      {
        currency: "CAD",
        nativeRevenue: 400,
        nativeCost: 100,
        nativeGrossProfit: 300
      }
    ]);
    expect(ocean.cadRevenue).toBe(400);
    expect(ocean.materializedMonthCount).toBe(1);
    expect(ocean.incompleteMonthCount).toBe(1);
  });
});

describe("getReportingOperatingCompanyDetail: one operating company's reporting", () => {
  beforeEach(() => {
    prismaTest.reset();
    configureAuth();
  });

  it("returns null for unknown or cross-tenant operating-company identifiers", async () => {
    prismaTest.model("operatingCompany").findFirst.mockResolvedValue(null);
    const detail = await getReportingOperatingCompanyDetail(ADMIN, "oc-foreign", { now: NOW });
    expect(detail).toBeNull();

    const where = prismaTest.model("operatingCompany").findFirst.mock.calls[0][0] as {
      where: Record<string, unknown>;
    };
    expect(where.where.tenantId).toBe("tenant-a");
    expect(where.where.id).toBe("oc-foreign");
  });

  it("assembles monthly rows with conservative PROVISIONAL labels and revenue-line evidence", async () => {
    prismaTest.model("operatingCompany").findFirst.mockResolvedValue({
      id: "oc-ww",
      slug: "newl-worldwide",
      displayName: "Newl Worldwide",
      homeCurrency: "CAD",
      active: true
    });
    prismaTest.model("customerMonthlyFinancial").findMany.mockResolvedValue([
      {
        id: "mf-1",
        monthKey: CURRENT_MONTH,
        companyId: "company-1",
        companyOperatingRelationshipId: "rel-1",
        sourceAccountKey: "acc-1",
        serviceLine: CustomerIntelligenceServiceLine.OCEAN,
        currency: "USD",
        nativeRevenue: 500,
        nativeCost: 0,
        nativeGrossProfit: 500,
        cadRevenue: 670.5,
        nativeOpenAr: 100,
        cadOpenAr: 134.1,
        reconciliationStatus: CustomerFinancialPeriodStatus.UNRECONCILED,
        company: { name: "Northstar Outdoor Supply" }
      },
      {
        id: "mf-2",
        monthKey: CLOSED_MONTH,
        companyId: "company-2",
        companyOperatingRelationshipId: "rel-2",
        sourceAccountKey: "ALL",
        serviceLine: CustomerIntelligenceServiceLine.AIR,
        currency: "CAD",
        nativeRevenue: 300,
        nativeCost: 0,
        nativeGrossProfit: 300,
        cadRevenue: 300,
        nativeOpenAr: 0,
        cadOpenAr: 0,
        reconciliationStatus: CustomerFinancialPeriodStatus.INCOMPLETE,
        company: { name: "Summit Parts Depot" }
      }
    ]);
    prismaTest.model("customerRevenueLine").findMany.mockResolvedValue([
      {
        sourceKey: "pnl-detail:realm-1:9001:1",
        transactionDate: new Date(Date.UTC(2026, 7, 3)),
        transactionType: "Invoice",
        transactionNumber: "9001",
        companyId: "company-1",
        serviceLine: CustomerIntelligenceServiceLine.OCEAN,
        nativeAmount: 500,
        nativeCurrency: "USD",
        cadAmount: 670.5,
        fxSource: "BANK_OF_CANADA_PROVISIONAL",
        company: { name: "Northstar Outdoor Supply" }
      }
    ]);
    prismaTest.model("customerRevenueLine").count.mockResolvedValue(1);

    const detail = await getReportingOperatingCompanyDetail(ADMIN, "oc-ww", { now: NOW });
    expect(detail).not.toBeNull();
    expect(detail!.disclosure).toContain("Directional management reporting");
    expect(detail!.operatingCompany.displayName).toBe("Newl Worldwide");

    expect(detail!.monthlyRows).toHaveLength(2);
    const currentRow = detail!.monthlyRows[0];
    expect(currentRow.companyName).toBe("Northstar Outdoor Supply");
    expect(currentRow.cadFx.cadStatus).toBe("PROVISIONAL");
    expect(currentRow.cadFx.isCurrentMonth).toBe(true);
    expect(currentRow.cadRevenue).toBe(670.5);
    const closedRow = detail!.monthlyRows[1];
    expect(closedRow.cadFx.cadStatus).toBe("PROVISIONAL");
    expect(closedRow.reconciliationStatus).toBe(CustomerFinancialPeriodStatus.INCOMPLETE);

    expect(detail!.revenueLines).toHaveLength(1);
    expect(detail!.revenueLines[0].monthKey).toBe(CURRENT_MONTH);
    expect(detail!.revenueLines[0].fxSource).toBe("BANK_OF_CANADA_PROVISIONAL");
    expect(detail!.revenueLines[0].companyName).toBe("Northstar Outdoor Supply");
    expect(detail!.revenueLines[0].nativeAmount).toBe(500);
    expect(detail!.revenueLines[0].nativeCurrency).toBe("USD");

    // A single-page evidence set is not truncated: the page metadata exposes the
    // complete tenant-scoped record.
    expect(detail!.revenueLinePage).toEqual({
      page: 1,
      pageSize: 500,
      totalCount: 1,
      totalPages: 1,
      hasPrevious: false,
      hasMore: false
    });

    // INCOMPLETE evidence is counted but excluded from materialized totals.
    expect(detail!.summary.monthlyRowCount).toBe(2);
    expect(detail!.summary.materializedMonthCount).toBe(1);
    expect(detail!.summary.incompleteMonthCount).toBe(1);
    expect(detail!.summary.nativeByCurrency).toEqual([
      {
        currency: "USD",
        nativeRevenue: 500,
        nativeCost: 0,
        nativeGrossProfit: 500,
        nativeOpenAr: 100
      }
    ]);
    expect(detail!.summary.cadRevenue).toBe(670.5);
    expect(detail!.summary.cadRevenuePartial).toBe(false);
    expect(detail!.summary.cadOpenAr).toBe(134.1);
    expect(detail!.summary.cadOpenArPartial).toBe(false);
    expect(detail!.summary.totalCadFx?.cadStatus).toBe("PROVISIONAL");
    expect(detail!.summary.revenueLineCount).toBe(1);
  });

  it("does not expose historical Open AR as live detail when the current snapshot is absent", async () => {
    prismaTest.model("operatingCompany").findFirst.mockResolvedValue({
      id: "oc-ww",
      slug: "newl-worldwide",
      displayName: "Newl Worldwide",
      homeCurrency: "CAD",
      active: true
    });
    prismaTest.model("customerMonthlyFinancial").findMany.mockResolvedValue([
      {
        id: "mf-historical",
        monthKey: CLOSED_MONTH,
        operatingCompanyId: "oc-ww",
        companyId: "company-1",
        companyOperatingRelationshipId: "rel-1",
        sourceAccountKey: "acc-1",
        serviceLine: CustomerIntelligenceServiceLine.OTHER,
        currency: "CAD",
        nativeRevenue: 0,
        nativeCost: 0,
        nativeGrossProfit: 0,
        cadRevenue: 0,
        nativeOpenAr: 125,
        cadOpenAr: 125,
        reconciliationStatus: CustomerFinancialPeriodStatus.UNRECONCILED,
        company: { name: "Northstar Outdoor Supply" }
      }
    ]);
    prismaTest.model("customerRevenueLine").findMany.mockResolvedValue([]);
    prismaTest.model("customerRevenueLine").count.mockResolvedValue(0);

    const detail = await getReportingOperatingCompanyDetail(ADMIN, "oc-ww", { now: NOW });
    expect(detail!.monthlyRows[0].nativeOpenAr).toBeNull();
    expect(detail!.monthlyRows[0].cadOpenAr).toBeNull();
    expect(detail!.monthlyRows[0].openArAvailable).toBe(false);
    expect(detail!.summary.openArAvailable).toBe(false);
    expect(detail!.summary.openArMonthKey).toBeNull();
    expect(detail!.summary.cadOpenAr).toBeNull();
    expect(detail!.summary.nativeByCurrency[0].nativeOpenAr).toBe(0);
  });

  it("pages revenue-line evidence deterministically and never hides truncation", async () => {
    prismaTest.model("operatingCompany").findFirst.mockResolvedValue({
      id: "oc-ww",
      slug: "newl-worldwide",
      displayName: "Newl Worldwide",
      homeCurrency: "CAD",
      active: true
    });
    prismaTest.model("customerMonthlyFinancial").findMany.mockResolvedValue([]);
    prismaTest.model("customerRevenueLine").count.mockResolvedValue(501);
    prismaTest.model("customerRevenueLine").findMany.mockResolvedValue(
      Array.from({ length: 500 }, (_, index) =>
        revenueLineRow({
          sourceKey: `pnl-detail:realm-1:line-${index}:1`,
          transactionDate: new Date(Date.UTC(2026, 7, 1 + (index % 20)))
        })
      )
    );

    const detail = await getReportingOperatingCompanyDetail(ADMIN, "oc-ww", { now: NOW });
    expect(detail!.revenueLines).toHaveLength(500);
    // The 501-row record exceeds the 500-row page: the page metadata exposes the
    // truncation and the summary count is the complete record, not the page.
    expect(detail!.revenueLinePage).toEqual({
      page: 1,
      pageSize: 500,
      totalCount: 501,
      totalPages: 2,
      hasPrevious: false,
      hasMore: true
    });
    expect(detail!.summary.revenueLineCount).toBe(501);

    const findManyArgs = prismaTest.model("customerRevenueLine").findMany.mock.calls[0][0] as {
      orderBy: unknown[];
      skip: number;
      take: number;
    };
    expect(findManyArgs.skip).toBe(0);
    expect(findManyArgs.take).toBe(500);
    // Deterministic ordering: newest-first by transaction date with the unique
    // id breaking ties, so pages never shift or duplicate across requests.
    expect(findManyArgs.orderBy).toEqual([{ transactionDate: "desc" }, { id: "desc" }]);
  });

  it("serves subsequent revenue-line evidence pages deterministically", async () => {
    prismaTest.model("operatingCompany").findFirst.mockResolvedValue({
      id: "oc-ww",
      slug: "newl-worldwide",
      displayName: "Newl Worldwide",
      homeCurrency: "CAD",
      active: true
    });
    prismaTest.model("customerMonthlyFinancial").findMany.mockResolvedValue([]);
    prismaTest.model("customerRevenueLine").count.mockResolvedValue(750);
    prismaTest.model("customerRevenueLine").findMany.mockResolvedValue([revenueLineRow()]);

    const detail = await getReportingOperatingCompanyDetail(ADMIN, "oc-ww", {
      revenueLinePage: 2,
      now: NOW
    });
    expect(detail!.revenueLinePage).toEqual({
      page: 2,
      pageSize: 500,
      totalCount: 750,
      totalPages: 2,
      hasPrevious: true,
      hasMore: false
    });
    const findManyArgs = prismaTest.model("customerRevenueLine").findMany.mock.calls[0][0] as {
      skip: number;
      take: number;
    };
    expect(findManyArgs.skip).toBe(500);
    expect(findManyArgs.take).toBe(500);
  });
});

describe("getReportingSummary: tenant-wide reporting metrics", () => {
  beforeEach(() => {
    prismaTest.reset();
    configureAuth();
  });

  it("computes materialized metrics and carries the current PROVISIONAL label", async () => {
    prismaTest.model("operatingCompany").findMany.mockResolvedValue([{ id: "oc-ww" }]);
    prismaTest.model("customerMonthlyFinancial").findMany.mockResolvedValue([
      monthlyRow({
        monthKey: CURRENT_MONTH,
        nativeRevenue: 1000,
        cadRevenue: 1000
      }),
      monthlyRow({
        monthKey: CLOSED_MONTH,
        nativeRevenue: 2000,
        cadRevenue: 2000
      }),
      monthlyRow({
        monthKey: CLOSED_MONTH,
        nativeRevenue: 300,
        cadRevenue: 300,
        reconciliationStatus: CustomerFinancialPeriodStatus.INCOMPLETE
      })
    ]);

    const summary = await getReportingSummary(ADMIN, { now: NOW });
    expect(summary.operatingCompanyCount).toBe(1);
    expect(summary.companiesWithFinancials).toBe(1);
    expect(summary.monthlyRowCount).toBe(3);
    expect(summary.materializedMonthCount).toBe(1);
    expect(summary.incompleteMonthCount).toBe(1);
    expect(summary.incompleteRowCount).toBe(1);
    expect(summary.nativeByCurrency).toEqual([
      {
        currency: "CAD",
        nativeRevenue: 1000,
        nativeCost: 0,
        nativeGrossProfit: 0,
        nativeOpenAr: 0
      }
    ]);
    expect(summary.cadRevenue).toBe(1000);
    expect(summary.currentMonthKey).toBe(CURRENT_MONTH);
    expect(summary.currentMonthCadFx.cadStatus).toBe("PROVISIONAL");
    // The mixed-status closed month is wholly excluded; only current remains.
    expect(summary.totalCadFx?.cadStatus).toBe("PROVISIONAL");
  });

  it("keeps CAD totals null when no materialized evidence exists", async () => {
    prismaTest.model("operatingCompany").findMany.mockResolvedValue([{ id: "oc-ww" }]);
    prismaTest.model("customerMonthlyFinancial").findMany.mockResolvedValue([]);

    const summary = await getReportingSummary(ADMIN, { now: NOW });
    expect(summary.materializedMonthCount).toBe(0);
    expect(summary.cadRevenue).toBeNull();
    expect(summary.nativeByCurrency).toEqual([]);
    expect(summary.totalCadFx).toBeNull();
  });

  it("keeps an all-closed total PROVISIONAL because final rematerialization is unproven", async () => {
    prismaTest.model("operatingCompany").findMany.mockResolvedValue([{ id: "oc-ww" }]);
    prismaTest.model("customerMonthlyFinancial").findMany.mockResolvedValue([
      monthlyRow({
        monthKey: CLOSED_MONTH,
        nativeRevenue: 2000,
        cadRevenue: 2000
      }),
      monthlyRow({
        monthKey: "2026-05",
        nativeRevenue: 1000,
        cadRevenue: 1000
      })
    ]);

    const summary = await getReportingSummary(ADMIN, { now: NOW });
    // The current calendar month is PROVISIONAL, but no current-month evidence
    // exists. Closed stored evidence still cannot prove final rematerialization.
    expect(summary.currentMonthKey).toBe(CURRENT_MONTH);
    expect(summary.currentMonthCadFx.cadStatus).toBe("PROVISIONAL");
    expect(summary.totalCadFx?.cadStatus).toBe("PROVISIONAL");
    expect(summary.totalCadFx?.finalMonthCount).toBe(0);
    expect(summary.totalCadFx?.provisionalMonthCount).toBe(2);
  });

  it("labels a current-month-only summary total PROVISIONAL", async () => {
    prismaTest.model("operatingCompany").findMany.mockResolvedValue([{ id: "oc-ww" }]);
    prismaTest.model("customerMonthlyFinancial").findMany.mockResolvedValue([
      monthlyRow({
        monthKey: CURRENT_MONTH,
        nativeRevenue: 1000,
        cadRevenue: 1000
      })
    ]);

    const summary = await getReportingSummary(ADMIN, { now: NOW });
    expect(summary.totalCadFx?.cadStatus).toBe("PROVISIONAL");
    expect(summary.totalCadFx?.finalMonthCount).toBe(0);
    expect(summary.totalCadFx?.provisionalMonthCount).toBe(1);
  });

  it("includes reliable current-month activity as month-to-date without treating in-progress as incomplete", async () => {
    prismaTest.model("operatingCompany").findMany.mockResolvedValue([{ id: "oc-ww" }]);
    prismaTest.model("customerMonthlyFinancial").findMany.mockResolvedValue([
      monthlyRow({
        monthKey: CURRENT_MONTH,
        reconciliationStatus: CustomerFinancialPeriodStatus.UNRECONCILED,
        nativeRevenue: 450,
        nativeCost: 150,
        nativeGrossProfit: 300,
        cadRevenue: 450
      })
    ]);

    const summary = await getReportingSummary(ADMIN, { now: NOW });
    expect(summary.materializedMonthCount).toBe(1);
    expect(summary.incompleteMonthCount).toBe(0);
    expect(summary.nativeByCurrency[0]).toMatchObject({
      nativeRevenue: 450,
      nativeCost: 150,
      nativeGrossProfit: 300
    });
    expect(summary.totalCadFx?.cadStatus).toBe("PROVISIONAL");
  });

  it("keeps one company's current AR available when another company's current snapshot is incomplete", async () => {
    prismaTest.model("operatingCompany").findMany.mockResolvedValue([
      { id: "oc-ww" },
      { id: "oc-usa" }
    ]);
    prismaTest.model("customerMonthlyFinancial").findMany.mockResolvedValue([
      monthlyRow({
        operatingCompanyId: "oc-ww",
        monthKey: CURRENT_MONTH,
        nativeRevenue: 900,
        nativeCost: 300,
        nativeGrossProfit: 600,
        cadRevenue: 900,
        nativeOpenAr: 900,
        cadOpenAr: 900,
        reconciliationStatus: CustomerFinancialPeriodStatus.INCOMPLETE
      }),
      monthlyRow({
        operatingCompanyId: "oc-usa",
        monthKey: CURRENT_MONTH,
        nativeRevenue: 400,
        nativeCost: 100,
        nativeGrossProfit: 300,
        cadRevenue: 400,
        nativeOpenAr: 75,
        cadOpenAr: 75
      })
    ]);

    const summary = await getReportingSummary(ADMIN, { now: NOW });
    expect(summary.materializedMonthCount).toBe(1);
    expect(summary.incompleteMonthCount).toBe(1);
    expect(summary.cadRevenue).toBe(400);
    expect(summary.nativeByCurrency[0]).toMatchObject({
      nativeRevenue: 400,
      nativeCost: 100,
      nativeGrossProfit: 300,
      nativeOpenAr: 75
    });
    expect(summary.cadOpenAr).toBe(75);
    expect(summary.openArAvailable).toBe(true);
    expect(summary.openArUnavailableOperatingCompanyCount).toBe(1);
  });

  it("treats an AR-only current snapshot as known zero revenue without an FX gap", async () => {
    prismaTest.model("operatingCompany").findMany.mockResolvedValue([{ id: "oc-ww" }]);
    prismaTest.model("customerMonthlyFinancial").findMany.mockResolvedValue([
      monthlyRow({
        monthKey: CURRENT_MONTH,
        serviceLine: CustomerIntelligenceServiceLine.OTHER,
        nativeRevenue: 0,
        cadRevenue: null,
        nativeOpenAr: 125,
        cadOpenAr: 125
      })
    ]);

    const summary = await getReportingSummary(ADMIN, { now: NOW });
    expect(summary.cadRevenue).toBe(0);
    expect(summary.cadRevenuePartial).toBe(false);
    expect(summary.cadOpenAr).toBe(125);
    expect(summary.openArAvailable).toBe(true);
    expect(summary.openArUnavailableOperatingCompanyCount).toBe(0);
  });

  it("counts a tenant operating company with no current snapshot as AR unavailable", async () => {
    prismaTest.model("operatingCompany").findMany.mockResolvedValue([
      { id: "oc-ww" },
      { id: "oc-usa" }
    ]);
    prismaTest.model("customerMonthlyFinancial").findMany.mockResolvedValue([
      monthlyRow({
        operatingCompanyId: "oc-ww",
        monthKey: CURRENT_MONTH,
        nativeOpenAr: 75,
        cadOpenAr: 75
      })
    ]);

    const summary = await getReportingSummary(ADMIN, { now: NOW });
    expect(summary.cadOpenAr).toBe(75);
    expect(summary.openArAvailable).toBe(true);
    expect(summary.openArUnavailableOperatingCompanyCount).toBe(1);
    expect(summary.cadValuesPartial).toBe(true);
  });
});

describe("server-rendered reporting pages", () => {
  beforeEach(() => {
    prismaTest.reset();
    configureAuth();
    vi.mocked(tenantContext.getAuthenticatedContext).mockResolvedValue(ADMIN);
  });

  it("renders the overview with the disclosure, PROVISIONAL labels, and both views", async () => {
    prismaTest.model("operatingCompany").findMany.mockResolvedValue([
      { id: "oc-ww", slug: "newl-worldwide", displayName: "Newl Worldwide", active: true }
    ]);
    prismaTest.model("customerMonthlyFinancial").findMany.mockResolvedValue([
      monthlyRow({
        monthKey: currentMonthKey(),
        serviceLine: CustomerIntelligenceServiceLine.OCEAN,
        currency: "CAD",
        nativeRevenue: 1000,
        cadRevenue: 1000
      }),
      monthlyRow({
        monthKey: "2020-01",
        serviceLine: CustomerIntelligenceServiceLine.OCEAN,
        currency: "CAD",
        nativeRevenue: 2000,
        cadRevenue: 2000
      })
    ]);

    const element = await CustomerIntelligenceReportingPage({
      searchParams: Promise.resolve({ view: "operating-companies" })
    });
    const html = renderToStaticMarkup(element);

    expect(html).toContain("Financial Reporting");
    expect(html).toContain("Directional management reporting");
    expect(html).toContain("not a statutory accounting entry");
    expect(html).toContain("PROVISIONAL");
    expect(html).toContain("final rematerialization can be proven");
    expect(html).toContain("Newl Worldwide");
    expect(html).toContain("Operating companies · 1");
    expect(html).toContain("Service lines · 7");
    expect(html).toContain("/customer-intelligence/reporting/operating-companies/oc-ww");
    // The closed row cannot prove final rematerialization, so the total stays
    // conservatively PROVISIONAL across the month transition.
    expect(html).toContain("Materialized CAD revenue · PROVISIONAL");
    // Native amounts render with their actual currency codes (CAD-only rows
    // here), while the CAD consolidation total remains a single CAD figure.
    expect(html).toContain(">CAD</span>");
    expect(html).toContain("$3,000.00");
  });

  it("renders per-currency native amounts and partial CAD AR markers on the operating-company view", async () => {
    prismaTest.model("operatingCompany").findMany.mockResolvedValue([
      { id: "oc-ww", slug: "newl-worldwide", displayName: "Newl Worldwide", active: true }
    ]);
    prismaTest.model("customerMonthlyFinancial").findMany.mockResolvedValue([
      monthlyRow({
        monthKey: currentMonthKey(),
        serviceLine: CustomerIntelligenceServiceLine.OCEAN,
        currency: "CAD",
        nativeRevenue: 2000,
        nativeCost: 700,
        nativeGrossProfit: 1300,
        cadRevenue: 2000,
        nativeOpenAr: 250,
        cadOpenAr: 250
      }),
      monthlyRow({
        monthKey: currentMonthKey(),
        serviceLine: CustomerIntelligenceServiceLine.OCEAN,
        currency: "USD",
        nativeRevenue: 500,
        nativeCost: 125,
        nativeGrossProfit: 375,
        cadRevenue: 670.5,
        nativeOpenAr: 100,
        cadOpenAr: null
      })
    ]);

    const element = await CustomerIntelligenceReportingPage({
      searchParams: Promise.resolve({ view: "operating-companies" })
    });
    const html = renderToStaticMarkup(element);

    // Both native currencies render with their codes; CAD and USD amounts are
    // never summed into one "native revenue" figure.
    expect(html).toContain(">CAD</span>");
    expect(html).toContain(">USD</span>");
    expect(html).toContain("$2,000.00");
    expect(html).toContain("$500.00");
    expect(html).toContain("Native cost");
    expect(html).toContain("Native gross profit");
    expect(html).toContain("$700.00");
    expect(html).toContain("US$125.00");
    expect(html).toContain("$1,300.00");
    expect(html).toContain("US$375.00");
    // The CAD AR total is marked partial because one contributing row lacks a
    // conversion, and the stored total remains conservatively provisional.
    expect(html).toContain("partial");
    expect(html).toContain("Materialized CAD revenue · PROVISIONAL");
  });

  it("renders Open AR as unavailable when the current live snapshot is incomplete", async () => {
    prismaTest.model("operatingCompany").findMany.mockResolvedValue([
      { id: "oc-ww", slug: "newl-worldwide", displayName: "Newl Worldwide", active: true }
    ]);
    prismaTest.model("customerMonthlyFinancial").findMany.mockResolvedValue([
      monthlyRow({ monthKey: "2020-01", nativeOpenAr: 125, cadOpenAr: 125 }),
      monthlyRow({
        monthKey: currentMonthKey(),
        nativeOpenAr: 500,
        cadOpenAr: 500,
        reconciliationStatus: CustomerFinancialPeriodStatus.INCOMPLETE
      })
    ]);

    const element = await CustomerIntelligenceReportingPage({
      searchParams: Promise.resolve({ view: "operating-companies" })
    });
    const html = renderToStaticMarkup(element);

    expect(html).toContain("Unavailable");
    expect(html).toContain("current snapshot unavailable");
    // Neither the incomplete current balance nor the older complete balance is
    // substituted into headline Open AR.
    expect(html).not.toContain("$500.00");
    expect(html).not.toContain("$125.00");
  });

  it("renders an all-closed stored total as PROVISIONAL when final rematerialization is unproven", async () => {
    prismaTest.model("operatingCompany").findMany.mockResolvedValue([
      { id: "oc-ww", slug: "newl-worldwide", displayName: "Newl Worldwide", active: true }
    ]);
    // All materialized evidence is from closed months even though the current
    // calendar month has advanced, but stored final rematerialization is unproven.
    prismaTest.model("customerMonthlyFinancial").findMany.mockResolvedValue([
      monthlyRow({
        monthKey: "2020-01",
        serviceLine: CustomerIntelligenceServiceLine.OCEAN,
        currency: "CAD",
        nativeRevenue: 1000,
        cadRevenue: 1000
      }),
      monthlyRow({
        monthKey: "2020-02",
        serviceLine: CustomerIntelligenceServiceLine.OCEAN,
        currency: "CAD",
        nativeRevenue: 2000,
        cadRevenue: 2000
      })
    ]);

    const element = await CustomerIntelligenceReportingPage({
      searchParams: Promise.resolve({ view: "operating-companies" })
    });
    const html = renderToStaticMarkup(element);

    expect(html).toContain("Materialized CAD revenue · PROVISIONAL");
    expect(html).toContain("$3,000.00");
  });

  it("renders aggregate revenue FX and current-snapshot AR FX with partial markers", async () => {
    prismaTest.model("operatingCompany").findMany.mockResolvedValue([
      { id: "oc-ww", slug: "newl-worldwide", displayName: "Newl Worldwide", active: true }
    ]);
    // One closed USD row missing both conversions and a provisional CAD row: the
    // Closed materialization remains unproven, so the total is provisional and partial.
    prismaTest.model("customerMonthlyFinancial").findMany.mockResolvedValue([
      monthlyRow({
        monthKey: "2020-01",
        serviceLine: CustomerIntelligenceServiceLine.OCEAN,
        currency: "USD",
        nativeRevenue: 500,
        cadRevenue: null,
        nativeOpenAr: 100,
        cadOpenAr: null
      }),
      monthlyRow({
        monthKey: currentMonthKey(),
        serviceLine: CustomerIntelligenceServiceLine.OCEAN,
        currency: "CAD",
        nativeRevenue: 2000,
        cadRevenue: 2000,
        nativeOpenAr: 400,
        cadOpenAr: 250
      }),
      monthlyRow({
        monthKey: "2020-02",
        serviceLine: CustomerIntelligenceServiceLine.OCEAN,
        currency: "USD",
        nativeRevenue: 500,
        cadRevenue: 670.5,
        nativeOpenAr: 100,
        cadOpenAr: 134.1
      })
    ]);

    const element = await CustomerIntelligenceReportingPage({
      searchParams: Promise.resolve({ view: "operating-companies" })
    });
    const html = renderToStaticMarkup(element);

    expect(html).toContain("Materialized CAD revenue · PROVISIONAL, partial");

    // Revenue spans the complete closed/current periods. Open AR is independent:
    // only the live current-month snapshot contributes.
    const revenueCell = cellAround(html, "$2,670.50");
    expect(revenueCell).toContain("PROVISIONAL");
    expect(revenueCell).toContain("partial");
    const arCell = cellAround(html, "$250.00");
    expect(arCell).toContain("PROVISIONAL");
    expect(arCell).not.toContain("partial");
  });

  it("does not label OCEAN revenue snapshot-incomplete when complete Open AR is under OTHER", async () => {
    prismaTest.model("operatingCompany").findMany.mockResolvedValue([
      { id: "oc-ww", slug: "newl-worldwide", displayName: "Newl Worldwide", active: true }
    ]);
    prismaTest.model("customerMonthlyFinancial").findMany.mockResolvedValue([
      monthlyRow({
        monthKey: currentMonthKey(),
        serviceLine: CustomerIntelligenceServiceLine.OCEAN,
        currency: "CAD",
        nativeRevenue: 2000,
        cadRevenue: 2000
      }),
      monthlyRow({
        monthKey: currentMonthKey(),
        serviceLine: CustomerIntelligenceServiceLine.OTHER,
        currency: "CAD",
        nativeRevenue: 0,
        cadRevenue: 0,
        nativeOpenAr: 100,
        cadOpenAr: 100
      })
    ]);

    const element = await CustomerIntelligenceReportingPage({
      searchParams: Promise.resolve({ view: "service-lines" })
    });
    const html = renderToStaticMarkup(element);

    expect(cellAround(html, "$2,000.00")).toContain("PROVISIONAL");
    expect(html).toContain("Open AR is reported at operating-company level");
    expect(html).not.toContain("Native AR");
    expect(html).not.toContain("CAD AR");
    expect(html).not.toContain("snapshot incomplete");
    expect(html).not.toContain("current snapshot unavailable");
  });

  it("renders the service-line view with every service line", async () => {
    prismaTest.model("operatingCompany").findMany.mockResolvedValue([
      { id: "oc-ww", slug: "newl-worldwide", displayName: "Newl Worldwide", active: true }
    ]);
    prismaTest.model("customerMonthlyFinancial").findMany.mockResolvedValue([
      monthlyRow({
        monthKey: "2020-01",
        serviceLine: CustomerIntelligenceServiceLine.OCEAN,
        currency: "CAD",
        nativeRevenue: 2500,
        nativeCost: 750,
        nativeGrossProfit: 1750,
        cadRevenue: 2500
      })
    ]);

    const element = await CustomerIntelligenceReportingPage({
      searchParams: Promise.resolve({ view: "service-lines" })
    });
    const html = renderToStaticMarkup(element);

    expect(html).toContain("Service lines · 7");
    expect(html).toContain("Ocean");
    expect(html).toContain("Customs Brokerage");
    expect(html).toContain("Warehousing Fulfillment");
    expect(html).toContain("Native cost");
    expect(html).toContain("Native gross profit");
    expect(html).toContain("$750.00");
    expect(html).toContain("$1,750.00");
  });

  it("renders an honest empty state when nothing is materialized", async () => {
    prismaTest.model("operatingCompany").findMany.mockResolvedValue([]);
    prismaTest.model("customerMonthlyFinancial").findMany.mockResolvedValue([]);

    const element = await CustomerIntelligenceReportingPage({
      searchParams: Promise.resolve({ view: "operating-companies" })
    });
    const html = renderToStaticMarkup(element);
    expect(html).toContain("No materialized monthly financials yet.");
  });

  it("renders the operating-company detail with monthly rows and revenue evidence", async () => {
    prismaTest.model("operatingCompany").findFirst.mockResolvedValue({
      id: "oc-ww",
      slug: "newl-worldwide",
      displayName: "Newl Worldwide",
      homeCurrency: "CAD",
      active: true
    });
    prismaTest.model("customerMonthlyFinancial").findMany.mockResolvedValue([
      {
        id: "mf-1",
        monthKey: currentMonthKey(),
        companyId: "company-1",
        companyOperatingRelationshipId: "rel-1",
        sourceAccountKey: "acc-1",
        serviceLine: CustomerIntelligenceServiceLine.OCEAN,
        currency: "USD",
        nativeRevenue: 500,
        nativeCost: 125,
        nativeGrossProfit: 375,
        cadRevenue: 670.5,
        nativeOpenAr: 100,
        cadOpenAr: 134.1,
        reconciliationStatus: CustomerFinancialPeriodStatus.UNRECONCILED,
        company: { name: "Northstar Outdoor Supply" }
      }
    ]);
    prismaTest.model("customerRevenueLine").findMany.mockResolvedValue([
      {
        sourceKey: "pnl-detail:realm-1:9001:1",
        transactionDate: new Date(Date.UTC(2026, 7, 3)),
        transactionType: "Invoice",
        transactionNumber: "9001",
        companyId: "company-1",
        serviceLine: CustomerIntelligenceServiceLine.OCEAN,
        nativeAmount: 500,
        nativeCurrency: "USD",
        cadAmount: 670.5,
        fxSource: "BANK_OF_CANADA_PROVISIONAL",
        company: { name: "Northstar Outdoor Supply" }
      }
    ]);
    prismaTest.model("customerRevenueLine").count.mockResolvedValue(1);

    const element = await CustomerIntelligenceReportingOperatingCompanyPage({
      params: Promise.resolve({ operatingCompanyId: "oc-ww" })
    });
    const html = renderToStaticMarkup(element);

    expect(html).toContain("Newl Worldwide");
    expect(html).toContain("Directional management reporting");
    expect(html).toContain("Monthly financials (1)");
    expect(html).toContain("Northstar Outdoor Supply");
    expect(html).toContain("Revenue-line evidence (1 total)");
    expect(html).toContain("BANK_OF_CANADA_PROVISIONAL");
    expect(html).toContain("PROVISIONAL");
    // The detail CAD totals carry the aggregate label of the included month
    // (the current month here, so PROVISIONAL).
    expect(html).toContain("Materialized CAD revenue · PROVISIONAL");
    expect(html).toContain("Live CAD Open AR · PROVISIONAL");
  });

  it("renders historical stored AR as unavailable in the monthly detail table", async () => {
    prismaTest.model("operatingCompany").findFirst.mockResolvedValue({
      id: "oc-ww",
      slug: "newl-worldwide",
      displayName: "Newl Worldwide",
      homeCurrency: "CAD",
      active: true
    });
    prismaTest.model("customerMonthlyFinancial").findMany.mockResolvedValue([
      {
        id: "mf-historical",
        monthKey: CLOSED_MONTH,
        companyId: "company-1",
        companyOperatingRelationshipId: "rel-1",
        sourceAccountKey: "acc-1",
        serviceLine: CustomerIntelligenceServiceLine.OTHER,
        currency: "CAD",
        nativeRevenue: 0,
        nativeCost: 0,
        nativeGrossProfit: 0,
        cadRevenue: 0,
        nativeOpenAr: 125,
        cadOpenAr: 125,
        reconciliationStatus: CustomerFinancialPeriodStatus.UNRECONCILED,
        company: { name: "Northstar Outdoor Supply" }
      }
    ]);
    prismaTest.model("customerRevenueLine").findMany.mockResolvedValue([]);
    prismaTest.model("customerRevenueLine").count.mockResolvedValue(0);

    const element = await CustomerIntelligenceReportingOperatingCompanyPage({
      params: Promise.resolve({ operatingCompanyId: "oc-ww" }),
      searchParams: Promise.resolve({})
    });
    const html = renderToStaticMarkup(element);

    expect(html).toContain("Live native AR");
    expect(html).toContain("Live CAD AR");
    expect(html.split("Unavailable").length - 1).toBeGreaterThanOrEqual(3);
    expect(html).not.toContain("$125.00");
  });

  it("renders incomplete current-month AR as unavailable in the monthly detail table", async () => {
    prismaTest.model("operatingCompany").findFirst.mockResolvedValue({
      id: "oc-ww",
      slug: "newl-worldwide",
      displayName: "Newl Worldwide",
      homeCurrency: "CAD",
      active: true
    });
    prismaTest.model("customerMonthlyFinancial").findMany.mockResolvedValue([
      {
        id: "mf-incomplete-current",
        monthKey: currentMonthKey(),
        companyId: "company-1",
        companyOperatingRelationshipId: "rel-1",
        sourceAccountKey: "acc-1",
        serviceLine: CustomerIntelligenceServiceLine.OTHER,
        currency: "CAD",
        nativeRevenue: 0,
        nativeCost: 0,
        nativeGrossProfit: 0,
        cadRevenue: 0,
        nativeOpenAr: 250,
        cadOpenAr: 250,
        reconciliationStatus: CustomerFinancialPeriodStatus.INCOMPLETE,
        company: { name: "Northstar Outdoor Supply" }
      }
    ]);
    prismaTest.model("customerRevenueLine").findMany.mockResolvedValue([]);
    prismaTest.model("customerRevenueLine").count.mockResolvedValue(0);

    const element = await CustomerIntelligenceReportingOperatingCompanyPage({
      params: Promise.resolve({ operatingCompanyId: "oc-ww" }),
      searchParams: Promise.resolve({})
    });
    const html = renderToStaticMarkup(element);

    expect(html).toContain("INCOMPLETE");
    expect(html.split("Unavailable").length - 1).toBeGreaterThanOrEqual(3);
    expect(html).not.toContain("$250.00");
  });

  it("renders detail native amounts in their actual currencies, never a CAD fallback", async () => {
    prismaTest.model("operatingCompany").findFirst.mockResolvedValue({
      id: "oc-ww",
      slug: "newl-worldwide",
      displayName: "Newl Worldwide",
      homeCurrency: "CAD",
      active: true
    });
    prismaTest.model("customerMonthlyFinancial").findMany.mockResolvedValue([
      {
        id: "mf-1",
        monthKey: currentMonthKey(),
        companyId: "company-1",
        companyOperatingRelationshipId: "rel-1",
        sourceAccountKey: "acc-1",
        serviceLine: CustomerIntelligenceServiceLine.OCEAN,
        currency: "USD",
        nativeRevenue: 500,
        nativeCost: 125,
        nativeGrossProfit: 375,
        cadRevenue: 670.5,
        nativeOpenAr: 100,
        cadOpenAr: 134.1,
        reconciliationStatus: CustomerFinancialPeriodStatus.UNRECONCILED,
        company: { name: "Northstar Outdoor Supply" }
      }
    ]);
    prismaTest.model("customerRevenueLine").count.mockResolvedValue(1);
    prismaTest.model("customerRevenueLine").findMany.mockResolvedValue([
      revenueLineRow({ nativeAmount: 500, nativeCurrency: "USD" })
    ]);

    const element = await CustomerIntelligenceReportingOperatingCompanyPage({
      params: Promise.resolve({ operatingCompanyId: "oc-ww" }),
      searchParams: Promise.resolve({})
    });
    const html = renderToStaticMarkup(element);

    // The monthly native revenue (USD 500) and the revenue-line native amount
    // (USD 500) both render as US dollars — never as the CAD default — while
    // the CAD-converted columns keep their CAD formatting.
    expect(html.split("US$500.00").length - 1).toBeGreaterThanOrEqual(2);
    expect(html).toContain("US$100.00");
    expect(html).toContain("US$125.00");
    expect(html).toContain("US$375.00");
    expect(html).toContain("Materialized native cost");
    expect(html).toContain("Materialized native gross profit");
    expect(html).toContain("$670.50");
    expect(html).toContain("$134.10");
    // No USD-converted column renders as CAD and no CAD column renders as USD.
    expect(html).not.toContain("US$670.50");
    expect(html).not.toContain("US$134.10");
  });

  it("discloses truncated revenue evidence and offers pagination controls", async () => {
    prismaTest.model("operatingCompany").findFirst.mockResolvedValue({
      id: "oc-ww",
      slug: "newl-worldwide",
      displayName: "Newl Worldwide",
      homeCurrency: "CAD",
      active: true
    });
    prismaTest.model("customerMonthlyFinancial").findMany.mockResolvedValue([]);
    prismaTest.model("customerRevenueLine").count.mockResolvedValue(501);
    prismaTest.model("customerRevenueLine").findMany.mockResolvedValue(
      Array.from({ length: 500 }, (_, index) =>
        revenueLineRow({
          sourceKey: `pnl-detail:realm-1:line-${index}:1`,
          transactionDate: new Date(Date.UTC(2026, 7, 1 + (index % 20)))
        })
      )
    );

    const element = await CustomerIntelligenceReportingOperatingCompanyPage({
      params: Promise.resolve({ operatingCompanyId: "oc-ww" }),
      searchParams: Promise.resolve({})
    });
    const html = renderToStaticMarkup(element);

    // The header exposes the complete record count and the footer discloses the
    // page window, so a 500-row page is never presented as the full record.
    expect(html).toContain("Revenue-line evidence (501 total)");
    expect(html).toContain("Showing rows 1–500 of 501");
    expect(html).toContain("page 1 of 2");
    // Page 2 is reachable; there is no previous page from page 1.
    expect(html).toContain("?page=2");
    expect(html).toContain(">Next</a>");
    expect(html).not.toContain(">Previous</a>");
  });

  it("renders the Previous control on subsequent revenue-line pages", async () => {
    prismaTest.model("operatingCompany").findFirst.mockResolvedValue({
      id: "oc-ww",
      slug: "newl-worldwide",
      displayName: "Newl Worldwide",
      homeCurrency: "CAD",
      active: true
    });
    prismaTest.model("customerMonthlyFinancial").findMany.mockResolvedValue([]);
    prismaTest.model("customerRevenueLine").count.mockResolvedValue(501);
    prismaTest.model("customerRevenueLine").findMany.mockResolvedValue([revenueLineRow()]);

    const element = await CustomerIntelligenceReportingOperatingCompanyPage({
      params: Promise.resolve({ operatingCompanyId: "oc-ww" }),
      searchParams: Promise.resolve({ page: "2" })
    });
    const html = renderToStaticMarkup(element);

    expect(html).toContain("Showing rows 501–501 of 501");
    expect(html).toContain("?page=1");
    expect(html).toContain(">Previous</a>");
    expect(html).not.toContain(">Next</a>");
  });

  it("normalizes malformed, non-finite, negative, fractional, and excessive page parameters", async () => {
    prismaTest.model("operatingCompany").findFirst.mockResolvedValue({
      id: "oc-ww",
      slug: "newl-worldwide",
      displayName: "Newl Worldwide",
      homeCurrency: "CAD",
      active: true
    });
    prismaTest.model("customerMonthlyFinancial").findMany.mockResolvedValue([]);
    prismaTest.model("customerRevenueLine").count.mockResolvedValue(1);
    prismaTest.model("customerRevenueLine").findMany.mockResolvedValue([revenueLineRow()]);

    for (const page of ["not-a-page", "Infinity", "-3", "1.5", "10001"]) {
      await CustomerIntelligenceReportingOperatingCompanyPage({
        params: Promise.resolve({ operatingCompanyId: "oc-ww" }),
        searchParams: Promise.resolve({ page })
      });
      const call = prismaTest.model("customerRevenueLine").findMany.mock.calls.at(-1)![0] as {
        skip: number;
      };
      expect(call.skip, `${page} must resolve to the controlled first page`).toBe(0);
      expect(Number.isFinite(call.skip)).toBe(true);
    }
  });

  it("renders not found for unknown or cross-tenant operating-company identifiers", async () => {
    prismaTest.model("operatingCompany").findFirst.mockResolvedValue(null);
    await expect(
      CustomerIntelligenceReportingOperatingCompanyPage({
        params: Promise.resolve({ operatingCompanyId: "oc-foreign" })
      })
    ).rejects.toThrow("NEXT_NOT_FOUND");
  });
});

describe("app shell: leadership-only Reporting navigation entry", () => {
  const leadershipRoles = [PlatformRole.ADMIN, PlatformRole.MANAGER, PlatformRole.FINANCE];
  const deniedRoles = [PlatformRole.READ_ONLY, PlatformRole.SALES, PlatformRole.OPERATIONS];

  function renderShell(role: PlatformRole, enabledModuleKeys: ModuleKey[] = [ModuleKey.CUSTOMER_INTELLIGENCE]) {
    return renderToStaticMarkup(
      <AppShell
        userName="User"
        userEmail="user@example.com"
        role={role}
        tenantName="Tenant A"
        enabledModuleKeys={enabledModuleKeys}
      >
        <div>content</div>
      </AppShell>
    );
  }

  it("shows the Reporting link to ADMIN, MANAGER, and FINANCE", () => {
    for (const role of leadershipRoles) {
      const html = renderShell(role);
      expect(html, `${role} must see the Reporting navigation entry`).toContain(
        "/customer-intelligence/reporting"
      );
      expect(html, `${role} must see the Reporting label`).toContain(">Reporting</a>");
    }
  });

  it("hides the Reporting link from READ_ONLY and other unauthorized roles even with the module enabled", () => {
    for (const role of deniedRoles) {
      const html = renderShell(role);
      expect(html, `${role} must not see the Reporting navigation entry`).not.toContain(
        "/customer-intelligence/reporting"
      );
      // The other Customer Intelligence entries stay visible for roles that
      // have the module enabled, proving only Reporting is leadership-restricted.
      expect(html, `${role} must still see the Customer Intelligence group`).toContain(
        "Customer Intelligence"
      );
      expect(html, `${role} must still see Identity Review`).toContain(
        "/customer-intelligence/review"
      );
    }
  });

  it("keeps the Reporting link hidden when the module is not enabled", () => {
    const html = renderShell(PlatformRole.ADMIN, []);
    expect(html).not.toContain("/customer-intelligence/reporting");
    expect(html).not.toContain("/customer-intelligence");
  });
});

describe("structural guard: reporting never references legacy Cashflow structures", () => {
  it("keeps the reporting queries and pages free of Cashflow structure references", () => {
    const files = [
      "src/modules/customer-intelligence/reporting-queries.ts",
      "src/app/(authenticated)/customer-intelligence/reporting/page.tsx",
      "src/app/(authenticated)/customer-intelligence/reporting/operating-companies/[operatingCompanyId]/page.tsx"
    ];
    // Concrete legacy Cashflow table/enum identifiers (the same family the
    // migration-guard suite protects). Prose that documents the boundary is
    // allowed; no concrete legacy structure may be referenced by the reporting
    // code, and no Prisma cashflow model access may exist.
    const legacyCashflowStructures = [
      "CashflowCustomer",
      "CashflowCustomerAlias",
      "CashflowFile",
      "CashflowAccountingLine",
      "CashflowCustomerInvoice",
      "CashflowVendorBill",
      "CashflowCustomerSnapshot",
      "CashflowFollowUp",
      "CashflowAlert",
      "CashflowSettings",
      "CashflowLegalEntity",
      "CashflowBusinessLine",
      "CashflowCustomerTier",
      "CashflowFileStatus",
      "CashflowInvoiceStatus",
      "CashflowVendorBillStatus",
      "CashflowRiskTier",
      "CashflowPriority",
      "CashflowBillingTrigger",
      "CashflowFollowUpStatus",
      "CashflowAlertStatus",
      "CashflowAlertType",
      "CashflowAccountingLineKind"
    ];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      for (const structure of legacyCashflowStructures) {
        expect(source, `${file} must never reference ${structure}`).not.toContain(structure);
      }
      expect(source, `${file} must never access a Prisma cashflow model`).not.toMatch(
        /prisma\.cashflow/i
      );
    }
  });
});
