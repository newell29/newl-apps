import {
  IntegrationProvider,
  IntegrationStatus,
  PlatformRole
} from "@prisma/client";
import { readFileSync } from "node:fs";
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
// boundary runs against the mocked DB exactly like the foundation suite.
vi.mock("@/server/db", () => ({
  prisma: prismaTest.proxy
}));

// The route handlers build their own context; the association action receives
// one directly, so this mock only feeds the connect/callback routes. The role
// is a plain string here: PlatformRole values are the same strings at runtime.
const routeContext = vi.hoisted(() => ({
  value: {
    userId: "user-1",
    userEmail: "user@example.com",
    userName: "User",
    role: "ADMIN",
    tenantId: "tenant-1",
    tenantSlug: "tenant-1",
    tenantName: "Tenant 1"
  } as {
    userId: string;
    userEmail: string;
    userName: string;
    role: string;
    tenantId: string;
    tenantSlug: string;
    tenantName: string;
  }
}));
vi.mock("@/server/tenant-context", () => ({
  getAuthenticatedContext: async () => routeContext.value
}));

import { GET as quickBooksConnectGET } from "@/app/api/integrations/quickbooks/connect/route";
import { GET as quickBooksCallbackGET } from "@/app/api/integrations/quickbooks/callback/route";
import { associateQuickBooksCredential } from "@/modules/customer-intelligence/actions";
import { QuickBooksAssociationError } from "@/modules/customer-intelligence/quickbooks-association-error";
import {
  getExistingQuickBooksAssociationOptions,
  resolveExistingQuickBooksAssociations
} from "@/modules/customer-intelligence/existing-quickbooks-association";
import { AuthorizationError } from "@/server/auth/authorization";
import {
  buildQuickBooksAuthorizationUrl,
  getQuickBooksConnectionName,
  getQuickBooksRedirectUri,
  isQuickBooksOperatingCompanySlug,
  parseQuickBooksState,
  QUICKBOOKS_APPROVED_REDIRECT_URI,
  quickBooksLegalEntityToSlug,
  quickBooksSlugToLegalEntity,
  type QuickBooksOperatingCompanySlug
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

function setQuickBooksEnv(overrides: Record<string, string> = {}) {
  for (const key of QB_ENV_KEYS) {
    savedEnv[key] = process.env[key];
  }
  process.env.QUICKBOOKS_CLIENT_ID = overrides.QUICKBOOKS_CLIENT_ID ?? "qb-test-client-id";
  process.env.QUICKBOOKS_CLIENT_SECRET = overrides.QUICKBOOKS_CLIENT_SECRET ?? "qb-test-client-secret";
  process.env.QUICKBOOKS_REDIRECT_URI = overrides.QUICKBOOKS_REDIRECT_URI ?? "";
  if (overrides.QUICKBOOKS_REDIRECT_URI === undefined) {
    delete process.env.QUICKBOOKS_REDIRECT_URI;
  }
  process.env.QUICKBOOKS_ENVIRONMENT = overrides.QUICKBOOKS_ENVIRONMENT ?? "production";
  process.env.AUTH_SECRET = overrides.AUTH_SECRET ?? "test-auth-secret-for-quickbooks-state";
  process.env.AUTH_URL = overrides.AUTH_URL ?? "https://newl-apps.vercel.app";
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

function activeQuickBooksCredential(overrides: Record<string, unknown> = {}) {
  return {
    id: "cred-qb-1",
    tenantId: "tenant-a",
    provider: IntegrationProvider.QUICKBOOKS,
    status: IntegrationStatus.ACTIVE,
    publicConfig: { realmId: "realm-1", legalEntity: "NEWL_WORLDWIDE" },
    ...overrides
  };
}

afterEach(() => {
  restoreQuickBooksEnv();
  vi.unstubAllGlobals();
});

describe("quickbooks.ts connection model (CP-02B-1)", () => {
  it("keys all three operating companies by stable slug and bridges the legacy legal-entity keys", () => {
    expect(isQuickBooksOperatingCompanySlug("newl-worldwide")).toBe(true);
    expect(isQuickBooksOperatingCompanySlug("newl-usa")).toBe(true);
    expect(isQuickBooksOperatingCompanySlug("newells-express")).toBe(true);
    // Legacy enum keys are not slugs; they remain the stored representation.
    expect(isQuickBooksOperatingCompanySlug("NEWL_WORLDWIDE")).toBe(false);
    expect(isQuickBooksOperatingCompanySlug("NEWL_USA")).toBe(false);
    expect(isQuickBooksOperatingCompanySlug("newells")).toBe(false);

    expect(quickBooksSlugToLegalEntity("newl-worldwide")).toBe("NEWL_WORLDWIDE");
    expect(quickBooksSlugToLegalEntity("newl-usa")).toBe("NEWL_USA");
    expect(quickBooksSlugToLegalEntity("newells-express")).toBe("NEWELLS_EXPRESS");
    expect(quickBooksSlugToLegalEntity("unknown")).toBeNull();

    expect(quickBooksLegalEntityToSlug("NEWL_WORLDWIDE")).toBe("newl-worldwide");
    expect(quickBooksLegalEntityToSlug("NEWL_USA")).toBe("newl-usa");
    expect(quickBooksLegalEntityToSlug("NEWELLS_EXPRESS")).toBe("newells-express");
    expect(quickBooksLegalEntityToSlug("NOT_A_LEGAL_ENTITY")).toBeNull();
  });

  it("keeps the two legacy connection names and adds the third operating company", () => {
    expect(getQuickBooksConnectionName("NEWL_WORLDWIDE")).toBe("QuickBooks - Newl Worldwide");
    expect(getQuickBooksConnectionName("NEWL_USA")).toBe("QuickBooks - Newl USA");
    expect(getQuickBooksConnectionName("NEWELLS_EXPRESS")).toBe(
      "QuickBooks - Newell's Express and Warehousing Ltd."
    );
  });

  it("defaults the redirect URI to the approved shared-app URL (CP-02B-1-Q2 SAME_APP)", () => {
    const original = process.env.QUICKBOOKS_REDIRECT_URI;
    try {
      delete process.env.QUICKBOOKS_REDIRECT_URI;
      expect(getQuickBooksRedirectUri()).toBe(QUICKBOOKS_APPROVED_REDIRECT_URI);
      expect(QUICKBOOKS_APPROVED_REDIRECT_URI).toBe(
        "https://newl-apps.vercel.app/api/integrations/quickbooks/callback"
      );

      process.env.QUICKBOOKS_REDIRECT_URI = "https://preview.example.com/api/integrations/quickbooks/callback";
      expect(getQuickBooksRedirectUri()).toBe(
        "https://preview.example.com/api/integrations/quickbooks/callback"
      );
    } finally {
      if (original === undefined) {
        delete process.env.QUICKBOOKS_REDIRECT_URI;
      } else {
        process.env.QUICKBOOKS_REDIRECT_URI = original;
      }
    }
  });

  it("embeds the operating-company slug and tenant in the signed OAuth state", () => {
    setQuickBooksEnv();

    const authorizationUrl = buildQuickBooksAuthorizationUrl({
      tenantId: "tenant-1",
      operatingCompanySlug: "newells-express",
      returnTo: "/settings"
    });
    const url = new URL(authorizationUrl);
    expect(url.origin + url.pathname).toBe("https://appcenter.intuit.com/connect/oauth2");
    expect(url.searchParams.get("redirect_uri")).toBe(QUICKBOOKS_APPROVED_REDIRECT_URI);
    expect(url.searchParams.get("scope")).toBe("com.intuit.quickbooks.accounting");

    const parsed = parseQuickBooksState(url.searchParams.get("state")!);
    expect(parsed.tenantId).toBe("tenant-1");
    expect(parsed.operatingCompanySlug).toBe("newells-express");
  });

  it("rejects a tampered OAuth state", () => {
    setQuickBooksEnv();
    expect(() => parseQuickBooksState("v1.dGFtcGVyZWQ.signature")).toThrow(
      /state signature is invalid/
    );
  });
});

describe("quickbooks connect route (operating-company keyed)", () => {
  beforeEach(() => {
    prismaTest.reset();
    routeContext.value = {
      ...routeContext.value,
      role: "ADMIN",
      tenantId: "tenant-1"
    };
  });

  it("starts a connection for every one of the three operating companies", async () => {
    setQuickBooksEnv();

    for (const slug of ["newl-worldwide", "newl-usa", "newells-express"]) {
      prismaTest.reset();
      const response = await quickBooksConnectGET(
        new Request(`https://newl.test/api/integrations/quickbooks/connect?entity=${slug}`)
      );

      expect(response.status).toBe(302);
      const location = response.headers.get("location")!;
      const authUrl = new URL(location);
      expect(authUrl.origin + authUrl.pathname).toBe("https://appcenter.intuit.com/connect/oauth2");
      expect(authUrl.searchParams.get("redirect_uri")).toBe(QUICKBOOKS_APPROVED_REDIRECT_URI);

      const parsed = parseQuickBooksState(authUrl.searchParams.get("state")!);
      expect(parsed.tenantId).toBe("tenant-1");
      expect(parsed.operatingCompanySlug).toBe(slug);
    }
  });

  it("rejects anything that is not one of the three operating-company slugs", async () => {
    setQuickBooksEnv();

    for (const entity of ["NEWL_WORLDWIDE", "NEWL_USA", "acme", "newells", ""]) {
      prismaTest.reset();
      const response = await quickBooksConnectGET(
        new Request(`https://newl.test/api/integrations/quickbooks/connect?entity=${encodeURIComponent(entity)}`)
      );
      expect(response.status).toBe(400);
      expect(response.headers.get("location")).toBeNull();
    }
  });

  it("requires an admin before any OAuth URL is produced", async () => {
    setQuickBooksEnv();
    routeContext.value = { ...routeContext.value, role: "SALES" };

    const response = await quickBooksConnectGET(
      new Request("https://newl.test/api/integrations/quickbooks/connect?entity=newells-express")
    );

    expect(response.status).toBe(500);
    expect(response.headers.get("location")).toBeNull();
  });
});

describe("quickbooks callback route (three operating companies)", () => {
  beforeEach(() => {
    prismaTest.reset();
    routeContext.value = {
      ...routeContext.value,
      role: "ADMIN",
      tenantId: "tenant-1"
    };
  });

  function buildState(tenantId = "tenant-1", slug: QuickBooksOperatingCompanySlug = "newells-express") {
    const authorizationUrl = buildQuickBooksAuthorizationUrl({
      tenantId,
      operatingCompanySlug: slug,
      returnTo: "/settings"
    });
    return new URL(authorizationUrl).searchParams.get("state")!;
  }

  function stubQuickBooksFetch() {
    const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const href = typeof input === "string" ? input : input.toString();
      if (href.includes("oauth.platform.intuit.com")) {
        expect(init?.method).toBe("POST");
        return new Response(
          JSON.stringify({
            access_token: "synthetic-access-token",
            refresh_token: "synthetic-refresh-token",
            expires_in: 3600,
            x_refresh_token_expires_in: 86400,
            token_type: "bearer"
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      if (href.includes("quickbooks.api.intuit.com")) {
        return new Response(
          JSON.stringify({
            CompanyInfo: { CompanyName: "Newell's Express and Warehousing Ltd." }
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      throw new Error(`Unexpected fetch in callback test: ${href}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("completes a connection for the third operating company without touching the two existing ones", async () => {
    setQuickBooksEnv();
    stubQuickBooksFetch();

    prismaTest.model("integrationCredential").findFirst.mockResolvedValue(null);
    prismaTest.model("integrationCredential").create.mockImplementation(
      ({ data }: { data: Record<string, unknown> }) => ({ id: "cred-newells", ...data })
    );

    const state = buildState("tenant-1", "newells-express");
    const response = await quickBooksCallbackGET(
      new Request(
        `https://newl.test/api/integrations/quickbooks/callback?code=abc&realmId=realm-123&state=${encodeURIComponent(state)}`
      )
    );

    expect(response.status).toBe(302);
    const location = response.headers.get("location")!;
    expect(location).toContain("quickbooks=connected");
    expect(location).toContain("entity=newells-express");

    const createArg = prismaTest.model("integrationCredential").create.mock.calls[0][0] as {
      data: Record<string, unknown>;
    };
    expect(createArg.data.tenantId).toBe("tenant-1");
    expect(createArg.data.provider).toBe(IntegrationProvider.QUICKBOOKS);
    expect(createArg.data.status).toBe(IntegrationStatus.ACTIVE);
    expect(createArg.data.name).toBe("QuickBooks - Newell's Express and Warehousing Ltd.");
    const publicConfig = createArg.data.publicConfig as Record<string, unknown>;
    expect(publicConfig.legalEntity).toBe("NEWELLS_EXPRESS");
    expect(publicConfig.realmId).toBe("realm-123");
    // The secrets stay encrypted in the credential secretRef and never appear
    // in the stored public config or the redirect.
    expect(JSON.stringify(createArg.data)).not.toContain("synthetic-access-token");
  });

  it("preserves the two existing connections: Newl Worldwide and Newl USA still map to their legacy keys", async () => {
    setQuickBooksEnv();
    stubQuickBooksFetch();

    for (const [slug, legalEntity, name] of [
      ["newl-worldwide", "NEWL_WORLDWIDE", "QuickBooks - Newl Worldwide"],
      ["newl-usa", "NEWL_USA", "QuickBooks - Newl USA"]
    ] as const) {
      prismaTest.reset();
      prismaTest.model("integrationCredential").findFirst.mockResolvedValue(null);
      prismaTest.model("integrationCredential").create.mockImplementation(
        ({ data }: { data: Record<string, unknown> }) => ({ id: `cred-${slug}`, ...data })
      );

      const state = buildState("tenant-1", slug);
      const response = await quickBooksCallbackGET(
        new Request(
          `https://newl.test/api/integrations/quickbooks/callback?code=abc&realmId=realm-${slug}&state=${encodeURIComponent(state)}`
        )
      );

      expect(response.status).toBe(302);
      const createArg = prismaTest.model("integrationCredential").create.mock.calls[0][0] as {
        data: Record<string, unknown>;
      };
      const publicConfig = createArg.data.publicConfig as Record<string, unknown>;
      expect(publicConfig.legalEntity).toBe(legalEntity);
      expect(createArg.data.name).toBe(name);
      expect(publicConfig.realmId).toBe(`realm-${slug}`);
    }
  });

  it("updates the matching existing connection instead of duplicating it", async () => {
    setQuickBooksEnv();
    stubQuickBooksFetch();

    prismaTest.model("integrationCredential").findFirst.mockResolvedValue({ id: "cred-existing" });
    prismaTest.model("integrationCredential").update.mockImplementation(
      ({ data }: { data: Record<string, unknown> }) => ({ id: "cred-existing", ...data })
    );

    const state = buildState("tenant-1", "newl-worldwide");
    const response = await quickBooksCallbackGET(
      new Request(
        `https://newl.test/api/integrations/quickbooks/callback?code=abc&realmId=realm-1&state=${encodeURIComponent(state)}`
      )
    );

    expect(response.status).toBe(302);
    const updateArg = prismaTest.model("integrationCredential").update.mock.calls[0][0] as {
      where: { id: string };
      data: Record<string, unknown>;
    };
    expect(updateArg.where.id).toBe("cred-existing");
    expect((updateArg.data.publicConfig as Record<string, unknown>).legalEntity).toBe(
      "NEWL_WORLDWIDE"
    );
    expect(prismaTest.model("integrationCredential").create.mock.calls.length).toBe(0);
  });

  it("redirects to settings with an error when callback params are missing", async () => {
    setQuickBooksEnv();
    const response = await quickBooksCallbackGET(
      new Request("https://newl.test/api/integrations/quickbooks/callback")
    );
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toContain("quickbooks=error");
  });

  it("redirects to settings with a tenant-mismatch error when the state belongs to another tenant", async () => {
    setQuickBooksEnv();
    const state = buildState("tenant-other", "newells-express");
    const response = await quickBooksCallbackGET(
      new Request(
        `https://newl.test/api/integrations/quickbooks/callback?code=abc&realmId=realm-123&state=${encodeURIComponent(state)}`
      )
    );
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toContain("tenant-mismatch");
    // No credential write is attempted for a foreign tenant.
    expect(prismaTest.model("integrationCredential").create.mock.calls.length).toBe(0);
    expect(prismaTest.model("integrationCredential").update.mock.calls.length).toBe(0);
  });

  it("rejects an invalid or tampered state before any credential write", async () => {
    setQuickBooksEnv();
    const response = await quickBooksCallbackGET(
      new Request(
        `https://newl.test/api/integrations/quickbooks/callback?code=abc&realmId=realm-123&state=${encodeURIComponent("v1.tampered.signature")}`
      )
    );
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toContain("quickbooks=error");
    expect(prismaTest.model("integrationCredential").create.mock.calls.length).toBe(0);
    expect(prismaTest.model("integrationCredential").update.mock.calls.length).toBe(0);
  });

  it("requires an admin at the callback", async () => {
    setQuickBooksEnv();
    routeContext.value = { ...routeContext.value, role: "SALES" };
    const state = buildState("tenant-1", "newells-express");
    const response = await quickBooksCallbackGET(
      new Request(
        `https://newl.test/api/integrations/quickbooks/callback?code=abc&realmId=realm-123&state=${encodeURIComponent(state)}`
      )
    );
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toContain("quickbooks=error");
    expect(prismaTest.model("integrationCredential").create.mock.calls.length).toBe(0);
    expect(prismaTest.model("integrationCredential").update.mock.calls.length).toBe(0);
  });
});

describe("associateQuickBooksCredential (ADMIN-only, audited, tenant-scoped)", () => {
  beforeEach(() => {
    prismaTest.reset();
    configureAuth();
  });

  const VALID_INPUT = {
    operatingCompanyId: "oc-ww",
    quickBooksCredentialId: "cred-qb-1",
    quickBooksRealmId: "realm-1"
  };

  it("associates an ACTIVE QUICKBOOKS credential with a matching realm and audits it", async () => {
    prismaTest.model("operatingCompany").findFirst.mockResolvedValue({
      id: "oc-ww",
      slug: "newl-worldwide",
      tenantId: "tenant-a",
      quickBooksRealmId: null,
      quickBooksCredentialId: null
    });
    prismaTest.model("integrationCredential").findFirst.mockResolvedValue(
      activeQuickBooksCredential()
    );
    prismaTest.model("operatingCompany").update.mockImplementation(
      ({ data }: { data: Record<string, unknown> }) => ({
        id: "oc-ww",
        slug: "newl-worldwide",
        tenantId: "tenant-a",
        quickBooksRealmId: null,
        quickBooksCredentialId: null,
        ...data
      })
    );

    const updated = await associateQuickBooksCredential(ADMIN, VALID_INPUT);

    expect(updated.quickBooksRealmId).toBe("realm-1");
    expect(updated.quickBooksCredentialId).toBe("cred-qb-1");

    const updateArg = prismaTest.model("operatingCompany").update.mock.calls[0][0] as {
      where: { tenantId_id: Record<string, unknown> };
      data: Record<string, unknown>;
    };
    expect(updateArg.where.tenantId_id.tenantId).toBe("tenant-a");
    expect(updateArg.where.tenantId_id.id).toBe("oc-ww");
    expect(updateArg.data.quickBooksRealmId).toBe("realm-1");
    expect(updateArg.data.quickBooksCredentialId).toBe("cred-qb-1");
    expect(prismaTest.model("integrationCredential").update).not.toHaveBeenCalled();

    const audit = prismaTest.model("auditLog").create.mock.calls[0][0] as {
      data: Record<string, unknown>;
    };
    expect(audit.data.tenantId).toBe("tenant-a");
    expect(audit.data.actorUserId).toBe("user-1");
    expect(audit.data.action).toBe("customer-intelligence.operating-company.quickbooks-associated");
    expect(audit.data.entityType).toBe("OperatingCompany");
    expect(audit.data.entityId).toBe("oc-ww");
  });

  it("writes the association and audit in one transaction", async () => {
    let transactionActive = false;
    prismaTest.transaction.mockImplementation(async (callback) => {
      transactionActive = true;
      try {
        return await callback(prismaTest.proxy);
      } finally {
        transactionActive = false;
      }
    });
    prismaTest.model("operatingCompany").findFirst.mockResolvedValue({
      id: "oc-ww",
      slug: "newl-worldwide",
      tenantId: "tenant-a",
      quickBooksRealmId: null,
      quickBooksCredentialId: null
    });
    prismaTest.model("integrationCredential").findFirst.mockResolvedValue(
      activeQuickBooksCredential()
    );
    prismaTest.model("operatingCompany").findMany.mockResolvedValue([]);
    prismaTest.model("operatingCompany").update.mockResolvedValue({
      id: "oc-ww",
      quickBooksRealmId: "realm-1",
      quickBooksCredentialId: "cred-qb-1"
    });
    prismaTest.model("auditLog").create.mockImplementation(() => {
      expect(transactionActive).toBe(true);
      return { id: "audit-1" };
    });

    await associateQuickBooksCredential(ADMIN, VALID_INPUT);

    expect(prismaTest.transaction).toHaveBeenCalledTimes(1);
    expect(prismaTest.model("auditLog").create).toHaveBeenCalledTimes(1);
  });

  it("fails the transaction with a safe code when its audit cannot be written", async () => {
    prismaTest.model("operatingCompany").findFirst.mockResolvedValue({
      id: "oc-ww",
      slug: "newl-worldwide",
      tenantId: "tenant-a",
      quickBooksRealmId: null,
      quickBooksCredentialId: null
    });
    prismaTest.model("integrationCredential").findFirst.mockResolvedValue(
      activeQuickBooksCredential()
    );
    prismaTest.model("operatingCompany").findMany.mockResolvedValue([]);
    prismaTest.model("operatingCompany").update.mockResolvedValue({
      id: "oc-ww",
      quickBooksRealmId: "realm-1",
      quickBooksCredentialId: "cred-qb-1"
    });
    prismaTest.model("auditLog").create.mockRejectedValue(
      new Error("synthetic database detail that must not escape")
    );

    await expect(associateQuickBooksCredential(ADMIN, VALID_INPUT)).rejects.toMatchObject({
      name: "QuickBooksAssociationError",
      code: "AUDIT_FAILED",
      message: "The association audit record could not be written."
    } satisfies Partial<QuickBooksAssociationError>);
    expect(prismaTest.model("integrationCredential").update).not.toHaveBeenCalled();
  });

  it.each([
    ["credential", { quickBooksCredentialId: "cred-qb-1", quickBooksRealmId: "realm-other" }],
    ["realm", { quickBooksCredentialId: "cred-qb-other", quickBooksRealmId: "realm-1" }]
  ])(
    "rejects a QuickBooks %s already associated with another operating company",
    async (_kind, conflictingAssociation) => {
      prismaTest.model("operatingCompany").findFirst.mockResolvedValue({
        id: "oc-ww",
        slug: "newl-worldwide",
        tenantId: "tenant-a",
        quickBooksRealmId: null,
        quickBooksCredentialId: null
      });
      prismaTest.model("integrationCredential").findFirst.mockResolvedValue(
        activeQuickBooksCredential()
      );
      prismaTest.model("operatingCompany").findMany.mockResolvedValue([
        {
          id: "oc-usa",
          tenantId: "tenant-a",
          displayName: "Newl USA",
          ...conflictingAssociation
        }
      ]);

      await expect(associateQuickBooksCredential(ADMIN, VALID_INPUT)).rejects.toThrow(
        /already associated with another operating company/
      );

      expect(prismaTest.transaction).toHaveBeenCalledTimes(1);
      expect(prismaTest.queryRaw).toHaveBeenCalledTimes(2);
      expect(prismaTest.model("operatingCompany").update).not.toHaveBeenCalled();
      assertNoDatabaseWrites();
    }
  );

  it("rejects an operating company from another tenant before any write", async () => {
    prismaTest.model("operatingCompany").findFirst.mockResolvedValue(null);
    await expect(associateQuickBooksCredential(ADMIN, VALID_INPUT)).rejects.toThrow(
      /Operating company does not exist in this tenant/
    );
    assertNoDatabaseWrites();
  });

  it("rejects a credential from another tenant before any write", async () => {
    prismaTest.model("operatingCompany").findFirst.mockResolvedValue({
      id: "oc-ww",
      slug: "newl-worldwide",
      tenantId: "tenant-a"
    });
    prismaTest.model("integrationCredential").findFirst.mockResolvedValue(null);

    await expect(associateQuickBooksCredential(ADMIN, VALID_INPUT)).rejects.toThrow(
      /QuickBooks credential does not exist in this tenant/
    );
    assertNoDatabaseWrites();
  });

  it("rejects a credential whose provider is not QUICKBOOKS", async () => {
    prismaTest.model("operatingCompany").findFirst.mockResolvedValue({
      id: "oc-ww",
      slug: "newl-worldwide",
      tenantId: "tenant-a"
    });
    prismaTest.model("integrationCredential").findFirst.mockResolvedValue(
      activeQuickBooksCredential({ provider: IntegrationProvider.UPS })
    );

    await expect(associateQuickBooksCredential(ADMIN, VALID_INPUT)).rejects.toThrow(
      /not a QuickBooks credential/
    );
    assertNoDatabaseWrites();
  });

  it("rejects an inactive credential", async () => {
    prismaTest.model("operatingCompany").findFirst.mockResolvedValue({
      id: "oc-ww",
      slug: "newl-worldwide",
      tenantId: "tenant-a"
    });
    prismaTest.model("integrationCredential").findFirst.mockResolvedValue(
      activeQuickBooksCredential({ status: IntegrationStatus.DISABLED })
    );

    await expect(associateQuickBooksCredential(ADMIN, VALID_INPUT)).rejects.toThrow(
      /must be ACTIVE/
    );
    assertNoDatabaseWrites();
  });

  it("rejects a realm that does not match the credential's stored realm", async () => {
    prismaTest.model("operatingCompany").findFirst.mockResolvedValue({
      id: "oc-ww",
      slug: "newl-worldwide",
      tenantId: "tenant-a"
    });
    prismaTest.model("integrationCredential").findFirst.mockResolvedValue(
      activeQuickBooksCredential({ publicConfig: { realmId: "realm-different" } })
    );

    await expect(
      associateQuickBooksCredential(ADMIN, {
        ...VALID_INPUT,
        quickBooksRealmId: "realm-1"
      })
    ).rejects.toThrow(/does not match the realm/);
    assertNoDatabaseWrites();
  });

  it("rejects a credential that stores no realm ID", async () => {
    prismaTest.model("operatingCompany").findFirst.mockResolvedValue({
      id: "oc-ww",
      slug: "newl-worldwide",
      tenantId: "tenant-a"
    });
    prismaTest.model("integrationCredential").findFirst.mockResolvedValue(
      activeQuickBooksCredential({ publicConfig: { legalEntity: "NEWL_WORLDWIDE" } })
    );

    await expect(associateQuickBooksCredential(ADMIN, VALID_INPUT)).rejects.toThrow(
      /does not store a realm ID/
    );
    assertNoDatabaseWrites();
  });

  it("rejects a credential whose legal entity belongs to a different operating company", async () => {
    prismaTest.model("operatingCompany").findFirst.mockResolvedValue({
      id: "oc-ww",
      slug: "newl-worldwide",
      tenantId: "tenant-a"
    });
    prismaTest.model("integrationCredential").findFirst.mockResolvedValue(
      activeQuickBooksCredential({
        publicConfig: { realmId: "realm-1", legalEntity: "NEWL_USA" }
      })
    );

    await expect(associateQuickBooksCredential(ADMIN, VALID_INPUT)).rejects.toThrow(
      /legal entity does not match/
    );
    assertNoDatabaseWrites();
  });

  it("denies every non-admin role and never reaches a database write", async () => {
    const calls: Array<[string, (c: AuthenticatedContext) => Promise<unknown>]> = [
      ["SALES", (c) => associateQuickBooksCredential(c, VALID_INPUT)],
      ["OPERATIONS", (c) => associateQuickBooksCredential(c, VALID_INPUT)],
      ["READ_ONLY", (c) => associateQuickBooksCredential(c, VALID_INPUT)],
      ["FINANCE", (c) => associateQuickBooksCredential(c, VALID_INPUT)]
    ];

    for (const [name, call] of calls) {
      prismaTest.reset();
      configureAuth();
      const role =
        name === "SALES" ? SALES : name === "OPERATIONS" ? OPERATIONS : name === "READ_ONLY" ? READ_ONLY : FINANCE;
      await expect(call(role), `${name} must be denied`).rejects.toBeInstanceOf(AuthorizationError);
      assertNoDatabaseWrites();
    }
  });

  it("denies FINANCE even when the tenant grants mutation access (association is ADMIN-only)", async () => {
    prismaTest.reset();
    configureAuth({ canMutate: true });
    await expect(associateQuickBooksCredential(FINANCE, VALID_INPUT)).rejects.toBeInstanceOf(
      AuthorizationError
    );
    assertNoDatabaseWrites();

    prismaTest.reset();
    configureAuth({ canMutate: false });
    await expect(associateQuickBooksCredential(FINANCE, VALID_INPUT)).rejects.toBeInstanceOf(
      AuthorizationError
    );
    assertNoDatabaseWrites();
  });
});

describe("settings surface guard (CP-02B-1)", () => {
  it("shows all three operating companies and never renders secrets in the settings page", () => {
    const page = [
      readFileSync("src/app/(authenticated)/settings/page.tsx", "utf8"),
      readFileSync(
        "src/modules/customer-intelligence/components/existing-quickbooks-association-control.tsx",
        "utf8"
      )
    ].join("\n");
    expect(page).toContain("newl-worldwide");
    expect(page).toContain("newl-usa");
    expect(page).toContain("newells-express");
    expect(page).toContain("Newell's Express and Warehousing Ltd.");
    expect(page).toContain("Associate existing connection");
    expect(page).toContain("Customer Intelligence:");
    // The page renders realm/company/environment metadata only.
    expect(page).not.toContain("secretRef");
    expect(page).not.toContain("refreshToken");
    expect(page).not.toContain("accessTokenExpiresAt");
  });

  it("maps stored QuickBooks connections to slugs for the settings surface", () => {
    const queries = readFileSync("src/modules/settings/queries.ts", "utf8");
    expect(queries).toContain("operatingCompanySlug");
    expect(queries).toContain("quickBooksLegalEntityToSlug");
  });

  it("documents the three operating companies and the association validation in the module docs", () => {
    const integrations = readFileSync(
      "docs/modules/customer-intelligence/integrations.md",
      "utf8"
    );
    expect(integrations).toContain("newl-worldwide");
    expect(integrations).toContain("newl-usa");
    expect(integrations).toContain("newells-express");
  });
});

describe("existing QuickBooks connection discovery", () => {
  beforeEach(() => {
    prismaTest.reset();
    configureAuth();
  });

  it("discovers an exact, active, secret-backed connection for each approved company without exposing IDs or secrets", async () => {
    prismaTest.model("operatingCompany").findMany.mockResolvedValue([
      { id: "oc-ww", slug: "newl-worldwide", quickBooksCredentialId: null, quickBooksRealmId: null },
      { id: "oc-usa", slug: "newl-usa", quickBooksCredentialId: null, quickBooksRealmId: null },
      { id: "oc-express", slug: "newells-express", quickBooksCredentialId: null, quickBooksRealmId: null }
    ]);
    prismaTest.model("integrationCredential").findMany.mockResolvedValue([
      { id: "cred-ww", publicConfig: { legalEntity: "NEWL_WORLDWIDE", realmId: "realm-ww", companyName: "Worldwide", environment: "production" } },
      { id: "cred-usa", publicConfig: { legalEntity: "NEWL_USA", realmId: "realm-usa", companyName: "USA", environment: "production" } },
      { id: "cred-express", publicConfig: { legalEntity: "NEWELLS_EXPRESS", realmId: "realm-express", companyName: "Express", environment: "production" } }
    ]);

    const options = await getExistingQuickBooksAssociationOptions(ADMIN);

    expect(options.map((option) => [option.operatingCompanySlug, option.status])).toEqual([
      ["newl-worldwide", "AVAILABLE"],
      ["newl-usa", "AVAILABLE"],
      ["newells-express", "AVAILABLE"]
    ]);
    expect(JSON.stringify(options)).not.toContain("cred-");
    expect(JSON.stringify(options)).not.toContain("realm-");
    expect(JSON.stringify(options)).not.toContain("secret");

    const companyWhere = prismaTest.model("operatingCompany").findMany.mock.calls[0][0].where;
    const credentialWhere = prismaTest.model("integrationCredential").findMany.mock.calls[0][0].where;
    expect(companyWhere.tenantId).toBe("tenant-a");
    expect(companyWhere).not.toHaveProperty("slug");
    expect(credentialWhere.tenantId).toBe("tenant-a");
    expect(credentialWhere.provider).toBe(IntegrationProvider.QUICKBOOKS);
    expect(credentialWhere.status).toBe(IntegrationStatus.ACTIVE);
    expect(credentialWhere.secretRef).toEqual({ not: null });
  });

  it("fails closed for ambiguous and conflicting matches", async () => {
    prismaTest.model("operatingCompany").findMany.mockResolvedValue([
      { id: "oc-ww", slug: "newl-worldwide", quickBooksCredentialId: null, quickBooksRealmId: null },
      { id: "oc-usa", slug: "newl-usa", quickBooksCredentialId: "different", quickBooksRealmId: null }
    ]);
    prismaTest.model("integrationCredential").findMany.mockResolvedValue([
      { id: "cred-ww-1", publicConfig: { legalEntity: "NEWL_WORLDWIDE", realmId: "realm-ww-1" } },
      { id: "cred-ww-2", publicConfig: { legalEntity: "NEWL_WORLDWIDE", realmId: "realm-ww-2" } },
      { id: "cred-usa", publicConfig: { legalEntity: "NEWL_USA", realmId: "realm-usa" } }
    ]);

    const resolved = await resolveExistingQuickBooksAssociations(ADMIN);
    expect(resolved.find((item) => item.operatingCompanySlug === "newl-worldwide")?.status).toBe("AMBIGUOUS");
    expect(resolved.find((item) => item.operatingCompanySlug === "newl-usa")?.status).toBe("CONFLICT");
    expect(resolved.find((item) => item.operatingCompanySlug === "newells-express")?.status).toBe("MISSING_OPERATING_COMPANY");
  });

  it("detects a credential claimed by any tenant operating company, including a legacy slug", async () => {
    prismaTest.model("operatingCompany").findMany.mockResolvedValue([
      {
        id: "oc-usa",
        slug: "newl-usa",
        quickBooksCredentialId: null,
        quickBooksRealmId: null
      },
      {
        id: "oc-legacy",
        slug: "legacy-usa",
        quickBooksCredentialId: "cred-usa",
        quickBooksRealmId: "realm-usa"
      }
    ]);
    prismaTest.model("integrationCredential").findMany.mockResolvedValue([
      {
        id: "cred-usa",
        publicConfig: { legalEntity: "NEWL_USA", realmId: "realm-usa" }
      }
    ]);

    const resolved = await resolveExistingQuickBooksAssociations(ADMIN);

    expect(resolved.find((item) => item.operatingCompanySlug === "newl-usa")?.status).toBe(
      "CONFLICT"
    );
  });
});
