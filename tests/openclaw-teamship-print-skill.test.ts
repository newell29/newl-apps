import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

describe("OpenClaw Teamship print skill", () => {
  it("requires a separate exact-request approval and keeps later phases disabled", async () => {
    const text = await readFile(path.join(process.cwd(), "ops/openclaw/skills/teamship-print/SKILL.md"), "utf8");
    expect(text).toContain("Do not call the approval tool in the same turn");
    expect(text).toContain("same employee");
    expect(text).toContain("Do not process batches");
    expect(text).toContain("never retried automatically");
  });

  it("names only the corrected outbound-label printer", async () => {
    const text = await readFile(path.join(process.cwd(), "ops/openclaw/skills/teamship-print/SKILL.md"), "utf8");
    expect(text).toContain("BIXOLON SRP-770III");
    expect(text).toContain("Never substitute `BIXOLON SRP-770III - BPL-Z`");
  });
});
