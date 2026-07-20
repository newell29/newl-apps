#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${NEWL_APPS_DIR:-$HOME/newl-apps}"
WORKER_SERVICE="${TEAMSHIP_WORKER_SERVICE_NAME:-newl-teamship-phase2-worker.service}"
BRANCH="${NEWL_APPS_UPDATE_BRANCH:-main}"
REMOTE="${NEWL_APPS_UPDATE_REMOTE:-origin}"
WORKER_STOPPED=0

cd "$APP_DIR"

log() {
  printf '[newl-apps auto-update] %s\n' "$*"
}

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  log "$APP_DIR is not a Git checkout."
  exit 1
fi

current_branch="$(git rev-parse --abbrev-ref HEAD)"

if [[ "$current_branch" != "$BRANCH" ]]; then
  log "Skipping update because checkout is on $current_branch, not $BRANCH."
  exit 0
fi

if [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then
  log "Skipping update because tracked files have local changes."
  git status --short --untracked-files=no
  exit 0
fi

before_sha="$(git rev-parse HEAD)"
log "Fetching $REMOTE/$BRANCH..."
git fetch "$REMOTE" "$BRANCH"
after_sha="$(git rev-parse "$REMOTE/$BRANCH")"

if [[ "$before_sha" == "$after_sha" ]]; then
  log "Already up to date at $before_sha."
  exit 0
fi

if ! git merge-base --is-ancestor "$before_sha" "$after_sha"; then
  log "Skipping update because local $BRANCH cannot fast-forward to $REMOTE/$BRANCH."
  exit 1
fi

package_before="$(git rev-parse HEAD:package-lock.json 2>/dev/null || true)"
log "Stopping $WORKER_SERVICE before update..."
systemctl --user stop "$WORKER_SERVICE" || true
WORKER_STOPPED=1

restart_worker_on_failure() {
  local status=$?

  if [[ "$status" -ne 0 && "$WORKER_STOPPED" -eq 1 ]]; then
    log "Update failed; restarting $WORKER_SERVICE so job polling continues."
    systemctl --user restart "$WORKER_SERVICE" || true
  fi

  exit "$status"
}

trap restart_worker_on_failure EXIT

git merge --ff-only "$REMOTE/$BRANCH"

package_after="$(git rev-parse HEAD:package-lock.json 2>/dev/null || true)"
if [[ "$package_before" != "$package_after" ]]; then
  log "package-lock.json changed; running npm install..."
  npm install
fi

log "Restarting $WORKER_SERVICE at $(git rev-parse --short HEAD)..."
systemctl --user restart "$WORKER_SERVICE"
WORKER_STOPPED=0
