#!/usr/bin/env bash
set -euo pipefail

create_pr=true
run_checks=true
title=""
body_file=""

usage() {
  echo "Usage: npm run codex:task:publish -- [options]"
  echo
  echo "Options:"
  echo "  --title <title>       Pull request title"
  echo "  --body-file <path>    Pull request body file"
  echo "  --no-pr               Push only; do not create a pull request"
  echo "  --skip-checks         Skip the standard lint and production build"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --title)
      title="${2:-}"
      shift 2
      ;;
    --body-file)
      body_file="${2:-}"
      shift 2
      ;;
    --no-pr)
      create_pr=false
      shift
      ;;
    --skip-checks)
      run_checks=false
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1"
      usage
      exit 1
      ;;
  esac
done

repo_root="$(git rev-parse --show-toplevel 2>/dev/null)" || {
  echo "Run this command from inside a Codex task worktree."
  exit 1
}
cd "$repo_root"

branch="$(git branch --show-current)"
if [[ "$branch" != codex/* ]]; then
  echo "Refusing to publish branch '$branch'. Codex task branches must start with 'codex/'."
  exit 1
fi

if [[ -n "$(git status --porcelain)" ]]; then
  echo "Refusing to publish because the worktree has uncommitted changes."
  echo "Review and commit the intended changes first."
  exit 1
fi

remote_url="$(git remote get-url origin)"
if [[ "$remote_url" == https://github.com/* ]]; then
  if ! command -v gh >/dev/null 2>&1 || ! gh auth status --hostname github.com >/dev/null 2>&1; then
    echo "The persistent GitHub login is missing or invalid."
    echo "Run: npm run codex:github-auth"
    exit 1
  fi
fi

if [[ "$create_pr" == true ]] && ! command -v gh >/dev/null 2>&1; then
  echo "GitHub CLI is required to create the draft pull request."
  exit 1
fi

echo "Fetching the current GitHub main branch..."
GIT_TERMINAL_PROMPT=0 git fetch origin \
  "+refs/heads/main:refs/remotes/origin/main"

if ! git merge-base --is-ancestor origin/main HEAD; then
  echo "Bringing current main into '$branch' before publication..."
  if ! git merge --no-edit origin/main; then
    echo
    echo "Main overlaps this task. Resolve the listed files, commit the merge, and run publish again."
    git status --short
    exit 1
  fi
fi

if [[ "$run_checks" == true ]]; then
  npm run lint
  npm run build
fi

GIT_TERMINAL_PROMPT=0 git push --set-upstream origin "$branch"

if [[ "$create_pr" == false ]]; then
  echo "Branch published without creating a pull request."
  exit 0
fi

existing_url="$(gh pr view "$branch" --json url --jq .url 2>/dev/null || true)"
if [[ -n "$existing_url" ]]; then
  echo "Draft pull request already exists: $existing_url"
  exit 0
fi

if [[ -z "$title" ]]; then
  title="$(git log --reverse --format=%s origin/main..HEAD | sed -n '1p')"
fi
if [[ -z "$title" ]]; then
  title="Codex task: ${branch#codex/}"
fi

temporary_body=""
if [[ -z "$body_file" ]]; then
  temporary_body="$(mktemp)"
  body_file="$temporary_body"
  {
    echo "## Summary"
    echo
    echo "Automated Codex task from the isolated worktree \`$branch\`."
    echo
    echo "## Validation"
    echo
    if [[ "$run_checks" == true ]]; then
      echo "- \`npm run lint\`"
      echo "- \`npm run build\`"
    else
      echo "- Standard checks were skipped; see the task report for focused validation."
    fi
    echo
    echo "## Safety"
    echo
    echo "This draft requires human review and does not merge or deploy production automatically."
  } > "$body_file"
fi

cleanup() {
  if [[ -n "$temporary_body" ]]; then
    rm -f "$temporary_body"
  fi
}
trap cleanup EXIT

pr_url="$(
  gh pr create \
    --draft \
    --base main \
    --head "$branch" \
    --title "$title" \
    --body-file "$body_file"
)"

echo "Draft pull request created: $pr_url"
