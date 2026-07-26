#!/bin/zsh

set -euo pipefail

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

script_directory="${0:A:h}"
source_repo_path="${script_directory:h:h}"
runtime_repo_path="${RIVET_RUNTIME_REPO_PATH:-${HOME}/Developer/newl-apps-rivet-runtime}"
runtime_main_ref="refs/rivet-runtime/newl-apps-main"
rivet_env_file="${RIVET_DEVELOPMENT_ENV_FILE:-${HOME}/.openclaw/agents/rivet/.env}"
source "${script_directory}/lib/resolve-codex-cli.zsh"
resolve_codex_cli

if [[ ! -r "${rivet_env_file}" ]]; then
  echo "Create the protected Rivet environment file before installation." >&2
  exit 1
fi
for required_name in \
  NEWL_APPS_URL \
  OPENCLAW_ASSISTANT_TOKEN \
  NEWL_TEAMS_TENANT_ID \
  RIVET_DEVELOPER_OBJECT_ID \
  RIVET_GITHUB_TOKEN \
  RIVET_NEWL_APPS_REPO_PATH \
  RIVET_TEAMS_TARGET; do
  if ! grep -Eq "^${required_name}=.+" "${rivet_env_file}"; then
    echo "${required_name} is not configured in the Rivet environment file." >&2
    exit 1
  fi
done

env_permissions="$(stat -f "%Lp" "${rivet_env_file}")"
if [[ "${env_permissions}" != "600" ]]; then
  echo "The Rivet environment file must have permissions 600." >&2
  exit 1
fi

if [[ -e "${runtime_repo_path}" && ! -e "${runtime_repo_path}/.git" ]]; then
  echo "RIVET_RUNTIME_REPO_PATH exists but is not a Git worktree." >&2
  exit 1
fi
if [[ ! -e "${runtime_repo_path}/.git" ]]; then
  git -C "${source_repo_path}" fetch origin "+main:${runtime_main_ref}"
  git -C "${source_repo_path}" worktree add --detach "${runtime_repo_path}" "${runtime_main_ref}"
fi
if [[ -n "$(git -C "${runtime_repo_path}" status --porcelain --untracked-files=normal)" ]]; then
  echo "The dedicated Rivet runtime contains unexpected local changes." >&2
  exit 1
fi

git -C "${runtime_repo_path}" fetch origin "+main:${runtime_main_ref}"
git -C "${runtime_repo_path}" checkout --detach "${runtime_main_ref}"

runtime_runner_path="${runtime_repo_path}/ops/openclaw/run-rivet-development-job.sh"
quality_runner_path="${runtime_repo_path}/ops/openclaw/run-rivet-hunter-quality-audit.sh"
chmod 700 \
  "${runtime_runner_path}" \
  "${quality_runner_path}" \
  "${runtime_repo_path}/ops/openclaw/install-rivet-development-worker.sh"

openclaw cron add \
  --name "NEWL Rivet Developer" \
  --display-name "NEWL Rivet Developer" \
  --description "Claim one explicitly approved, deduplicated Newl development suggestion; run the local authenticated Codex CLI in an isolated branch; open a draft PR; report the result to Alex in Teams. Never merge, deploy, write Teamship, print, or communicate with customers." \
  --declaration-key "newl.rivet.developer.approved.v1" \
  --cron "* * * * *" \
  --tz "America/Toronto" \
  --exact \
  --command-argv "[\"/bin/zsh\",\"${runtime_runner_path}\"]" \
  --command-cwd "${runtime_repo_path}" \
  --command-env "RIVET_DEVELOPMENT_ENV_FILE=${rivet_env_file}" \
  --timeout-seconds 3600 \
  --no-output-timeout-seconds 1200 \
  --output-max-bytes 200000 \
  --no-deliver

openclaw cron add \
  --name "NEWL Hunter Quality Auditor" \
  --display-name "NEWL Hunter Quality Auditor" \
  --description "Audit a five-company stratified Hunter sample with read-only Codex web research; verify every enabled TradeMining profile completed; queue restricted Rivet draft-PR work only for reproducible code defects; report the result to Alex in Teams. Never reclassify, retry a search or outreach, merge, deploy, or communicate with customers." \
  --declaration-key "newl.hunter.quality-auditor.daily.v1" \
  --cron "30 11 * * *" \
  --tz "America/Toronto" \
  --exact \
  --command-argv "[\"/bin/zsh\",\"${quality_runner_path}\"]" \
  --command-cwd "${runtime_repo_path}" \
  --command-env "RIVET_DEVELOPMENT_ENV_FILE=${rivet_env_file}" \
  --timeout-seconds 1800 \
  --no-output-timeout-seconds 900 \
  --output-max-bytes 200000 \
  --no-deliver

echo "Installed the restricted Rivet developer worker to check for approved jobs every minute."
echo "Installed the Hunter quality auditor for 11:30 America/Toronto each day."
echo "Dedicated runtime: ${runtime_repo_path}"
