#!/bin/zsh

set -euo pipefail

script_directory="${0:A:h}"
source_repo_path="${script_directory:h:h}"
runtime_repo_path="${HUNTER_RUNTIME_REPO_PATH:-${HOME}/Developer/newl-apps-hunter-runtime}"
runtime_main_ref="refs/hunter-runtime/newl-apps-main"
worker_env_file="${HUNTER_WORKER_ENV_FILE:-${HOME}/.openclaw/agents/hunter/.env}"
launch_agents_directory="${HOME}/Library/LaunchAgents"
log_directory="${HOME}/Library/Logs/newl-apps"
service_label="com.newl.hunter-worker"
target_path="${launch_agents_directory}/${service_label}.plist"
launch_domain="gui/$(id -u)"
base_url=""
teams_target=""
temporary_env_file=""
temporary_plist=""

cleanup() {
  [[ -n "${temporary_env_file}" ]] && rm -f "${temporary_env_file}"
  [[ -n "${temporary_plist}" ]] && rm -f "${temporary_plist}"
}
trap cleanup EXIT

while (( $# > 0 )); do
  case "$1" in
    --base-url)
      if (( $# < 2 )); then
        echo "--base-url requires an HTTPS URL." >&2
        exit 1
      fi
      base_url="$2"
      shift 2
      ;;
    --teams-target)
      if (( $# < 2 )) || [[ -z "$2" ]]; then
        echo "--teams-target requires an OpenClaw Microsoft Teams target." >&2
        exit 1
      fi
      teams_target="$2"
      shift 2
      ;;
    *)
      echo "Unknown option: $1" >&2
      exit 1
      ;;
  esac
done

if [[ ! -r "${worker_env_file}" ]]; then
  echo "Hunter worker environment file is not readable." >&2
  exit 1
fi
env_permissions="$(stat -f "%Lp" "${worker_env_file}")"
if [[ "${env_permissions}" != "600" ]]; then
  echo "The Hunter environment file must have permissions 600." >&2
  exit 1
fi
if [[ -n "${base_url}" && "${base_url}" != https://* ]]; then
  echo "--base-url must use HTTPS." >&2
  exit 1
fi

if [[ -n "${base_url}" ]]; then
  temporary_env_file="$(mktemp)"
  awk -v replacement="NEWL_APPS_BASE_URL=${base_url}" '
    BEGIN { replaced = 0 }
    /^NEWL_APPS_BASE_URL=/ { print replacement; replaced = 1; next }
    { print }
    END { if (!replaced) print replacement }
  ' "${worker_env_file}" > "${temporary_env_file}"
  install -m 600 "${temporary_env_file}" "${worker_env_file}"
  rm -f "${temporary_env_file}"
  temporary_env_file=""
fi

if [[ -n "${teams_target}" ]]; then
  temporary_env_file="$(mktemp)"
  awk -v replacement="HUNTER_TEAMS_TARGET=${teams_target}" '
    BEGIN { replaced = 0 }
    /^HUNTER_TEAMS_TARGET=/ { print replacement; replaced = 1; next }
    { print }
    END { if (!replaced) print replacement }
  ' "${worker_env_file}" > "${temporary_env_file}"
  install -m 600 "${temporary_env_file}" "${worker_env_file}"
  rm -f "${temporary_env_file}"
  temporary_env_file=""
fi

for required_name in NEWL_APPS_BASE_URL INGESTION_API_TOKEN TRADEMINING_USER TRADEMINING_PASSWORD HUNTER_WORKER_ID HUNTER_EXPORT_DIRECTORY HUNTER_PROCESSED_DIRECTORY HUNTER_TRADEMINING_PORTS_JSON; do
  if ! grep -Eq "^${required_name}=.+" "${worker_env_file}"; then
    echo "${required_name} is not configured in the Hunter environment file." >&2
    exit 1
  fi
done

if [[ "${runtime_repo_path}" == "${source_repo_path}" ]]; then
  echo "Hunter's runtime path must be separate from the development checkout." >&2
  exit 1
fi
if [[ -e "${runtime_repo_path}" && ! -e "${runtime_repo_path}/.git" ]]; then
  echo "HUNTER_RUNTIME_REPO_PATH exists but is not a Git worktree." >&2
  exit 1
fi
if [[ ! -e "${runtime_repo_path}/.git" ]]; then
  git -C "${source_repo_path}" fetch origin "+main:${runtime_main_ref}"
  git -C "${source_repo_path}" worktree add --detach "${runtime_repo_path}" "${runtime_main_ref}"
fi
if [[ -n "$(git -C "${runtime_repo_path}" status --porcelain --untracked-files=normal)" ]]; then
  echo "The dedicated Hunter runtime contains unexpected local changes." >&2
  exit 1
fi

git -C "${runtime_repo_path}" fetch origin "+main:${runtime_main_ref}"
launchctl bootout "${launch_domain}/${service_label}" >/dev/null 2>&1 || true
git -C "${runtime_repo_path}" checkout --detach "${runtime_main_ref}"

template_path="${runtime_repo_path}/ops/openclaw/launchd/com.newl.hunter-worker.plist.template"
runner_path="${runtime_repo_path}/ops/openclaw/run-hunter-worker.sh"
mkdir -p "${launch_agents_directory}" "${log_directory}"
chmod 700 "${runner_path}"

escape_replacement() {
  print -r -- "$1" | sed 's/[&|]/\\&/g'
}

temporary_plist="$(mktemp)"
sed \
  -e "s|__RUNNER_PATH__|$(escape_replacement "${runner_path}")|g" \
  -e "s|__ENV_FILE__|$(escape_replacement "${worker_env_file}")|g" \
  -e "s|__REPO_PATH__|$(escape_replacement "${runtime_repo_path}")|g" \
  -e "s|__LOG_DIRECTORY__|$(escape_replacement "${log_directory}")|g" \
  "${template_path}" > "${temporary_plist}"
plutil -lint "${temporary_plist}" >/dev/null
install -m 600 "${temporary_plist}" "${target_path}"

launchctl bootstrap "${launch_domain}" "${target_path}"
launchctl kickstart -k "${launch_domain}/${service_label}"

echo "Installed and started ${service_label}."
echo "Dedicated runtime: ${runtime_repo_path}"
echo "Runtime revision: $(git -C "${runtime_repo_path}" rev-parse --short=12 HEAD)"
