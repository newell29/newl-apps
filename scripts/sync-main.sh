#!/usr/bin/env bash
set -euo pipefail

current_branch="$(git branch --show-current)"

if [[ "$current_branch" != "main" ]]; then
  echo "Refusing to sync main while on branch '$current_branch'."
  echo "Switch to main first: git switch main"
  exit 1
fi

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "Refusing to sync main because the working tree has uncommitted changes."
  echo "Commit, stash, or move those changes before updating main."
  exit 1
fi

git fetch origin main
git merge --ff-only origin/main

echo "Main is up to date."
