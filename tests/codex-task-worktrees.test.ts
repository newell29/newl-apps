import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

const repositoryRoot = resolve(__dirname, "..");
const startScript = join(repositoryRoot, "scripts/codex-task-start.sh");
const publishScript = join(repositoryRoot, "scripts/codex-task-publish.sh");
const cleanupScript = join(repositoryRoot, "scripts/codex-task-cleanup.sh");

const temporaryDirectories: string[] = [];

function run(
  command: string,
  args: string[],
  cwd: string,
  extraEnv: NodeJS.ProcessEnv = {}
) {
  return spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      ...extraEnv
    }
  });
}

function git(cwd: string, ...args: string[]) {
  const result = run("git", args, cwd);
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout);
  }
  return result.stdout.trim();
}

function createFixture() {
  const root = mkdtempSync(join(tmpdir(), "newl-codex-worktrees-"));
  temporaryDirectories.push(root);

  const remote = join(root, "remote.git");
  const seed = join(root, "seed");
  const coordinator = join(root, "coordinator");
  const worktrees = join(root, "worktrees");

  mkdirSync(seed);
  git(root, "init", "--bare", remote);
  git(seed, "init");
  git(seed, "config", "user.name", "Codex Test");
  git(seed, "config", "user.email", "codex-test@example.com");
  writeFileSync(join(seed, "README.md"), "fixture\n");
  git(seed, "add", "README.md");
  git(seed, "commit", "-m", "Initial fixture");
  git(seed, "branch", "-M", "main");
  git(seed, "remote", "add", "origin", remote);
  git(seed, "push", "-u", "origin", "main");
  git(remote, "symbolic-ref", "HEAD", "refs/heads/main");
  git(root, "clone", remote, coordinator);
  git(coordinator, "config", "user.name", "Codex Test");
  git(coordinator, "config", "user.email", "codex-test@example.com");

  return { coordinator, remote, worktrees };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("Codex task worktree workflow", () => {
  it("starts from current origin/main, publishes after resync, and cleans only after merge", () => {
    const fixture = createFixture();
    const environment = {
      CODEX_WORKTREE_ROOT: fixture.worktrees
    };

    const start = run("bash", [startScript, "workflow-test"], fixture.coordinator, environment);
    expect(start.status, start.stderr || start.stdout).toBe(0);

    const taskWorktree = join(fixture.worktrees, "workflow-test");
    expect(existsSync(taskWorktree)).toBe(true);
    expect(git(taskWorktree, "branch", "--show-current")).toBe("codex/workflow-test");
    expect(git(taskWorktree, "rev-parse", "HEAD")).toBe(
      git(fixture.coordinator, "rev-parse", "origin/main")
    );

    writeFileSync(join(taskWorktree, "feature.txt"), "feature\n");
    git(taskWorktree, "add", "feature.txt");
    git(taskWorktree, "commit", "-m", "Add fixture feature");

    writeFileSync(join(fixture.coordinator, "main.txt"), "main\n");
    git(fixture.coordinator, "add", "main.txt");
    git(fixture.coordinator, "commit", "-m", "Advance main");
    git(fixture.coordinator, "push", "origin", "main");

    const publish = run(
      "bash",
      [publishScript, "--no-pr", "--skip-checks"],
      taskWorktree,
      environment
    );
    expect(publish.status, publish.stderr || publish.stdout).toBe(0);
    expect(
      git(taskWorktree, "merge-base", "--is-ancestor", "origin/main", "HEAD")
    ).toBe("");
    expect(git(taskWorktree, "rev-parse", "HEAD")).toBe(
      git(taskWorktree, "rev-parse", "origin/codex/workflow-test")
    );

    git(fixture.coordinator, "merge", "--no-ff", "codex/workflow-test", "-m", "Merge fixture task");
    git(fixture.coordinator, "push", "origin", "main");

    const cleanup = run(
      "bash",
      [cleanupScript, "workflow-test"],
      fixture.coordinator,
      environment
    );
    expect(cleanup.status, cleanup.stderr || cleanup.stdout).toBe(0);
    expect(existsSync(taskWorktree)).toBe(false);
    expect(
      git(fixture.coordinator, "branch", "--list", "codex/workflow-test")
    ).toBe("");
  });

  it("refuses to create a second task with the same branch name", () => {
    const fixture = createFixture();
    const environment = {
      CODEX_WORKTREE_ROOT: fixture.worktrees
    };

    const first = run("bash", [startScript, "duplicate-test"], fixture.coordinator, environment);
    expect(first.status, first.stderr || first.stdout).toBe(0);

    const duplicate = run(
      "bash",
      [startScript, "duplicate-test"],
      fixture.coordinator,
      environment
    );
    expect(duplicate.status).not.toBe(0);
    expect(duplicate.stdout).toContain("already exists");
  });
});
