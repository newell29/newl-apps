import { IntegrationProvider, IntegrationStatus } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TenantContext } from "@/server/tenant-context";

const findModuleAccess = vi.fn();
const findCredentials = vi.fn();
const getLocalUpsAccountMetadata = vi.fn();

vi.mock("@/server/db", () => ({
  prisma: {
    tenantModuleAccess: {
      findMany: (...args: unknown[]) => findModuleAccess(...args)
    },
    integrationCredential: {
      findMany: (...args: unknown[]) => findCredentials(...args)
    }
  }
}));

vi.mock("@/server/integrations/ups", () => ({
  getLocalUpsAccountMetadata: (...args: unknown[]) => getLocalUpsAccountMetadata(...args)
}));

import { getSettingsShell } from "@/modules/settings/queries";

const tenant: TenantContext = {
  tenantId: "tenant-7l",
  tenantSlug: "tenant-7l",
  tenantName: "Tenant 7L"
};

describe("getSettingsShell 7L contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findModuleAccess.mockResolvedValue([]);
    getLocalUpsAccountMetadata.mockResolvedValue([]);
  });

  it("keeps imported 7L carriers tenant-scoped and preserves selection/default flags", async () => {
    findCredentials.mockResolvedValue([
      {
        id: "cred-7l",
        provider: IntegrationProvider.SEVEN_L,
        name: "Imported 7L Carrier Set",
        status: IntegrationStatus.ACTIVE,
        secretRef: "secret/7l",
        publicConfig: {
          baseUrl: "https://restapi.my7l.com",
          defaultUom: "US",
          strictResult: true,
          harmonizedCharges: false,
          dryRun: false,
          carrierMode: "TENANT_SELECTED",
          carriers: [
            {
              carrierHash: "carrier-a",
              name: "Southeastern Freight",
              code: "SEFL",
              scac: "SEFL",
              defaulted: true,
              enabled: true
            },
            {
              carrierHash: "carrier-b",
              name: "Old Dominion",
              code: "ODFL",
              scac: "ODFL",
              defaulted: false,
              enabled: false
            },
            {
              carrierHash: "broken-carrier",
              name: "Broken",
              code: "BRK",
              defaulted: true,
              enabled: true
            }
          ]
        }
      }
    ]);

    const settings = await getSettingsShell(tenant);

    expect(findCredentials).toHaveBeenCalledWith({
      where: {
        tenantId: "tenant-7l",
        provider: {
          in: [IntegrationProvider.UPS, IntegrationProvider.SEVEN_L, IntegrationProvider.OPENCLAW]
        }
      },
      orderBy: {
        name: "asc"
      }
    });

    expect(settings.sevenLAccounts).toHaveLength(1);
    expect(settings.sevenLAccounts[0]).toMatchObject({
      id: "cred-7l",
      name: "Imported 7L Carrier Set",
      carrierMode: "TENANT_SELECTED",
      secretConfigured: true
    });
    expect(settings.sevenLAccounts[0].carriers).toEqual([
      {
        carrierHash: "carrier-a",
        name: "Southeastern Freight",
        code: "SEFL",
        scac: "SEFL",
        defaulted: true,
        enabled: true
      },
      {
        carrierHash: "carrier-b",
        name: "Old Dominion",
        code: "ODFL",
        scac: "ODFL",
        defaulted: false,
        enabled: false
      }
    ]);
  });

  it("does not require or expose raw 7L secrets in the settings client payload", async () => {
    findCredentials.mockResolvedValue([
      {
        id: "cred-7l",
        provider: IntegrationProvider.SEVEN_L,
        name: "Dry Run Imports",
        status: IntegrationStatus.ACTIVE,
        secretRef: null,
        publicConfig: {
          baseUrl: "https://restapi.my7l.com",
          username: "should-not-leak",
          password: "should-not-leak",
          dryRun: false,
          carriers: [
            {
              carrierHash: "carrier-a",
              name: "Southeastern Freight",
              code: "SEFL",
              scac: "SEFL"
            }
          ]
        }
      }
    ]);

    const settings = await getSettingsShell(tenant);
    const account = settings.sevenLAccounts[0] as Record<string, unknown>;

    expect(settings.sevenLAccounts).toHaveLength(1);
    expect(account.secretConfigured).toBe(false);
    expect(account.name).toBe("Dry Run Imports");
    expect(account).not.toHaveProperty("secretRef");
    expect(account).not.toHaveProperty("username");
    expect(account).not.toHaveProperty("password");
  });
});
