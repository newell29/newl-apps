import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const repoRoot = process.cwd();
const installerPath = path.join(repoRoot, "ops/openclaw/install-hunter-worker.sh");
const runnerPath = path.join(repoRoot, "ops/openclaw/run-hunter-worker.sh");

describe("Hunter launchd runtime", () => {
  it("keeps the runner and installer valid zsh", async () => {
    await expect(execFileAsync("/bin/zsh", ["-n", runnerPath])).resolves.toBeDefined();
    await expect(execFileAsync("/bin/zsh", ["-n", installerPath])).resolves.toBeDefined();
  });

  it("installs a clean detached origin/main worktree for the live service", async () => {
    const installer = await readFile(installerPath, "utf8");

    expect(installer).toContain("newl-apps-hunter-runtime");
    expect(installer).toContain('fetch origin "+main:${runtime_main_ref}"');
    expect(installer).toContain('worktree add --detach "${runtime_repo_path}"');
    expect(installer).toContain('checkout --detach "${runtime_main_ref}"');
    expect(installer).toContain('status --porcelain --untracked-files=normal');
    expect(installer).toContain('__REPO_PATH__|$(escape_replacement "${runtime_repo_path}")');
  });

  it("always resolves worker code from the runner checkout", async () => {
    const runner = await readFile(runnerPath, "utf8");

    expect(runner).toContain('worker_repo_path="${runner_directory:h:h}"');
    expect(runner).not.toContain("HUNTER_REPO_PATH|");
    expect(runner).not.toContain('worker_repo_path="${HUNTER_REPO_PATH');
  });

  it("persists an optional Teams target without putting it in the launch plist", async () => {
    const [installer, runner] = await Promise.all([
      readFile(installerPath, "utf8"),
      readFile(runnerPath, "utf8")
    ]);

    expect(installer).toContain("--teams-target");
    expect(installer).toContain("HUNTER_TEAMS_TARGET=");
    expect(runner).toContain("HUNTER_TEAMS_TARGET|HUNTER_TEAMS_ACCOUNT");
  });

  it("loads the independent Apollo-exception Brave pause flag", async () => {
    const runner = await readFile(runnerPath, "utf8");

    expect(runner).toContain("HUNTER_APOLLO_EXCEPTION_AUTOPILOT_ENABLED");
  });
});
