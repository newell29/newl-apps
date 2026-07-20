import { IntegrationProvider, IntegrationStatus } from "@prisma/client";
import { describe, expect, it } from "vitest";

import {
  parseTeamshipReadScopeUpload,
  parseTeamshipSettings
} from "@/server/integrations/teamship-settings";

describe("Teamship read-only scope settings", () => {
  it("parses complete exact scopes and drops incomplete entries", () => {
    const settings = parseTeamshipSettings({
      id: "credential-1",
      provider: IntegrationProvider.TEAMSHIP,
      name: "Teamship WMS",
      status: IntegrationStatus.ACTIVE,
      secretRef: "encrypted",
      publicConfig: {
        email: "integration@example.com",
        readOnlySearchEnabled: true,
        readOnlyScopes: [
          {
            customerId: "420",
            customerName: "Garland Canada Distribution",
            warehouseId: "102",
            warehouseName: "Annagem",
            inventoryUserId: "420",
            inventoryLocationId: "102"
          },
          { customerId: "incomplete" }
        ]
      }
    });

    expect(settings.readOnlySearchEnabled).toBe(true);
    expect(settings.readOnlyScopes).toEqual([
      {
        customerId: "420",
        customerName: "Garland Canada Distribution",
        warehouseId: "102",
        warehouseName: "Annagem",
        inventoryUserId: "420",
        inventoryLocationId: "102"
      }
    ]);
  });

  it("defaults to disabled with no scopes", () => {
    const settings = parseTeamshipSettings();

    expect(settings.readOnlySearchEnabled).toBe(false);
    expect(settings.readOnlyScopes).toEqual([]);
  });

  it("strictly validates the reviewed scope upload wrapper", () => {
    const scope = {
      customerId: "420",
      customerName: "Garland Canada Distribution",
      warehouseId: "102",
      warehouseName: "Annagem",
      inventoryUserId: "420",
      inventoryLocationId: "102"
    };

    expect(parseTeamshipReadScopeUpload({ readOnlyScopes: [scope] })).toEqual([scope]);
    expect(() => parseTeamshipReadScopeUpload({ readOnlyScopes: [scope, scope] })).toThrow(/duplicates customer/i);
    expect(() => parseTeamshipReadScopeUpload({ readOnlyScopes: [{ customerId: "420" }] })).toThrow(/customerName/i);
    expect(() => parseTeamshipReadScopeUpload({ readOnlyScopes: [] })).toThrow(/non-empty/i);
  });
});
