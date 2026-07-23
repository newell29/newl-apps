import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const repoRoot = process.cwd();
const helperPath = path.join(repoRoot, "ops/openclaw/lib/resolve-codex-cli.zsh");
const schemaPath = path.join(
  repoRoot,
  "ops/openclaw/skills/website-growth-scout/scout-output.schema.json",
);

describe("Website Growth Scout OpenClaw scripts", () => {
  it("honors an explicit executable CODEX_BIN", async () => {
    const { stdout } = await execFileAsync(
      "/bin/zsh",
      ["-c", `source ${JSON.stringify(helperPath)}; resolve_codex_cli; print -r -- \"$codex_bin\"`],
      { env: { ...process.env, CODEX_BIN: "/bin/echo" } },
    );

    expect(stdout.trim()).toBe("/bin/echo");
  });

  it("discovers the Codex binary bundled with the ChatGPT application", async () => {
    const helper = await readFile(helperPath, "utf8");

    expect(helper).toContain("/Applications/ChatGPT.app/Contents/Resources/codex");
  });

  it.each([
    "configure-semrush-mcp.sh",
    "install-website-growth-scout.sh",
    "run-website-growth-scout.sh",
  ])("uses the shared Codex resolver in %s", async (scriptName) => {
    const script = await readFile(path.join(repoRoot, "ops/openclaw", scriptName), "utf8");

    expect(script).toContain("lib/resolve-codex-cli.zsh");
    expect(script).toContain("${codex_bin}");
  });

  it("declares an explicit type for every structured-output property", async () => {
    const schema = JSON.parse(await readFile(schemaPath, "utf8")) as Record<string, unknown>;
    const missingTypes: string[] = [];

    function inspect(value: unknown, location: string) {
      if (!value || typeof value !== "object" || Array.isArray(value)) return;

      const record = value as Record<string, unknown>;
      const properties = record.properties;
      if (properties && typeof properties === "object" && !Array.isArray(properties)) {
        for (const [name, property] of Object.entries(properties as Record<string, unknown>)) {
          if (property && typeof property === "object" && !Array.isArray(property)) {
            const propertySchema = property as Record<string, unknown>;
            if (!("type" in propertySchema) && !("$ref" in propertySchema)) {
              missingTypes.push(`${location}.properties.${name}`);
            }
          }
        }
      }

      for (const [name, child] of Object.entries(record)) {
        inspect(child, `${location}.${name}`);
      }
    }

    inspect(schema, "$");
    expect(missingTypes).toEqual([]);
  });
});
