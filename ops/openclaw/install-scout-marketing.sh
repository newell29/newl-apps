#!/bin/zsh
set -euo pipefail
runner_directory="${0:A:h}"
runtime_repo_path="${NEWL_APPS_SCOUT_RUNTIME_REPO_PATH:-${HOME}/Developer/newl-apps-scout-runtime}"
runner_path="${runtime_repo_path}/ops/openclaw/run-scout-marketing.sh"
if [[ ! -r "${runner_path}" ]]; then
  echo "Update the reviewed Scout runtime checkout before installing the marketing wake."
  exit 1
fi
openclaw cron add \
  --name "NEWL Scout Marketing" \
  --display-name "NEWL Scout Marketing" \
  --description "Resume one owner-scoped marketing research item. Newl Apps enforces the rolling budget, saved state, and review boundaries." \
  --declaration-key "newl.website-growth.marketing.v1" \
  --cron "0 9-16 * * 1-5" \
  --tz "America/Toronto" \
  --command-argv "[\"/bin/zsh\",\"${runner_path}\"]" \
  --command-cwd "${runtime_repo_path}" \
  --timeout-seconds 2400 \
  --disabled
echo "Marketing wake installed disabled. Review the mission and preview before enabling it."
