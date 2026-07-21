#!/bin/zsh

set -euo pipefail

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
export PYTHONUNBUFFERED=1

worker_env_file="${HUNTER_WORKER_ENV_FILE:-${HOME}/.openclaw/agents/hunter/.env}"
if [[ ! -r "${worker_env_file}" ]]; then
  echo "Hunter worker environment file is not readable." >&2
  exit 1
fi

while IFS= read -r worker_env_line || [[ -n "${worker_env_line}" ]]; do
  [[ -z "${worker_env_line}" || "${worker_env_line}" == \#* || "${worker_env_line}" != *=* ]] && continue
  worker_env_name="${worker_env_line%%=*}"
  worker_env_value="${worker_env_line#*=}"
  case "${worker_env_name}" in
    NEWL_APPS_BASE_URL|INGESTION_API_TOKEN|INGESTION_TENANT_SLUG|TRADEMINING_USER|TRADEMINING_PASSWORD|HUNTER_WORKER_ID|HUNTER_REPO_PATH|HUNTER_PYTHON_PATH|HUNTER_EXPORT_DIRECTORY|HUNTER_PROCESSED_DIRECTORY|HUNTER_COOKIE_FILE|HUNTER_TRADEMINING_PORTS_JSON|HUNTER_SEARCH_CHUNK_DAYS|HUNTER_DAILY_RUN_TIME|HUNTER_END_DATE|HUNTER_POLL_MS|VERCEL_AUTOMATION_BYPASS_SECRET)
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
worker_repo_path="${HUNTER_REPO_PATH:-${runner_directory:h:h}}"
worker_python_path="${HUNTER_PYTHON_PATH:-/usr/bin/python3}"
worker_script="${worker_repo_path}/ops/openclaw/hunter/hunter_worker.py"

if [[ ! -f "${worker_script}" ]]; then
  echo "Hunter worker repository path is invalid." >&2
  exit 1
fi
if [[ ! -x "${worker_python_path}" ]]; then
  echo "Hunter Python runtime is not executable." >&2
  exit 1
fi

cd "${worker_repo_path}"
exec "${worker_python_path}" -u "${worker_script}" "$@"
