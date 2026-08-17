import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tenantFindUniqueMock = vi.hoisted(() => vi.fn());

vi.mock("@/server/db", () => ({
  prisma: {
    tenant: {
      findUnique: tenantFindUniqueMock
    }
  }
}));

import {
  authenticateIngestionCronRequest,
  IngestionAuthError
} from "@/server/ingestion-auth";

describe("tenant-scoped ingestion cron authentication", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = "synthetic-cron-secret";
    process.env.INGESTION_TENANT_SLUG = "synthetic-tenant";
    tenantFindUniqueMock.mockResolvedValue({
      id: "tenant-1",
      slug: "synthetic-tenant",
      name: "Synthetic Tenant"
    });
  });

  afterEach(() => {
    delete process.env.CRON_SECRET;
    delete process.env.INGESTION_TENANT_SLUG;
  });

  it("binds a valid Vercel bearer request to the configured ingestion tenant", async () => {
    const request = new Request("https://newl.test/api/operations/tmg-order-intake/scheduled", {
      headers: { authorization: "Bearer synthetic-cron-secret" }
    });

    await expect(authenticateIngestionCronRequest(request)).resolves.toEqual({
      tenantId: "tenant-1",
      tenantSlug: "synthetic-tenant",
      tenantName: "Synthetic Tenant"
    });
    expect(tenantFindUniqueMock).toHaveBeenCalledWith(expect.objectContaining({
      where: { slug: "synthetic-tenant" }
    }));
  });

  it("rejects an invalid cron secret before any tenant lookup", async () => {
    const request = new Request("https://newl.test/api/operations/tmg-order-intake/scheduled", {
      headers: { authorization: "Bearer wrong-secret" }
    });

    await expect(authenticateIngestionCronRequest(request)).rejects.toBeInstanceOf(IngestionAuthError);
    expect(tenantFindUniqueMock).not.toHaveBeenCalled();
  });
});
