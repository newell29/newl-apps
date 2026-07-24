#!/bin/zsh

set -euo pipefail

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

script_directory="${0:A:h}"
repo_path="${script_directory:h:h}"
runner_path="${script_directory}/run-website-growth-scout.sh"
scout_env_file="${WEBSITE_GROWTH_SCOUT_ENV_FILE:-${HOME}/.openclaw/agents/scout/.env}"
source "${script_directory}/lib/resolve-codex-cli.zsh"
resolve_codex_cli

if [[ ! -r "${scout_env_file}" ]]; then
  echo "Create the protected Scout environment file before installation." >&2
  exit 1
fi
for required_name in NEWL_APPS_URL OPENCLAW_WEBSITE_GROWTH_TOKEN NEWL_WEBSITE_REPO_PATH WEBSITE_GROWTH_TEAMS_TARGET; do
  if ! grep -Eq "^${required_name}=.+" "${scout_env_file}"; then
    echo "${required_name} is not configured in the Scout environment file." >&2
    exit 1
  fi
done
if ! "${codex_bin}" mcp get semrush >/dev/null 2>&1; then
  echo "Configure the official SEMrush MCP OAuth connection before installing the weekly job." >&2
  exit 1
fi

chmod 700 "${runner_path}"

openclaw cron add \
  --name "NEWL Website Growth Scout" \
  --display-name "NEWL Website Growth Scout" \
  --description "Refresh Search Console, GA4, first-party form evidence, Position Tracking, and backlink opportunities; run read-only Codex Scout with official SEMrush MCP; send the curated approval slate to Teams." \
  --declaration-key "newl.website-growth.scout.weekly.v1" \
  --cron "15 9 * * 1" \
  --tz "America/Toronto" \
  --exact \
  --command-argv "[\"/bin/zsh\",\"${runner_path}\"]" \
  --command-cwd "${repo_path}" \
  --command-env "WEBSITE_GROWTH_SCOUT_ENV_FILE=${scout_env_file}" \
  --timeout-seconds 1800 \
  --no-output-timeout-seconds 900 \
  --output-max-bytes 100000 \
  --no-deliver

echo "Installed the Website Growth Scout for Mondays at 9:15 AM America/Toronto."
