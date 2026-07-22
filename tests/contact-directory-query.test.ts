import { describe, expect, it } from "vitest";

import { buildContactDirectoryWhere } from "@/modules/lead-gen/queries";

const tenant = {
  tenantId: "tenant-1",
  tenantSlug: "newl-group",
  tenantName: "Newl Group"
};

describe("contact directory ownership filtering", () => {
  it("includes assigned and unassigned pipeline contacts by default", () => {
    const where = buildContactDirectoryWhere(tenant, {});

    expect(where).not.toHaveProperty("assignedRep");
    expect(where).toMatchObject({
      company: {
        leads: {
          some: {
            tenantId: "tenant-1"
          }
        }
      }
    });
  });

  it("keeps unassigned and named-rep filters explicit", () => {
    expect(buildContactDirectoryWhere(tenant, { assignedRep: "UNASSIGNED" })).toMatchObject({
      assignedRep: null
    });
    expect(buildContactDirectoryWhere(tenant, { assignedRep: "user-1" })).toMatchObject({
      assignedRep: "user-1"
    });
  });
});
