#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${NEWL_APPS_DIR:-$HOME/newl-apps}"
BRANCH="${NEWL_APPS_UPDATE_BRANCH:-main}"
REMOTE="${NEWL_APPS_UPDATE_REMOTE:-origin}"
DEFAULT_WORKER_SERVICES="newl-teamship-phase2-worker.service newl-tmg-order-intake-worker.service"
WORKER_SERVICES_VALUE="${TEAMSHIP_WORKER_SERVICE_NAMES:-$DEFAULT_WORKER_SERVICES}"
if [[ -n "${TEAMSHIP_WORKER_SERVICE_NAME:-}" && -z "${TEAMSHIP_WORKER_SERVICE_NAMES:-}" ]]; then
  WORKER_SERVICES_VALUE="$TEAMSHIP_WORKER_SERVICE_NAME"
fi
read -r -a WORKER_SERVICES <<< "$WORKER_SERVICES_VALUE"
STOPPED_WORKER_SERVICES=()

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

for worker_service in "${WORKER_SERVICES[@]}"; do
  if systemctl --user is-active --quiet "$worker_service"; then
    log "Stopping active worker $worker_service before update..."
    systemctl --user stop "$worker_service"
    STOPPED_WORKER_SERVICES+=("$worker_service")
  else
    log "Leaving inactive worker $worker_service stopped."
  fi
done

restart_stopped_workers() {
  local worker_service

  for worker_service in "${STOPPED_WORKER_SERVICES[@]}"; do
    log "Restarting $worker_service..."
    systemctl --user restart "$worker_service"
  done
}

restart_workers_on_failure() {
  local status=$?

  if [[ "$status" -ne 0 && "${#STOPPED_WORKER_SERVICES[@]}" -gt 0 ]]; then
    log "Update failed; restarting workers that were active before the update."
    restart_stopped_workers || true
  fi

  exit "$status"
}

trap restart_workers_on_failure EXIT

git merge --ff-only "$REMOTE/$BRANCH"

package_after="$(git rev-parse HEAD:package-lock.json 2>/dev/null || true)"
if [[ "$package_before" != "$package_after" ]]; then
  log "package-lock.json changed; running npm install..."
  npm install
fi

log "Restarting workers that were active at $(git rev-parse --short HEAD)..."
restart_stopped_workers
STOPPED_WORKER_SERVICES=()
