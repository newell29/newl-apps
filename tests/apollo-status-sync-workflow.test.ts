import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(path.join(process.cwd(), ".github/workflows/apollo-status-sync.yml"), "utf8");

describe("Apollo status sync workflow", () => {
  it("does not retry a tenant-level application failure as a new whole-batch request", () => {
    expect(workflow).toContain("curl --fail-with-body");
    expect(workflow).not.toContain("--retry");
    expect(workflow).not.toContain("--retry-all-errors");
  });
});
