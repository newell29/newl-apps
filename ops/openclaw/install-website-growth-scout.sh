#!/bin/zsh

set -euo pipefail

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

script_directory="${0:A:h}"
source_repo_path="${script_directory:h:h}"
runtime_repo_path="${NEWL_APPS_SCOUT_RUNTIME_REPO_PATH:-${HOME}/Developer/newl-apps-scout-runtime}"
runtime_main_ref="refs/scout-runtime/website-growth-main"
scout_env_file="${WEBSITE_GROWTH_SCOUT_ENV_FILE:-${HOME}/.openclaw/agents/scout/.env}"
hunter_env_file="${HUNTER_ENV_FILE:-${HOME}/.openclaw/agents/hunter/.env}"
source "${script_directory}/lib/resolve-codex-cli.zsh"
source "${script_directory}/lib/require-codex-subscription.zsh"
resolve_codex_cli
"${codex_bin}" --version >/dev/null
require_codex_chatgpt_subscription

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
if ! grep -Eq "^HUNTER_BRAVE_SEARCH_API_KEY=.+" "${scout_env_file}" && {
  [[ ! -r "${hunter_env_file}" ]] ||
  ! grep -Eq "^HUNTER_BRAVE_SEARCH_API_KEY=.+" "${hunter_env_file}"
}; then
  echo "HUNTER_BRAVE_SEARCH_API_KEY is not configured in the protected Scout or Hunter environment file." >&2
  exit 1
fi
if [[ -e "${runtime_repo_path}" && ! -e "${runtime_repo_path}/.git" ]]; then
  echo "NEWL_APPS_SCOUT_RUNTIME_REPO_PATH exists but is not a Git worktree." >&2
  exit 1
fi
if [[ ! -e "${runtime_repo_path}/.git" ]]; then
  git -C "${source_repo_path}" fetch origin "+main:${runtime_main_ref}"
  git -C "${source_repo_path}" worktree add --detach "${runtime_repo_path}" "${runtime_main_ref}"
fi
if [[ -n "$(git -C "${runtime_repo_path}" status --porcelain --untracked-files=normal)" ]]; then
  echo "The dedicated Website Growth Scout runtime contains unexpected local changes." >&2
  exit 1
fi

git -C "${runtime_repo_path}" fetch origin "+main:${runtime_main_ref}"
git -C "${runtime_repo_path}" checkout --detach "${runtime_main_ref}"

runtime_runner_path="${runtime_repo_path}/ops/openclaw/run-website-growth-scout-runtime.sh"
build_notification_runner_path="${runtime_repo_path}/ops/openclaw/run-website-growth-build-notifications.sh"

openclaw cron add \
  --name "NEWL Website Growth Scout" \
  --display-name "NEWL Website Growth Scout" \
  --description "Every Monday and Wednesday, run the read-only Codex content review from first-party and retained SEMrush evidence; send the approval/report package to Teams. Backlink failures cannot block this job." \
  --declaration-key "newl.website-growth.scout.weekly.v1" \
  --cron "15 9 * * 1,3" \
  --tz "America/Toronto" \
  --exact \
  --command-argv "[\"/bin/zsh\",\"${runtime_runner_path}\"]" \
  --command-cwd "${runtime_repo_path}" \
  --command-env "WEBSITE_GROWTH_SCOUT_ENV_FILE=${scout_env_file}" \
  --timeout-seconds 1800 \
  --no-output-timeout-seconds 900 \
  --output-max-bytes 100000 \
  --no-deliver

openclaw cron add \
  --name "NEWL Website Growth backlink discovery" \
  --display-name "NEWL Website Growth backlink discovery" \
  --description "Every Tuesday, run bounded Brave discovery and ChatGPT-subscription Codex triage independently from website content research; send a Teams outcome even when no prospect qualifies." \
  --declaration-key "newl.website-growth.backlink-discovery.weekly.v1" \
  --cron "15 10 * * 2" \
  --tz "America/Toronto" \
  --exact \
  --command-argv "[\"/bin/zsh\",\"${runtime_runner_path}\",\"--backlinks\"]" \
  --command-cwd "${runtime_repo_path}" \
  --command-env "WEBSITE_GROWTH_SCOUT_ENV_FILE=${scout_env_file}" \
  --timeout-seconds 1800 \
  --no-output-timeout-seconds 900 \
  --output-max-bytes 100000 \
  --no-deliver

openclaw cron add \
  --name "NEWL Website Growth Scout check-in" \
  --display-name "NEWL Website Growth Scout check-in" \
  --description "Tuesday, Thursday, and Friday, refresh Search Console, GA4, forms, and queue state; reuse the stored SEMrush cache; send a Teams check-in without Codex or SEMrush API calls." \
  --declaration-key "newl.website-growth.scout.weekday-checkin.v1" \
  --cron "15 9 * * 2,4-5" \
  --tz "America/Toronto" \
  --exact \
  --command-argv "[\"/bin/zsh\",\"${runtime_runner_path}\",\"--light\"]" \
  --command-cwd "${runtime_repo_path}" \
  --command-env "WEBSITE_GROWTH_SCOUT_ENV_FILE=${scout_env_file}" \
  --timeout-seconds 600 \
  --no-output-timeout-seconds 300 \
  --output-max-bytes 100000 \
  --no-deliver

openclaw cron add \
  --name "NEWL Website Growth build notifications" \
  --display-name "NEWL Website Growth build notifications" \
  --description "Deliver deterministic Teams updates when an approved Website Growth build starts, reaches Preview, or fails." \
  --declaration-key "newl.website-growth.build-notifications.v1" \
  --every "2m" \
  --command-argv "[\"/bin/zsh\",\"${build_notification_runner_path}\"]" \
  --command-cwd "${runtime_repo_path}" \
  --command-env "WEBSITE_GROWTH_SCOUT_ENV_FILE=${scout_env_file}" \
  --timeout-seconds 90 \
  --no-deliver

echo "Installed content-only Website Growth Scout runs for Monday and Wednesday at 9:15 AM, an independent bounded backlink discovery run for Tuesday at 10:15 AM, and cache-backed check-ins for Tuesday, Thursday, and Friday at 9:15 AM America/Toronto."
echo "Installed the deterministic Website Growth build notifier every two minutes."
echo "Dedicated runtime: ${runtime_repo_path}"
