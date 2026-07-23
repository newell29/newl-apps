#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "Usage: npm run codex:task:start -- <task-slug>"
  echo "Example: npm run codex:task:start -- website-growth-cleanup"
}

slug="${1:-}"
if [[ -z "$slug" ]]; then
  usage
  exit 1
fi

if [[ ! "$slug" =~ ^[a-z0-9][a-z0-9-]*$ ]]; then
  echo "Task slug must contain only lowercase letters, numbers, and hyphens."
  exit 1
fi

repo_root="$(git rev-parse --show-toplevel 2>/dev/null)" || {
  echo "Run this command from inside the Newl Apps repository."
  exit 1
}

cd "$repo_root"

remote_url="$(git remote get-url origin)"
if [[ "$remote_url" == https://github.com/* ]]; then
  if ! command -v gh >/dev/null 2>&1 || ! gh auth status --hostname github.com >/dev/null 2>&1; then
    echo "The persistent GitHub login is missing or invalid."
    echo "Run: npm run codex:github-auth"
    exit 1
  fi
fi

branch="codex/$slug"
worktree_root="${CODEX_WORKTREE_ROOT:-$repo_root/work/codex}"
worktree_path="$worktree_root/$slug"

if git show-ref --verify --quiet "refs/heads/$branch"; then
  echo "Branch '$branch' already exists."
  git worktree list
  echo "Use the existing task worktree or choose a different task slug."
  exit 1
fi

if git show-ref --verify --quiet "refs/remotes/origin/$branch"; then
  echo "Remote branch 'origin/$branch' already exists."
  echo "Resume that task instead of creating a second branch with the same name."
  exit 1
fi

if [[ -e "$worktree_path" ]]; then
  echo "Worktree path already exists: $worktree_path"
  exit 1
fi

echo "Fetching the current GitHub main branch..."
GIT_TERMINAL_PROMPT=0 git fetch origin \
  "+refs/heads/main:refs/remotes/origin/main"

mkdir -p "$worktree_root"
git worktree add -b "$branch" "$worktree_path" origin/main

if [[ -d "$repo_root/node_modules" && ! -e "$worktree_path/node_modules" ]]; then
  ln -s "$repo_root/node_modules" "$worktree_path/node_modules"
fi

echo
echo "Task workspace ready:"
echo "  Branch:   $branch"
echo "  Worktree: $worktree_path"
echo
echo "Open the task in: $worktree_path"
