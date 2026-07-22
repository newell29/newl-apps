#!/bin/zsh

set -euo pipefail

script_directory="${0:A:h}"
repo_path="${script_directory:h:h}"
template_path="${script_directory}/launchd/com.newl.teamship-print-worker.plist.template"
runner_path="${script_directory}/run-teamship-print-worker.sh"
worker_env_file="${TEAMSHIP_PRINT_ENV_FILE:-${HOME}/.openclaw/.env}"
launch_agents_directory="${HOME}/Library/LaunchAgents"
log_directory="${HOME}/Library/Logs/newl-apps"
service_label="com.newl.teamship-print-worker"
target_path="${launch_agents_directory}/${service_label}.plist"
launch_domain="gui/$(id -u)"
temporary_plist=""

cleanup() {
  [[ -n "${temporary_plist}" ]] && rm -f "${temporary_plist}"
}
trap cleanup EXIT

if [[ ! -r "${worker_env_file}" ]]; then
  echo "Teamship print worker environment file is not readable." >&2
  exit 1
fi

for required_name in NEWL_APPS_BASE_URL TEAMSHIP_PRINT_WORKER_TOKEN TEAMSHIP_PRINT_WORKER_TENANT_SLUG TEAMSHIP_PRINT_WORKER_ID TEAMSHIP_BROWSER_EXECUTABLE_PATH; do
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
