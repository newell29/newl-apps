import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
const backlinkEnablePath = path.join(
  repoRoot,
  "ops/openclaw/enable-website-growth-backlink-executor.sh",
);
const backlinkPromptPath = path.join(
  repoRoot,
  "ops/openclaw/prompts/website-growth-backlink-executor.md",
);
const backlinkRunnerPath = path.join(
  repoRoot,
  "ops/openclaw/run-website-growth-backlink-executor.sh",
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
const backlinkValidatorPath = path.join(
  repoRoot,
  "ops/openclaw/validate-website-growth-backlink-agent-run.py",
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

  it("splits Monday and Wednesday deep runs from cache-backed weekday check-ins", async () => {
    const installer = await readFile(installerPath, "utf8");

    expect(installer).toContain('--cron "15 9 * * 1,3"');
    expect(installer).toContain('--cron "15 9 * * 2,4-5"');
    expect(installer).toContain("NEWL_APPS_SCOUT_RUNTIME_REPO_PATH");
    expect(installer).toContain("run-website-growth-scout-runtime.sh");
    expect(installer).toContain('--declaration-key "newl.website-growth.scout.weekly.v1"');
    expect(installer).toContain('--declaration-key "newl.website-growth.scout.weekday-checkin.v1"');
    expect(installer).toContain(
      '--declaration-key "newl.website-growth.build-notifications.v1"'
    );
    expect(installer).toContain('--every "2m"');
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

  it("runs backlink outreach through a deterministic command wrapper with no shell tools", async () => {
    const [installer, enableScript, runner, prompt] = await Promise.all([
      readFile(backlinkInstallerPath, "utf8"),
      readFile(
        path.join(
          repoRoot,
          "ops/openclaw/enable-website-growth-backlink-executor.sh",
        ),
        "utf8",
      ),
      readFile(backlinkRunnerPath, "utf8"),
      readFile(backlinkPromptPath, "utf8"),
    ]);

    expect(installer).toContain('profile: "minimal"');
    expect(installer).toContain('--model "openai/gpt-5.4-mini"');
    expect(installer).toContain('alsoAllow: [');
    expect(installer).not.toContain('  allow: [');
    expect(installer).toContain(
      'deny: ["exec", "bash", "read", "write", "edit", "apply_patch", "process"]'
    );
    expect(installer).toContain('"newl_backlink_business_profile"');
    expect(installer).toContain('--command-argv "${executor_argv}"');
    expect(installer).toContain("--no-deliver");
    expect(installer).not.toContain('--agent scout\n  --model "openai/gpt-5.6-sol"');
    expect(installer).toContain('canonical_executor_job_id="$(');
    expect(installer).toContain('openclaw cron rm "${stale_job_id}"');
    expect(installer).toContain(
      'job.get("id") != sys.argv[2]'
    );
    expect(enableScript).toContain(
      '(job.get("payload") or {}).get("kind") == "command"'
    );
    expect(enableScript).toContain("cron list --all --json");
    expect(installer).toContain("openclaw cron list --all --json");
    expect(enableScript).toContain("if len(matches) == 1:");
    expect(runner).toContain('run_started_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"');
    expect(runner).toContain('"${openclaw_command}" agent');
    expect(runner).toContain(
      "/api/website-growth/backlinks/executor/summary"
    );
    expect(runner).toContain(
      "The Scout browser work phase failed after its deterministic summary was delivered."
    );
    expect(runner).toContain("validate-website-growth-backlink-agent-run.py");
    expect(runner).toContain('--model "openai/gpt-5.4-mini"');
    expect(prompt).toContain(
      "Never call or emulate Bash, exec, a shell, arbitrary file reads"
    );
    expect(prompt).toContain(
      "Do not call `newl_backlink_summary` and do not send a Teams message."
    );
  });

  it("finds and enables the intentionally disabled backlink command job", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "newl-backlink-enable-"));
    const openclawPath = path.join(directory, "openclaw");
    const enableLogPath = path.join(directory, "enabled.txt");
    await writeFile(
      openclawPath,
      `#!/bin/zsh
if [[ "$1" == "cron" && "$2" == "list" && "$3" == "--all" && "$4" == "--json" ]]; then
  print -r -- '{"jobs":[{"id":"disabled-job-1","declarationKey":"newl.website-growth.backlink-outreach.weekday.v1","enabled":false,"payload":{"kind":"command"}}]}'
  exit 0
fi
if [[ "$1" == "cron" && "$2" == "enable" && "$3" == "disabled-job-1" ]]; then
  print -r -- "$3" > "$ENABLE_LOG_PATH"
  exit 0
fi
exit 2
`,
    );
    await chmod(openclawPath, 0o700);

    try {
      await expect(execFileAsync("/bin/zsh", [backlinkEnablePath], {
        env: {
          ...process.env,
          OPENCLAW_BIN: openclawPath,
          ENABLE_LOG_PATH: enableLogPath
        }
      })).resolves.toBeDefined();
      expect(await readFile(enableLogPath, "utf8")).toBe("disabled-job-1\n");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("fails closed when the backlink agent has no exposed tools", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "newl-backlink-validator-"));
    const agentOutputPath = path.join(directory, "agent-output.json");
    const sessionsDirectory = path.join(directory, "sessions");
    const sessionId = "synthetic-session-123";
    await mkdir(sessionsDirectory);

    try {
      await writeFile(agentOutputPath, JSON.stringify({
        result: {
          meta: {
            agentMeta: { sessionId },
            systemPromptReport: { tools: { entries: [] } }
          }
        }
      }));
      await writeFile(
        path.join(sessionsDirectory, `${sessionId}.jsonl`),
        JSON.stringify({
          type: "message",
          message: { role: "assistant", content: [{ type: "text", text: "finished" }] }
        })
      );

      await expect(execFileAsync("/usr/bin/python3", [
        backlinkValidatorPath,
        "--agent-output",
        agentOutputPath,
        "--sessions-directory",
        sessionsDirectory
      ])).rejects.toMatchObject({
        stderr: expect.stringContaining("required executor tools were not exposed")
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("accepts a backlink agent run only after the required tool sequence completes", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "newl-backlink-validator-"));
    const agentOutputPath = path.join(directory, "agent-output.json");
    const sessionsDirectory = path.join(directory, "sessions");
    const sessionId = "synthetic-session-456";
    const requiredTools = [
      "newl_backlink_business_profile",
      "newl_backlink_sync_replies",
      "newl_backlink_sync_directory_verifications",
      "newl_backlink_follow_ups",
      "newl_backlink_verification",
      "newl_backlink_claim"
    ];
    await mkdir(sessionsDirectory);

    try {
      await writeFile(agentOutputPath, JSON.stringify({
        result: {
          meta: {
            agentMeta: { sessionId },
            systemPromptReport: {
              tools: { entries: [...requiredTools, "browser"].map((name) => ({ name })) }
            }
          }
        }
      }));
      await writeFile(
        path.join(sessionsDirectory, `${sessionId}.jsonl`),
        requiredTools.map((name) => JSON.stringify({
          type: "message",
          message: { role: "assistant", content: [{ type: "toolCall", name }] }
        })).join("\n")
      );

      await expect(execFileAsync("/usr/bin/python3", [
        backlinkValidatorPath,
        "--agent-output",
        agentOutputPath,
        "--sessions-directory",
        sessionsDirectory
      ])).resolves.toBeDefined();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("delivers the deterministic summary even when the constrained agent turn fails", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "newl-backlink-runner-"));
    const scoutEnvPath = path.join(directory, "scout.env");
    const gatewayEnvPath = path.join(directory, "gateway.env");
    const openclawPath = path.join(directory, "openclaw");
    const curlPath = path.join(directory, "curl");
    const teamsLogPath = path.join(directory, "teams.log");

    await writeFile(
      scoutEnvPath,
      [
        "NEWL_APPS_URL=https://newl-apps.example.com",
        "WEBSITE_GROWTH_TEAMS_TARGET=example-target",
      ].join("\n"),
    );
    await writeFile(
      gatewayEnvPath,
      "OPENCLAW_WEBSITE_GROWTH_BACKLINK_TOKEN=synthetic-token\n",
    );
    await writeFile(
      openclawPath,
      `#!/bin/zsh
if [[ "$1" == "agent" ]]; then
  exit 9
fi
message=""
while [[ "$#" -gt 0 ]]; do
  if [[ "$1" == "--message" ]]; then
    shift
    message="$1"
  fi
  shift
done
print -r -- "$message" > "$TEAMS_LOG_PATH"
`,
    );
    await writeFile(
      curlPath,
      `#!/bin/zsh
print -r -- '{"data":{"message":"Deterministic summary after failure"}}'
`,
    );
    await Promise.all([chmod(openclawPath, 0o700), chmod(curlPath, 0o700)]);

    try {
      let failure: {
        code?: number;
        stderr?: string;
      } | null = null;
      try {
        await execFileAsync("/bin/zsh", [backlinkRunnerPath], {
          env: {
            ...process.env,
            HOME: directory,
            OPENCLAW_BIN: openclawPath,
            CURL_BIN: curlPath,
            WEBSITE_GROWTH_SCOUT_ENV_FILE: scoutEnvPath,
            OPENCLAW_GATEWAY_ENV_FILE: gatewayEnvPath,
            TEAMS_LOG_PATH: teamsLogPath,
          },
        });
      } catch (error) {
        failure = error as typeof failure;
      }

      expect(failure?.code).toBe(9);
      expect(failure?.stderr).toContain(
        "failed after its deterministic summary was delivered",
      );
      expect(await readFile(teamsLogPath, "utf8")).toBe(
        "Deterministic summary after failure\n",
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("opens fresh backlink research tabs through the browser tool", async () => {
    const [prompt, skill] = await Promise.all([
      readFile(backlinkPromptPath, "utf8"),
      readFile(backlinkSkillPath, "utf8"),
    ]);

    expect(prompt).toContain("Use the browser tool directly");
    expect(prompt).toContain("Open every approved public URL in a fresh tab");
    expect(prompt).toContain("Never navigate an assumed active tab");
    expect(skill).toContain("open a fresh tab");
    expect(skill).toContain("Retain and focus the stable tab handle");
    expect(skill).toContain("Do not issue speculative browser actions");
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

  it("batches local Qwen review and retries one invalid batch without repeating search", async () => {
    const python = String.raw`
import json, runpy, sys
module = runpy.run_path(sys.argv[1])
calls = []
def fake_batch(schema, prompt, rows):
    calls.append(len(rows))
    if len(calls) == 1:
        raise RuntimeError("synthetic truncated JSON")
    return [
        {
            "id": row["id"],
            "disposition": "REJECT",
            "category": None,
            "confidence": 90,
            "reason": "synthetic"
        }
        for row in rows
    ]
module["ollama_request"].__globals__["_ollama_batch"] = fake_batch
rows = [{"id": f"candidate-{index}"} for index in range(65)]
decisions = module["ollama_request"]({}, "synthetic prompt", rows)
print(json.dumps({"calls": calls, "decisionCount": len(decisions)}))
`;

    const { stdout } = await execFileAsync("/usr/bin/python3", [
      "-c",
      python,
      backlinkDiscoveryPath
    ]);

    expect(JSON.parse(stdout)).toEqual({
      calls: [30, 30, 30, 5],
      decisionCount: 65
    });
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
    "run-website-growth-backlink-executor.sh",
    "run-rivet-backlink-failure-monitor.sh",
    "run-website-growth-scout.sh",
    "run-website-growth-scout-runtime.sh",
    "run-website-growth-build-notifications.sh",
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
