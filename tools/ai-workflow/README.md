# AI Development Engine — Version 1A.1

> Evidence status: Confirmed from code. Model quality and provider-specific model IDs require hands-on validation.

Version 1A.1 is a developer-operated experiment for one question: does a supervised Qwen → DeepSeek → Qwen loop improve Newl Apps feature quality? The 1A.1 readiness pass adds only the fail-closed checks needed for one safe live pilot.

It implements only this sequence:

1. A fresh Qwen planner inspects the repository and returns a validated phased plan.
2. A human approves the complete plan once.
3. DeepSeek implements only the current phase.
4. The controller runs every mandatory verification command.
5. A fresh Qwen reviewer receives the original request, approved plan, phase, cumulative Git diff, bounded surrounding code, and verification evidence.
6. Exact verification failures or review findings return to DeepSeek.
7. An approved phase may advance only when the next phase is not owner-gated. Completion is manual.

There is no workflow-state persistence, event journal, lock, migration, checkpoint commit, resume support, dashboard, reporting engine, Codex escalation, automatic push, merge, deployment, or production action.

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

The selection is written with user-only file permissions to ignored `tmp/ai-workflow/models.json`. It accepts only the three model ID fields. Use `--model-config tmp/ai-workflow/another.json` to select another ignored file, or supply all three IDs through CLI flags/environment variables for a one-off run. Never put API keys in this file or the repository.

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

Verification output is bounded and common credential patterns are redacted before it is sent to the reviewer or builder. Commands receive a reduced environment. OpenCode agents cannot use shell commands, invoke subagents, read or edit environment files, access outside the repository, browse the web, commit, push, or deploy. Only the builder can edit repository files.

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

## Known Version 1A.1 limitations

- There is no general resume support. Only the most recent independently reviewed boundary has a one-shot, local recovery packet; all other interrupted states restart manually.
- The reviewer gets the cumulative diff from the workflow starting commit. Later-phase reviews may therefore include earlier approved changes.
- There is no final cross-phase reviewer beyond the per-phase reviews.
- OpenCode provider authentication and exact model availability are local prerequisites; preflight validates their local presence but makes no inference request.
- API cost is `null` when OpenCode does not emit complete cost data.
- No browser runner is selected automatically. The fixed build and Vitest baseline runs, while any manual UI validation remains part of human acceptance.
- High-risk work is not delegated to Codex. A reviewer escalation or exhausted loop stops with a manual-escalation error.
- A phase marked `requiresOwnerApproval` never starts automatically, including after a recovered earlier-phase approval.

The retained future architecture is documented in [`docs/ai/ai-development-engine.md`](../../docs/ai/ai-development-engine.md).
