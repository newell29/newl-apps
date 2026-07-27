import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const repoRoot = process.cwd();
const helperPath = path.join(repoRoot, "ops/openclaw/lib/resolve-codex-cli.zsh");
const runtimeHelperPath = path.join(
  repoRoot,
  "ops/openclaw/lib/website-growth-scout-runtime.zsh",
);
const installerPath = path.join(repoRoot, "ops/openclaw/install-website-growth-scout.sh");
const backlinkInstallerPath = path.join(
  repoRoot,
  "ops/openclaw/install-website-growth-backlink-executor.sh",
);
const backlinkPromptPath = path.join(
  repoRoot,
  "ops/openclaw/prompts/website-growth-backlink-executor.md",
);
const backlinkSkillPath = path.join(
  repoRoot,
  "ops/openclaw/skills/website-growth-backlink-executor/SKILL.md",
);
const runnerPath = path.join(repoRoot, "ops/openclaw/run-website-growth-scout.sh");
const runtimeRunnerPath = path.join(
  repoRoot,
  "ops/openclaw/run-website-growth-scout-runtime.sh",
);
const schemaPath = path.join(
  repoRoot,
  "ops/openclaw/skills/website-growth-scout/scout-output.schema.json",
);
const backlinkDiscoveryPath = path.join(
  repoRoot,
  "ops/openclaw/website_growth_backlink_discovery.py",
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

  it("splits the Monday deep run from cache-backed weekday check-ins", async () => {
    const installer = await readFile(installerPath, "utf8");

    expect(installer).toContain('--cron "15 9 * * 1"');
    expect(installer).toContain('--cron "15 9 * * 2-5"');
    expect(installer).toContain("NEWL_APPS_SCOUT_RUNTIME_REPO_PATH");
    expect(installer).toContain("run-website-growth-scout-runtime.sh");
    expect(installer).toContain('--declaration-key "newl.website-growth.scout.weekly.v1"');
    expect(installer).toContain('--declaration-key "newl.website-growth.scout.weekday-checkin.v1"');
    expect(installer).toContain('\\"--light\\"');
  });

  it("configures the backlink plugin before installing it", async () => {
    const installer = await readFile(backlinkInstallerPath, "utf8");
    const configureIndex = installer.indexOf(
      "openclaw config set plugins.entries.newl-website-growth",
    );
    const installIndex = installer.indexOf(
      'openclaw plugins install --force "${plugin_path}"',
    );

    expect(configureIndex).toBeGreaterThan(-1);
    expect(installIndex).toBeGreaterThan(configureIndex);
  });

  it("allows the protected backlink profile to already be installed at its target path", async () => {
    const installer = await readFile(backlinkInstallerPath, "utf8");

    expect(installer).toContain(
      'if [[ "${profile_source:A}" == "${profile_target:A}" ]]; then'
    );
    expect(installer).toContain('chmod 600 "${profile_target}"');
  });

  it("installs a deterministic Rivet failure monitor beside the disabled outreach schedule", async () => {
    const installer = await readFile(backlinkInstallerPath, "utf8");
    const monitor = await readFile(
      path.join(repoRoot, "ops/openclaw/run-rivet-backlink-failure-monitor.sh"),
      "utf8"
    );

    expect(installer).toContain(
      '--declaration-key "newl.rivet.website-growth.backlink-failure-monitor.v1"'
    );
    expect(installer).toContain('--every "15m"');
    const failureMonitorBlock = installer.slice(
      installer.indexOf('openclaw cron add \\\n  --name "NEWL Rivet Backlink Failure Monitor"'),
      installer.indexOf('echo "Installed the dedicated Scout agent')
    );
    expect(failureMonitorBlock).not.toContain("--exact");
    expect(installer).toContain("--command-argv");
    expect(monitor).toContain(
      "/api/website-growth/backlinks/executor/failures"
    );
    expect(monitor).toContain("openclaw cron disable");
    expect(monitor).toContain("send_website_growth_teams_message");
  });

  it("opens fresh backlink research tabs instead of navigating a stale active tab", async () => {
    const [prompt, skill] = await Promise.all([
      readFile(backlinkPromptPath, "utf8"),
      readFile(backlinkSkillPath, "utf8"),
    ]);

    expect(prompt).toContain("openclaw browser open <url> --json");
    expect(prompt).toContain("do not start with `openclaw browser navigate`");
    expect(prompt).toContain("openclaw browser --json focus <suggestedTargetId>");
    expect(prompt).toContain("openclaw browser --json snapshot --format aria --limit 300");
    expect(prompt).toContain("Never use the unsupported `snapshot --refs` or `snapshot --target-id`");
    expect(skill).toContain("open a fresh browser tab");
    expect(skill).toContain("openclaw browser --json focus <suggestedTargetId>");
    expect(skill).toContain("openclaw browser --json snapshot --format aria --limit 300");
    expect(skill).toContain("does not support `snapshot --refs` or `snapshot --target-id`");
    expect(skill).toContain("A failed browser probe marks the scheduled run failed");
  });

  it("updates the clean dedicated runtime from main before every Scout run", async () => {
    const runtimeRunner = await readFile(runtimeRunnerPath, "utf8");

    expect(runtimeRunner).toContain('status --porcelain --untracked-files=normal');
    expect(runtimeRunner).toContain('fetch --quiet origin "+main:${runtime_main_ref}"');
    expect(runtimeRunner).toContain('checkout --quiet --detach "${runtime_main_ref}"');
    expect(runtimeRunner).toContain('exec /bin/zsh "${runtime_repo_path}/ops/openclaw/run-website-growth-scout.sh" "$@"');
  });

  it("delivers Excel reports as Newl Apps links without Teams media uploads", async () => {
    const [installer, runner, helper] = await Promise.all([
      readFile(installerPath, "utf8"),
      readFile(runnerPath, "utf8"),
      readFile(runtimeHelperPath, "utf8")
    ]);

    expect(helper).not.toContain("WEBSITE_GROWTH_TEAMS_FILE_TARGET");
    expect(installer).not.toContain("WEBSITE_GROWTH_TEAMS_FILE_TARGET");
    expect(runner).not.toContain("--media");
    expect(helper).toContain('--target "${WEBSITE_GROWTH_TEAMS_TARGET}"');
  });

  it("instructs Scout to review question-led AI-answer opportunities without creating thin pages", async () => {
    const runner = await readFile(runnerPath, "utf8");

    expect(runner).toContain(
      "Treat candidates marked questionOpportunity as a dedicated customer-question and AI-answer lane."
    );
    expect(runner).toContain(
      "prefer a direct answer section on the strongest relevant page"
    );
    expect(runner).toContain("Reject thin FAQ pages");
    expect(runner).toContain("guarantees an AI citation or ranking");
  });

  it("runs a bounded Brave, Qwen, then Codex backlink funnel", async () => {
    const [runner, installer, discovery] = await Promise.all([
      readFile(runnerPath, "utf8"),
      readFile(installerPath, "utf8"),
      readFile(backlinkDiscoveryPath, "utf8")
    ]);

    expect(installer).toContain("HUNTER_BRAVE_SEARCH_API_KEY");
    expect(runner).toContain("website_growth_backlink_discovery.py");
    expect(runner).toContain("no more than 5 high-quality");
    expect(runner).toContain("backlinks.source to WEB_DISCOVERY");
    expect(discovery).toContain('search_web("BRAVE", query, 10)');
    expect(discovery).toContain('limits.get("fetches") or 40');
    expect(discovery).toContain('limits.get("pagesPerDomain") or 2');
    expect(discovery).toContain('limits.get("finalists") or 15');
  });

  it("sends safe Teams outcomes for duplicate and failed runs", async () => {
    const [runner, runtimeRunner, helper] = await Promise.all([
      readFile(runnerPath, "utf8"),
      readFile(runtimeRunnerPath, "utf8"),
      readFile(runtimeHelperPath, "utf8"),
    ]);

    expect(helper).toContain("send_website_growth_teams_message");
    expect(runner).toContain("another Scout run is already active");
    expect(runner).toContain("No website work was approved, merged, or published");
    expect(runtimeRunner).toContain("The dedicated runtime did not reach the read-only Scout");
  });

  it.each([
    "install-website-growth-scout.sh",
    "install-website-growth-backlink-executor.sh",
    "enable-website-growth-backlink-executor.sh",
    "run-rivet-backlink-failure-monitor.sh",
    "run-website-growth-scout.sh",
    "run-website-growth-scout-runtime.sh",
    "lib/website-growth-scout-runtime.zsh",
  ])("passes zsh syntax validation for %s", async (scriptName) => {
    await expect(
      execFileAsync("/bin/zsh", [
        "-n",
        path.join(repoRoot, "ops/openclaw", scriptName),
      ]),
    ).resolves.toBeDefined();
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

  it("creates valid SEO Excel workbooks from the completion response", async () => {
    const outputDirectory = await mkdtemp(path.join(tmpdir(), "newl-scout-reports-"));
    const responsePath = path.join(outputDirectory, "completion.json");
    const reportScript = path.join(
      repoRoot,
      "ops/openclaw/lib/create-website-growth-reports.ts"
    );

    try {
      await writeFile(responsePath, JSON.stringify({
        data: {
          reports: {
            keywordImport: {
              filename: "newl-semrush-keywords.xlsx",
              sheetName: "SEMrush Import",
              columns: [
                { key: "keyword", header: "Keyword" },
                { key: "tags", header: "Tags" }
              ],
              rows: [{ keyword: "kitting services", tags: "website-growth,scout" }]
            },
            performance: {
              filename: "newl-seo-performance.xlsx",
              sheetName: "Weekly SEO",
              columns: [
                { key: "item", header: "Keyword or Metric" },
                { key: "currentValue", header: "Current" }
              ],
              rows: [{ item: "Visibility", currentValue: 6.42 }]
            }
          }
        }
      }));

      const { stdout } = await execFileAsync(
        process.execPath,
        ["--experimental-strip-types", reportScript, responsePath, outputDirectory]
      );
      const manifest = JSON.parse(stdout) as {
        keywordImport: { path: string };
        performance: { path: string };
      };
      const [keywordBytes, performanceBytes] = await Promise.all([
        readFile(manifest.keywordImport.path),
        readFile(manifest.performance.path)
      ]);

      expect(keywordBytes.subarray(0, 2).toString()).toBe("PK");
      expect(performanceBytes.subarray(0, 2).toString()).toBe("PK");
    } finally {
      await rm(outputDirectory, { recursive: true, force: true });
    }
  });
});
