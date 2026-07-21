import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const skill = readFileSync(
  path.join(process.cwd(), "ops/openclaw/skills/teamship-read-only/SKILL.md"),
  "utf8"
);

describe("OpenClaw Teamship skill routing", () => {
  it("preserves Ship by LPN SKU detail and serial-number intent", () => {
    expect(skill).toContain("Which LPNs and locations contain SKU SKU");
    expect(skill).toContain("Where is serial number SERIAL");
    expect(skill).toContain("Preserve whether a SKU question asks for Inventory All totals or Ship by LPN handling-unit detail");
  });

  it("does not retry a failed read as a different Teamship operation", () => {
    expect(skill).toContain("Do not retry by changing a Ship by LPN request into Inventory All");
  });
});
