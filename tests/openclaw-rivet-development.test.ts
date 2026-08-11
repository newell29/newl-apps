import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const repoRoot = process.cwd();
const runnerPath = path.join(repoRoot, "ops/openclaw/run-rivet-development-job.sh");
const hunterQualityRunnerPath = path.join(
  repoRoot,
  "ops/openclaw/run-rivet-hunter-quality-audit.sh"
);
const installerPath = path.join(repoRoot, "ops/openclaw/install-rivet-development-worker.sh");

describe("Rivet local Codex development worker", () => {
  it("keeps the runner and installer valid zsh", async () => {
    await expect(execFileAsync("/bin/zsh", ["-n", runnerPath])).resolves.toBeDefined();
    await expect(
      execFileAsync("/bin/zsh", ["-n", hunterQualityRunnerPath])
    ).resolves.toBeDefined();
    await expect(execFileAsync("/bin/zsh", ["-n", installerPath])).resolves.toBeDefined();
  });

  it("requires Garland context, an isolated branch, and schema-validated local Codex output", async () => {
    const runner = await readFile(runnerPath, "utf8");
    const gitignore = await readFile(path.join(repoRoot, ".gitignore"), "utf8");

    expect(runner).toContain("read every requiredContextPaths entry");
    expect(runner).toContain("For Garland work, those files are the required operating understanding");
    expect(runner).toContain('rivet_repo_path="${runner_directory:h:h}"');
    expect(runner).toContain('git -C "${rivet_repo_path}" worktree add');
    expect(runner).toContain('git -C "${rivet_repo_path}" cat-file -e "origin/${base_branch}:${context_path}"');
    expect(runner).toContain('if ! /usr/bin/python3 - "${packet_path}"');
    expect(runner).not.toContain('IFS=$\'\\t\' read -r repository base_branch branch_name codex_model codex_effort title issue_key <<EOF');
    expect(runner).toContain("--sandbox workspace-write");
    expect(runner).toContain("--output-schema");
    expect(runner).toContain("env -i");
    expect(runner).not.toContain("OPENAI_API_KEY");
    expect(runner).not.toContain("--dangerously-bypass-approvals-and-sandbox");
    expect(runner).toContain("prompts/rivet-code-review.md");
    expect(runner).toContain("review-output.schema.json");
    expect(runner).toContain("rivet-review-preflight.py");
    expect(runner).toContain("--sandbox read-only");
    expect(runner).toContain("max_autofix_attempts=2");
    expect(runner).toContain("OPEN_SIBLING_PULL_REQUEST_OVERLAPS_JSON");
    expect(runner).toContain("RIVET_REVIEW_BLOCKED");
    expect(runner).toContain("evidenceManifests");
    expect(runner).toContain(".rivet-evidence");
    expect(runner).toContain("X-Newl-Rivet-Lease-Token");
    expect(runner).toContain("inspect every artifact localPath");
    expect(runner).toContain("exact saved reviewOrder");
    expect(runner).toContain("Evidence is read-only and must never be added to Git");
    expect(runner).toContain("\\.rivet-evidence(?:/|$)");
    expect(gitignore).toContain(".rivet-evidence/");
  });

  it("opens only a draft PR and reports completion without merge or deployment", async () => {
    const runner = await readFile(runnerPath, "utf8");

    expect(runner).toContain("\"draft\": True");
    expect(runner).toContain("pullRequestUrls");
    expect(runner).toContain("\"action\": \"complete\"");
    expect(runner).toContain("\"action\": \"review\"");
    expect(runner).not.toMatch(/\bgh pr merge\b/);
    expect(runner).not.toMatch(/\bvercel deploy\b/);
  });

  it("opens no PR until the exact commit passes independent review", async () => {
    const runner = await readFile(runnerPath, "utf8");
    const passGate = runner.indexOf('if [[ "${review_verdict}" == "PASS" ]]');
    const openReviewedPr = runner.indexOf(
      'failure_stage="open the independently reviewed draft pull request"'
    );
    const blockedReview = runner.indexOf(
      'failure_stage="record the independent review blocker"'
    );

    expect(passGate).toBeGreaterThan(0);
    expect(openReviewedPr).toBeGreaterThan(passGate);
    expect(blockedReview).toBeGreaterThan(openReviewedPr);
    expect(runner).not.toContain('failure_stage="open the draft pull request"');
    expect(
      runner.indexOf('write_pull_request_payload "create"', runner.indexOf("while true; do"))
    ).toBeLessThan(
      runner.indexOf("CURRENT_PULL_REQUEST_PAYLOAD_JSON:", runner.indexOf("while true; do"))
    );
    expect(runner).toContain(
      "Independent Codex review blocked this branch before PR creation"
    );
  });

  it("installs a separate Rivet command schedule instead of adding Codex access to the digest", async () => {
    const installer = await readFile(installerPath, "utf8");

    expect(installer).toContain("--name \"NEWL Rivet Developer\"");
    expect(installer).toContain("--declaration-key \"newl.rivet.developer.approved.v1\"");
    expect(installer).toContain("--cron \"* * * * *\"");
    expect(installer).toContain("--no-deliver");
    expect(installer).toContain("RIVET_TEAMS_TARGET");
    expect(installer).toContain("--name \"NEWL Hunter Quality Auditor\"");
    expect(installer).toContain(
      "--declaration-key \"newl.hunter.quality-auditor.daily.v1\""
    );
    expect(installer).toContain("--cron \"30 13 * * *\"");
  });

  it("keeps Hunter quality research read-only and sends only the bounded result to Teams", async () => {
    const runner = await readFile(hunterQualityRunnerPath, "utf8");

    expect(runner).toContain("--sandbox read-only");
    expect(runner).toContain("--output-schema");
    expect(runner).toContain("send_rivet_teams_message");
    expect(runner).toContain("No lead was reclassified");
    expect(runner).not.toMatch(/\bgh pr merge\b/);
    expect(runner).not.toMatch(/\bvercel deploy\b/);
    expect(runner).not.toContain("INGESTION_API_TOKEN");
  });
});
