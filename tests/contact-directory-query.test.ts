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
      AND: [{
        OR: [
          {
            company: {
              leads: {
                some: {
                  tenantId: "tenant-1"
                }
              }
            }
          },
          {
            outreachPlans: {
              some: {
                tenantId: "tenant-1",
                status: { not: "ARCHIVED" }
              }
            }
          }
        ]
      }]
    });
  });

  it("combines active-work visibility with text search instead of replacing it", () => {
    const where = buildContactDirectoryWhere(tenant, { query: "Stabilus" });

    expect(where.AND).toHaveLength(2);
    expect(where.AND).toEqual(expect.arrayContaining([
      expect.objectContaining({ OR: expect.any(Array) }),
      expect.objectContaining({
        OR: expect.arrayContaining([
          expect.objectContaining({
            company: {
              name: {
                contains: "Stabilus",
                mode: "insensitive"
              }
            }
          })
        ])
      })
    ]));
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
