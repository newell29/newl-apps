import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  tenant: vi.fn(),
  create: vi.fn(),
  credit: vi.fn(),
  imports: { create: vi.fn(), update: vi.fn() },
  inbound: vi.fn(),
  count: vi.fn(),
  opportunities: vi.fn()
}));
vi.mock("@/server/db", () => ({
  prisma: {
    tenant: { findUnique: mocks.tenant },
    websiteInboundSubmission: { create: mocks.create, findMany: mocks.inbound },
    websiteGrowthDataImport: mocks.imports,
    company: { count: mocks.count },
    contact: { count: mocks.count },
    lead: { count: mocks.count },
    creditCheck: { count: mocks.count }
  }
}));
vi.mock("@/modules/credit-checks/create", () => ({
  createCreditCheckFromAccountSetup: mocks.credit
}));
vi.mock("@/modules/website-growth/opportunity-store", () => ({
  createMissingWebsiteGrowthOpportunities: mocks.opportunities
}));
import { POST } from "@/app/api/website-inbound/route";
import { syncWebsiteInboundForTenant } from "@/modules/website-growth/evidence-refresh";
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("WEBSITE_INBOUND_API_TOKEN", "synthetic-test-token");
  mocks.tenant.mockResolvedValue({ id: "tenant-a" });
  mocks.create.mockResolvedValue({ id: "row-a", createdAt: new Date("2026-09-16Z") });
  mocks.credit.mockResolvedValue({ id: "credit-a" });
});
afterEach(() => vi.unstubAllEnvs());
function request(payload: unknown) {
  return new Request("https://example.com/api/website-inbound", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-newl-inbound-key": "synthetic-test-token" },
    body: JSON.stringify(payload)
  });
}
describe("existing form intake compatibility", () => {
  it.each([{ Phone: "202-555-0100" }, {}])(
    "continues accepting partial and absent contact evidence",
    async (fields) => {
      expect((await POST(request({ formType: "assessment", fields }))).status).toBe(201);
      expect(mocks.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tenantId: "tenant-a",
          formType: "assessment",
          fields,
          receivedOn: expect.any(Date)
        }),
        select: { id: true, createdAt: true }
      });
      expect(mocks.create.mock.calls[0][0].data.phoneNormalized).toBe(
        fields.Phone ? "2025550100" : null
      );
    }
  );
  it("continues routing account setups to Finance", async () => {
    await POST(request({ formType: "account_setup", fields: { Company: "Synthetic Company" } }));
    expect(mocks.credit).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: "tenant-a", formType: "account_setup" })
    );
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("does not trust client-supplied lifecycle, tenant, owner, or intake origin", async () => {
    await POST(
      request({
        formType: "assessment",
        fields: {},
        tenantId: "foreign-tenant",
        ownerUserId: "foreign-user",
        status: "WON",
        entryMethod: "MANUAL"
      })
    );
    const data = mocks.create.mock.calls[0][0].data;
    expect(data.tenantId).toBe("tenant-a");
    expect(data.status).toBeUndefined();
    expect(data.ownerUserId).toBeUndefined();
    expect(data.entryMethod).toBeUndefined();
  });
  it("keeps manual enquiries out of website form growth evidence", async () => {
    mocks.imports.create.mockResolvedValue({ id: "import-a" });
    mocks.inbound.mockResolvedValue([]);
    mocks.count.mockResolvedValue(0);
    mocks.opportunities.mockResolvedValue({ createdCount: 0, existingCount: 0 });
    const result = await syncWebsiteInboundForTenant("tenant-a");
    expect(result.rowCount).toBe(0);
    expect(mocks.inbound).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tenantId: "tenant-a",
          formType: { not: "account_setup" },
          entryMethod: "WEBSITE_FORM",
          status: { not: "TEST" },
          isTest: false,
          marketingExcludedReason: null
        },
        select: { pageUrl: true, primaryNeed: true }
      })
    );
  });

  it("preserves the raw request and stores normalized paid attribution", async () => {
    const payload = {
      formType: "assessment",
      source: "website",
      pageUrl: "https://www.newlgroup.com/contact",
      fields: { Company: "Synthetic Company" },
      utmSource: "google",
      utmMedium: "cpc",
      utmCampaign: "synthetic-search",
      gclid: "synthetic-click-id",
      landingPage: "https://www.newlgroup.com/services/warehousing?utm_source=google",
      submittedAt: "2026-09-16T14:30:00.000Z",
      campaignId: "123456",
      adGroupId: "456789",
      creativeId: "789012",
      matchType: "exact",
      network: "search",
      device: "mobile"
    };
    await POST(request(payload));
    expect(mocks.create.mock.calls[0][0].data).toMatchObject({
      rawPayload: payload,
      utmSource: "google",
      utmMedium: "cpc",
      campaignId: "123456",
      adGroupId: "456789",
      attributionChannel: "PAID_SEARCH",
      isTest: false,
      submittedAt: new Date("2026-09-16T14:30:00.000Z")
    });
  });

  it("retains diagnostics as Test records instead of counting them as genuine leads", async () => {
    await POST(request({
      formType: "assessment",
      pageUrl: "https://www.newlgroup.com/contact?codex_weekly_diagnostic=1",
      fields: {},
      isTest: true
    }));
    expect(mocks.create.mock.calls[0][0].data).toMatchObject({
      status: "TEST",
      isTest: true,
      marketingExcludedReason: "CODEX_DIAGNOSTIC"
    });
  });

  it("retains explicitly marked automated checks even when they exercise a honeypot", async () => {
    const response = await POST(request({
      formType: "assessment",
      source: "form_health_check",
      fields: { faxNumber: "synthetic-check" },
      isTest: true
    }));
    expect(response.status).toBe(201);
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(mocks.create.mock.calls[0][0].data).toMatchObject({
      fields: {},
      status: "TEST",
      marketingExcludedReason: "AUTOMATED_FORM_CHECK"
    });
  });
});
