#!/bin/zsh
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
runner_directory="${0:A:h}"
source "${runner_directory}/lib/website-growth-scout-runtime.zsh"
source "${runner_directory}/lib/resolve-codex-cli.zsh"
source "${runner_directory}/lib/require-codex-subscription.zsh"
scout_env_file="${WEBSITE_GROWTH_SCOUT_ENV_FILE:-${HOME}/.openclaw/agents/scout/.env}"
load_website_growth_scout_env "${scout_env_file}"
: "${NEWL_APPS_URL:?NEWL_APPS_URL is required}"
: "${OPENCLAW_WEBSITE_GROWTH_TOKEN:?OPENCLAW_WEBSITE_GROWTH_TOKEN is required}"
resolve_codex_cli
require_codex_chatgpt_subscription
export WEBSITE_GROWTH_CODEX_BIN="${codex_bin}"
exec /usr/bin/python3 "${runner_directory}/scout/worker.py"
