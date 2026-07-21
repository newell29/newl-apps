#!/bin/zsh

set -euo pipefail

script_directory="${0:A:h}"
repo_path="${script_directory:h:h}"
template_path="${script_directory}/launchd/com.newl.teamship-browser-read-worker.plist.template"
runner_path="${script_directory}/run-teamship-browser-read-worker.sh"
worker_env_file="${TEAMSHIP_WORKER_ENV_FILE:-${HOME}/.openclaw/.env}"
launch_agents_directory="${HOME}/Library/LaunchAgents"
log_directory="${HOME}/Library/Logs/newl-apps"
service_label="com.newl.teamship-browser-read-worker"
target_path="${launch_agents_directory}/${service_label}.plist"
launch_domain="gui/$(id -u)"
base_url=""
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
    *)
      echo "Unknown option: $1" >&2
      exit 1
      ;;
  esac
done

if [[ ! -r "${worker_env_file}" ]]; then
  echo "Teamship browser worker environment file is not readable." >&2
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
fi

for required_name in NEWL_APPS_BASE_URL TEAMSHIP_BROWSER_WORKER_TOKEN TEAMSHIP_BROWSER_WORKER_ID TEAMSHIP_BROWSER_EXECUTABLE_PATH; do
  if ! grep -Eq "^${required_name}=.+" "${worker_env_file}"; then
    echo "${required_name} is not configured in the worker environment file." >&2
    exit 1
  fi
done

mkdir -p "${launch_agents_directory}" "${log_directory}"
chmod +x "${runner_path}"

escape_replacement() {
  print -r -- "$1" | sed 's/[&|]/\\&/g'
}

temporary_plist="$(mktemp)"
sed \
  -e "s|__RUNNER_PATH__|$(escape_replacement "${runner_path}")|g" \
  -e "s|__ENV_FILE__|$(escape_replacement "${worker_env_file}")|g" \
  -e "s|__REPO_PATH__|$(escape_replacement "${repo_path}")|g" \
  -e "s|__LOG_DIRECTORY__|$(escape_replacement "${log_directory}")|g" \
  "${template_path}" > "${temporary_plist}"
plutil -lint "${temporary_plist}" >/dev/null
install -m 600 "${temporary_plist}" "${target_path}"

launchctl bootout "${launch_domain}/${service_label}" >/dev/null 2>&1 || true
launchctl bootstrap "${launch_domain}" "${target_path}"
launchctl kickstart -k "${launch_domain}/${service_label}"

echo "Installed and started ${service_label}."
