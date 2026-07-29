import { describe, expect, it } from "vitest";

import {
  dedupeHunterCompaniesByIdentity,
  resolveExistingHunterCompanyByName,
  resolveHunterCompanyIdentityKey
} from "@/modules/lead-gen/hunter-company-identity";

describe("Hunter company identity resolution", () => {
  it("uses the normalized domain before noisy legal and branch labels", () => {
    expect(
      resolveHunterCompanyIdentityKey({
        name: "Pratt (Rock Hill Corrugating) LLC",
        normalizedName: "pratt-rock-hill-corrugating-llc",
        domain: "https://www.prattindustries.com/about"
      })
    ).toBe("domain:prattindustries.com");
  });

  it("deduplicates aliases that resolve to the same company domain", () => {
    const companies = dedupeHunterCompaniesByIdentity([
      {
        id: "company-1",
        name: "Atlas Copco Compressors LLC",
        normalizedName: "atlas-copco-compressors-llc",
        domain: "atlascopco.com"
      },
      {
        id: "company-2",
        name: "Atlas Copco",
        normalizedName: "atlas-copco",
        domain: "www.atlascopco.com"
      }
    ]);

    expect(companies.map((company) => company.id)).toEqual(["company-1"]);
  });

  it("uses the confirmed Apollo organization before a conflicting alias domain", () => {
    const companies = dedupeHunterCompaniesByIdentity([
      {
        id: "company-1",
        name: "Pratt Industries",
        normalizedName: "pratt-industries",
        domain: "prattindustries.com",
        apolloOrganizationId: "apollo-pratt"
      },
      {
        id: "company-2",
        name: "Pratt (Rock Hill Corrugating) LLC",
        normalizedName: "pratt-rock-hill-corrugating-llc",
        domain: "rockhillcorrugating.example",
        apolloOrganizationId: "apollo-pratt"
      }
    ]);

    expect(companies.map((company) => company.id)).toEqual(["company-1"]);
  });

  it("maps a unique legal-name variant to the existing company", () => {
    const existing = {
      id: "company-1",
      name: "Zoe Baby Products LLC",
      normalizedName: "zoe-baby-products-llc",
      domain: "zoebaby.com"
    };

    expect(resolveExistingHunterCompanyByName(
      {
        name: "Zoe Baby Products, Inc.",
        normalizedName: "zoe-baby-products-inc"
      },
      [existing]
    )).toEqual({
      company: existing,
      matchType: "UNIQUE_LEGAL_NAME_ALIAS"
    });
  });

  it("does not auto-map an ambiguous short or duplicated name identity", () => {
    expect(resolveExistingHunterCompanyByName(
      {
        name: "ABC LLC",
        normalizedName: "abc-llc"
      },
      [{
        id: "company-1",
        name: "ABC Inc.",
        normalizedName: "abc-inc"
      }]
    )).toBeNull();

    expect(resolveExistingHunterCompanyByName(
      {
        name: "Action LLC",
        normalizedName: "action-llc"
      },
      [{
        id: "company-1",
        name: "Action Inc.",
        normalizedName: "action-inc"
      }, {
        id: "company-2",
        name: "Action Ltd.",
        normalizedName: "action-ltd"
      }]
    )).toBeNull();
  });
});
