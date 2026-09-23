#!/bin/zsh
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
runner_directory="${0:A:h}"
source "${runner_directory}/lib/website-growth-scout-runtime.zsh"
load_website_growth_scout_env "${WEBSITE_GROWTH_SCOUT_ENV_FILE:-${HOME}/.openclaw/agents/scout/.env}"
load_website_growth_scout_env "${OPENCLAW_GATEWAY_ENV_FILE:-${HOME}/.openclaw/.env}"
: "${NEWL_APPS_URL:?NEWL_APPS_URL is required}"
: "${OPENCLAW_WEBSITE_GROWTH_BACKLINK_TOKEN:?Executor token is required}"
exec /usr/bin/python3 "${runner_directory}/scout/authority_executor.py"
