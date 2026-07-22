import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const skill = readFileSync(
  path.join(process.cwd(), "ops/openclaw/skills/teamship-read-only/SKILL.md"),
  "utf8"
);

describe("OpenClaw Teamship skill routing", () => {
  it("preserves Ship by LPN SKU detail and serial-number intent", () => {
    expect(skill).toContain("Where is SKU SKU for CUSTOMER");
    expect(skill).toContain("Return LPN, location, serial, quantity, quarantine, and total row count");
    expect(skill).toContain("Where is serial number SERIAL");
    expect(skill).toContain("Preserve whether a SKU question asks for Inventory All totals or Ship by LPN handling-unit detail");
  });

  it("does not retry a failed read as a different Teamship operation", () => {
    expect(skill).toContain("Do not retry by changing a Ship by LPN request into Inventory All");
  });

  it("requires an exact target and forbids all-order guessing for Garland PDFs", () => {
    expect(skill).toContain("pass it as `targetReference` to `newl_garland_pdf_review`");
    expect(skill).toContain("Prefer PS because SR can repeat");
    expect(skill).toContain("Never infer a reference from the PDF or ask to check every order");
    expect(skill).toContain("Call `newl_garland_approve_update` only when the employee explicitly approves");
    expect(skill).toContain("editable-BOL weight cleanup");
  });
});
