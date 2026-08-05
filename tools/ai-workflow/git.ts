import { spawn } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { relative, resolve, sep } from "node:path";

import { sanitizeCommandOutput } from "./verification";

const MAX_DIFF_CHARACTERS = 400_000;
const MAX_CONTEXT_CHARACTERS = 120_000;
const MAX_CONTEXT_LINES_PER_FILE = 240;

type GitResult = {
  stdout: string;
  stderr: string;
  exitCode: number | null;
};

async function git(
  repositoryRoot: string,
  args: string[],
  allowedExitCodes: number[] = [0]
): Promise<GitResult> {
  return new Promise((resolveResult, reject) => {
    const child = spawn("git", args, {
      cwd: repositoryRoot,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => (stdout += chunk));
    child.stderr.on("data", (chunk: string) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (exitCode) => {
      if (exitCode !== null && allowedExitCodes.includes(exitCode)) {
        resolveResult({ stdout, stderr, exitCode });
        return;
      }
      reject(new Error(`git ${args[0]} failed: ${stderr.trim() || stdout.trim() || exitCode}`));
    });
  });
}

function validateBranchName(branch: string): string {
  if (
    !branch.startsWith("codex/") ||
    branch.length > 120 ||
    !/^[A-Za-z0-9][A-Za-z0-9._/-]+$/.test(branch) ||
    branch.includes("..") ||
    branch.includes("@{") ||
    branch.endsWith("/") ||
    branch.endsWith(".lock")
  ) {
    throw new Error("Workflow branches must be safe names under the codex/ prefix.");
  }
  return branch;
}

export function makeWorkflowBranchName(request: string, now = new Date()): string {
  const slug = request
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 42);
  const timestamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "z").toLowerCase();
  return `codex/ai-workflow-${slug || "feature"}-${timestamp}`;
}

export async function findRepositoryRoot(cwd: string): Promise<string> {
  const result = await git(cwd, ["rev-parse", "--show-toplevel"]);
  return resolve(result.stdout.trim());
}

export type GitWorktreeInspection = {
  repositoryRoot: string;
  branch: string;
  gitDirectory: string;
  commonGitDirectory: string;
  isDedicatedWorktree: boolean;
};

export async function inspectGitWorktree(repositoryRoot: string): Promise<GitWorktreeInspection> {
  const [topLevel, branch, gitDirectory, commonGitDirectory, inside] = await Promise.all([
    git(repositoryRoot, ["rev-parse", "--show-toplevel"]),
    git(repositoryRoot, ["branch", "--show-current"]),
    git(repositoryRoot, ["rev-parse", "--git-dir"]),
    git(repositoryRoot, ["rev-parse", "--git-common-dir"]),
    git(repositoryRoot, ["rev-parse", "--is-inside-work-tree"])
  ]);
  if (inside.stdout.trim() !== "true") throw new Error("The current directory is not a Git worktree.");

  const actualRoot = resolve(topLevel.stdout.trim());
  const resolvedGitDirectory = resolve(repositoryRoot, gitDirectory.stdout.trim());
  const resolvedCommonDirectory = resolve(repositoryRoot, commonGitDirectory.stdout.trim());
  return {
    repositoryRoot: actualRoot,
    branch: branch.stdout.trim(),
    gitDirectory: resolvedGitDirectory,
    commonGitDirectory: resolvedCommonDirectory,
    isDedicatedWorktree: resolvedGitDirectory !== resolvedCommonDirectory
  };
}

export async function ensureWorkflowBranch(
  repositoryRoot: string,
  requestedBranch?: string
): Promise<{ branch: string; baseCommit: string }> {
  const status = await git(repositoryRoot, ["status", "--porcelain=v1", "--untracked-files=all"]);
  if (status.stdout.trim()) {
    throw new Error("The workflow requires a clean working tree before planning begins.");
  }

  const current = (await git(repositoryRoot, ["branch", "--show-current"])).stdout.trim();
  if (!current) throw new Error("The workflow cannot start from a detached HEAD.");

  let branch = current;
  if (requestedBranch && requestedBranch !== current) {
    branch = validateBranchName(requestedBranch);
    const existing = await git(repositoryRoot, ["branch", "--list", branch]);
    if (existing.stdout.trim()) {
      throw new Error(`Branch ${branch} already exists; Version 1A does not resume or reuse branches.`);
    }
    await git(repositoryRoot, ["switch", "-c", branch]);
  } else if (current === "main" || current === "master") {
    throw new Error(
      "Refusing to modify the base branch. Supply a new codex/... branch or start a Newl Apps task worktree first."
    );
  }
  validateBranchName(branch);

  const baseCommit = (await git(repositoryRoot, ["rev-parse", "HEAD"])).stdout.trim();
  return { branch, baseCommit };
}

export async function listChangedFiles(repositoryRoot: string): Promise<string[]> {
  const result = await git(repositoryRoot, [
    "-c",
    "core.quotepath=false",
    "status",
    "--porcelain=v1",
    "-z",
    "--untracked-files=all"
  ]);
  const records = result.stdout.split("\0").filter(Boolean);
  const paths: string[] = [];
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    const status = record.slice(0, 2);
    paths.push(record.slice(3));
    if (status.includes("R") || status.includes("C")) index += 1;
  }
  return [...new Set(paths)].sort();
}

function safeChangedPath(repositoryRoot: string, path: string): string {
  const absolute = resolve(repositoryRoot, path);
  const rel = relative(repositoryRoot, absolute);
  if (!rel || rel === ".." || rel.startsWith(`..${sep}`)) {
    throw new Error(`Git reported a changed path outside the repository: ${path}`);
  }
  return absolute;
}

export async function getWorkflowDiff(repositoryRoot: string, baseCommit: string): Promise<string> {
  let diff = (
    await git(repositoryRoot, ["diff", "--no-ext-diff", "--binary", "--unified=80", baseCommit, "--"])
  ).stdout;
  const status = await git(repositoryRoot, ["ls-files", "-z", "--others", "--exclude-standard"]);

  for (const path of status.stdout.split("\0").filter(Boolean)) {
    safeChangedPath(repositoryRoot, path);
    const untrackedDiff = await git(
      repositoryRoot,
      ["diff", "--no-index", "--binary", "--", "/dev/null", path],
      [0, 1]
    );
    diff += `\n${untrackedDiff.stdout}`;
  }

  if (!diff.trim()) return "(no Git diff)";
  const bounded =
    diff.length <= MAX_DIFF_CHARACTERS
      ? diff
      : `${diff.slice(0, MAX_DIFF_CHARACTERS)}\n...[Git diff truncated; inspect changed files directly]...`;
  return sanitizeCommandOutput(bounded);
}

export async function getSurroundingCode(repositoryRoot: string): Promise<string> {
  const sections: string[] = [];
  let characters = 0;

  for (const path of await listChangedFiles(repositoryRoot)) {
    const absolute = safeChangedPath(repositoryRoot, path);
    if (!existsSync(absolute) || !statSync(absolute).isFile()) continue;
    const buffer = readFileSync(absolute);
    if (buffer.includes(0)) {
      sections.push(`### ${path}\n(binary file omitted)`);
      continue;
    }
    const lines = buffer.toString("utf8").split(/\r?\n/);
    const excerpt = lines.slice(0, MAX_CONTEXT_LINES_PER_FILE).join("\n");
    const section = `### ${path}\n${excerpt}${
      lines.length > MAX_CONTEXT_LINES_PER_FILE ? "\n...[file excerpt truncated]..." : ""
    }`;
    if (characters + section.length > MAX_CONTEXT_CHARACTERS) {
      sections.push("...[surrounding code limit reached; inspect remaining files directly]...");
      break;
    }
    sections.push(section);
    characters += section.length;
  }

  return sections.length > 0
    ? sanitizeCommandOutput(sections.join("\n\n"))
    : "(no changed file context)";
}
