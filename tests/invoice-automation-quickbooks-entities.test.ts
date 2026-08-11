import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TenantContext } from "@/server/tenant-context";

const mocks = vi.hoisted(() => ({
  prisma: {
    invoiceAutomationQuickBooksEntity: {
      findMany: vi.fn(),
      count: vi.fn(),
      findFirst: vi.fn()
    },
    invoiceAutomationEntityAlias: {
      findMany: vi.fn()
    }
  }
}));

vi.mock("@/server/db", () => ({
  prisma: mocks.prisma
}));

import { getInvoiceAutomationQuickBooksEntityOptions } from "@/modules/invoice-automation/quickbooks-entities";

const tenant: TenantContext = {
  tenantId: "tenant-1",
  tenantSlug: "tenant-one",
  tenantName: "Tenant One"
};

describe("invoice automation QuickBooks entity options", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("limits invoice automation QuickBooks options and learned aliases to Newl Worldwide realms", async () => {
    mocks.prisma.invoiceAutomationQuickBooksEntity.findMany.mockResolvedValueOnce([
      {
        entityType: "CUSTOMER",
        realmId: "realm-worldwide",
        quickBooksId: "customer-worldwide",
        displayName: "Acme Logistics",
        normalizedName: "acme logistics",
        currency: "CAD",
        legalEntity: "NEWL_WORLDWIDE"
      }
    ]);
    mocks.prisma.invoiceAutomationEntityAlias.findMany.mockResolvedValueOnce([
      {
        invoiceType: "CUSTOMER",
        normalizedAlias: "acme",
        quickBooksEntityId: "quickbooks:realm-worldwide:CUSTOMER:customer-worldwide",
        quickBooksEntityDisplayName: "Acme Logistics",
        currency: "CAD"
      },
      {
        invoiceType: "CUSTOMER",
        normalizedAlias: "acme usa",
        quickBooksEntityId: "quickbooks:realm-usa:CUSTOMER:customer-usa",
        quickBooksEntityDisplayName: "Acme Logistics USA",
        currency: "USD"
      },
      {
        invoiceType: "CUSTOMER",
        normalizedAlias: "legacy acme",
        quickBooksEntityId: "customer-legacy-without-realm",
        quickBooksEntityDisplayName: "Legacy Acme",
        currency: "CAD"
      }
    ]);

    await expect(getInvoiceAutomationQuickBooksEntityOptions(tenant)).resolves.toEqual([
      {
        id: "quickbooks:realm-worldwide:CUSTOMER:customer-worldwide",
        displayName: "Acme Logistics",
        normalizedName: "acme logistics",
        currency: "CAD",
        entityType: "CUSTOMER"
      },
      {
        id: "quickbooks:realm-worldwide:CUSTOMER:customer-worldwide",
        displayName: "Acme Logistics",
        normalizedName: "acme",
        currency: "CAD",
        entityType: "CUSTOMER"
      }
    ]);
    expect(mocks.prisma.invoiceAutomationQuickBooksEntity.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tenantId: tenant.tenantId,
          active: true,
          legalEntity: "NEWL_WORLDWIDE"
        }
      })
    );
  });
});
