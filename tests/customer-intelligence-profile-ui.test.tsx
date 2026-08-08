import {
  ContactStatus,
  CustomerIdentityMatchKind,
  CustomerIdentityMatchStatus,
  CustomerLifecycle,
  CustomerSourceAccountStatus,
  HunterServiceLine,
  HunterSignalStatus,
  HunterSignalType,
  LeadPipelineStage,
  PlatformRole
} from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaTest = vi.hoisted(() => {
  const modelCalls: Array<{
    model: string;
    method: string;
    args: unknown[];
    inTransaction: boolean;
  }> = [];
  const modelTargets = new Map<string, Record<string, ReturnType<typeof vi.fn>>>();
  let inTransaction = false;
  const queryRaw = vi.fn(async () => []);
  const transaction = vi.fn(async (callback: (client: Record<string, unknown>) => unknown) => {
    inTransaction = true;
    try {
      return await callback(proxy);
    } finally {
      inTransaction = false;
    }
  });
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
            modelCalls.push({ model: modelName, method, args, inTransaction });
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
    isInTransaction() {
      return inTransaction;
    },
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
        async (callback: (client: Record<string, unknown>) => unknown) => {
          inTransaction = true;
          try {
            return await callback(proxy);
          } finally {
            inTransaction = false;
          }
        }
      );
    }
  };
});

// Only Prisma, next/cache, next/navigation, next/link, and the tenant-context
// session resolver are mocked. The authorization module is REAL, so the
// leadership-only boundary runs against the mocked DB exactly like the
// foundation suite. next/link and the client contact-edit panel are stubbed so
// the server-rendered pages can be rendered to static markup in the Node
// environment; the real panel's server-side guard lives in the core action and
// is covered separately.
vi.mock("@/server/db", () => ({
  prisma: prismaTest.proxy
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/server/tenant-context", () => ({
  getAuthenticatedContext: vi.fn()
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  }
}));
vi.mock("next/link", async () => {
  const React = await import("react");
  function MockLink(props: Record<string, unknown>) {
    return React.createElement("a", props as never);
  }
  return { default: MockLink };
});
vi.mock("@/modules/customer-intelligence/components/contact-edit-panel", async () => {
  const React = await import("react");
  function ContactEditPanel() {
    return React.createElement(
      "div",
      { "data-testid": "contact-edit-panel" } as never,
      "Contact edit panel"
    );
  }
  return { ContactEditPanel };
});

import { renderToStaticMarkup } from "react-dom/server";

import CustomerIntelligenceDirectoryPage from "@/app/(authenticated)/customer-intelligence/page";
import CustomerIntelligenceCompanyDetailPage from "@/app/(authenticated)/customer-intelligence/companies/[companyId]/page";
import { updateContactDetails } from "@/modules/customer-intelligence/actions";
import { ContactEditPanel } from "@/modules/customer-intelligence/components/contact-edit-panel";
import { updateContactDetailsAction } from "@/modules/customer-intelligence/profile-actions";
import { EMPTY_PROFILE_ACTION_STATE } from "@/modules/customer-intelligence/profile-action-state";
import {
  extractPotentialContactsFromEvidence
} from "@/modules/customer-intelligence/profile-evidence";
import {
  getCompanyProfileDetail,
  getUnmatchedCustomerDirectory,
  listCompanyDirectory
} from "@/modules/customer-intelligence/queries";
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

const MATCHED_COMPANY = {
  id: "company-1",
  name: "Northstar Outdoor Supply",
  normalizedName: "northstar-outdoor-supply",
  domain: "northstar.example.com",
  operatingRelationships: [
    {
      id: "rel-ww",
      lifecycle: CustomerLifecycle.ACTIVE_CUSTOMER,
      updatedAt: new Date("2026-07-20T12:00:00Z"),
      operatingCompany: {
        id: "oc-ww",
        slug: "newl-worldwide",
        displayName: "Newl Worldwide"
      },
      sourceAccounts: [
        { id: "acc-1", active: true, status: CustomerSourceAccountStatus.ACTIVE },
        { id: "acc-2", active: false, status: CustomerSourceAccountStatus.INACTIVE }
      ]
    },
    {
      id: "rel-usa",
      lifecycle: CustomerLifecycle.DORMANT_CUSTOMER,
      updatedAt: new Date("2026-06-01T12:00:00Z"),
      operatingCompany: {
        id: "oc-usa",
        slug: "newl-usa",
        displayName: "Newl USA"
      },
      sourceAccounts: []
    }
  ],
  contacts: [{ id: "contact-1" }, { id: "contact-2" }],
  leads: [{ stage: LeadPipelineStage.QUALIFIED }],
  hunterOpportunitySignals: [{ id: "signal-1" }, { id: "signal-2" }]
};

describe("profile-evidence: potential contacts from stored evidence only", () => {
  it("extracts email and phone values from stored identity-match evidence", () => {
    const contacts = extractPotentialContactsFromEvidence({
      displayName: "North Star Outdoor Imports Ltd.",
      email: "purchasing@example.com",
      phone: "+1 416 555 0199",
      currency: "CAD"
    });
    expect(contacts).toEqual([
      { kind: "EMAIL", value: "purchasing@example.com", source: "stored identity-match evidence" },
      { kind: "PHONE", value: "+1 416 555 0199", source: "stored identity-match evidence" }
    ]);
  });

  it("never invents contacts from missing, empty, or malformed evidence", () => {
    expect(extractPotentialContactsFromEvidence(null)).toEqual([]);
    expect(extractPotentialContactsFromEvidence("not-an-object")).toEqual([]);
    expect(extractPotentialContactsFromEvidence({ displayName: "Unnamed customer" })).toEqual([]);
    expect(extractPotentialContactsFromEvidence({ email: "", phone: "   " })).toEqual([]);
  });

  it("de-duplicates values and skips oversized fields", () => {
    const oversized = "x".repeat(300);
    const contacts = extractPotentialContactsFromEvidence({
      email: "purchasing@example.com",
      phone: oversized
    });
    expect(contacts).toEqual([
      { kind: "EMAIL", value: "purchasing@example.com", source: "stored identity-match evidence" }
    ]);
  });
});

describe("permissions: leadership-only Customer Profile reads and ADMIN/FINANCE contact edits", () => {
  beforeEach(() => {
    prismaTest.reset();
    configureAuth();
  });

  it("denies SALES on every new Customer Profile query and read path", async () => {
    const reads: Array<[name: string, call: () => Promise<unknown>]> = [
      ["listCompanyDirectory", () => listCompanyDirectory(SALES)],
      ["getUnmatchedCustomerDirectory", () => getUnmatchedCustomerDirectory(SALES)],
      ["getCompanyProfileDetail", () => getCompanyProfileDetail(SALES, "company-1")]
    ];
    for (const [name, call] of reads) {
      await expect(call(), `${name} must enforce leadership access`).rejects.toBeInstanceOf(
        AuthorizationError
      );
    }
  });

  it("denies OPERATIONS and READ_ONLY on the new reads and grants FINANCE and MANAGER", async () => {
    prismaTest.model("company").findMany.mockResolvedValue([]);
    prismaTest.model("customerIdentityMatch").findMany.mockResolvedValue([]);

    for (const denied of [OPERATIONS, READ_ONLY]) {
      prismaTest.reset();
      configureAuth();
      await expect(listCompanyDirectory(denied)).rejects.toBeInstanceOf(AuthorizationError);
      await expect(getUnmatchedCustomerDirectory(denied)).rejects.toBeInstanceOf(
        AuthorizationError
      );
    }

    prismaTest.reset();
    configureAuth();
    prismaTest.model("company").findMany.mockResolvedValue([]);
    prismaTest.model("customerIdentityMatch").findMany.mockResolvedValue([]);
    await expect(listCompanyDirectory(FINANCE)).resolves.toEqual([]);
    await expect(listCompanyDirectory(MANAGER)).resolves.toEqual([]);
  });

  it("denies the contact-details mutation for non-approval roles before any write", async () => {
    const input = {
      contactId: "contact-1",
      companyId: "company-1",
      firstName: "Priya",
      lastName: "Desai"
    };
    for (const denied of [SALES, OPERATIONS, READ_ONLY, MANAGER]) {
      prismaTest.reset();
      configureAuth();
      await expect(
        updateContactDetails(denied, input),
        `${denied.role} must be denied contact edits`
      ).rejects.toBeInstanceOf(AuthorizationError);
      assertNoDatabaseWrites();
    }
  });

  it("denies FINANCE when the tenant mutation gate disables writes", async () => {
    prismaTest.reset();
    configureAuth({ canMutate: false });
    await expect(
      updateContactDetails(FINANCE, { contactId: "contact-1", companyId: "company-1" })
    ).rejects.toBeInstanceOf(AuthorizationError);
    assertNoDatabaseWrites();
  });
});

describe("listCompanyDirectory: matched companies from tenant-scoped foundation data", () => {
  beforeEach(() => {
    prismaTest.reset();
    configureAuth();
  });

  it("assembles lifecycle rollup, counts, lead stage, signals, and last activity", async () => {
    prismaTest.model("company").findMany.mockResolvedValue([MATCHED_COMPANY]);

    const entries = await listCompanyDirectory(ADMIN);
    expect(entries).toHaveLength(1);
    const entry = entries[0];
    expect(entry.companyName).toBe("Northstar Outdoor Supply");
    expect(entry.lifecycle).toBe(CustomerLifecycle.ACTIVE_CUSTOMER);
    expect(entry.operatingCompanies.map((company) => company.displayName)).toEqual([
      "Newl Worldwide",
      "Newl USA"
    ]);
    expect(entry.sourceAccountCount).toBe(2);
    expect(entry.activeSourceAccountCount).toBe(1);
    expect(entry.contactCount).toBe(2);
    expect(entry.leadStage).toBe(LeadPipelineStage.QUALIFIED);
    expect(entry.opportunitySignalCount).toBe(2);
    expect(entry.lastActivityAt?.toISOString()).toBe("2026-07-20T12:00:00.000Z");
  });

  it("scopes the directory read to the authenticated tenant", async () => {
    prismaTest.model("company").findMany.mockResolvedValue([]);
    await listCompanyDirectory(ADMIN);
    const args = prismaTest.model("company").findMany.mock.calls[0][0] as {
      where: Record<string, unknown>;
    };
    expect(args.where.tenantId).toBe("tenant-a");
    expect(args.where.operatingRelationships).toEqual({ some: {} });
  });

  it("excludes companies without any operating-company relationship", async () => {
    prismaTest.model("company").findMany.mockResolvedValue([]);
    const entries = await listCompanyDirectory(FINANCE);
    expect(entries).toEqual([]);
  });
});

describe("getUnmatchedCustomerDirectory: unmatched QuickBooks customers with stored-evidence contacts", () => {
  beforeEach(() => {
    prismaTest.reset();
    configureAuth();
  });

  it("returns PROPOSED matches with potential contacts derived from stored evidence", async () => {
    prismaTest.model("customerIdentityMatch").findMany.mockResolvedValue([
      {
        id: "match-1",
        // A reviewer-selected target does not make a deferred proposal matched.
        companyId: "company-1",
        sourceLabel: "North Star Outdoor - USD",
        sourceRecordKey: "realm-1:1002",
        score: 96,
        evidence: { email: "purchasing@example.com", phone: "+1 416 555 0199" },
        operatingCompany: { id: "oc-usa", slug: "newl-usa", displayName: "Newl USA" },
        candidateCompany: { id: "company-1", name: "Northstar Outdoor Supply", domain: "northstar.example.com" }
      },
      {
        id: "match-2",
        sourceLabel: "Summit Parts Depot",
        sourceRecordKey: "realm-1:1003",
        score: 0,
        evidence: { displayName: "Summit Parts Depot" },
        operatingCompany: { id: "oc-ww", slug: "newl-worldwide", displayName: "Newl Worldwide" },
        candidateCompany: null
      }
    ]);

    const entries = await getUnmatchedCustomerDirectory(ADMIN);
    expect(entries).toHaveLength(2);

    expect(entries[0].sourceLabel).toBe("North Star Outdoor - USD");
    expect(entries[0].candidateCompany?.name).toBe("Northstar Outdoor Supply");
    expect(entries[0].potentialContacts).toEqual([
      { kind: "EMAIL", value: "purchasing@example.com", source: "stored identity-match evidence" },
      { kind: "PHONE", value: "+1 416 555 0199", source: "stored identity-match evidence" }
    ]);

    expect(entries[1].potentialContacts).toEqual([]);
  });

  it("lists all tenant PROPOSED QUICKBOOKS_ACCOUNT rows regardless of a selected company", async () => {
    prismaTest.model("customerIdentityMatch").findMany.mockResolvedValue([]);
    await getUnmatchedCustomerDirectory(FINANCE);
    const args = prismaTest.model("customerIdentityMatch").findMany.mock.calls[0][0] as {
      where: Record<string, unknown>;
    };
    expect(args.where.tenantId).toBe("tenant-a");
    expect(args.where.kind).toBe(CustomerIdentityMatchKind.QUICKBOOKS_ACCOUNT);
    expect(args.where.status).toBe(CustomerIdentityMatchStatus.PROPOSED);
    expect(args.where).not.toHaveProperty("companyId");
  });
});

describe("getCompanyProfileDetail: one canonical profile over stored data", () => {
  beforeEach(() => {
    prismaTest.reset();
    configureAuth();
  });

  it("returns null for unknown or cross-tenant company identifiers (renders not found)", async () => {
    prismaTest.model("company").findFirst.mockResolvedValue(null);
    const detail = await getCompanyProfileDetail(ADMIN, "company-foreign");
    expect(detail).toBeNull();

    const args = prismaTest.model("company").findFirst.mock.calls[0][0] as {
      where: Record<string, unknown>;
    };
    expect(args.where.tenantId).toBe("tenant-a");
    expect(args.where.id).toBe("company-foreign");
  });

  it("assembles relationships, contacts, match status, lead, signals, and import evidence", async () => {
    prismaTest.model("company").findFirst.mockResolvedValue({
      id: "company-1",
      name: "Northstar Outdoor Supply",
      domain: "northstar.example.com",
      primaryIndustry: "Outdoor retail"
    });
    prismaTest.model("companyOperatingRelationship").findMany.mockResolvedValue([
      {
        id: "rel-ww",
        companyId: "company-1",
        operatingCompanyId: "oc-ww",
        lifecycle: CustomerLifecycle.ACTIVE_CUSTOMER,
        status: "ACTIVE",
        firstRevenueDate: new Date("2026-01-10T00:00:00Z"),
        lastRevenueDate: new Date("2026-06-30T00:00:00Z"),
        assignedOwnerUserId: "user-9",
        notes: "Annual ocean program",
        operatingCompany: { id: "oc-ww", slug: "newl-worldwide", displayName: "Newl Worldwide" },
        sourceAccounts: [
          {
            id: "acc-1",
            displayName: "Northstar Outdoor - CAD",
            currency: "CAD",
            active: true,
            status: CustomerSourceAccountStatus.ACTIVE,
            email: "ap@example.com",
            phone: "+1 416 555 0199",
            lastSyncedAt: new Date("2026-07-01T00:00:00Z")
          }
        ]
      }
    ]);
    prismaTest.model("contact").findMany.mockResolvedValue([
      {
        id: "contact-1",
        companyId: "company-1",
        firstName: "Priya",
        lastName: "Desai",
        fullName: "Priya Desai",
        title: "Purchasing Manager",
        department: "Purchasing",
        email: "priya.desai@example.com",
        phone: null,
        contactStatus: ContactStatus.APPROVED,
        source: "MANUAL",
        contactPoints: [
          {
            id: "cp-1",
            type: "EMAIL",
            value: "priya.desai@example.com",
            displayValue: "priya.desai@example.com",
            primary: true,
            verificationStatus: "VERIFIED",
            source: "EMAIL_SIGNATURE"
          }
        ],
        contactEvidence: [{ id: "ce-1" }, { id: "ce-2" }]
      }
    ]);
    prismaTest.model("customerIdentityMatch").findMany.mockResolvedValue([
      {
        id: "match-1",
        kind: CustomerIdentityMatchKind.QUICKBOOKS_ACCOUNT,
        status: CustomerIdentityMatchStatus.APPROVED,
        score: 100,
        sourceRecordKey: "realm-1:1001",
        sourceLabel: "Northstar Outdoor",
        operatingCompanyId: "oc-ww",
        reviewedAt: new Date("2026-07-05T00:00:00Z")
      },
      {
        id: "match-2",
        kind: CustomerIdentityMatchKind.QUICKBOOKS_ACCOUNT,
        status: CustomerIdentityMatchStatus.PROPOSED,
        score: 82,
        sourceRecordKey: "realm-1:1004",
        sourceLabel: "North Star Outdoor - USD",
        operatingCompanyId: "oc-usa",
        reviewedAt: null
      }
    ]);
    prismaTest.model("lead").findFirst.mockResolvedValue({
      id: "lead-1",
      stage: LeadPipelineStage.QUALIFIED,
      score: 72,
      ownerUserId: "user-3",
      notes: "Ocean program renewal",
      updatedAt: new Date("2026-07-15T00:00:00Z")
    });
    prismaTest.model("hunterOpportunitySignal").findMany.mockResolvedValue([
      {
        id: "signal-1",
        signalType: HunterSignalType.EXPANSION,
        serviceLine: HunterServiceLine.WAREHOUSING,
        status: HunterSignalStatus.NEW,
        title: "New distribution centre announced",
        summary: "Western Canada distribution launch",
        observedAt: new Date("2026-07-18T00:00:00Z"),
        confidence: 80
      }
    ]);
    prismaTest.model("tradeMiningImportRecord").findMany.mockResolvedValue([
      {
        id: "import-1",
        rawRecordKey: "SR812345",
        importerName: "North Star Outdoor Imports Ltd.",
        consigneeName: null,
        shipperName: "Example Freight Co.",
        arrivalDate: new Date("2026-07-12T00:00:00Z"),
        originCountry: "Vietnam",
        sourcePort: "Hai Phong",
        productDescription: "Outdoor equipment"
      }
    ]);
    prismaTest.model("customerSourceAccount").count.mockResolvedValue(1);

    const detail = await getCompanyProfileDetail(ADMIN, "company-1");
    expect(detail).not.toBeNull();
    expect(detail!.lifecycle).toBe(CustomerLifecycle.ACTIVE_CUSTOMER);
    expect(detail!.company.domain).toBe("northstar.example.com");

    expect(detail!.relationships).toHaveLength(1);
    expect(detail!.relationships[0].approvedMatchCount).toBe(1);
    expect(detail!.relationships[0].sourceAccounts[0].currency).toBe("CAD");

    expect(detail!.contacts).toHaveLength(1);
    expect(detail!.contacts[0].evidenceCount).toBe(2);
    expect(detail!.contacts[0].source).toBe("MANUAL");
    expect(detail!.contacts[0].contactPoints[0].verificationStatus).toBe("VERIFIED");
    expect(detail!.contacts[0].contactPoints[0].source).toBe("EMAIL_SIGNATURE");

    expect(detail!.identityMatches.map((match) => match.status)).toEqual([
      CustomerIdentityMatchStatus.APPROVED,
      CustomerIdentityMatchStatus.PROPOSED
    ]);
    expect(detail!.lead?.stage).toBe(LeadPipelineStage.QUALIFIED);
    expect(detail!.opportunitySignals[0].title).toBe("New distribution centre announced");
    expect(detail!.importRecords[0].rawRecordKey).toBe("SR812345");
    expect(detail!.sourceAccountCount).toBe(1);
  });
});

describe("updateContactDetails: guarded manual contact correction", () => {
  beforeEach(() => {
    prismaTest.reset();
    configureAuth();
  });

  const EXISTING_CONTACT = {
    id: "contact-1",
    tenantId: "tenant-a",
    companyId: "company-1",
    firstName: "Priya",
    lastName: "Desai",
    fullName: "Priya Desai",
    title: "Purchasing Manager",
    department: "Purchasing",
    email: "priya.desai@example.com",
    phone: null,
    contactStatus: ContactStatus.APPROVED,
    source: "MANUAL"
  };

  it("updates submitted details, derives fullName, and writes an audit entry", async () => {
    let contactUpdateInTransaction = false;
    let contactPointUpsertInTransaction = false;
    let auditCreateInTransaction = false;
    prismaTest.model("contact").findFirst.mockResolvedValue(EXISTING_CONTACT);
    prismaTest.model("contact").update.mockImplementation(
      ({ data }: { data: Record<string, unknown> }) => {
        contactUpdateInTransaction = prismaTest.isInTransaction();
        return { ...EXISTING_CONTACT, ...data };
      }
    );
    prismaTest.model("contactPoint").findFirst.mockResolvedValue(null);
    prismaTest.model("contactPoint").upsert.mockImplementation(
      ({ create }: { create: Record<string, unknown> }) => {
        contactPointUpsertInTransaction = prismaTest.isInTransaction();
        return { id: "cp-1", ...create };
      }
    );
    prismaTest.model("contactPoint").updateMany.mockResolvedValue({ count: 0 });
    prismaTest.model("auditLog").create.mockImplementation(() => {
      auditCreateInTransaction = prismaTest.isInTransaction();
      return { id: "audit-1" };
    });

    const updated = await updateContactDetails(ADMIN, {
      contactId: "contact-1",
      companyId: "company-1",
      firstName: "Priya",
      lastName: "Desai",
      title: "VP Supply Chain",
      email: "priya.desai@example.com"
    });

    expect(updated.fullName).toBe("Priya Desai");
    expect(updated.title).toBe("VP Supply Chain");
    expect(updated.contactStatus).toBe(ContactStatus.APPROVED);

    const updateArgs = prismaTest.model("contact").update.mock.calls[0][0] as {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    };
    expect(updateArgs.where).toEqual({ tenantId_id: { tenantId: "tenant-a", id: "contact-1" } });

    // The contact update, the ContactPoint correction, and the audit commit in
    // one Prisma transaction.
    expect(prismaTest.transaction).toHaveBeenCalledTimes(1);
    expect(contactUpdateInTransaction).toBe(true);
    expect(contactPointUpsertInTransaction).toBe(true);
    expect(auditCreateInTransaction).toBe(true);

    const auditArgs = prismaTest.model("auditLog").create.mock.calls[0][0] as {
      data: Record<string, unknown>;
    };
    expect(auditArgs.data.tenantId).toBe("tenant-a");
    expect(auditArgs.data.action).toBe("customer-intelligence.contact.details-updated");
    expect(auditArgs.data.entityType).toBe("Contact");
  });

  it("records a corrected email as a normalized ContactPoint with prior evidence retained", async () => {
    prismaTest.model("contact").findFirst.mockResolvedValue({
      ...EXISTING_CONTACT,
      email: "old.buyer@example.com"
    });
    prismaTest.model("contact").update.mockImplementation(
      ({ data }: { data: Record<string, unknown> }) => ({
        ...EXISTING_CONTACT,
        email: "old.buyer@example.com",
        ...data
      })
    );
    prismaTest.model("contactPoint").findFirst.mockResolvedValue(null);
    const upsertMock = prismaTest.model("contactPoint").upsert;
    upsertMock.mockImplementation(({ create }: { create: Record<string, unknown> }) => ({
      id: create.primary ? "cp-new" : "cp-prior",
      ...create
    }));
    prismaTest.model("contactPoint").updateMany.mockResolvedValue({ count: 1 });

    const updated = await updateContactDetails(ADMIN, {
      contactId: "contact-1",
      companyId: "company-1",
      firstName: "Priya",
      lastName: "Desai",
      email: "New.Buyer@Example.COM"
    });

    expect(updated.email).toBe("New.Buyer@Example.COM");

    expect(upsertMock).toHaveBeenCalledTimes(2);
    const priorUpsertArgs = upsertMock.mock.calls.find(
      ([args]) => args.create.value === "old.buyer@example.com"
    )?.[0] as {
      where: { tenantId_contactId_type_value: Record<string, unknown> };
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    };
    expect(priorUpsertArgs.where.tenantId_contactId_type_value.value).toBe(
      "old.buyer@example.com"
    );
    expect(priorUpsertArgs.create.displayValue).toBe("old.buyer@example.com");
    expect(priorUpsertArgs.create.primary).toBe(false);
    expect(priorUpsertArgs.create.source).toBe("MANUAL");
    expect(priorUpsertArgs.update.primary).toBe(false);

    const upsertArgs = upsertMock.mock.calls.find(
      ([args]) => args.create.value === "new.buyer@example.com"
    )?.[0] as {
      where: { tenantId_contactId_type_value: Record<string, unknown> };
      create: Record<string, unknown>;
    };
    // Normalization: the stored value is the deterministic lowercased key while
    // the human display value keeps the submitted spelling.
    expect(upsertArgs.where.tenantId_contactId_type_value.value).toBe("new.buyer@example.com");
    expect(upsertArgs.create.value).toBe("new.buyer@example.com");
    expect(upsertArgs.create.displayValue).toBe("New.Buyer@Example.COM");
    expect(upsertArgs.create.type).toBe("EMAIL");
    expect(upsertArgs.create.primary).toBe(true);
    expect(upsertArgs.create.source).toBe("MANUAL");

    // Replacement retains the prior direct value even though no ContactPoint
    // represented it before this correction. Existing primary points are also
    // demoted and no evidence is deleted.
    const demoteArgs = prismaTest.model("contactPoint").updateMany.mock.calls[0][0] as {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    };
    expect(demoteArgs.where.contactId).toBe("contact-1");
    expect(demoteArgs.where.type).toBe("EMAIL");
    expect(demoteArgs.where.primary).toBe(true);
    expect(demoteArgs.data.primary).toBe(false);
    expect(
      prismaTest.modelCalls.filter(
        (call) => call.model === "contactPoint" && call.method === "delete"
      )
    ).toEqual([]);
  });

  it("clears a direct phone while retaining and demoting the prior value", async () => {
    prismaTest.model("contact").findFirst.mockResolvedValue({
      ...EXISTING_CONTACT,
      phone: "+1 (416) 555-0188",
      source: "IMPORT"
    });
    prismaTest.model("contact").update.mockImplementation(
      ({ data }: { data: Record<string, unknown> }) => ({
        ...EXISTING_CONTACT,
        phone: "+1 (416) 555-0188",
        source: "IMPORT",
        ...data
      })
    );
    const upsertMock = prismaTest.model("contactPoint").upsert;
    upsertMock.mockImplementation(({ update }: { update: Record<string, unknown> }) => ({
      id: "cp-prior",
      ...update
    }));
    prismaTest.model("contactPoint").updateMany.mockResolvedValue({ count: 0 });

    const updated = await updateContactDetails(ADMIN, {
      contactId: "contact-1",
      companyId: "company-1",
      phone: null
    });

    expect(updated.phone).toBeNull();
    expect(upsertMock).toHaveBeenCalledTimes(1);
    const retainedArgs = upsertMock.mock.calls[0][0] as {
      where: { tenantId_contactId_type_value: Record<string, unknown> };
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    };
    expect(retainedArgs.where.tenantId_contactId_type_value.value).toBe(
      "4165550188"
    );
    expect(retainedArgs.create.primary).toBe(false);
    expect(retainedArgs.create.source).toBe("IMPORT");
    expect(retainedArgs.update.primary).toBe(false);

    const demoteArgs = prismaTest.model("contactPoint").updateMany.mock.calls[0][0] as {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    };
    expect(demoteArgs.where).toMatchObject({
      tenantId: "tenant-a",
      contactId: "contact-1",
      type: "PHONE",
      primary: true
    });
    expect(demoteArgs.data.primary).toBe(false);
    expect(
      prismaTest.modelCalls.filter(
        (call) => call.model === "contactPoint" && call.method === "delete"
      )
    ).toEqual([]);
  });

  it("deduplicates a corrected email against the existing normalized ContactPoint", async () => {
    prismaTest.model("contact").findFirst.mockResolvedValue(EXISTING_CONTACT);
    prismaTest.model("contact").update.mockImplementation(
      ({ data }: { data: Record<string, unknown> }) => ({ ...EXISTING_CONTACT, ...data })
    );
    prismaTest.model("contactPoint").findFirst.mockResolvedValue({
      id: "cp-existing",
      tenantId: "tenant-a",
      contactId: "contact-1",
      companyId: "company-1",
      type: "EMAIL",
      value: "priya.desai@example.com",
      displayValue: "priya.desai@example.com",
      primary: true,
      source: "EMAIL_SIGNATURE"
    });
    const upsertMock = prismaTest.model("contactPoint").upsert;
    upsertMock.mockImplementation(({ update }: { update: Record<string, unknown> }) => ({
      id: "cp-existing",
      ...update
    }));
    prismaTest.model("contactPoint").updateMany.mockResolvedValue({ count: 0 });

    const updated = await updateContactDetails(ADMIN, {
      contactId: "contact-1",
      companyId: "company-1",
      firstName: "Priya",
      lastName: "Desai",
      email: "Priya.Desai@Example.com"
    });

    expect(updated.email).toBe("Priya.Desai@Example.com");
    expect(upsertMock).toHaveBeenCalledTimes(1);
    const upsertArgs = upsertMock.mock.calls[0][0] as {
      where: { tenantId_contactId_type_value: Record<string, unknown> };
      update: Record<string, unknown>;
    };
    // Equivalent spellings resolve to the single existing normalized point.
    expect(upsertArgs.where.tenantId_contactId_type_value.value).toBe("priya.desai@example.com");
    // The existing point's source evidence survives the correction.
    expect(upsertArgs.update.source).toBe("EMAIL_SIGNATURE");
  });

  it("normalizes and deduplicates a corrected phone ContactPoint", async () => {
    prismaTest.model("contact").findFirst.mockResolvedValue(EXISTING_CONTACT);
    prismaTest.model("contact").update.mockImplementation(
      ({ data }: { data: Record<string, unknown> }) => ({ ...EXISTING_CONTACT, ...data })
    );
    prismaTest.model("contactPoint").findFirst.mockResolvedValue(null);
    const upsertMock = prismaTest.model("contactPoint").upsert;
    upsertMock.mockImplementation(({ create }: { create: Record<string, unknown> }) => ({
      id: "cp-phone",
      ...create
    }));
    prismaTest.model("contactPoint").updateMany.mockResolvedValue({ count: 0 });

    await updateContactDetails(ADMIN, {
      contactId: "contact-1",
      companyId: "company-1",
      firstName: "Priya",
      lastName: "Desai",
      phone: "+1 (416) 555-0134"
    });

    const upsertArgs = upsertMock.mock.calls[0][0] as {
      where: { tenantId_contactId_type_value: Record<string, unknown> };
      create: Record<string, unknown>;
    };
    expect(upsertArgs.create.type).toBe("PHONE");
    expect(upsertArgs.create.value).toBe("4165550134");
    expect(upsertArgs.create.displayValue).toBe("+1 (416) 555-0134");
  });

  it("rejects an un-normalizable submitted phone before the correction commits", async () => {
    prismaTest.model("contact").findFirst.mockResolvedValue(EXISTING_CONTACT);
    prismaTest.model("contact").update.mockImplementation(
      ({ data }: { data: Record<string, unknown> }) => ({ ...EXISTING_CONTACT, ...data })
    );
    prismaTest.model("contactPoint").findFirst.mockResolvedValue(null);

    await expect(
      updateContactDetails(ADMIN, {
        contactId: "contact-1",
        companyId: "company-1",
        firstName: "Priya",
        lastName: "Desai",
        phone: "N/A"
      })
    ).rejects.toThrow("Contact point value is not valid for its type");
  });

  it("rejects when the audit write fails so the correction cannot commit unaudited", async () => {
    let auditCreateInTransaction = false;
    prismaTest.model("contact").findFirst.mockResolvedValue(EXISTING_CONTACT);
    prismaTest.model("contact").update.mockImplementation(
      ({ data }: { data: Record<string, unknown> }) => ({ ...EXISTING_CONTACT, ...data })
    );
    prismaTest.model("auditLog").create.mockImplementation(() => {
      auditCreateInTransaction = prismaTest.isInTransaction();
      throw new Error("audit log unavailable");
    });

    await expect(
      updateContactDetails(ADMIN, {
        contactId: "contact-1",
        companyId: "company-1",
        firstName: "Priya",
        lastName: "Desai",
        title: "VP Supply Chain"
      })
    ).rejects.toThrow("audit log unavailable");

    // The material correction and the audit record share one transaction: the
    // mutation never resolves, so the correction cannot commit without its
    // audit record.
    expect(prismaTest.transaction).toHaveBeenCalledTimes(1);
    expect(prismaTest.model("contact").update).toHaveBeenCalledTimes(1);
    expect(auditCreateInTransaction).toBe(true);
  });

  it("rejects a cross-tenant contact before any write", async () => {
    prismaTest.model("contact").findFirst.mockResolvedValue(null);
    await expect(
      updateContactDetails(ADMIN, { contactId: "contact-foreign", companyId: "company-1" })
    ).rejects.toThrow("Contact does not exist in this tenant");
    assertNoDatabaseWrites();
  });

  it("rejects clearing both first and last names", async () => {
    prismaTest.model("contact").findFirst.mockResolvedValue(EXISTING_CONTACT);
    await expect(
      updateContactDetails(ADMIN, {
        contactId: "contact-1",
        companyId: "company-1",
        firstName: null,
        lastName: null
      })
    ).rejects.toThrow("Contact full name is required");
    assertNoDatabaseWrites();
  });

  it("preserves existing values for fields not submitted", async () => {
    prismaTest.model("contact").findFirst.mockResolvedValue(EXISTING_CONTACT);
    prismaTest.model("contact").update.mockImplementation(
      ({ data }: { data: Record<string, unknown> }) => ({ ...EXISTING_CONTACT, ...data })
    );

    const updated = await updateContactDetails(ADMIN, {
      contactId: "contact-1",
      companyId: "company-1",
      contactStatus: ContactStatus.REVIEWING
    });
    expect(updated.email).toBe("priya.desai@example.com");
    expect(updated.department).toBe("Purchasing");
    expect(updated.contactStatus).toBe(ContactStatus.REVIEWING);
  });

  it("uses the locked transaction snapshot without overwriting an unsubmitted concurrent correction", async () => {
    const authoritativeContact = {
      ...EXISTING_CONTACT,
      lastName: "Shah",
      fullName: "Priya Shah",
      department: "Strategic Sourcing",
      email: "authoritative.buyer@example.com"
    };
    let readInTransaction = false;
    prismaTest.model("contact").findFirst.mockImplementation(() => {
      readInTransaction = prismaTest.isInTransaction();
      return authoritativeContact;
    });
    prismaTest.model("contact").update.mockImplementation(
      ({ data }: { data: Record<string, unknown> }) => ({ ...authoritativeContact, ...data })
    );
    prismaTest.model("contactPoint").findFirst.mockResolvedValue(null);
    prismaTest.model("contactPoint").upsert.mockImplementation(
      ({ create }: { create: Record<string, unknown> }) => ({ id: `cp-${create.value}`, ...create })
    );
    prismaTest.model("contactPoint").updateMany.mockResolvedValue({ count: 1 });

    const updated = await updateContactDetails(ADMIN, {
      contactId: "contact-1",
      companyId: "company-1",
      firstName: "Asha",
      email: "asha.buyer@example.com"
    });

    expect(readInTransaction).toBe(true);
    expect(prismaTest.queryRaw).toHaveBeenCalledTimes(1);
    expect(updated.fullName).toBe("Asha Shah");
    expect(updated.department).toBe("Strategic Sourcing");

    const updateData = prismaTest.model("contact").update.mock.calls[0][0].data as Record<
      string,
      unknown
    >;
    expect(updateData).toMatchObject({
      firstName: "Asha",
      fullName: "Asha Shah",
      email: "asha.buyer@example.com"
    });
    expect(updateData).not.toHaveProperty("lastName");
    expect(updateData).not.toHaveProperty("department");
    expect(updateData).not.toHaveProperty("phone");

    const retainedPriorPoint = prismaTest.model("contactPoint").upsert.mock.calls.find(
      ([args]) => args.create.value === "authoritative.buyer@example.com"
    )?.[0] as { create: Record<string, unknown> };
    expect(retainedPriorPoint.create.displayValue).toBe("authoritative.buyer@example.com");

    const auditData = prismaTest.model("auditLog").create.mock.calls[0][0].data as {
      before: Record<string, unknown>;
    };
    expect(auditData.before).toMatchObject({
      lastName: "Shah",
      department: "Strategic Sourcing",
      email: "authoritative.buyer@example.com"
    });
  });
});

describe("updateContactDetailsAction: thin guarded server-action wrapper", () => {
  beforeEach(() => {
    prismaTest.reset();
    configureAuth();
  });

  it("applies the form and returns a success state", async () => {
    vi.mocked(tenantContext.getAuthenticatedContext).mockResolvedValue(ADMIN);
    prismaTest.model("contact").findFirst.mockResolvedValue({
      id: "contact-1",
      tenantId: "tenant-a",
      companyId: "company-1",
      firstName: "Priya",
      lastName: "Desai",
      fullName: "Priya Desai",
      title: null,
      department: null,
      email: null,
      phone: null,
      contactStatus: ContactStatus.NEW
    });
    prismaTest.model("contact").update.mockImplementation(
      ({ data }: { data: Record<string, unknown> }) => ({ ...data, id: "contact-1" })
    );

    const formData = new FormData();
    formData.set("contactId", "contact-1");
    formData.set("companyId", "company-1");
    formData.set("firstName", "Priya");
    formData.set("lastName", "Desai");
    formData.set("title", "Purchasing Manager");
    formData.set("contactStatus", ContactStatus.APPROVED);

    const state = await updateContactDetailsAction(EMPTY_PROFILE_ACTION_STATE, formData);
    expect(state.status).toBe("success");
    expect(state.message).toContain("updated");

    const updateArgs = prismaTest.model("contact").update.mock.calls[0][0] as {
      data: Record<string, unknown>;
    };
    expect(updateArgs.data.contactStatus).toBe(ContactStatus.APPROVED);
  });

  it("returns an error state when the contact is missing", async () => {
    vi.mocked(tenantContext.getAuthenticatedContext).mockResolvedValue(ADMIN);
    prismaTest.model("contact").findFirst.mockResolvedValue(null);

    const formData = new FormData();
    formData.set("contactId", "contact-foreign");
    formData.set("companyId", "company-1");

    const state = await updateContactDetailsAction(EMPTY_PROFILE_ACTION_STATE, formData);
    expect(state.status).toBe("error");
    expect(state.message).toContain("Contact does not exist");
    assertNoDatabaseWrites();
  });

  it("rejects a nonempty unrecognized contact-status value with an error state", async () => {
    vi.mocked(tenantContext.getAuthenticatedContext).mockResolvedValue(ADMIN);
    prismaTest.model("contact").findFirst.mockResolvedValue({
      id: "contact-1",
      tenantId: "tenant-a",
      companyId: "company-1",
      firstName: "Priya",
      lastName: "Desai",
      fullName: "Priya Desai",
      title: null,
      department: null,
      email: null,
      phone: null,
      contactStatus: ContactStatus.NEW
    });

    const formData = new FormData();
    formData.set("contactId", "contact-1");
    formData.set("companyId", "company-1");
    formData.set("contactStatus", "NOT_A_STATUS");

    const state = await updateContactDetailsAction(EMPTY_PROFILE_ACTION_STATE, formData);
    expect(state.status).toBe("error");
    expect(state.message).toContain("Unrecognized contact status value");
    // The false-success path is gone: no write is attempted for an unknown
    // status, and the stored status is never silently kept behind a success.
    assertNoDatabaseWrites();
  });
});

describe("UI surface compiles: client contact-edit control and action-state contract", () => {
  it("exports the ContactEditPanel component and the idle action state", () => {
    expect(typeof ContactEditPanel).toBe("function");
    expect(EMPTY_PROFILE_ACTION_STATE).toEqual({ status: "idle" });
  });
});

describe("server-rendered Customer Profile pages", () => {
  beforeEach(() => {
    prismaTest.reset();
    configureAuth();
    vi.mocked(tenantContext.getAuthenticatedContext).mockResolvedValue(ADMIN);
  });

  it("renders the matched directory view with lifecycle, counts, and links", async () => {
    prismaTest.model("company").findMany.mockResolvedValue([MATCHED_COMPANY]);
    prismaTest.model("customerIdentityMatch").findMany.mockResolvedValue([]);
    prismaTest.model("customerIdentityMatch").count.mockResolvedValue(0);

    const element = await CustomerIntelligenceDirectoryPage({
      searchParams: Promise.resolve({ view: "matched" })
    });
    const html = renderToStaticMarkup(element);

    expect(html).toContain("Company Profiles");
    expect(html).toContain("Northstar Outdoor Supply");
    expect(html).toContain("northstar.example.com");
    expect(html).toContain("Newl Worldwide");
    expect(html).toContain("Active Customer");
    expect(html).toContain("/customer-intelligence/companies/company-1");
  });

  it("renders the unmatched view with stored-evidence potential contacts only", async () => {
    prismaTest.model("company").findMany.mockResolvedValue([]);
    prismaTest.model("customerIdentityMatch").findMany.mockResolvedValue([
      {
        id: "match-1",
        sourceLabel: "North Star Outdoor - USD",
        sourceRecordKey: "realm-1:1002",
        score: 96,
        evidence: { email: "purchasing@example.com", phone: "+1 416 555 0199" },
        operatingCompany: { id: "oc-usa", slug: "newl-usa", displayName: "Newl USA" },
        candidateCompany: null
      }
    ]);
    prismaTest.model("customerIdentityMatch").count.mockResolvedValue(1);

    const element = await CustomerIntelligenceDirectoryPage({
      searchParams: Promise.resolve({ view: "unmatched" })
    });
    const html = renderToStaticMarkup(element);

    expect(html).toContain("Unmatched QuickBooks customers (1)");
    expect(html).toContain("North Star Outdoor - USD");
    expect(html).toContain("purchasing@example.com");
    expect(html).toContain("+1 416 555 0199");
    expect(html).toContain("Review in identity queue");
  });

  it("renders honest empty states when no matched or unmatched rows exist", async () => {
    prismaTest.model("company").findMany.mockResolvedValue([]);
    prismaTest.model("customerIdentityMatch").findMany.mockResolvedValue([]);
    prismaTest.model("customerIdentityMatch").count.mockResolvedValue(0);

    const matchedElement = await CustomerIntelligenceDirectoryPage({
      searchParams: Promise.resolve({ view: "matched" })
    });
    expect(renderToStaticMarkup(matchedElement)).toContain("No matched companies yet.");

    const unmatchedElement = await CustomerIntelligenceDirectoryPage({
      searchParams: Promise.resolve({ view: "unmatched" })
    });
    expect(renderToStaticMarkup(unmatchedElement)).toContain(
      "No unmatched QuickBooks customers."
    );
  });

  function mockProfileDetailData() {
    prismaTest.model("company").findFirst.mockResolvedValue({
      id: "company-1",
      name: "Northstar Outdoor Supply",
      domain: "northstar.example.com",
      primaryIndustry: "Outdoor retail"
    });
    prismaTest.model("companyOperatingRelationship").findMany.mockResolvedValue([
      {
        id: "rel-ww",
        companyId: "company-1",
        operatingCompanyId: "oc-ww",
        lifecycle: CustomerLifecycle.ACTIVE_CUSTOMER,
        status: "ACTIVE",
        firstRevenueDate: new Date("2026-01-10T00:00:00Z"),
        lastRevenueDate: new Date("2026-06-30T00:00:00Z"),
        assignedOwnerUserId: "user-9",
        notes: "Annual ocean program",
        operatingCompany: { id: "oc-ww", slug: "newl-worldwide", displayName: "Newl Worldwide" },
        sourceAccounts: [
          {
            id: "acc-1",
            displayName: "Northstar Outdoor - CAD",
            currency: "CAD",
            active: true,
            status: CustomerSourceAccountStatus.ACTIVE,
            email: "ap@example.com",
            phone: "+1 416 555 0199",
            lastSyncedAt: new Date("2026-07-01T00:00:00Z")
          }
        ]
      }
    ]);
    prismaTest.model("contact").findMany.mockResolvedValue([
      {
        id: "contact-1",
        companyId: "company-1",
        firstName: "Priya",
        lastName: "Desai",
        fullName: "Priya Desai",
        title: "Purchasing Manager",
        department: "Purchasing",
        email: "priya.desai@example.com",
        phone: null,
        contactStatus: ContactStatus.APPROVED,
        source: "MANUAL",
        contactPoints: [
          {
            id: "cp-1",
            type: "EMAIL",
            value: "priya.desai@example.com",
            displayValue: "priya.desai@example.com",
            primary: true,
            verificationStatus: "VERIFIED",
            source: "EMAIL_SIGNATURE"
          }
        ],
        contactEvidence: [{ id: "ce-1" }]
      }
    ]);
    prismaTest.model("customerIdentityMatch").findMany.mockResolvedValue([]);
    prismaTest.model("lead").findFirst.mockResolvedValue({
      id: "lead-1",
      stage: LeadPipelineStage.QUALIFIED,
      score: 72,
      ownerUserId: "user-3",
      notes: "Ocean program renewal",
      updatedAt: new Date("2026-07-15T00:00:00Z")
    });
    prismaTest.model("hunterOpportunitySignal").findMany.mockResolvedValue([
      {
        id: "signal-1",
        signalType: HunterSignalType.EXPANSION,
        serviceLine: HunterServiceLine.WAREHOUSING,
        status: HunterSignalStatus.NEW,
        title: "New distribution centre announced",
        summary: "Western Canada distribution launch",
        observedAt: new Date("2026-07-18T00:00:00Z"),
        confidence: 80
      }
    ]);
    prismaTest.model("tradeMiningImportRecord").findMany.mockResolvedValue([
      {
        id: "import-1",
        rawRecordKey: "SR812345",
        importerName: "North Star Outdoor Imports Ltd.",
        consigneeName: null,
        shipperName: "Example Freight Co.",
        arrivalDate: new Date("2026-07-12T00:00:00Z"),
        originCountry: "Vietnam",
        sourcePort: "Hai Phong",
        productDescription: "Outdoor equipment"
      }
    ]);
    prismaTest.model("customerSourceAccount").count.mockResolvedValue(1);
  }

  it("renders a populated profile with ADMIN edit controls and honest news/TradeMining states", async () => {
    mockProfileDetailData();

    const element = await CustomerIntelligenceCompanyDetailPage({
      params: Promise.resolve({ companyId: "company-1" })
    });
    const html = renderToStaticMarkup(element);

    expect(html).toContain("Northstar Outdoor Supply");
    expect(html).toContain("Newl Worldwide");
    expect(html).toContain("Active Customer");
    expect(html).toContain("Priya Desai");
    expect(html).toContain("Contact source: Manual");
    expect(html).toContain("Source: Email Signature");
    expect(html).toContain("Verification: Verified");
    expect(html).toContain("Qualified");
    expect(html).toContain("New distribution centre announced");
    expect(html).toContain("North Star Outdoor Imports Ltd.");
    expect(html).toContain("ADMIN / FINANCE can edit details");
    expect(html).toContain('data-testid="contact-edit-panel"');
    expect(html).toContain("No news source is connected.");
    expect(html).toContain(
      "A separate per-company TradeMining search identity"
    );
  });

  it("shows the edit control for FINANCE and hides it for MANAGER", async () => {
    vi.mocked(tenantContext.getAuthenticatedContext).mockResolvedValue(FINANCE);
    mockProfileDetailData();
    const financeElement = await CustomerIntelligenceCompanyDetailPage({
      params: Promise.resolve({ companyId: "company-1" })
    });
    const financeHtml = renderToStaticMarkup(financeElement);
    expect(financeHtml).toContain("ADMIN / FINANCE can edit details");
    expect(financeHtml).toContain('data-testid="contact-edit-panel"');

    prismaTest.reset();
    configureAuth();
    vi.mocked(tenantContext.getAuthenticatedContext).mockResolvedValue(MANAGER);
    mockProfileDetailData();
    const managerElement = await CustomerIntelligenceCompanyDetailPage({
      params: Promise.resolve({ companyId: "company-1" })
    });
    const managerHtml = renderToStaticMarkup(managerElement);
    // MANAGER keeps leadership read access but never sees the ADMIN/FINANCE
    // edit control; the server-side mutation guard is untouched by the hidden
    // control.
    expect(managerHtml).not.toContain("ADMIN / FINANCE can edit details");
    expect(managerHtml).not.toContain('data-testid="contact-edit-panel"');
  });

  it("hides contact editing from FINANCE when tenant mutation access is disabled", async () => {
    configureAuth({ canMutate: false });
    vi.mocked(tenantContext.getAuthenticatedContext).mockResolvedValue(FINANCE);
    mockProfileDetailData();

    const element = await CustomerIntelligenceCompanyDetailPage({
      params: Promise.resolve({ companyId: "company-1" })
    });
    const html = renderToStaticMarkup(element);

    expect(html).toContain("Northstar Outdoor Supply");
    expect(html).not.toContain("ADMIN / FINANCE can edit details");
    expect(html).not.toContain('data-testid="contact-edit-panel"');
  });

  it("renders honest empty sections on a profile with no stored evidence", async () => {
    prismaTest.model("company").findFirst.mockResolvedValue({
      id: "company-1",
      name: "Northstar Outdoor Supply",
      domain: null,
      primaryIndustry: null
    });
    prismaTest.model("companyOperatingRelationship").findMany.mockResolvedValue([]);
    prismaTest.model("contact").findMany.mockResolvedValue([]);
    prismaTest.model("customerIdentityMatch").findMany.mockResolvedValue([]);
    prismaTest.model("lead").findFirst.mockResolvedValue(null);
    prismaTest.model("hunterOpportunitySignal").findMany.mockResolvedValue([]);
    prismaTest.model("tradeMiningImportRecord").findMany.mockResolvedValue([]);
    prismaTest.model("customerSourceAccount").count.mockResolvedValue(0);

    const element = await CustomerIntelligenceCompanyDetailPage({
      params: Promise.resolve({ companyId: "company-1" })
    });
    const html = renderToStaticMarkup(element);

    expect(html).toContain("No operating-company relationship is stored for this company yet.");
    expect(html).toContain("No contacts are stored for this company.");
    expect(html).toContain("No QuickBooks source accounts are stored for this company.");
    expect(html).toContain("No QuickBooks identity-match records are stored for this company.");
    expect(html).toContain("No stored sales-pipeline lead exists for this company.");
    expect(html).toContain("No opportunity signals are stored for this company.");
    expect(html).toContain("No TradeMining import records are stored for this company.");
  });

  it("renders not found for unknown or cross-tenant company identifiers", async () => {
    prismaTest.model("company").findFirst.mockResolvedValue(null);
    await expect(
      CustomerIntelligenceCompanyDetailPage({
        params: Promise.resolve({ companyId: "company-foreign" })
      })
    ).rejects.toThrow("NEXT_NOT_FOUND");
  });
});
