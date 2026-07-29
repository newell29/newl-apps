import { describe, expect, it } from "vitest";

import {
  dedupeHunterCompaniesByIdentity,
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
});
