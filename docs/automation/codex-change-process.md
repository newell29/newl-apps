# Automation: Codex Change Process

> Evidence status: Confirmed from code unless otherwise marked.


This document records operational guardrails from `AGENTS.md`, `reference/CODEX_PR_WORKFLOW.md`, auth docs, package scripts, and implementation files. Production behaviour must not be changed by documentation-only work.

## Why task worktrees are required

All Codex chats for this repository share the same Git object database and branch references. Reusing the root checkout, creating branches from a stale local `main`, or leaving temporary worktrees registered can cause:

- branches that begin several commits behind GitHub `main`;
- pull requests that conflict only when they are ready for review;
- branches that cannot be checked out because another chat still owns a worktree;
- `gh pr create` failures when remote-tracking references were not fetched; and
- accidental overlap between unrelated conversations.

The root checkout is therefore a coordination checkout. Each implementation task uses a uniquely named persistent worktree created from a freshly fetched `origin/main`.

## One-time GitHub authentication

Run:

```bash
npm run codex:github-auth
```

This verifies the GitHub CLI login, opens the GitHub browser login only when the stored credential is missing or invalid, and configures Git to reuse that credential. Secret values are never printed or written into the repository.

Authentication is stored outside the repository by GitHub CLI and the operating-system credential store. Codex sandbox or connector approvals are separate product-level controls and are not disabled by this command.

## Start a task

From any checkout of Newl Apps, run:

```bash
npm run codex:task:start -- website-growth-example
```

The start command:

1. validates the unique task slug;
2. confirms persistent GitHub authentication for HTTPS remotes;
3. fetches the current `origin/main`;
4. refuses to reuse an existing local or remote branch;
5. creates `codex/website-growth-example`;
6. creates the worktree under `work/codex/website-growth-example`; and
7. reuses the root `node_modules` directory when it is available.

Each chat must remain in its assigned worktree for the lifetime of the task.

## Publish a task

After the intended changes are committed, run:

```bash
npm run codex:task:publish -- \
  --title "Describe the change" \
  --body-file /absolute/path/to/pr-body.md
```

The publish command refuses dirty or non-Codex branches, fetches current `main`, merges it into the task branch when needed, runs lint and the production build, pushes the branch, and opens a draft pull request. If current `main` overlaps the task, publication stops with the exact conflicted files so the agent can resolve them before owner review.

Focused regression tests remain the responsibility of the task agent and must be included in the final report and pull-request body. `--skip-checks` is available only when equivalent validation has already been run and documented. `--no-pr` supports credential-separated automation that publishes the branch while another approved system creates the pull request.

The command never merges the pull request or deploys production.

## Clean up after merge

After the owner merges the pull request, run:

```bash
npm run codex:task:cleanup -- website-growth-example
```

Cleanup confirms the GitHub pull request was merged, refuses a worktree with uncommitted changes, removes the dedicated worktree, and deletes only its merged local branch. It does not delete unmerged work or production data.

GitHub's repository setting to automatically delete merged head branches should be enabled so remote feature branches do not accumulate.

## Existing worktrees

Existing worktrees require a one-time audit. Do not bulk-delete them. For each worktree:

1. identify the owning chat and pull request;
2. confirm whether its branch is merged, open, abandoned, or contains uncommitted changes;
3. preserve every active or dirty worktree; and
4. use the guarded cleanup command only for confirmed-merged tasks.
