# AI Development Engine — Version 1B.1

> Evidence status: Confirmed from code. Model quality and provider-specific model IDs require hands-on validation.

Version 1B.1 keeps the proven Qwen → DeepSeek → Qwen controller and adds the smallest local operator layer needed to use it safely across real multi-phase features. The normal entry point is now:

```bash
npm run ai:feature
```

The original `npm run ai-workflow` commands remain available as lower-level compatibility and diagnostic commands.

It implements only this sequence:

1. A fresh Qwen planner inspects the repository and returns a validated phased plan.
2. The launcher shows the complete roadmap, but a human approves exactly one phase.
3. DeepSeek implements only the current phase.
4. The controller runs every mandatory verification command.
5. A fresh Qwen reviewer receives the original request, approved plan, phase, cumulative Git diff, bounded surrounding code, and verification evidence.
6. Exact verification failures or review findings return to DeepSeek.
7. Every approved phase stops before every later phase. Progression is always a new explicit operator action.

Version 1B.1 adds bounded local feature state, append-only progress events, structured owner decisions, safe review recovery, and conservative resume checks. There is still no database, checkpoint commit, web dashboard, mobile service, Codex escalation, automatic push, merge, deployment, migration execution, or production/external action.

## Operator commands

```bash
npm run ai:feature
npm run ai:feature -- start customer-profile
npm run ai:feature -- continue customer-profile
npm run ai:feature -- adopt customer-profile
npm run ai:feature -- next customer-profile
npm run ai:feature -- status customer-profile
npm run ai:feature -- watch customer-profile
npm run ai:feature -- resume customer-profile
npm run ai:feature -- recover-review customer-profile
npm run ai:feature -- questions customer-profile
npm run ai:feature -- answer customer-profile QUESTION-ID
npm run ai:feature -- readiness customer-profile
npm run ai:feature -- models list
npm run ai:feature -- models configure
```

Running `npm run ai:feature` without arguments opens the guided menu. The launcher labels approval prompts, shows the selected worktree and models, creates internal request files, and reports when a model is active even if no safe content is available to display.

For a new feature, the operator may describe the request directly in ordinary text. Handoff Markdown, JSON, and review evidence are optional inputs for continuing or transferring existing work; they are not required to start a feature. The planner turns the operator's text plus repository evidence into the validated roadmap.

Feature state is owner-only and local under the coordination checkout:

```text
tmp/ai-workflow/features/<feature-slug>/
  state.json
  events.jsonl
  artifacts/
```

Unknown state versions, stale active-run guards, unexpected branches, changed HEADs, and changed diff hashes fail closed. Automatic reset, stash, clean, lock removal, rebase, deletion, commit, push, merge, and deployment are prohibited.

## Prerequisites

- Run `npm install` so the pinned repository-local OpenCode CLI is available.
- Authenticate the required providers with OpenCode outside this workflow by running `npx opencode auth login` once for each selected provider. Credentials stay in OpenCode's user storage; model configuration contains no keys. Version 1A.1 deliberately does not pass provider API-key environment variables into model subprocesses.
- Use the exact `provider/model` IDs reported for authenticated providers. Provider catalogs change, so the repository does not guess IDs for Qwen or DeepSeek releases.
- Start from a clean, dedicated Newl Apps task worktree. The repository root is a coordination checkout:

```bash
npm run codex:task:start -- my-feature
cd work/codex/my-feature
```

The task command already creates the required `codex/...` feature branch. In a clean non-base checkout, Version 1A.1 can also create one simple branch with `--branch codex/name`; it never fetches, pushes, commits, merges, or manages a worktree.

## Model configuration

The launcher stores reusable credential-free defaults at:

```text
~/.config/newl-ai-workflow/models.json
```

Worktree-level overrides at `tmp/ai-workflow/models.json` remain supported. Resolution order is complete CLI overrides, complete environment overrides, worktree override, then user defaults. Credentials remain exclusively in OpenCode storage.

List model IDs belonging to the providers currently authenticated in OpenCode:

```bash
npm run ai-workflow:models
```

Copy exact IDs from that output and validate/save the credential-free local selection:

```bash
npm run ai-workflow:configure -- \
  --planner-model '<exact-qwen-planner-id>' \
  --builder-model '<exact-deepseek-builder-id>' \
  --reviewer-model '<exact-qwen-reviewer-id>'
```

The compatibility command writes a worktree override with user-only permissions to ignored `tmp/ai-workflow/models.json`. It accepts only credential-free model IDs. Use `--model-config tmp/ai-workflow/another.json` to select another ignored file, or supply all three IDs through CLI flags/environment variables for a one-off run. Never put API keys in either model file or the repository.

## Feature registration, handoffs, and requests

`start` creates a repository-standard `work/codex/<slug>` task from freshly fetched `origin/main`. `adopt` registers an existing dedicated `codex/...` worktree after checking its branch, base, HEAD, and current diff. If owner-only `review-recovery.json` metadata exists, the launcher can import its request and roadmap, but it asks the owner whether the current phase actually received final approval.

Legacy Version 1A plans may predate structured `ownerQuestions`. During adoption, Version 1B.1 deterministically imports stable deferred IDs from an imported handoff JSON `open_business_questions` array. It also reads only plan-referenced `docs/**/open-questions.md` files and imports question bullets from sections that explicitly say they are blocking or gate the owner-approved phase. This compatibility path requires exactly one explicitly owner-gated phase, preserves the documented IDs and wording, rejects conflicting definitions, and performs no planner call. Unanswered imported blocking questions mark that phase blocked; answering the final blocker returns it to pending status.

Handoff Markdown, JSON, and review evidence are copied byte-for-byte into bounded, owner-only ignored storage and hashed with SHA-256. Symlinks, directories, devices, unsupported types, malformed top-level JSON, and files over 2 MB are rejected. The launcher never rewrites an artifact's internal paths; generated planning and phase requests refer to validated worktree-local copies.

## Phase approval and owner decisions

The roadmap is context, not blanket implementation approval. The controller always selects one phase, displays its risk, objective, expected files, tests, and completion criteria, and records approval for that phase only. HIGH and OWNER_GATED phases require typing the exact phase ID.

Planner questions have stable IDs, phase IDs, types, evidence, and blocking flags. Answers are stored with exact plan and question hashes. A changed question or plan requires reconfirmation. Models cannot default or infer missing owner decisions. Later owner-gated questions do not block an earlier phase unless they are explicitly global.

Risk may be raised deterministically but never lowered. Migration files and `prisma/schema.prisma` are at least HIGH. Protected production writes, deployment, OAuth consent, permission changes, Teamship writes, Apollo enrollment, customer communications, and destructive actions are OWNER_GATED and remain outside automatic engine authority.

`npm run ai-workflow -- --validate-models` revalidates a saved selection without invoking a model.

## Fail-closed preflight

Run the same preflight the workflow runs automatically:

```bash
npm run ai-workflow:preflight
```

Before the planner or any other model can run, preflight confirms:

- it is in the Newl Apps repository and a dedicated linked worktree, not the coordination checkout;
- the tree is clean and on the current or explicitly requested safe `codex/...` branch;
- Git, Node, npm, and the repository's `typecheck`, `lint`, `build`, and `test` scripts exist;
- the repository-local pinned OpenCode executable loads;
- the planner, builder, and reviewer agent profiles load;
- each configured model is an exact current OpenCode model ID and its provider has stored authentication; and
- the complete deterministic baseline passes.

Any failure exits before `opencode run` is invoked. There are currently no accepted baseline exceptions.

## Run

```bash
npm run ai-workflow -- \
  --request-file requests/my-feature.md
```

Use `--request "..."` instead of `--request-file` for a short request. Request files must be inside the repository and cannot be environment files.

Optional settings:

- `--branch codex/name` creates a new feature branch from the clean current commit.
- `--max-review-cycles 3` sets the fresh-review limit per phase.
- `--max-retries 3` sets the combined verification/review correction limit per phase.
- `--metrics-file tmp/name.jsonl` changes the ignored local metrics destination.
- `OPENCODE_BIN=/absolute/path` selects another OpenCode executable.
- `AI_WORKFLOW_PLANNER_MODEL`, `AI_WORKFLOW_BUILDER_MODEL`, and `AI_WORKFLOW_REVIEWER_MODEL` may supply model IDs.

The CLI displays the complete plan and accepts only an interactive `yes` or `y` before any builder runs. There is no non-interactive approval flag.

## Reviewer contract and review-boundary recovery

Reviewer status is fail-closed. The only canonical values are `approved`, `changes_requested`, and `escalate`. `approved` must be exact and cannot contain findings, missing tests, scope concerns, or an escalation reason. The controller never converts `pass`, `passed`, `accepted`, `looks_good`, `no_issues`, capitalization variants of approval, or positive prose into approval.

For provider compatibility, the only accepted aliases are `changes_required` and `changes-requested`, which become `changes_requested`. Capitalization variants of canonical `changes_requested` and `escalate` are also normalized. A change request still requires at least one complete actionable finding, and an escalation requires a non-empty reason. The entire normalized object is revalidated; nested, incomplete, truncated, ambiguous, and extra-field envelopes fail closed.

Immediately before each independent review, the controller writes one bounded, owner-only recovery packet to ignored `tmp/ai-workflow/review-recovery.json`. It contains the original request, approved plan, current phase ID, expected branch, base commit, HEAD, and exact diff hash. It is not a general persistence or resume layer. If reviewer parsing fails, the controller separately writes a bounded, redacted diagnostic under `tmp/ai-workflow/failures/` with the OpenCode session, assistant-message, and relevant text-part IDs when available. Reasoning parts, common credential shapes, environment variables, and unbounded OpenCode logs are not stored.

To recover only the pinned review boundary:

```bash
npm run ai-workflow -- review-current-diff
```

The supported operator equivalent is:

```bash
npm run ai:feature -- recover-review <feature-slug>
```

The command validates the dedicated worktree, exact model configuration, stored provider authentication, owner-only recovery packet, branch, base, HEAD, and diff hash. It reruns all mandatory verification before making a fresh read-only reviewer call. It makes no planner or initial builder call. A validated change request enters the existing correction loop with the exact findings; approval marks only the pinned phase. Recovery always stops before every later phase and requires explicit owner action to continue. Any changed identity, malformed response, reviewer-side Git mutation, commit, or owner-gated current phase is rejected.

## Deterministic verification

The controller runs these commands once during preflight and again in this order after every builder attempt:

```text
git diff --check <workflow-starting-commit> --
npm run typecheck
npm run lint
npm run build
npm run test
```

Models cannot remove, replace, narrow, or bypass these commands. Planner `testFiles` entries describe expected regression files for Qwen's coverage review only; they never control execution. A reviewer is not called unless all five checks pass.

### Verification cadence assessment

The first pilot intentionally retains this strict cadence. Rebuilding the production bundle and running the entire test suite after every implementation or correction attempt is likely to become the dominant runtime as the repository grows or a phase needs several retries. It is acceptable for the first evidence-gathering pilot because it minimizes ambiguity about whether a failure was introduced. The recorded command durations and review metrics should be used later to decide whether a deterministic focused-test tier plus one final full gate is warranted; Version 1A.1 does not make that optimization.

Verification output is bounded and common credential patterns are redacted. Exact failing output is returned to the builder. Successful output sent to the reviewer is deterministically reduced to command identity, pass status, exit code, duration, a bounded summary, and a SHA-256 output hash; bounded sanitized raw output remains local. Commands receive a reduced environment. OpenCode agents cannot use shell commands, invoke subagents, read or edit environment files, access outside the repository, browse the web, commit, push, or deploy. Only the builder can edit repository files.

## Progress and evaluator extension

The launcher records safe milestones in `events.jsonl` and shows feature, phase, stage, elapsed time, model role, and heartbeats. It never records private reasoning or raw environment variables. `status` reads the current atomic snapshot; `watch` follows the append-only event file.

Version 1B.1 also defines the schema-validated `WorkflowEvaluator` interface. Evaluators are controller-registered deterministic evidence producers. A required evaluator may block review, but it can never approve a phase. No Hunter, TradeMining, Apollo, or outreach evaluator is implemented in this version.

## Metrics

Each successfully completed workflow appends one JSON record to `tmp/ai-workflow-metrics.jsonl` by default. The record contains:

- planner, builder, and reviewer models;
- start, completion, and total elapsed time;
- total API cost when every OpenCode event exposes cost, otherwise `null`;
- retry count and review cycles;
- files changed; and
- test commands executed.

This JSONL file is measurement only. It cannot resume a workflow and is ignored by Git.

## Proposed live pilot (requires separate approval)

Do not run this pilot merely because the readiness pass is installed. After the readiness changes are reviewed and the worktree is clean, the proposed synthetic request is:

> Add a standalone developer-tooling helper `formatPilotFeatureLabel(input: string)` in `tools/ai-workflow/pilot-fixture.ts`. It must trim leading and trailing whitespace, collapse internal whitespace to one ASCII space, and return `(untitled)` when the result is empty. Add Vitest coverage for ordinary text, repeated mixed whitespace, and blank input. Do not import or integrate the helper anywhere else, and do not change production application behavior.

Expected tracked files are only `tools/ai-workflow/pilot-fixture.ts` and `tests/ai-workflow-pilot-fixture.test.ts`. The minimum path uses three model sessions (planner, builder, reviewer); one requested correction raises that to five. Repository inspection may make each session use several underlying provider requests. A cautious planning range is 10–30 provider requests, roughly 50k–200k input tokens and 3k–15k output tokens. Monetary cost cannot be estimated responsibly until the exact authenticated model IDs and provider rates are selected; the workflow records cost only when OpenCode exposes it.

After explicit approval, run:

```bash
npm run ai-workflow:preflight
npm run ai-workflow -- --request 'Add a standalone developer-tooling helper formatPilotFeatureLabel(input: string) in tools/ai-workflow/pilot-fixture.ts. It must trim leading and trailing whitespace, collapse internal whitespace to one ASCII space, and return (untitled) when the result is empty. Add Vitest coverage for ordinary text, repeated mixed whitespace, and blank input. Do not import or integrate the helper anywhere else, and do not change production application behavior.'
```

For a recoverable rollback, first confirm that Git reports only the two expected files. Move those two files to a temporary holding directory, confirm the tracked worktree is clean, and retain or remove the ignored metrics file as desired:

```bash
mkdir -p /private/tmp/newl-ai-workflow-pilot-rollback
mv tools/ai-workflow/pilot-fixture.ts /private/tmp/newl-ai-workflow-pilot-rollback/
mv tests/ai-workflow-pilot-fixture.test.ts /private/tmp/newl-ai-workflow-pilot-rollback/
git status --short
```

If the workflow changes any unexpected file, stop and review it instead of using a broad reset or clean command.

## Manual finish

After completion, inspect the branch, run any risk-specific or browser checks the approved plan requires, commit intentionally, and follow the repository's normal reviewed pull-request process. Version 1A deliberately stops before those actions.

### Git and pull-request boundary

Engine phase approval is an AI quality gate, not automatically a Git commit or pull-request boundary. Version 1B.1 pins the registered HEAD and cumulative diff for safe resume and recovery, so do not commit between phases of one active registered workflow. The normal path is:

1. Complete every approved phase intended for the current branch, stopping for owner decisions between phases.
2. Inspect the complete cumulative diff and run any risk-specific acceptance checks.
3. Commit intentionally after the engine workflow for that branch is complete.
4. Run `npm run codex:task:publish -- ...` or ask Codex to create a draft pull request.
5. Review CI and any applicable Vercel Preview, mark the pull request ready, and merge only through human review.
6. After confirmed merge, run `npm run codex:task:cleanup -- <task-slug>`.

When a HIGH or OWNER_GATED phase is independently reviewable, prefer ending the current workflow and opening a pull request for that phase, then start the later phase in a fresh task worktree from merged `origin/main`. Do not reuse or silently repoint the existing registered workflow across that Git boundary. The launcher never commits, pushes, opens, merges, or deploys a pull request itself.

## Known Version 1B.1 limitations

- Resume is limited to state boundaries that can be reconciled against the exact branch, base, HEAD, and diff. An interrupted builder that changed files requires explicit inspection; it is never assumed complete.
- The reviewer gets the cumulative diff from the workflow starting commit. Later-phase reviews may therefore include earlier approved changes.
- There is no final cross-phase reviewer beyond the per-phase reviews.
- OpenCode provider authentication and exact model availability are local prerequisites; preflight validates their local presence but makes no inference request.
- API cost is `null` when OpenCode does not emit complete cost data.
- No browser runner is selected automatically. The fixed build and Vitest baseline runs, while any manual UI validation remains part of human acceptance.
- High-risk work is not delegated to Codex. A reviewer escalation or exhausted loop stops with a manual-escalation error.
- A phase marked `requiresOwnerApproval` never starts automatically, including after a recovered earlier-phase approval.
- Low-risk auto-continuation is deliberately not enabled. Every phase stops during the initial trust-building period.
- Concurrent active workflow execution is unsupported. A stale active-run guard is not automatically removed.
- OpenCode remains CLI-driven. The mobile status service and SDK/server transport are deferred.

The retained future architecture is documented in [`docs/ai/ai-development-engine.md`](../../docs/ai/ai-development-engine.md).
