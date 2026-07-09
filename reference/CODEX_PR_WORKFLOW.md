# Codex PR Workflow

Use this workflow whenever Codex finishes code, documentation, schema, test, or configuration changes in Newl Apps and needs to publish them to GitHub.

## Goal

Avoid rediscovering how to create pull requests. Always reuse an existing open PR for the current branch when one exists. Create a new PR only when no open PR exists.

## Required Behavior

1. Confirm the current branch and working tree.
   - Run `git branch --show-current`.
   - Run `git status --short`.
   - Never work directly on `main`.
   - If the user has unrelated local changes, leave them alone and use a clean branch or worktree.

2. Commit intentionally.
   - Stage only files related to the request.
   - Commit with a concise message.
   - Do not amend or rewrite commits unless the user asks.

3. Push the branch.
   - Use `git push -u origin <branch>` for a new branch.
   - Use `git push` for an already tracked branch.

4. Use the GitHub connector for PR operations.
   - First call `tool_search` for GitHub pull request tools, using a query such as `pull request create list github`.
   - Prefer connector tools over `gh`.
   - Do not assume the `gh` CLI is installed.

5. Check for an existing open PR for the current branch.
   - If a list/search PR tool is available, search open PRs where `head` equals the current branch.
   - If an open PR exists, do not create another PR. Push the branch and, when useful, add a short PR comment summarizing the new commit and verification.
   - If no list/search tool is available, try the create PR tool only after checking the branch has been pushed. If GitHub reports a PR already exists, reuse that PR URL.

6. Create a PR only if one is not already open.
   - Use the GitHub connector `_create_pull_request` tool when available.
   - Base branch: `main`.
   - Head branch: the current branch.
   - Set `draft: false` unless the user asks for a draft.
   - Set `maintainer_can_modify: true`.

7. PR body must include:
   - What changed
   - Why it changed
   - Files changed
   - How to test locally
   - Screens/pages affected
   - Tenant-safety considerations
   - Known limitations

8. Final response must include:
   - PR URL or the existing PR URL that was updated.
   - Verification commands run and their results.
   - Any checks that could not be run.

## Connector Notes

When `tool_search` exposes GitHub PR tools, use them directly. The commonly used tool is:

- `mcp__codex_apps__github._create_pull_request`

If only issue/comment tools are initially visible, search again with a PR-specific query. GitHub tools are lazy-loaded and may not appear until searched.

## Fallbacks

- If the GitHub connector is unavailable, use the pushed branch URL GitHub prints after `git push` and tell the user PR creation could not be completed from the current tool environment.
- If `gh` is installed and authenticated, it may be used as a fallback, but never as the first choice.
- If neither connector nor `gh` can create the PR, provide the exact compare URL:
  `https://github.com/newell29/newl-apps/pull/new/<branch>`

## Safety Rules

- Never push directly to `main`.
- Never create duplicate PRs for the same branch.
- Never stage secrets or generated local output unless explicitly requested and safe.
- Never merge the PR unless the user explicitly asks.
