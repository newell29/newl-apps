#!/usr/bin/env bash
set -euo pipefail

if ! command -v gh >/dev/null 2>&1; then
  echo "GitHub CLI is required. Install it with: brew install gh"
  exit 1
fi

if ! gh auth status --hostname github.com >/dev/null 2>&1; then
  echo "Starting the one-time GitHub browser login."
  gh auth login --hostname github.com --git-protocol https --web
fi

gh auth setup-git --hostname github.com

account="$(gh api user --jq .login)"
echo "GitHub authentication is stored for account '$account'."
echo "Future Codex task worktrees will reuse this login."
