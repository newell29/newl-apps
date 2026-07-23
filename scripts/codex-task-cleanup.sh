#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "Usage: npm run codex:task:cleanup -- <task-slug-or-branch>"
}

task="${1:-}"
if [[ -z "$task" ]]; then
  usage
  exit 1
fi

if [[ "$task" == codex/* ]]; then
  branch="$task"
else
  branch="codex/$task"
fi

repo_root="$(git rev-parse --show-toplevel 2>/dev/null)" || {
  echo "Run this command from inside the Newl Apps repository."
  exit 1
}
cd "$repo_root"

if ! git show-ref --verify --quiet "refs/heads/$branch"; then
  echo "Local branch '$branch' does not exist."
  exit 1
fi

remote_url="$(git remote get-url origin)"
github_remote=false
if [[ "$remote_url" == https://github.com/* ]]; then
  github_remote=true
  if ! command -v gh >/dev/null 2>&1 || ! gh auth status --hostname github.com >/dev/null 2>&1; then
    echo "The persistent GitHub login is missing or invalid."
    echo "Run: npm run codex:github-auth"
    exit 1
  fi
fi

GIT_TERMINAL_PROMPT=0 git fetch origin \
  "+refs/heads/main:refs/remotes/origin/main"

merged=false
if [[ "$github_remote" == true ]]; then
  merged_at="$(gh pr view "$branch" --json mergedAt --jq '.mergedAt // ""' 2>/dev/null || true)"
  if [[ -n "$merged_at" ]]; then
    merged=true
  fi
elif git merge-base --is-ancestor "$branch" origin/main; then
  merged=true
fi

if [[ "$merged" != true ]]; then
  echo "Refusing cleanup because '$branch' is not confirmed as merged into main."
  exit 1
fi

worktree_path=""
candidate_path=""
while IFS= read -r line; do
  case "$line" in
    "worktree "*)
      candidate_path="${line#worktree }"
      ;;
    "branch refs/heads/$branch")
      worktree_path="$candidate_path"
      ;;
  esac
done < <(git worktree list --porcelain)

if [[ -n "$worktree_path" ]]; then
  if [[ -n "$(git -C "$worktree_path" status --porcelain)" ]]; then
    echo "Refusing cleanup because the task worktree has uncommitted changes:"
    echo "$worktree_path"
    exit 1
  fi
  git worktree remove "$worktree_path"
fi

git branch -D "$branch"

echo "Removed the merged task worktree and local branch '$branch'."
echo "GitHub may delete the remote branch automatically after merge."
