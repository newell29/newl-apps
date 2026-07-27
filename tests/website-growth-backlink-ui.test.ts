import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

const pagePath = path.join(
  process.cwd(),
  "src/app/(authenticated)/website-growth/backlinks/page.tsx"
);

describe("Website Growth backlink blocker workspace", () => {
  it("shows current-run versus lifetime blockers and actionable card details", async () => {
    const source = await readFile(pagePath, "utf8");

    expect(source).toContain('label="Blocked this run"');
    expect(source).toContain('label="Blocked total"');
    expect(source).toContain("Blocker reason");
    expect(source).toContain("Recommended next action");
    expect(source).toContain("Will retrying help?");
    expect(source).toContain("formatWebsiteGrowthBacklinkBlockerCategory");
  });
});
