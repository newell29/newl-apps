#!/bin/zsh
set -euo pipefail
runner_directory="${0:A:h}"
source "${runner_directory}/lib/website-growth-scout-runtime.zsh"
if [[ "${1:-}" == "--apply" ]]; then
  git -C "${runner_directory}" merge-base --is-ancestor HEAD origin/main || { echo "Use an owner-merged runtime commit."; exit 1; }
  load_website_growth_scout_env "${WEBSITE_GROWTH_SCOUT_ENV_FILE:-${HOME}/.openclaw/agents/scout/.env}"
  load_website_growth_scout_env "${OPENCLAW_GATEWAY_ENV_FILE:-${HOME}/.openclaw/.env}"
fi
exec /usr/bin/python3 "${runner_directory}/scout/authority_cutover.py" "$@"
