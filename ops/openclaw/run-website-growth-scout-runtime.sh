#!/bin/zsh

set -euo pipefail

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

runner_directory="${0:A:h}"
runtime_repo_path="${runner_directory:h:h}"
runtime_main_ref="refs/scout-runtime/website-growth-main"
scout_env_file="${WEBSITE_GROWTH_SCOUT_ENV_FILE:-${HOME}/.openclaw/agents/scout/.env}"
source "${runner_directory}/lib/website-growth-scout-runtime.zsh"

if ! load_website_growth_scout_env "${scout_env_file}"; then
  echo "Website Growth Scout environment file is not readable." >&2
  exit 1
fi

runtime_stage="validate dedicated runtime"
runtime_handed_off=0

report_runtime_failure() {
  local exit_status=$?
  trap - EXIT
  if [[ ${exit_status} -ne 0 && ${runtime_handed_off} -eq 0 ]]; then
    send_website_growth_teams_message \
      "Website Growth Scout could not start during ${runtime_stage}. The dedicated runtime did not reach the read-only Scout, and no website work was approved, merged, or published. Review the OpenClaw job log." \
      >/dev/null 2>&1 || true
  fi
  exit ${exit_status}
}
trap report_runtime_failure EXIT

if [[ ! -e "${runtime_repo_path}/.git" ]]; then
  echo "Website Growth Scout runtime is not a Git worktree." >&2
  exit 1
fi
if [[ -n "$(git -C "${runtime_repo_path}" status --porcelain --untracked-files=normal)" ]]; then
  echo "Website Growth Scout runtime contains unexpected local changes." >&2
  exit 1
fi

runtime_stage="update the dedicated runtime from Newl Apps main"
git -C "${runtime_repo_path}" fetch --quiet origin "+main:${runtime_main_ref}"
git -C "${runtime_repo_path}" checkout --quiet --detach "${runtime_main_ref}"

runtime_stage="validate the synchronized Scout files"
/bin/zsh -n "${runtime_repo_path}/ops/openclaw/run-website-growth-scout.sh"
/usr/bin/python3 -m json.tool \
  "${runtime_repo_path}/ops/openclaw/skills/website-growth-scout/scout-output.schema.json" \
  >/dev/null

runtime_handed_off=1
trap - EXIT
exec /bin/zsh "${runtime_repo_path}/ops/openclaw/run-website-growth-scout.sh" "$@"
