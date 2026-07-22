#!/bin/zsh

set -euo pipefail

export PATH="/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"

worker_env_file="${TEAMSHIP_PRINT_ENV_FILE:-${HOME}/.openclaw/.env}"
if [[ ! -r "${worker_env_file}" ]]; then
  echo "Teamship print worker environment file is not readable." >&2
  exit 1
fi

while IFS= read -r worker_env_line || [[ -n "${worker_env_line}" ]]; do
  [[ -z "${worker_env_line}" || "${worker_env_line}" == \#* || "${worker_env_line}" != *=* ]] && continue
  worker_env_name="${worker_env_line%%=*}"
  worker_env_value="${worker_env_line#*=}"
  case "${worker_env_name}" in
    NEWL_APPS_BASE_URL|TEAMSHIP_PRINT_WORKER_TOKEN|TEAMSHIP_PRINT_WORKER_TENANT_SLUG|TEAMSHIP_PRINT_WORKER_ID|TEAMSHIP_BROWSER_EXECUTABLE_PATH|TEAMSHIP_PRINT_HEADED|TEAMSHIP_PRINT_TIMEOUT_MS|TEAMSHIP_PRINT_WORKER_POLL_MS|TEAMSHIP_BROWSER_ALLOWED_HOSTS|TEAMSHIP_WORKER_REPO_PATH|TEAMSHIP_APP_BASE_URL|VERCEL_AUTOMATION_BYPASS_SECRET)
      if [[ "${worker_env_value}" == \"*\" && "${worker_env_value}" == *\" ]]; then
        worker_env_value="${worker_env_value:1:-1}"
      elif [[ "${worker_env_value}" == \'*\' && "${worker_env_value}" == *\' ]]; then
        worker_env_value="${worker_env_value:1:-1}"
      fi
      export "${worker_env_name}=${worker_env_value}"
      ;;
  esac
done < "${worker_env_file}"

runner_directory="${0:A:h}"
worker_repo_path="${TEAMSHIP_WORKER_REPO_PATH:-${runner_directory:h:h}}"
if [[ ! -f "${worker_repo_path}/package.json" ]]; then
  echo "Teamship print worker repository path is invalid." >&2
  exit 1
fi

cd "${worker_repo_path}"
exec /opt/homebrew/bin/npm run worker:teamship-print
