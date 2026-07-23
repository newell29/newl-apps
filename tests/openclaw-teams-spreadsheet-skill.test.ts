import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const skill = readFileSync(
  path.join(process.cwd(), "ops/openclaw/skills/teams-spreadsheet/SKILL.md"),
  "utf8"
);

const routing = readFileSync(
  path.join(process.cwd(), "ops/openclaw/AGENTS.teamship.md"),
  "utf8"
);

describe("OpenClaw Teams spreadsheet skill", () => {
  it("requires a real Teams upload and forbids local-path delivery", () => {
    expect(skill).toContain("newl_create_spreadsheet");
    expect(skill).toContain('`action: "upload-file"`');
    expect(skill).toContain('`channel: "msteams"`');
    expect(skill).toContain("Omit `to`");
    expect(skill).toContain("Never return a local filesystem path");
    expect(skill).toContain("spreadsheet was not delivered");
  });

  it("routes spreadsheet requests through the installed skill and message tool", () => {
    expect(routing).toContain("skills/teams-spreadsheet/SKILL.md");
    expect(routing).toContain("message(action=upload-file)");
    expect(routing).toContain("Never answer with a Mac path");
  });
});
