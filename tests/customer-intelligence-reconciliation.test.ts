import {
  CustomerIdentityMatchKind,
  CustomerIdentityMatchStatus,
  PlatformRole,
  Prisma
} from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

const prismaTest = vi.hoisted(() => {
  const modelCalls: Array<{ model: string; method: string; args: unknown[] }> = [];
  const modelTargets = new Map<string, Record<string, ReturnType<typeof vi.fn>>>();
  const queryRaw = vi.fn(async (...args: unknown[]) => {
    void args;
    return [];
  });
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
// boundary runs against the mocked DB exactly like the foundation suite.
vi.mock("@/server/db", () => ({
  prisma: prismaTest.proxy
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/server/tenant-context", () => ({
  getAuthenticatedContext: vi.fn()
}));

import {
  runIdentityReconciliation,
  reviewIdentityMatch,
  approveIdentityMatchWithNewCompany
} from "@/modules/customer-intelligence/actions";
import {
  addressLinesFromJson,
  addressLinesOverlap,
  normalizeAddressLine,
  readQuickBooksMatchEvidence,
  reconcileQuickBooksIdentityMatches,
  scoreQuickBooksReconciliation,
  type QuickBooksMatchEvidence,
  type ReconciliationCandidate
} from "@/modules/customer-intelligence/reconciliation";
import {
  getIdentityReviewMetrics,
  getIdentityReviewQueue
} from "@/modules/customer-intelligence/queries";
import { AuthorizationError } from "@/server/auth/authorization";
import * as tenantContext from "@/server/tenant-context";
import type { AuthenticatedContext } from "@/server/tenant-context";
import { createAndApproveIdentityCompanyAction } from "@/modules/customer-intelligence/review-actions";

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

/** Proves a denied call never reached a database write (create/update/upsert/delete). */
function assertNoDatabaseWrites() {
  const writes = prismaTest.modelCalls.filter((call) => WRITE_METHODS.has(call.method));
  expect(writes).toEqual([]);
}

const SOURCE: QuickBooksMatchEvidence = {
  displayName: "Blue Peak Packaging Inc.",
  companyName: null,
  email: "purchasing@bluepeak.example",
  phone: "416-555-0134",
  billingAddress: null,
  shippingAddress: null
};

function candidate(overrides: Partial<ReconciliationCandidate> = {}): ReconciliationCandidate {
  return {
    companyId: "company-1",
    name: "Blue Peak Packaging",
    domains: ["bluepeak.example"],
    phones: [],
    addressLines: [],
    exactPersistedMapping: false,
    previouslyApprovedStableId: false,
    ...overrides
  };
}

const PROPOSED_MATCH = {
  id: "match-1",
  operatingCompanyId: "oc-ww",
  sourceRecordKey: "realm-1:1001",
  companyId: null,
  candidateCompanyId: null,
  score: 0,
  evidence: {
    source: "QUICKBOOKS",
    displayName: "Blue Peak Packaging Inc.",
    email: "purchasing@bluepeak.example",
    phone: "416-555-0134"
  }
};

describe("reconciliation scoring matrix (identity.ts rules only)", () => {
  it("reads stored QuickBooks evidence deterministically", () => {
    const evidence = readQuickBooksMatchEvidence({ evidence: PROPOSED_MATCH.evidence });
    expect(evidence.displayName).toBe("Blue Peak Packaging Inc.");
    expect(evidence.email).toBe("purchasing@bluepeak.example");
    expect(evidence.phone).toBe("416-555-0134");
    expect(evidence.billingAddress).toBeNull();
  });

  it("auto-links at 95 for a unique domain plus a compatible name", () => {
    const result = scoreQuickBooksReconciliation(SOURCE, [candidate()], {
      "bluepeak.example": 1
    });
    expect(result.score).toBe(95);
    expect(result.reason).toBe("AUTO_LINK");
    expect(result.bestCandidateCompanyId).toBe("company-1");
    expect(result.ambiguous).toBe(false);
  });

  it("auto-links at 92 for a compatible name plus a matching phone", () => {
    const result = scoreQuickBooksReconciliation(
      SOURCE,
      [candidate({ domains: ["different.example"], phones: ["(416) 555-0134"] })],
      { "bluepeak.example": 1, "different.example": 1 }
    );
    expect(result.score).toBe(92);
    expect(result.reason).toBe("AUTO_LINK");
  });

  it("auto-links at 100 for an exact persisted mapping / previously approved stable ID", () => {
    const exact = scoreQuickBooksReconciliation(
      SOURCE,
      [candidate({ exactPersistedMapping: true })],
      { "bluepeak.example": 1 }
    );
    expect(exact.score).toBe(100);
    expect(exact.reason).toBe("AUTO_LINK");

    const stable = scoreQuickBooksReconciliation(
      SOURCE,
      [candidate({ previouslyApprovedStableId: true })],
      { "bluepeak.example": 1 }
    );
    expect(stable.score).toBe(100);
    expect(stable.reason).toBe("AUTO_LINK");
  });

  it("never auto-links on exact normalized name alone", () => {
    const result = scoreQuickBooksReconciliation(
      { ...SOURCE, email: null, phone: null },
      [candidate({ domains: ["other.example"], phones: ["(212) 555-0199"] })],
      {}
    );
    expect(result.score).toBe(0);
    expect(result.reason).toBe("BELOW_THRESHOLD");
    expect(result.bestCandidateCompanyId).toBeNull();
  });

  it("excludes free-mail domains from establishing company identity", () => {
    const result = scoreQuickBooksReconciliation(
      { ...SOURCE, email: "purchasing@gmail.com" },
      [candidate({ domains: ["gmail.com"] })],
      { "gmail.com": 1 }
    );
    expect(result.score).toBe(0);
    expect(result.reason).toBe("BELOW_THRESHOLD");
  });

  it("routes a tie for the best score to review (ambiguous)", () => {
    // Two similarly named candidates sharing the source phone but neither
    // carrying the source's unique domain: both score 92 (name + phone), so
    // the tie is genuinely at the name+phone tier of the approved matrix.
    const tied = [
      candidate({
        companyId: "company-1",
        domains: ["other.example"],
        phones: ["(416) 555-0134"]
      }),
      candidate({
        companyId: "company-2",
        name: "Blue Peak Packaging Inc Logistics",
        domains: ["other.example"],
        phones: ["(416) 555-0134"]
      })
    ];
    const result = scoreQuickBooksReconciliation(SOURCE, tied, { "other.example": 1 });
    expect(result.score).toBe(92);
    expect(result.ambiguous).toBe(true);
    expect(result.reason).toBe("AMBIGUOUS");
    expect(result.bestCandidateCompanyId).toBeNull();
  });

  it("keeps a match with no candidate companies in review (CP-02B-3-Q1)", () => {
    const result = scoreQuickBooksReconciliation(SOURCE, [], {});
    expect(result.score).toBe(0);
    expect(result.reason).toBe("NO_CANDIDATE");
    expect(result.bestCandidateCompanyId).toBeNull();
  });
});

describe("address-line evidence derivation", () => {
  it("normalizes only case, punctuation, and whitespace", () => {
    expect(normalizeAddressLine("1200 Example Rd.,  Mississauga")).toBe(
      "1200 example rd mississauga"
    );
  });

  it("detects an exact normalized address line without inferring suffix equivalence", () => {
    expect(
      addressLinesOverlap(["1200 EXAMPLE Rd., Mississauga"], ["1200 Example Rd Mississauga"])
    ).toBe(true);
    expect(
      addressLinesOverlap(["1200 Example Rd., Mississauga"], ["1200 Example Road, Mississauga"])
    ).toBe(false);
    expect(addressLinesOverlap(["1200 Example Rd."], ["99 Other Blvd"])).toBe(false);
  });

  it.each([
    ["city", { City: "Mississauga" }],
    ["province", { CountrySubDivisionCode: "ON" }],
    ["postal code", { PostalCode: "L5T 2J7" }],
    ["country", { Country: "Canada" }]
  ])("does not treat a shared %s as street-address evidence", (_label, address) => {
    expect(addressLinesFromJson(address)).toEqual([]);
    const result = scoreQuickBooksReconciliation(
      { ...SOURCE, email: null, phone: null, billingAddress: address },
      [candidate({ domains: [], addressLines: addressLinesFromJson(address) })],
      {}
    );
    expect(result.score).toBe(0);
    expect(result.reason).toBe("BELOW_THRESHOLD");
  });

  it("uses an exact approved QuickBooks street line but not arbitrary address values", () => {
    expect(
      addressLinesFromJson({
        Line1: "1200 Example Rd.",
        City: "Mississauga",
        CountrySubDivisionCode: "ON",
        PostalCode: "L5T 2J7",
        Country: "Canada"
      })
    ).toEqual(["1200 Example Rd."]);
  });
});

describe("reconcileQuickBooksIdentityMatches", () => {
  beforeEach(() => {
    prismaTest.reset();
    configureAuth();
    prismaTest.model("customerIdentityMatch").findMany.mockResolvedValue([PROPOSED_MATCH]);
    prismaTest.model("companyOperatingRelationship").findMany.mockResolvedValue([
      { companyId: "company-1", operatingCompanyId: "oc-ww" }
    ]);
    prismaTest.model("company").findMany.mockResolvedValue([
      {
        id: "company-1",
        name: "Blue Peak Packaging",
        domain: "bluepeak.example",
        customerSourceAccounts: []
      }
    ]);
    // assertCanApproveIdentityMatch tenant validation reads.
    prismaTest.model("company").findFirst.mockResolvedValue({ id: "company-1" });
    prismaTest.model("operatingCompany").findFirst.mockResolvedValue({ id: "oc-ww" });
    // No reviewed decision and no conflicting approval for the source.
    prismaTest.model("customerIdentityMatch").findFirst.mockResolvedValue(null);
    prismaTest.model("customerIdentityMatch").findUnique.mockResolvedValue({
      ...PROPOSED_MATCH,
      tenantId: "tenant-a",
      kind: CustomerIdentityMatchKind.QUICKBOOKS_ACCOUNT,
      status: CustomerIdentityMatchStatus.PROPOSED
    });
    prismaTest.model("customerIdentityMatch").update.mockImplementation(
      ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => ({
        id: (where.tenantId_id as { id?: string } | null | undefined)?.id ?? "match-1",
        ...data
      })
    );
  });

  function auditActions() {
    return prismaTest.model("auditLog").create.mock.calls.map(
      ([arg]) => (arg as { data: Record<string, unknown> }).data.action
    );
  }

  it("auto-links a unique high-confidence target to a tenant-valid company", async () => {
    const report = await reconcileQuickBooksIdentityMatches(ADMIN, {});

    expect(report.totals.evaluated).toBe(1);
    expect(report.totals.autoLinked).toBe(1);
    expect(report.totals.routedToReview).toBe(0);

    const updateArg = prismaTest.model("customerIdentityMatch").update.mock.calls[0][0] as {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    };
    expect(updateArg.where).toEqual({ tenantId_id: { tenantId: "tenant-a", id: "match-1" } });
    expect(updateArg.data).toMatchObject({
      companyId: "company-1",
      candidateCompanyId: "company-1",
      score: 95,
      status: CustomerIdentityMatchStatus.APPROVED
    });

    // Every approval writes an AuditLog, and the run writes a terminal summary.
    expect(auditActions()).toEqual([
      "customer-intelligence.identity-match.approved",
      "customer-intelligence.identity-reconciliation.run"
    ]);
    const runAudit = prismaTest.model("auditLog").create.mock.calls[1][0] as {
      data: Record<string, unknown>;
    };
    expect(runAudit.data.tenantId).toBe("tenant-a");
    expect(runAudit.data.after).toMatchObject({
      totals: { evaluated: 1, autoLinked: 1, routedToReview: 0, reviewedPreserved: 0, errors: 0 }
    });
    // Source identifiers never reach the audit trail.
    expect(JSON.stringify(runAudit.data)).not.toContain("realm-1");
    expect(JSON.stringify(runAudit.data)).not.toContain("Blue Peak");
  });

  it("derives score 100 from an exact tenant/operating-company persisted source mapping", async () => {
    prismaTest.model("company").findMany.mockResolvedValue([
      {
        id: "company-1",
        name: "Blue Peak Packaging",
        domain: null,
        customerSourceAccounts: [{
          operatingCompanyId: "oc-ww",
          realmId: "realm-1",
          quickBooksCustomerId: "1001",
          email: null,
          phone: null,
          billingAddress: null,
          shippingAddress: null
        }]
      }
    ]);

    const report = await reconcileQuickBooksIdentityMatches(ADMIN, {});

    expect(report.totals.autoLinked).toBe(1);
    expect(prismaTest.model("customerIdentityMatch").update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ score: 100 }) })
    );
  });

  it("derives score 100 from tenant- and operating-company-scoped approved stable-ID evidence", async () => {
    prismaTest.model("customerIdentityMatch").findMany
      .mockResolvedValueOnce([PROPOSED_MATCH])
      .mockResolvedValueOnce([{
        companyId: "company-1",
        operatingCompanyId: "oc-ww",
        sourceRecordKey: "realm-1:1001"
      }]);

    const report = await reconcileQuickBooksIdentityMatches(ADMIN, {});

    expect(report.totals.autoLinked).toBe(1);
    expect(prismaTest.model("customerIdentityMatch").update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ score: 100 }) })
    );
    const stableRead = prismaTest.model("customerIdentityMatch").findMany.mock.calls[1][0] as {
      where: Record<string, unknown>;
    };
    expect(stableRead.where).toMatchObject({
      tenantId: "tenant-a",
      kind: CustomerIdentityMatchKind.QUICKBOOKS_ACCOUNT,
      status: CustomerIdentityMatchStatus.APPROVED
    });
  });

  it("excludes a high-confidence company related only to another operating company", async () => {
    prismaTest.model("companyOperatingRelationship").findMany.mockImplementation(
      ({ where }: { where: { operatingCompanyId?: string } }) =>
        where.operatingCompanyId === "oc-ww"
          ? [{ companyId: "company-local", operatingCompanyId: "oc-ww" }]
          : [{ companyId: "company-foreign", operatingCompanyId: "oc-usa" }]
    );
    prismaTest.model("company").findMany.mockResolvedValue([
      {
        id: "company-foreign",
        name: "Blue Peak Packaging",
        domain: "bluepeak.example",
        customerSourceAccounts: []
      },
      {
        id: "company-local",
        name: "Unrelated Local Company",
        domain: "local.example",
        customerSourceAccounts: []
      }
    ]);

    const report = await reconcileQuickBooksIdentityMatches(ADMIN, {});

    expect(report.totals.autoLinked).toBe(0);
    expect(report.totals.routedToReview).toBe(1);
    expect(prismaTest.model("customerIdentityMatch").update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: CustomerIdentityMatchStatus.PROPOSED,
          candidateCompanyId: null,
          score: 0
        })
      })
    );
    expect(prismaTest.model("companyOperatingRelationship").findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ tenantId: "tenant-a", operatingCompanyId: "oc-ww" })
      })
    );
  });

  it("ignores an exact persisted mapping owned by another operating company", async () => {
    const evidenceWithoutIdentity = {
      ...PROPOSED_MATCH,
      evidence: { source: "QUICKBOOKS" }
    };
    prismaTest.model("customerIdentityMatch").findMany.mockResolvedValueOnce([
      evidenceWithoutIdentity
    ]);
    prismaTest.model("customerIdentityMatch").findUnique.mockResolvedValue({
      ...evidenceWithoutIdentity,
      tenantId: "tenant-a",
      kind: CustomerIdentityMatchKind.QUICKBOOKS_ACCOUNT,
      status: CustomerIdentityMatchStatus.PROPOSED
    });
    prismaTest.model("company").findMany.mockResolvedValue([
      {
        id: "company-1",
        name: "Blue Peak Packaging",
        domain: null,
        customerSourceAccounts: [
          {
            operatingCompanyId: "oc-usa",
            realmId: "realm-1",
            quickBooksCustomerId: "1001",
            email: null,
            phone: null,
            billingAddress: null,
            shippingAddress: null
          }
        ]
      }
    ]);

    const report = await reconcileQuickBooksIdentityMatches(ADMIN, {});

    expect(report.totals.autoLinked).toBe(0);
    expect(report.totals.routedToReview).toBe(1);
    expect(prismaTest.model("customerIdentityMatch").update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ score: 0 }) })
    );
  });

  it("does not use another operating company's source-account domain to auto-link", async () => {
    prismaTest.model("company").findMany.mockResolvedValue([
      {
        id: "company-1",
        name: "Blue Peak Packaging",
        domain: null,
        customerSourceAccounts: [
          {
            operatingCompanyId: "oc-usa",
            realmId: "realm-other",
            quickBooksCustomerId: "other-customer",
            email: "accounts@bluepeak.example",
            phone: null,
            billingAddress: null,
            shippingAddress: null
          }
        ]
      }
    ]);

    const report = await reconcileQuickBooksIdentityMatches(ADMIN, {});

    expect(report.totals.autoLinked).toBe(0);
    expect(report.totals.routedToReview).toBe(1);
    expect(prismaTest.model("customerIdentityMatch").update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: CustomerIdentityMatchStatus.PROPOSED,
          score: 0
        })
      })
    );
  });

  it("ignores approved stable-ID evidence from another operating company", async () => {
    const evidenceWithoutIdentity = {
      ...PROPOSED_MATCH,
      evidence: { source: "QUICKBOOKS" }
    };
    prismaTest.model("customerIdentityMatch").findMany.mockImplementation(
      ({ where }: { where: { status?: CustomerIdentityMatchStatus; operatingCompanyId?: string } }) => {
        if (where.status === CustomerIdentityMatchStatus.PROPOSED) {
          return [evidenceWithoutIdentity];
        }
        return where.operatingCompanyId === "oc-ww"
          ? []
          : [
              {
                companyId: "company-1",
                operatingCompanyId: "oc-usa",
                sourceRecordKey: "realm-1:1001"
              }
            ];
      }
    );
    prismaTest.model("customerIdentityMatch").findUnique.mockResolvedValue({
      ...evidenceWithoutIdentity,
      tenantId: "tenant-a",
      kind: CustomerIdentityMatchKind.QUICKBOOKS_ACCOUNT,
      status: CustomerIdentityMatchStatus.PROPOSED
    });
    prismaTest.model("company").findMany.mockResolvedValue([
      {
        id: "company-1",
        name: "Blue Peak Packaging",
        domain: null,
        customerSourceAccounts: []
      }
    ]);

    const report = await reconcileQuickBooksIdentityMatches(ADMIN, {});

    expect(report.totals.autoLinked).toBe(0);
    expect(report.totals.routedToReview).toBe(1);
    expect(prismaTest.model("customerIdentityMatch").update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ score: 0 }) })
    );
    const stableRead = prismaTest.model("customerIdentityMatch").findMany.mock.calls.find(
      ([arg]) =>
        (arg as { where?: { status?: CustomerIdentityMatchStatus } }).where?.status ===
        CustomerIdentityMatchStatus.APPROVED
    )?.[0] as { where: Record<string, unknown> } | undefined;
    expect(stableRead?.where).toMatchObject({
      tenantId: "tenant-a",
      operatingCompanyId: "oc-ww",
      status: CustomerIdentityMatchStatus.APPROVED
    });
  });

  it("uses candidate shipping-address street evidence at score 92", async () => {
    const shippingMatch = {
      ...PROPOSED_MATCH,
      evidence: {
        displayName: "Blue Peak Packaging Inc.",
        shippingAddress: { Line1: "1200 Example Rd.", City: "Mississauga" }
      }
    };
    prismaTest.model("customerIdentityMatch").findMany.mockResolvedValueOnce([shippingMatch]);
    prismaTest.model("customerIdentityMatch").findUnique.mockResolvedValue({
      ...shippingMatch,
      tenantId: "tenant-a",
      kind: CustomerIdentityMatchKind.QUICKBOOKS_ACCOUNT,
      status: CustomerIdentityMatchStatus.PROPOSED
    });
    prismaTest.model("company").findMany.mockResolvedValue([{
      id: "company-1",
      name: "Blue Peak Packaging",
      domain: null,
      customerSourceAccounts: [{
        operatingCompanyId: "oc-ww",
        realmId: "different-realm",
        quickBooksCustomerId: "different-id",
        email: null,
        phone: null,
        billingAddress: null,
        shippingAddress: { Line1: "1200 Example Rd.", Country: "Canada" }
      }]
    }]);

    const report = await reconcileQuickBooksIdentityMatches(ADMIN, {});
    expect(report.totals.autoLinked).toBe(1);
    expect(prismaTest.model("customerIdentityMatch").update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ score: 92 }) })
    );
  });

  it("routes a tied best score to the review queue (PROPOSED, never approved)", async () => {
    prismaTest.model("company").findMany.mockResolvedValue([
      {
        id: "company-1",
        name: "Blue Peak Packaging",
        domain: "bluepeak.example",
        customerSourceAccounts: [{ operatingCompanyId: "oc-ww", phone: "416-555-0134", email: null, billingAddress: null }]
      },
      {
        id: "company-2",
        name: "Blue Peak Packaging Inc Logistics",
        domain: "bluepeak.example",
        customerSourceAccounts: [{ operatingCompanyId: "oc-ww", phone: "416-555-0134", email: null, billingAddress: null }]
      }
    ]);
    prismaTest.model("companyOperatingRelationship").findMany.mockResolvedValue([
      { companyId: "company-1", operatingCompanyId: "oc-ww" },
      { companyId: "company-2", operatingCompanyId: "oc-ww" }
    ]);

    const report = await reconcileQuickBooksIdentityMatches(ADMIN, {});

    expect(report.totals.evaluated).toBe(1);
    expect(report.totals.routedToReview).toBe(1);
    expect(report.totals.autoLinked).toBe(0);

    const updateArg = prismaTest.model("customerIdentityMatch").update.mock.calls[0][0] as {
      data: Record<string, unknown>;
    };
    // Ambiguity keeps the record PROPOSED without a suggested target.
    expect(updateArg.data.status).toBe(CustomerIdentityMatchStatus.PROPOSED);
    expect(updateArg.data.candidateCompanyId).toBeNull();
    expect(updateArg.data.companyId).toBeUndefined();
    expect(auditActions()).toEqual([
      "customer-intelligence.identity-match.deferred",
      "customer-intelligence.identity-reconciliation.run"
    ]);
    const deferral = prismaTest.model("auditLog").create.mock.calls[0][0] as {
      data: { tenantId: string; after: { reason: string } };
    };
    expect(deferral.data).toMatchObject({
      tenantId: "tenant-a",
      after: { reason: "AMBIGUOUS" }
    });
  });

  it("keeps a below-threshold match PROPOSED without inventing a canonical target", async () => {
    prismaTest.model("company").findMany.mockResolvedValue([
      {
        id: "company-1",
        name: "Blue Peak Packaging",
        domain: "other.example",
        customerSourceAccounts: []
      }
    ]);

    const report = await reconcileQuickBooksIdentityMatches(ADMIN, {});

    expect(report.totals.routedToReview).toBe(1);
    const updateArg = prismaTest.model("customerIdentityMatch").update.mock.calls[0][0] as {
      data: Record<string, unknown>;
    };
    expect(updateArg.data.status).toBe(CustomerIdentityMatchStatus.PROPOSED);
    expect(updateArg.data.companyId).toBeUndefined();
    expect(updateArg.data.candidateCompanyId).toBeNull();
    expect(auditActions()).toEqual([
      "customer-intelligence.identity-match.deferred",
      "customer-intelligence.identity-reconciliation.run"
    ]);
    expect(
      (prismaTest.model("auditLog").create.mock.calls[0][0] as {
        data: { after: { reason: string } };
      }).data.after.reason
    ).toBe("BELOW_THRESHOLD");
  });

  it("keeps a match with no canonical candidate PROPOSED (CP-02B-3-Q1 MANUAL_ONLY)", async () => {
    prismaTest.model("companyOperatingRelationship").findMany.mockResolvedValue([]);
    prismaTest.model("company").findMany.mockResolvedValue([]);

    const report = await reconcileQuickBooksIdentityMatches(ADMIN, {});

    expect(report.totals.routedToReview).toBe(1);
    expect(report.totals.autoLinked).toBe(0);
    const updateArg = prismaTest.model("customerIdentityMatch").update.mock.calls[0][0] as {
      data: Record<string, unknown>;
    };
    // Approval without a tenant-valid companyId stays impossible.
    expect(updateArg.data.companyId).toBeUndefined();
    expect(updateArg.data.status).toBe(CustomerIdentityMatchStatus.PROPOSED);
    // No canonical Company was created or approved.
    expect(prismaTest.model("company").create).not.toHaveBeenCalled();
    expect(prismaTest.model("customerIdentityMatch").create).not.toHaveBeenCalled();
    expect(
      (prismaTest.model("auditLog").create.mock.calls[0][0] as {
        data: { after: { reason: string } };
      }).data.after.reason
    ).toBe("NO_CANDIDATE");
  });

  it("counts a relationship-less tenant company when deciding domain uniqueness", async () => {
    prismaTest.model("company").findMany.mockResolvedValue([
      {
        id: "company-1",
        name: "Blue Peak Packaging",
        domain: "bluepeak.example",
        customerSourceAccounts: []
      },
      {
        id: "company-without-relationship",
        name: "Unrelated Canonical Company",
        domain: "bluepeak.example",
        customerSourceAccounts: []
      }
    ]);

    const report = await reconcileQuickBooksIdentityMatches(ADMIN, {});

    expect(report.totals.autoLinked).toBe(0);
    expect(report.totals.routedToReview).toBe(1);
    const updateArg = prismaTest.model("customerIdentityMatch").update.mock.calls[0][0] as {
      data: Record<string, unknown>;
    };
    expect(updateArg.data.status).toBe(CustomerIdentityMatchStatus.PROPOSED);
    expect(updateArg.data.score).toBe(0);
  });

  it("audits a conflicting-approval deferral atomically", async () => {
    prismaTest.model("customerIdentityMatch").findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: "approved-under-another-operating-company",
        companyId: "company-2",
        status: CustomerIdentityMatchStatus.APPROVED
      });

    const report = await reconcileQuickBooksIdentityMatches(ADMIN, {});

    expect(report.totals.routedToReview).toBe(1);
    expect(report.totals.autoLinked).toBe(0);
    expect(
      (prismaTest.model("auditLog").create.mock.calls[0][0] as {
        data: { after: { reason: string } };
      }).data.after.reason
    ).toBe("APPROVED_CONFLICT");
  });

  it.each([
    ["partial", { displayName: "Blue Peak Packaging Inc." }],
    ["completely missing", {}]
  ])("keeps %s QuickBooks evidence PROPOSED", async (_label, evidence) => {
    const sparseMatch = { ...PROPOSED_MATCH, evidence };
    prismaTest.model("customerIdentityMatch").findMany.mockResolvedValue([sparseMatch]);
    prismaTest.model("customerIdentityMatch").findUnique.mockResolvedValue({
      ...sparseMatch,
      tenantId: "tenant-a",
      kind: CustomerIdentityMatchKind.QUICKBOOKS_ACCOUNT,
      status: CustomerIdentityMatchStatus.PROPOSED
    });
    prismaTest.model("company").findMany.mockResolvedValue([
      {
        id: "company-1",
        name: "Blue Peak Packaging",
        domain: "bluepeak.example",
        customerSourceAccounts: []
      }
    ]);

    const report = await reconcileQuickBooksIdentityMatches(ADMIN, {});

    expect(report.totals.routedToReview).toBe(1);
    expect(report.totals.autoLinked).toBe(0);
    expect(prismaTest.model("customerIdentityMatch").update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.not.objectContaining({ status: CustomerIdentityMatchStatus.APPROVED })
      })
    );
  });

  it.each(["oc-owned-by-b", "oc-does-not-exist"])(
    "rejects invalid reconciliation operatingCompanyId %s before writes or audit",
    async (operatingCompanyId) => {
      prismaTest.model("operatingCompany").findFirst.mockResolvedValue(null);

      await expect(
        reconcileQuickBooksIdentityMatches(ADMIN, { operatingCompanyId })
      ).rejects.toThrow(/Operating company does not exist in this tenant/);

      expect(prismaTest.model("customerIdentityMatch").findMany).not.toHaveBeenCalled();
      expect(prismaTest.model("auditLog").create).not.toHaveBeenCalled();
      assertNoDatabaseWrites();
    }
  );

  it("rolls back an automatic approval when its audit write fails", async () => {
    prismaTest.model("auditLog").create.mockRejectedValueOnce(new Error("synthetic audit failure"));

    const report = await reconcileQuickBooksIdentityMatches(ADMIN, {});

    expect(report.totals.errors).toBe(1);
    expect(report.totals.autoLinked).toBe(0);
    expect(prismaTest.transaction).toHaveBeenCalled();
    expect(prismaTest.model("customerIdentityMatch").update).toHaveBeenCalled();
  });

  it("preserves a reviewed decision on re-run (REVIEWED_PRESERVED, no rewrite)", async () => {
    prismaTest.model("customerIdentityMatch").findFirst.mockResolvedValue({
      id: "match-approved",
      tenantId: "tenant-a",
      kind: CustomerIdentityMatchKind.QUICKBOOKS_ACCOUNT,
      companyId: "company-1",
      operatingCompanyId: "oc-ww",
      sourceRecordKey: "realm-1:1001",
      status: CustomerIdentityMatchStatus.APPROVED
    });

    const report = await reconcileQuickBooksIdentityMatches(ADMIN, {});

    expect(report.totals.reviewedPreserved).toBe(1);
    expect(report.totals.autoLinked).toBe(0);
    expect(report.totals.routedToReview).toBe(0);
    expect(prismaTest.model("customerIdentityMatch").update).not.toHaveBeenCalled();
    expect(prismaTest.model("customerIdentityMatch").create).not.toHaveBeenCalled();
    expect(prismaTest.transaction).toHaveBeenCalledTimes(1);
    expect(prismaTest.queryRaw).toHaveBeenCalledTimes(1);
  });

  it("re-runs are idempotent: only PROPOSED matches are evaluated again", async () => {
    const first = await reconcileQuickBooksIdentityMatches(ADMIN, {});
    expect(first.totals.autoLinked).toBe(1);

    // After the first run the source is APPROVED, so a re-run finds nothing
    // left PROPOSED and makes no state-changing writes.
    prismaTest.model("customerIdentityMatch").findMany.mockResolvedValue([]);
    prismaTest.model("customerIdentityMatch").update.mockClear();

    const second = await reconcileQuickBooksIdentityMatches(ADMIN, {});
    expect(second.totals.evaluated).toBe(0);
    expect(second.totals.autoLinked).toBe(0);
    expect(prismaTest.model("customerIdentityMatch").update).not.toHaveBeenCalled();
  });

  it("fails closed when a candidate company is not in the tenant (cross-tenant rejected)", async () => {
    prismaTest.model("company").findMany.mockResolvedValue([
      {
        id: "company-owned-by-b",
        name: "Blue Peak Packaging",
        domain: "bluepeak.example",
        customerSourceAccounts: []
      }
    ]);
    // The candidate batch is built from the tenant's relationships, so the
    // relationship must point at the foreign company for the scorer to
    // auto-link to it and exercise the shared invariant validator.
    prismaTest.model("companyOperatingRelationship").findMany.mockResolvedValue([
      { companyId: "company-owned-by-b", operatingCompanyId: "oc-ww" }
    ]);
    // The shared invariant validator rejects the foreign-tenant company.
    prismaTest.model("company").findFirst.mockResolvedValue(null);

    const report = await reconcileQuickBooksIdentityMatches(ADMIN, {});

    expect(report.totals.errors).toBe(1);
    expect(report.totals.autoLinked).toBe(0);
    expect(report.totals.routedToReview).toBe(0);
    const approvedWrites = prismaTest.model("customerIdentityMatch").update.mock.calls.filter(
      ([arg]) =>
        (arg as { data: Record<string, unknown> }).data.status ===
        CustomerIdentityMatchStatus.APPROVED
    );
    expect(approvedWrites).toEqual([]);
  });

  it("uses the shared transaction-scoped advisory lock for each source", async () => {
    await reconcileQuickBooksIdentityMatches(ADMIN, {});
    expect(prismaTest.transaction).toHaveBeenCalledTimes(1);
    expect(prismaTest.queryRaw).toHaveBeenCalledTimes(1);
    const lockSql = prismaTest.queryRaw.mock.calls[0][0] as Prisma.Sql;
    expect(lockSql.text).toContain("pg_advisory_xact_lock");
  });
});

describe("permissions: reconciliation and review are ADMIN/FINANCE-only mutations", () => {
  beforeEach(() => {
    prismaTest.reset();
    configureAuth();
  });

  it("denies MANAGER, SALES, OPERATIONS, and READ_ONLY before any write", async () => {
    const denied: Array<[string, AuthenticatedContext]> = [
      ["MANAGER", MANAGER],
      ["SALES", SALES],
      ["OPERATIONS", OPERATIONS],
      ["READ_ONLY", READ_ONLY]
    ];

    for (const [name, role] of denied) {
      prismaTest.reset();
      configureAuth();
      await expect(
        runIdentityReconciliation(role, {}),
        `${name} must be denied on reconciliation`
      ).rejects.toBeInstanceOf(AuthorizationError);
      assertNoDatabaseWrites();

      prismaTest.reset();
      configureAuth();
      await expect(
        reviewIdentityMatch(role, "match-1", "APPROVE", { companyId: "company-1" }),
        `${name} must be denied on approve`
      ).rejects.toBeInstanceOf(AuthorizationError);
      assertNoDatabaseWrites();

      prismaTest.reset();
      configureAuth();
      await expect(
        reviewIdentityMatch(role, "match-1", "REJECT"),
        `${name} must be denied on reject`
      ).rejects.toBeInstanceOf(AuthorizationError);
      assertNoDatabaseWrites();

      prismaTest.reset();
      configureAuth();
      await expect(
        reviewIdentityMatch(role, "match-1", "DEFER"),
        `${name} must be denied on defer`
      ).rejects.toBeInstanceOf(AuthorizationError);
      assertNoDatabaseWrites();

      prismaTest.reset();
      configureAuth();
      await expect(
        approveIdentityMatchWithNewCompany(role, "match-1", {
          companyName: "Synthetic Canonical Company",
          confirmation: "CREATE_AND_APPROVE"
        }),
        `${name} must be denied on explicit Company creation`
      ).rejects.toBeInstanceOf(AuthorizationError);
      assertNoDatabaseWrites();
    }
  });

  it("allows FINANCE through the same mutation gate as ADMIN", async () => {
    prismaTest.model("customerIdentityMatch").findMany.mockResolvedValue([]);
    prismaTest.model("companyOperatingRelationship").findMany.mockResolvedValue([]);
    prismaTest.model("company").findMany.mockResolvedValue([]);

    const report = await runIdentityReconciliation(FINANCE, {});
    expect(report.totals.evaluated).toBe(0);
  });
});

describe("explicit reviewer-approved canonical Company creation", () => {
  const proposed = {
    ...PROPOSED_MATCH,
    tenantId: "tenant-a",
    kind: CustomerIdentityMatchKind.QUICKBOOKS_ACCOUNT,
    status: CustomerIdentityMatchStatus.PROPOSED
  };

  beforeEach(() => {
    prismaTest.reset();
    configureAuth();
    prismaTest.model("customerIdentityMatch").findFirst.mockImplementation(
      ({ where }: { where: Record<string, unknown> }) =>
        typeof where.id === "string" ? Promise.resolve(proposed) : Promise.resolve(null)
    );
    prismaTest.model("operatingCompany").findFirst.mockResolvedValue({ id: "oc-ww" });
    prismaTest.model("company").findFirst.mockResolvedValue(null);
    prismaTest.model("company").create.mockResolvedValue({
      id: "company-created",
      tenantId: "tenant-a",
      name: "Synthetic Canonical Company",
      normalizedName: "synthetic-canonical-company",
      domain: "synthetic.example"
    });
    prismaTest.model("companyOperatingRelationship").create.mockResolvedValue({
      id: "relationship-created",
      tenantId: "tenant-a",
      companyId: "company-created",
      operatingCompanyId: "oc-ww"
    });
    prismaTest.model("customerIdentityMatch").update.mockResolvedValue({
      ...proposed,
      companyId: "company-created",
      candidateCompanyId: "company-created",
      status: CustomerIdentityMatchStatus.APPROVED
    });
  });

  it("atomically creates a tenant Company, relationship, approved decision, and audits", async () => {
    const result = await approveIdentityMatchWithNewCompany(ADMIN, "match-1", {
      companyName: "Synthetic Canonical Company",
      domain: "synthetic.example",
      operatingCompanyId: "oc-ww",
      note: "Reviewed source evidence",
      confirmation: "CREATE_AND_APPROVE"
    });

    expect(result.match.status).toBe(CustomerIdentityMatchStatus.APPROVED);
    expect(prismaTest.transaction).toHaveBeenCalledTimes(1);
    expect(prismaTest.model("company").create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: "tenant-a",
        name: "Synthetic Canonical Company",
        normalizedName: "synthetic-canonical-company"
      })
    });
    expect(prismaTest.model("companyOperatingRelationship").create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: "tenant-a",
        companyId: "company-created",
        operatingCompanyId: "oc-ww"
      })
    });
    expect(prismaTest.model("customerIdentityMatch").update).toHaveBeenCalledWith({
      where: { tenantId_id: { tenantId: "tenant-a", id: "match-1" } },
      data: expect.objectContaining({
        companyId: "company-created",
        operatingCompanyId: "oc-ww",
        status: CustomerIdentityMatchStatus.APPROVED,
        reviewerUserId: "user-1"
      })
    });
    expect(
      prismaTest.model("auditLog").create.mock.calls.map(
        ([arg]) => (arg as { data: { action: string } }).data.action
      )
    ).toEqual([
      "customer-intelligence.company.created-from-identity-review",
      "customer-intelligence.relationship.created",
      "customer-intelligence.identity-match.approved"
    ]);
  });

  it("routes the confirmed server action through the guarded creation workflow", async () => {
    vi.mocked(tenantContext.getAuthenticatedContext).mockResolvedValue(ADMIN);
    const formData = new FormData();
    formData.set("matchId", "match-1");
    formData.set("companyName", "Synthetic Canonical Company");
    formData.set("operatingCompanyId", "oc-ww");
    formData.set("approvalConfirmation", "CREATE_AND_APPROVE");

    const state = await createAndApproveIdentityCompanyAction({ status: "idle" }, formData);

    expect(state).toEqual({
      status: "success",
      message: "Canonical company created and identity match approved."
    });
    expect(prismaTest.model("company").create).toHaveBeenCalledTimes(1);
  });

  it("keeps the UI creation path explicit and does not prefill the canonical name", () => {
    const source = readFileSync(
      new URL(
        "../src/modules/customer-intelligence/components/identity-review-actions.tsx",
        import.meta.url
      ),
      "utf8"
    );
    expect(source).toContain('name="companyName"');
    expect(source).not.toMatch(/name="companyName"[\s\S]{0,160}defaultValue=/);
    expect(source).toContain('name="approvalConfirmation"');
    expect(source).toContain('value="CREATE_AND_APPROVE"');
    expect(source).toContain("Create company and approve");
  });

  it("requires explicit confirmation and never falls back to the QuickBooks source name", async () => {
    await expect(
      approveIdentityMatchWithNewCompany(ADMIN, "match-1", {
        companyName: "   ",
        confirmation: "CREATE_AND_APPROVE"
      })
    ).rejects.toThrow(/Canonical company name is required/);
    expect(prismaTest.model("company").create).not.toHaveBeenCalled();
  });

  it("rejects a cross-tenant operating company before any Company is created", async () => {
    prismaTest.model("customerIdentityMatch").findFirst.mockResolvedValue({
      ...proposed,
      operatingCompanyId: null
    });
    prismaTest.model("operatingCompany").findFirst.mockResolvedValue(null);

    await expect(
      approveIdentityMatchWithNewCompany(ADMIN, "match-1", {
        companyName: "Synthetic Canonical Company",
        operatingCompanyId: "oc-owned-by-b",
        confirmation: "CREATE_AND_APPROVE"
      })
    ).rejects.toThrow(/Operating company does not exist in this tenant/);
    expect(prismaTest.model("company").create).not.toHaveBeenCalled();
    expect(prismaTest.model("auditLog").create).not.toHaveBeenCalled();
  });

  it("does not commit Company creation or approval without all audit evidence", async () => {
    prismaTest.model("auditLog").create.mockRejectedValueOnce(new Error("synthetic audit failure"));

    await expect(
      approveIdentityMatchWithNewCompany(ADMIN, "match-1", {
        companyName: "Synthetic Canonical Company",
        confirmation: "CREATE_AND_APPROVE"
      })
    ).rejects.toThrow(/synthetic audit failure/);
    expect(prismaTest.transaction).toHaveBeenCalledTimes(1);
    expect(prismaTest.model("company").create).toHaveBeenCalledTimes(1);
    expect(prismaTest.model("customerIdentityMatch").update).toHaveBeenCalledTimes(1);
  });
});

describe("reviewIdentityMatch DEFER and target assignment", () => {
  beforeEach(() => {
    prismaTest.reset();
    configureAuth();
  });

  it("defers a match back to PROPOSED, clears reviewer fields, and audits", async () => {
    prismaTest.model("customerIdentityMatch").findFirst.mockResolvedValue({
      id: "match-1",
      tenantId: "tenant-a",
      kind: CustomerIdentityMatchKind.QUICKBOOKS_ACCOUNT,
      companyId: "company-1",
      operatingCompanyId: "oc-ww",
      sourceRecordKey: "realm-1:1001",
      status: CustomerIdentityMatchStatus.APPROVED,
      evidence: { source: "QUICKBOOKS" }
    });
    prismaTest.model("customerIdentityMatch").update.mockImplementation(
      ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => ({
        id: (where.tenantId_id as { id?: string } | null | undefined)?.id ?? "match-1",
        ...data
      })
    );

    const updated = await reviewIdentityMatch(ADMIN, "match-1", "DEFER", {
      note: "Waiting for domain verification"
    });

    expect(updated.status).toBe(CustomerIdentityMatchStatus.PROPOSED);
    const updateArg = prismaTest.model("customerIdentityMatch").update.mock.calls[0][0] as {
      data: Record<string, unknown>;
    };
    expect(updateArg.data.status).toBe(CustomerIdentityMatchStatus.PROPOSED);
    expect(updateArg.data.reviewerUserId).toBeNull();
    expect(updateArg.data.reviewedAt).toBeNull();
    expect((updateArg.data.evidence as Record<string, unknown>).reviewNote).toBe(
      "Waiting for domain verification"
    );
    const audit = prismaTest.model("auditLog").create.mock.calls[0][0] as {
      data: Record<string, unknown>;
    };
    expect(audit.data.action).toBe("customer-intelligence.identity-match.deferred");
    expect(audit.data.tenantId).toBe("tenant-a");
  });

  it("approves with an explicitly selected tenant-valid canonical company", async () => {
    const match = {
      id: "match-1",
      tenantId: "tenant-a",
      kind: CustomerIdentityMatchKind.QUICKBOOKS_ACCOUNT,
      companyId: null,
      operatingCompanyId: "oc-ww",
      sourceRecordKey: "realm-1:1001",
      status: CustomerIdentityMatchStatus.PROPOSED,
      evidence: { source: "QUICKBOOKS" }
    };
    prismaTest.model("customerIdentityMatch").findFirst.mockImplementation(
      ({ where }: { where: Record<string, unknown> }) =>
        // Only the initial review lookup carries a scalar `id`. The conflict
        // lookup carries `id: { not: ... }` and must not resolve to this match.
        typeof where.id === "string" && where.id === "match-1"
          ? Promise.resolve(match)
          : Promise.resolve(null)
    );
    prismaTest.model("company").findFirst.mockResolvedValue({ id: "company-1" });
    prismaTest.model("operatingCompany").findFirst.mockResolvedValue({ id: "oc-ww" });
    prismaTest.model("customerIdentityMatch").update.mockImplementation(
      ({ data }: { data: Record<string, unknown> }) => ({ id: "match-1", ...data })
    );

    const updated = await reviewIdentityMatch(ADMIN, "match-1", "APPROVE", {
      companyId: "company-1"
    });

    expect(updated.status).toBe(CustomerIdentityMatchStatus.APPROVED);
    const updateArg = prismaTest.model("customerIdentityMatch").update.mock.calls[0][0] as {
      data: Record<string, unknown>;
    };
    expect(updateArg.data).toMatchObject({
      status: CustomerIdentityMatchStatus.APPROVED,
      companyId: "company-1",
      operatingCompanyId: "oc-ww"
    });
    const audit = prismaTest.model("auditLog").create.mock.calls[0][0] as {
      data: Record<string, unknown>;
    };
    expect(audit.data.action).toBe("customer-intelligence.identity-match.approved");
    expect(prismaTest.transaction).toHaveBeenCalledTimes(1);
    expect(prismaTest.queryRaw).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["APPROVE" as const, { companyId: "company-1" }, "customer-intelligence.identity-match.approved"],
    ["REJECT" as const, {}, "customer-intelligence.identity-match.rejected"],
    ["DEFER" as const, {}, "customer-intelligence.identity-match.deferred"]
  ])("does not commit %s without its audit evidence", async (decision, input, expectedAction) => {
    const match = {
      ...PROPOSED_MATCH,
      tenantId: "tenant-a",
      kind: CustomerIdentityMatchKind.QUICKBOOKS_ACCOUNT,
      status: CustomerIdentityMatchStatus.PROPOSED
    };
    prismaTest.model("customerIdentityMatch").findFirst.mockImplementation(
      ({ where }: { where: Record<string, unknown> }) =>
        typeof where.id === "string" ? Promise.resolve(match) : Promise.resolve(null)
    );
    prismaTest.model("company").findFirst.mockResolvedValue({ id: "company-1" });
    prismaTest.model("operatingCompany").findFirst.mockResolvedValue({ id: "oc-ww" });
    prismaTest.model("customerIdentityMatch").update.mockResolvedValue({
      ...match,
      status:
        decision === "APPROVE"
          ? CustomerIdentityMatchStatus.APPROVED
          : decision === "REJECT"
            ? CustomerIdentityMatchStatus.REJECTED
            : CustomerIdentityMatchStatus.PROPOSED
    });
    prismaTest.model("auditLog").create.mockRejectedValueOnce(new Error("synthetic audit failure"));

    await expect(reviewIdentityMatch(ADMIN, "match-1", decision, input)).rejects.toThrow(
      /synthetic audit failure/
    );
    expect(prismaTest.transaction).toHaveBeenCalledTimes(1);
    expect(prismaTest.model("customerIdentityMatch").update).toHaveBeenCalledTimes(1);
    expect(
      (prismaTest.model("auditLog").create.mock.calls[0][0] as {
        data: { action: string };
      }).data.action
    ).toBe(expectedAction);
  });

  it("rejects a cross-tenant companyId before any status update", async () => {
    prismaTest.model("customerIdentityMatch").findFirst.mockResolvedValue({
      id: "match-1",
      tenantId: "tenant-a",
      kind: CustomerIdentityMatchKind.QUICKBOOKS_ACCOUNT,
      companyId: null,
      operatingCompanyId: "oc-ww",
      sourceRecordKey: "realm-1:1001",
      status: CustomerIdentityMatchStatus.PROPOSED,
      evidence: { source: "QUICKBOOKS" }
    });
    // The foreign company does not exist in this tenant.
    prismaTest.model("company").findFirst.mockResolvedValue(null);

    await expect(
      reviewIdentityMatch(ADMIN, "match-1", "APPROVE", { companyId: "company-owned-by-b" })
    ).rejects.toThrow(/Company does not exist in this tenant/);
    expect(prismaTest.model("customerIdentityMatch").update).not.toHaveBeenCalled();
    expect(prismaTest.model("auditLog").create).not.toHaveBeenCalled();
  });

  it("rejects a cross-tenant operatingCompanyId on approval", async () => {
    prismaTest.model("customerIdentityMatch").findFirst.mockResolvedValue({
      id: "match-1",
      tenantId: "tenant-a",
      kind: CustomerIdentityMatchKind.QUICKBOOKS_ACCOUNT,
      companyId: "company-1",
      operatingCompanyId: null,
      sourceRecordKey: "realm-1:1001",
      status: CustomerIdentityMatchStatus.PROPOSED,
      evidence: { source: "QUICKBOOKS" }
    });
    prismaTest.model("company").findFirst.mockResolvedValue({ id: "company-1" });
    prismaTest.model("operatingCompany").findFirst.mockResolvedValue(null);

    await expect(
      reviewIdentityMatch(ADMIN, "match-1", "APPROVE", { operatingCompanyId: "oc-owned-by-b" })
    ).rejects.toThrow(/Operating company does not exist in this tenant/);
    expect(prismaTest.model("customerIdentityMatch").update).not.toHaveBeenCalled();
  });

  it("rejects a cross-tenant companyId recorded on a rejection", async () => {
    prismaTest.model("customerIdentityMatch").findFirst.mockResolvedValue({
      id: "match-1",
      tenantId: "tenant-a",
      kind: CustomerIdentityMatchKind.QUICKBOOKS_ACCOUNT,
      companyId: null,
      operatingCompanyId: "oc-ww",
      sourceRecordKey: "realm-1:1001",
      status: CustomerIdentityMatchStatus.PROPOSED,
      evidence: { source: "QUICKBOOKS" }
    });
    prismaTest.model("company").findFirst.mockResolvedValue(null);

    await expect(
      reviewIdentityMatch(ADMIN, "match-1", "REJECT", { companyId: "company-owned-by-b" })
    ).rejects.toThrow(/Company does not exist in this tenant/);
    expect(prismaTest.model("customerIdentityMatch").update).not.toHaveBeenCalled();
  });
});

describe("review queue queries are tenant-scoped and leadership-only", () => {
  beforeEach(() => {
    prismaTest.reset();
    configureAuth();
  });

  it("lists only PROPOSED QUICKBOOKS_ACCOUNT matches for the caller's tenant", async () => {
    prismaTest.model("customerIdentityMatch").findMany.mockResolvedValue([PROPOSED_MATCH]);

    const rows = await getIdentityReviewQueue(ADMIN);

    const findArg = prismaTest.model("customerIdentityMatch").findMany.mock.calls[0][0] as {
      where: Record<string, unknown>;
    };
    expect(findArg.where.tenantId).toBe("tenant-a");
    expect(findArg.where.kind).toBe(CustomerIdentityMatchKind.QUICKBOOKS_ACCOUNT);
    expect(findArg.where.status).toBe(CustomerIdentityMatchStatus.PROPOSED);
    expect(rows).toHaveLength(1);
  });

  it("counts review states tenant-scoped", async () => {
    prismaTest.model("customerIdentityMatch").count.mockResolvedValue(3);

    const metrics = await getIdentityReviewMetrics(ADMIN);

    expect(metrics).toEqual({ proposed: 3, approved: 3, rejected: 3 });
    for (const [arg] of prismaTest.model("customerIdentityMatch").count.mock.calls) {
      expect((arg as { where: Record<string, unknown> }).where.tenantId).toBe("tenant-a");
    }
  });

  it("denies SALES, OPERATIONS, and READ_ONLY on the review queue", async () => {
    for (const role of [SALES, OPERATIONS, READ_ONLY]) {
      prismaTest.reset();
      configureAuth();
      await expect(getIdentityReviewQueue(role)).rejects.toBeInstanceOf(AuthorizationError);
    }
  });
});

describe("concurrent reconciliation backstop", () => {
  beforeEach(() => {
    prismaTest.reset();
    configureAuth();
    prismaTest.model("customerIdentityMatch").findMany.mockResolvedValue([PROPOSED_MATCH]);
    prismaTest.model("companyOperatingRelationship").findMany.mockResolvedValue([
      { companyId: "company-1", operatingCompanyId: "oc-ww" }
    ]);
    prismaTest.model("company").findMany.mockResolvedValue([
      {
        id: "company-1",
        name: "Blue Peak Packaging",
        domain: "bluepeak.example",
        customerSourceAccounts: []
      }
    ]);
    prismaTest.model("company").findFirst.mockResolvedValue({ id: "company-1" });
    prismaTest.model("operatingCompany").findFirst.mockResolvedValue({ id: "oc-ww" });
    prismaTest.model("customerIdentityMatch").findUnique.mockResolvedValue({
      ...PROPOSED_MATCH,
      tenantId: "tenant-a",
      kind: CustomerIdentityMatchKind.QUICKBOOKS_ACCOUNT,
      status: CustomerIdentityMatchStatus.PROPOSED
    });
  });

  it.each([
    ["partial", { source: "QUICKBOOKS", displayName: "Blue Peak Packaging Inc." }],
    ["completely missing", { source: "QUICKBOOKS" }]
  ])(
    "scores authoritative %s evidence after waiting for the ingestion lock",
    async (_label, refreshedEvidence) => {
      let row = {
        ...PROPOSED_MATCH,
        tenantId: "tenant-a",
        kind: CustomerIdentityMatchKind.QUICKBOOKS_ACCOUNT,
        status: CustomerIdentityMatchStatus.PROPOSED,
        evidence: PROPOSED_MATCH.evidence as Prisma.JsonValue
      };

      // The outer batch read sees high-confidence evidence. Before the locked
      // reconciliation callback runs, simulate ingestion winning the shared
      // source lock and refreshing that evidence. Old code scored before this
      // point and incorrectly auto-approved from the stale batch snapshot.
      prismaTest.transaction.mockImplementation(
        async (callback: (client: Record<string, unknown>) => unknown) => {
          row = { ...row, evidence: refreshedEvidence };
          return callback(prismaTest.proxy as Record<string, unknown>);
        }
      );
      prismaTest.model("customerIdentityMatch").findUnique.mockImplementation(() => ({ ...row }));
      prismaTest.model("customerIdentityMatch").update.mockImplementation(
        ({ data }: { data: Record<string, unknown> }) => {
          row = { ...row, ...data } as typeof row;
          return { ...row };
        }
      );

      const report = await reconcileQuickBooksIdentityMatches(ADMIN, {});

      expect(report.totals.autoLinked).toBe(0);
      expect(report.totals.routedToReview).toBe(1);
      expect(row.status).toBe(CustomerIdentityMatchStatus.PROPOSED);
      expect(row.companyId).toBeNull();
      expect(prismaTest.model("customerIdentityMatch").update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: CustomerIdentityMatchStatus.PROPOSED,
            score: 0
          })
        })
      );
    }
  );

  it("prevents concurrent reviewers from moving a newly assigned operating company", async () => {
    let row: Omit<typeof PROPOSED_MATCH, "operatingCompanyId"> & {
      tenantId: string;
      kind: CustomerIdentityMatchKind;
      operatingCompanyId: string | null;
      status: CustomerIdentityMatchStatus;
    } = {
      ...PROPOSED_MATCH,
      tenantId: "tenant-a",
      kind: CustomerIdentityMatchKind.QUICKBOOKS_ACCOUNT,
      operatingCompanyId: null,
      status: CustomerIdentityMatchStatus.PROPOSED
    };
    let transactionTail: Promise<unknown> = Promise.resolve();
    prismaTest.transaction.mockImplementation(
      (callback: (client: Record<string, unknown>) => unknown) => {
        const run = transactionTail.then(() => callback(prismaTest.proxy));
        transactionTail = run.then(
          () => undefined,
          () => undefined
        );
        return run;
      }
    );
    prismaTest.model("customerIdentityMatch").findFirst.mockImplementation(
      ({ where }: { where: Record<string, unknown> }) =>
        typeof where.id === "string" ? Promise.resolve({ ...row }) : Promise.resolve(null)
    );
    prismaTest.model("company").findFirst.mockResolvedValue({ id: "company-1" });
    prismaTest.model("operatingCompany").findFirst.mockImplementation(
      ({ where }: { where: { id: string } }) => ({ id: where.id })
    );
    prismaTest.model("customerIdentityMatch").update.mockImplementation(
      ({ data }: { data: Record<string, unknown> }) => {
        row = {
          ...row,
          ...data,
          operatingCompanyId:
            (data.operatingCompanyId as string | null | undefined) ?? row.operatingCompanyId,
          status:
            (data.status as CustomerIdentityMatchStatus | undefined) ?? row.status
        };
        return Promise.resolve({ ...row });
      }
    );

    const first = reviewIdentityMatch(ADMIN, "match-1", "APPROVE", {
      companyId: "company-1",
      operatingCompanyId: "oc-first"
    });
    const second = reviewIdentityMatch(ADMIN, "match-1", "APPROVE", {
      companyId: "company-1",
      operatingCompanyId: "oc-second"
    });
    const [firstResult, secondResult] = await Promise.allSettled([first, second]);

    expect(firstResult.status).toBe("fulfilled");
    expect(secondResult.status).toBe("rejected");
    if (secondResult.status === "rejected") {
      expect(secondResult.reason).toEqual(
        new Error("A QuickBooks identity match cannot be moved to another operating company.")
      );
    }
    expect(row.operatingCompanyId).toBe("oc-first");
    expect(prismaTest.model("customerIdentityMatch").update).toHaveBeenCalledTimes(1);
    expect(prismaTest.model("auditLog").create).toHaveBeenCalledTimes(1);
    expect(prismaTest.queryRaw).toHaveBeenCalledTimes(2);
  });

  it("returns the authoritative approved match when the one-approved index rejects a second approve", async () => {
    const approvedRow = {
      id: "existing-approved",
      tenantId: "tenant-a",
      kind: CustomerIdentityMatchKind.QUICKBOOKS_ACCOUNT,
      companyId: "company-1",
      operatingCompanyId: "oc-ww",
      sourceRecordKey: "realm-1:1001",
      status: CustomerIdentityMatchStatus.APPROVED
    };
    // Call order inside the locked transaction: reviewed lookup -> conflict
    // lookup -> post-P2002 authoritative lookup.
    prismaTest.model("customerIdentityMatch").findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(approvedRow);
    const uniqueViolation = new Prisma.PrismaClientKnownRequestError("conflict", {
      code: "P2002",
      clientVersion: "test"
    });
    prismaTest.model("customerIdentityMatch").update.mockRejectedValueOnce(uniqueViolation);

    const report = await reconcileQuickBooksIdentityMatches(ADMIN, {});

    expect(report.totals.reviewedPreserved).toBe(1);
    expect(report.totals.autoLinked).toBe(0);
    expect(report.totals.routedToReview).toBe(0);
    // Exactly one APPROVED update was attempted and the database rejected it;
    // the authoritative approved row won.
    expect(prismaTest.model("customerIdentityMatch").update).toHaveBeenCalledTimes(1);
    expect(
      prismaTest.model("auditLog").create.mock.calls.some(
        ([arg]) =>
          (arg as { data: { action: string; after: { reason?: string } } }).data.action ===
            "customer-intelligence.identity-match.deferred" &&
          (arg as { data: { after: { reason?: string } } }).data.after.reason ===
            "APPROVED_CONCURRENTLY"
      )
    ).toBe(true);
  });

  it("serializes malformed-record deferral so a simultaneous rejection is preserved", async () => {
    let row: Record<string, unknown> & { status: CustomerIdentityMatchStatus } = {
      ...PROPOSED_MATCH,
      tenantId: "tenant-a",
      kind: CustomerIdentityMatchKind.QUICKBOOKS_ACCOUNT,
      operatingCompanyId: null,
      sourceRecordKey: null,
      status: CustomerIdentityMatchStatus.PROPOSED
    };
    prismaTest.model("customerIdentityMatch").findMany.mockImplementation(
      ({ where }: { where: { status?: CustomerIdentityMatchStatus } }) =>
        Promise.resolve(where.status === CustomerIdentityMatchStatus.APPROVED ? [] : [{ ...row }])
    );
    prismaTest.model("companyOperatingRelationship").findMany.mockResolvedValue([]);
    prismaTest.model("company").findMany.mockResolvedValue([]);
    let transactionTail: Promise<unknown> = Promise.resolve();
    prismaTest.transaction.mockImplementation(
      (callback: (client: Record<string, unknown>) => unknown) => {
        const run = transactionTail.then(() => callback(prismaTest.proxy));
        transactionTail = run.then(() => undefined, () => undefined);
        return run;
      }
    );
    prismaTest.model("customerIdentityMatch").findFirst.mockImplementation(
      ({ where }: { where: Record<string, unknown> }) =>
        typeof where.id === "string" ? Promise.resolve({ ...row }) : Promise.resolve(null)
    );
    prismaTest.model("customerIdentityMatch").update.mockImplementation(
      ({ data }: { data: Record<string, unknown> }) => {
        row = {
          ...row,
          ...data,
          status: (data.status as CustomerIdentityMatchStatus | undefined) ?? row.status
        };
        return Promise.resolve({ ...row });
      }
    );

    const rejection = reviewIdentityMatch(ADMIN, "match-1", "REJECT");
    const reconciliation = reconcileQuickBooksIdentityMatches(ADMIN, {});
    const [reviewed, report] = await Promise.all([rejection, reconciliation]);

    expect(reviewed.status).toBe(CustomerIdentityMatchStatus.REJECTED);
    expect(row.status).toBe(CustomerIdentityMatchStatus.REJECTED);
    expect(report.totals.reviewedPreserved).toBe(1);
    const lockValues = prismaTest.queryRaw.mock.calls.map(([sql]) => (sql as Prisma.Sql).values);
    expect(lockValues[0]).toEqual(lockValues[1]);
  });

  it("serializes manual review with reconciliation so the reviewed decision wins", async () => {
    let row: typeof PROPOSED_MATCH & {
      tenantId: string;
      kind: CustomerIdentityMatchKind;
      status: CustomerIdentityMatchStatus;
    } = {
      ...PROPOSED_MATCH,
      tenantId: "tenant-a",
      kind: CustomerIdentityMatchKind.QUICKBOOKS_ACCOUNT,
      status: CustomerIdentityMatchStatus.PROPOSED
    };
    let transactionTail: Promise<unknown> = Promise.resolve();
    prismaTest.transaction.mockImplementation(
      (callback: (client: Record<string, unknown>) => unknown) => {
        const run = transactionTail.then(() => callback(prismaTest.proxy));
        transactionTail = run.then(
          () => undefined,
          () => undefined
        );
        return run;
      }
    );
    prismaTest.model("customerIdentityMatch").findFirst.mockImplementation(
      ({ where }: { where: Record<string, unknown> }) => {
        if (typeof where.id === "string") {
          return Promise.resolve(row);
        }
        const status = where.status as { in?: CustomerIdentityMatchStatus[] } | undefined;
        if (status?.in) {
          return Promise.resolve(status.in.includes(row.status) ? row : null);
        }
        return Promise.resolve(null);
      }
    );
    prismaTest.model("customerIdentityMatch").update.mockImplementation(
      ({ data }: { data: Record<string, unknown> }) => {
        row = { ...row, ...data } as typeof row;
        return Promise.resolve(row);
      }
    );

    const reviewPromise = reviewIdentityMatch(ADMIN, "match-1", "REJECT");
    const reconciliationPromise = reconcileQuickBooksIdentityMatches(ADMIN, {});
    const [reviewed, report] = await Promise.all([reviewPromise, reconciliationPromise]);

    expect(reviewed.status).toBe(CustomerIdentityMatchStatus.REJECTED);
    expect(row.status).toBe(CustomerIdentityMatchStatus.REJECTED);
    expect(report.totals.reviewedPreserved).toBe(1);
    expect(report.totals.autoLinked).toBe(0);
    expect(prismaTest.queryRaw).toHaveBeenCalledTimes(2);
    const lockSql = prismaTest.queryRaw.mock.calls.map(([sql]) => (sql as Prisma.Sql).values);
    expect(lockSql[0]).toEqual(lockSql[1]);
  });
});
