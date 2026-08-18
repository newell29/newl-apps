#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${NEWL_APPS_DIR:-$HOME/newl-apps}"
SYSTEMD_USER_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
ENV_FILE="$APP_DIR/.env.teamship-phase2-worker"
TMG_ENV_FILE="$APP_DIR/.env.tmg-order-intake-worker"

cd "$APP_DIR"

mkdir -p "$SYSTEMD_USER_DIR"
cp ops/teamship-phase2-vm/newl-teamship-phase2-worker.service "$SYSTEMD_USER_DIR/"
cp ops/teamship-phase2-vm/newl-tmg-order-intake-worker.service "$SYSTEMD_USER_DIR/"
cp ops/teamship-phase2-vm/newl-apps-auto-update.service "$SYSTEMD_USER_DIR/"
cp ops/teamship-phase2-vm/newl-apps-auto-update.timer "$SYSTEMD_USER_DIR/"

if [[ ! -f "$ENV_FILE" ]]; then
  cp ops/teamship-phase2-vm/teamship-phase2-worker.env.example "$ENV_FILE"
  if [[ -n "${DISPLAY:-}" ]]; then
    sed -i "s|# DISPLAY=:1|DISPLAY=${DISPLAY}|" "$ENV_FILE"
  fi
  if [[ -n "${XAUTHORITY:-}" ]]; then
    printf 'XAUTHORITY=%s\n' "$XAUTHORITY" >> "$ENV_FILE"
  fi
  chmod 600 "$ENV_FILE"
  cat <<MSG
Created $ENV_FILE.
Edit it now and set NEWL_AGENT_TOKEN before starting the worker.
MSG
else
  chmod 600 "$ENV_FILE"
fi

if [[ ! -f "$TMG_ENV_FILE" ]]; then
  cp ops/teamship-phase2-vm/tmg-order-intake-worker.env.example "$TMG_ENV_FILE"
  if [[ -n "${DISPLAY:-}" ]]; then
    sed -i "s|# DISPLAY=:1|DISPLAY=${DISPLAY}|" "$TMG_ENV_FILE"
  fi
  if [[ -n "${XAUTHORITY:-}" ]]; then
    printf 'XAUTHORITY=%s\n' "$XAUTHORITY" >> "$TMG_ENV_FILE"
  fi
  chmod 600 "$TMG_ENV_FILE"
  cat <<MSG
Created $TMG_ENV_FILE.
Keep TMG_ALLOW_LIVE_WRITES=false until the separately approved live activation.
MSG
else
  chmod 600 "$TMG_ENV_FILE"
fi

chmod +x scripts/teamship-phase2-vm-update.sh

systemctl --user daemon-reload
systemctl --user enable newl-apps-auto-update.timer
systemctl --user enable newl-teamship-phase2-worker.service

cat <<MSG
Installed Teamship Phase 2 VM services.

The isolated TMG service is installed but remains disabled and stopped.

Next:
1. Edit $ENV_FILE and set NEWL_AGENT_TOKEN plus any rollout allowlist.
2. Keep the existing Garland units running:
   systemctl --user start newl-teamship-phase2-worker.service
   systemctl --user start newl-apps-auto-update.timer
3. Prepare $TMG_ENV_FILE, but do not enable TMG until live activation is approved.
4. During the separately approved TMG activation, set the real ingestion token,
   set TMG_ALLOW_LIVE_WRITES=true, then run:
   systemctl --user enable --now newl-tmg-order-intake-worker.service
5. Optional, after sudo access is available, keep services alive after logout:
   sudo loginctl enable-linger "$USER"

Useful checks:
  systemctl --user status newl-teamship-phase2-worker.service
  systemctl --user status newl-tmg-order-intake-worker.service
  systemctl --user list-timers newl-apps-auto-update.timer
  journalctl --user -u newl-teamship-phase2-worker.service -f
  journalctl --user -u newl-tmg-order-intake-worker.service -f
MSG
