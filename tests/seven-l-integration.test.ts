import { IntegrationProvider, IntegrationStatus, ModuleKey } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TenantContext } from "@/server/tenant-context";

const findModuleAccess = vi.fn();
const findCredentials = vi.fn();
const findExistingCredential = vi.fn();
const createCredential = vi.fn();
const updateCredential = vi.fn();
const findRecentJobs = vi.fn();

vi.mock("@/server/db", () => ({
  prisma: {
    tenantModuleAccess: {
      findFirst: (...args: unknown[]) => findModuleAccess(...args)
    },
    integrationCredential: {
      findMany: (...args: unknown[]) => findCredentials(...args),
      findFirst: (...args: unknown[]) => findExistingCredential(...args),
      create: (...args: unknown[]) => createCredential(...args),
      update: (...args: unknown[]) => updateCredential(...args)
    },
    automationJobRun: {
      findMany: (...args: unknown[]) => findRecentJobs(...args)
    }
  }
}));

import { getLtlRatePortalShell, seedLtlTenantDefaults } from "@/modules/ltl-rate-portal/queries";

const tenant: TenantContext = {
  tenantId: "tenant-7l",
  tenantSlug: "tenant-7l",
  tenantName: "Tenant 7L"
};

describe("7L server integration account loading", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findRecentJobs.mockResolvedValue([]);
  });

  it("returns only the preferred carrier subset configured for the tenant's live account", async () => {
    findModuleAccess.mockResolvedValue({ id: "module-access-1" });
    findCredentials.mockResolvedValue([
      {
        id: "cred-live",
        name: "Tenant Preferred LTL",
        status: IntegrationStatus.ACTIVE,
        secretRef: "secret/live",
        publicConfig: {
          baseUrl: "https://restapi.my7l.com",
          defaultUom: "US",
          strictResult: true,
          harmonizedCharges: false,
          dryRun: false,
          carrierMode: "TENANT_SELECTED",
          carriers: [
            {
              carrierHash: "preferred-1",
              name: "Southeastern Freight",
              code: "SEFL",
              scac: "SEFL",
              defaulted: true,
              enabled: true
            },
            {
              carrierHash: "preferred-2",
              name: "Old Dominion",
              code: "ODFL",
              scac: "ODFL",
              defaulted: false,
              enabled: false
            },
            {
              carrierHash: "missing-scac",
              name: "Broken Carrier",
              code: "BRK",
              defaulted: true,
              enabled: true
            }
          ]
        }
      },
      {
        id: "cred-invalid",
        name: "Ignored Invalid Record",
        status: IntegrationStatus.ACTIVE,
        secretRef: null,
        publicConfig: {
          carriers: [{ code: "BAD" }]
        }
      }
    ]);

    const shell = await getLtlRatePortalShell(tenant);

    expect(findModuleAccess).toHaveBeenCalledWith({
      where: {
        tenantId: "tenant-7l",
        enabled: true,
        module: {
          key: ModuleKey.LTL_RATE_PORTAL
        }
      },
      select: { id: true }
    });
    expect(findCredentials).toHaveBeenCalledWith({
      where: {
        tenantId: "tenant-7l",
        provider: IntegrationProvider.SEVEN_L
      },
      orderBy: [{ status: "asc" }, { name: "asc" }]
    });

    expect(shell).toMatchObject({
      moduleEnabled: true,
      hasActiveAccounts: true
    });
    expect(shell.accounts).toHaveLength(1);
    expect(shell.accounts[0]).toMatchObject({
      id: "cred-live",
      name: "Tenant Preferred LTL",
      dryRun: false,
      strictResult: true,
      harmonizedCharges: false,
      carrierMode: "TENANT_SELECTED",
      secretConfigured: true
    });
    expect(shell.accounts[0].carriers).toEqual([
      {
        carrierHash: "preferred-1",
        name: "Southeastern Freight",
        code: "SEFL",
        scac: "SEFL",
        defaulted: true,
        enabled: true
      },
      {
        carrierHash: "preferred-2",
        name: "Old Dominion",
        code: "ODFL",
        scac: "ODFL",
        defaulted: false,
        enabled: false
      }
    ]);
  });

  it("defaults seeded tenant fallback accounts to dry-run mode with the core carrier set", async () => {
    findExistingCredential.mockResolvedValue(null);

    await seedLtlTenantDefaults("tenant-seeded");

    expect(findExistingCredential).toHaveBeenCalledWith({
      where: {
        tenantId: "tenant-seeded",
        provider: IntegrationProvider.SEVEN_L,
        name: "7L Dry Run - Core LTL"
      },
      select: { id: true }
    });
    expect(createCredential).toHaveBeenCalledTimes(1);
    expect(createCredential).toHaveBeenCalledWith({
      data: {
        tenantId: "tenant-seeded",
        provider: IntegrationProvider.SEVEN_L,
        name: "7L Dry Run - Core LTL",
        status: IntegrationStatus.ACTIVE,
        publicConfig: {
          baseUrl: "https://restapi.my7l.com",
          defaultUom: "US",
          strictResult: false,
          harmonizedCharges: true,
          dryRun: true,
          carrierMode: "TENANT_SELECTED",
          carriers: [
            {
              carrierHash: "aaa-cooper-hash",
              name: "AAA Cooper",
              code: "AAA",
              scac: "AACT",
              defaulted: true,
              enabled: true
            },
            {
              carrierHash: "estes-hash",
              name: "Estes Express",
              code: "EST",
              scac: "EXLA",
              defaulted: true,
              enabled: true
            },
            {
              carrierHash: "dayton-hash",
              name: "Dayton Freight",
              code: "DAY",
              scac: "DYLT",
              defaulted: true,
              enabled: true
            }
          ]
        }
      }
    });
    expect(updateCredential).not.toHaveBeenCalled();
  });

  it("refreshes an existing seeded fallback instead of creating a duplicate account", async () => {
    findExistingCredential.mockResolvedValue({ id: "cred-existing" });

    await seedLtlTenantDefaults("tenant-seeded");

    expect(updateCredential).toHaveBeenCalledTimes(1);
    expect(updateCredential).toHaveBeenCalledWith({
      where: { id: "cred-existing" },
      data: {
        status: IntegrationStatus.ACTIVE,
        publicConfig: {
          baseUrl: "https://restapi.my7l.com",
          defaultUom: "US",
          strictResult: false,
          harmonizedCharges: true,
          dryRun: true,
          carrierMode: "TENANT_SELECTED",
          carriers: [
            {
              carrierHash: "aaa-cooper-hash",
              name: "AAA Cooper",
              code: "AAA",
              scac: "AACT",
              defaulted: true,
              enabled: true
            },
            {
              carrierHash: "estes-hash",
              name: "Estes Express",
              code: "EST",
              scac: "EXLA",
              defaulted: true,
              enabled: true
            },
            {
              carrierHash: "dayton-hash",
              name: "Dayton Freight",
              code: "DAY",
              scac: "DYLT",
              defaulted: true,
              enabled: true
            }
          ]
        }
      }
    });
    expect(createCredential).not.toHaveBeenCalled();
  });
});
