import { describe, expect, it } from "vitest";

import { hasTeamshipInternalReadAccess } from "@/modules/teamship/access-policy";

describe("temporary Teamship internal-team read policy", () => {
  it.each([
    ["Alex Newell", "unknown@example.com"],
    ["Faisal Haroon", "unknown@example.com"],
    ["Suzy Boreham", "unknown@example.com"],
    ["Lily Morales", "unknown@example.com"],
    ["Different Display Name", "alex.newell@newl.ca"],
    ["Different Display Name", "suzy.boreham@newlgroup.com"],
    ["Different Display Name", "lily.morales@newl.ca"]
  ])("allows %s / %s", (userName, userEmail) => {
    expect(hasTeamshipInternalReadAccess({ userName, userEmail })).toBe(true);
  });

  it("denies every other authenticated employee", () => {
    expect(
      hasTeamshipInternalReadAccess({
        userName: "Another Employee",
        userEmail: "employee@newl.ca"
      })
    ).toBe(false);
  });
});
