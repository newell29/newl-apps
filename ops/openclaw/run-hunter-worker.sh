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
    NEWL_APPS_BASE_URL|INGESTION_API_TOKEN|INGESTION_TENANT_SLUG|TRADEMINING_USER|TRADEMINING_PASSWORD|HUNTER_WORKER_ID|HUNTER_PYTHON_PATH|HUNTER_EXPORT_DIRECTORY|HUNTER_PROCESSED_DIRECTORY|HUNTER_COOKIE_FILE|HUNTER_TRADEMINING_PORTS_JSON|HUNTER_HTTP_MAX_ATTEMPTS|HUNTER_DAILY_RUN_TIME|HUNTER_END_DATE|HUNTER_POLL_MS|HUNTER_TEAMS_TARGET|HUNTER_TEAMS_ACCOUNT|HUNTER_SIGNAL_SCOUT_ENABLED|HUNTER_SIGNAL_SCOUT_DAILY_TIME|HUNTER_SIGNAL_SCOUT_TIMEZONE|HUNTER_OLLAMA_BASE_URL|HUNTER_CLASSIFICATION_MODEL|HUNTER_CLASSIFICATION_BATCH_SIZE|HUNTER_COMPANY_RESEARCH_ENABLED|HUNTER_COMPANY_RESEARCH_DAILY_TIME|HUNTER_COMPANY_RESEARCH_TIMEZONE|HUNTER_RESEARCH_SEARCH_PROVIDER|HUNTER_BRAVE_SEARCH_API_KEY|HUNTER_RESEARCH_RESULTS_PER_QUERY|HUNTER_RESEARCH_PAGES_PER_COMPANY|HUNTER_RESEARCH_FOLLOW_UP_QUERIES|HUNTER_RESEARCH_LUNA_MAX_ATTEMPTS|HUNTER_RESEARCH_QWEN_SHADOW_ENABLED|HUNTER_RESEARCH_QWEN_FALLBACK_ENABLED|HUNTER_RESEARCH_QWEN_MODEL|HUNTER_RESEARCH_QWEN_BATCH_SIZE|HUNTER_RESEARCH_QWEN_REPAIR_ATTEMPTS|HUNTER_RESEARCH_CHECKPOINT_DIRECTORY|HUNTER_KIMI_API_KEY|HUNTER_KIMI_BASE_URL|HUNTER_KIMI_MODEL|HUNTER_RESEARCH_KIMI_BATCH_SIZE|HUNTER_KIMI_VALIDATOR_MODEL|HUNTER_RESEARCH_K3_VALIDATOR_LIMIT|HUNTER_RESEARCH_K3_REASONING_EFFORT|VERCEL_AUTOMATION_BYPASS_SECRET)
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
worker_repo_path="${runner_directory:h:h}"
worker_python_path="${HUNTER_PYTHON_PATH:-/usr/bin/python3}"
worker_script="${worker_repo_path}/ops/openclaw/hunter/hunter_worker.py"

if [[ ! -f "${worker_script}" ]]; then
  echo "Hunter's dedicated runtime checkout is invalid." >&2
  exit 1
fi
if [[ ! -x "${worker_python_path}" ]]; then
  echo "Hunter Python runtime is not executable." >&2
  exit 1
fi

cd "${worker_repo_path}"
exec "${worker_python_path}" -u "${worker_script}" "$@"
