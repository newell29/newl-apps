import { describe, expect, it } from "vitest";

import type { TenantContext } from "@/server/tenant-context";
import { tenantWhere } from "@/server/tenant-query";

const tenant: TenantContext = {
  tenantId: "tenant-a",
  tenantSlug: "tenant-a-slug",
  tenantName: "Tenant A"
};

describe("tenantWhere", () => {
  it("injects the caller's tenantId when no where is provided", () => {
    expect(tenantWhere(tenant)).toEqual({ tenantId: "tenant-a" });
  });

  it("merges tenantId into an existing where clause", () => {
    expect(tenantWhere(tenant, { candidateStatus: "NEW" })).toEqual({
      candidateStatus: "NEW",
      tenantId: "tenant-a"
    });
  });

  it("forces the context tenantId even if the caller tries to pass a different one (no cross-tenant override)", () => {
    const result = tenantWhere(tenant, { tenantId: "tenant-b", id: "lead-1" } as { tenantId: string; id: string });
    expect(result.tenantId).toBe("tenant-a");
    expect(result.id).toBe("lead-1");
  });
});
