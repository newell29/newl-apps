import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const temporaryDirectories: string[] = [];
const preflightPath = path.join(process.cwd(), "ops/openclaw/rivet-review-preflight.py");

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))
  );
});

describe("Rivet deterministic review preflight", () => {
  it("allows reserved synthetic references and a clean current-main merge", async () => {
    const report = await runPreflight([
      "diff --git a/tests/example.ts b/tests/example.ts",
      "+++ b/tests/example.ts",
      "@@ -0,0 +1 @@",
      "+const reference = \"PS123456\";"
    ].join("\n"), true);

    expect(report).toEqual({
      status: "PASS",
      mergeableWithCurrentMain: true,
      findings: []
    });
  });

  it("routes production-looking references and non-example email addresses to safe remediation", async () => {
    const reference = `PS${"654321"}`;
    const email = `person@${"customer.invalid"}`;
    const report = await runPreflight([
      "diff --git a/tests/example.ts b/tests/example.ts",
      "+++ b/tests/example.ts",
      "@@ -0,0 +1,2 @@",
      `+const reference = "${reference}";`,
      `+const email = "${email}";`
    ].join("\n"), true);

    expect(report.status).toBe("NEEDS_CHANGES");
    expect(report.findings).toEqual([
      expect.objectContaining({ category: "PRIVACY", autoFixable: true }),
      expect.objectContaining({ category: "PRIVACY", autoFixable: true })
    ]);
  });

  it("blocks high-confidence credential patterns", async () => {
    const token = `github_pat_${"A".repeat(24)}`;
    const report = await runPreflight([
      "diff --git a/tests/example.ts b/tests/example.ts",
      "+++ b/tests/example.ts",
      "@@ -0,0 +1 @@",
      `+const token = "${token}";`
    ].join("\n"), true);

    expect(report.status).toBe("BLOCKED");
    expect(report.findings).toEqual([
      expect.objectContaining({ category: "SECRETS", autoFixable: false })
    ]);
  });

  it("requires remediation when the exact commit conflicts with current main", async () => {
    const report = await runPreflight("", false);

    expect(report.status).toBe("NEEDS_CHANGES");
    expect(report.findings).toEqual([
      expect.objectContaining({ category: "MERGEABILITY", autoFixable: true })
    ]);
  });
});

async function runPreflight(diff: string, mergeable: boolean) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "rivet-preflight-"));
  temporaryDirectories.push(directory);
  const diffPath = path.join(directory, "review.diff");
  const outputPath = path.join(directory, "report.json");
  await writeFile(diffPath, diff, "utf8");
  await execFileAsync("/usr/bin/python3", [
    preflightPath,
    diffPath,
    outputPath,
    mergeable ? "1" : "0"
  ]);
  return JSON.parse(await readFile(outputPath, "utf8")) as {
    status: string;
    mergeableWithCurrentMain: boolean;
    findings: Array<Record<string, unknown>>;
  };
}
