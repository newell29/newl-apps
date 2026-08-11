load_website_growth_scout_env() {
  local scout_env_file="$1"
  local scout_env_line
  local scout_env_name
  local scout_env_value

  if [[ ! -r "${scout_env_file}" ]]; then
    return 1
  fi

  while IFS= read -r scout_env_line || [[ -n "${scout_env_line}" ]]; do
    [[ -z "${scout_env_line}" || "${scout_env_line}" == \#* || "${scout_env_line}" != *=* ]] && continue
    scout_env_name="${scout_env_line%%=*}"
    scout_env_value="${scout_env_line#*=}"
    case "${scout_env_name}" in
      NEWL_APPS_URL|OPENCLAW_WEBSITE_GROWTH_TOKEN|OPENCLAW_WEBSITE_GROWTH_BACKLINK_TOKEN|NEWL_WEBSITE_REPO_PATH|WEBSITE_GROWTH_TEAMS_TARGET|WEBSITE_GROWTH_TEAMS_ACCOUNT|VERCEL_AUTOMATION_BYPASS_SECRET|CODEX_BIN|HUNTER_BRAVE_SEARCH_API_KEY|HUNTER_ENV_FILE|WEBSITE_GROWTH_QWEN_URL|WEBSITE_GROWTH_QWEN_MODEL)
        if [[ "${scout_env_value}" == \"*\" && "${scout_env_value}" == *\" ]]; then
          scout_env_value="${scout_env_value:1:-1}"
        elif [[ "${scout_env_value}" == \'*\' && "${scout_env_value}" == *\' ]]; then
          scout_env_value="${scout_env_value:1:-1}"
        fi
        export "${scout_env_name}=${scout_env_value}"
        ;;
    esac
  done < "${scout_env_file}"
}

load_website_growth_search_env() {
  local hunter_env_file="$1"
  local hunter_env_line
  local hunter_env_value

  if [[ -n "${HUNTER_BRAVE_SEARCH_API_KEY:-}" ]]; then
    return 0
  fi
  if [[ ! -r "${hunter_env_file}" ]]; then
    return 1
  fi
  while IFS= read -r hunter_env_line || [[ -n "${hunter_env_line}" ]]; do
    [[ "${hunter_env_line}" != HUNTER_BRAVE_SEARCH_API_KEY=* ]] && continue
    hunter_env_value="${hunter_env_line#*=}"
    if [[ "${hunter_env_value}" == \"*\" && "${hunter_env_value}" == *\" ]]; then
      hunter_env_value="${hunter_env_value:1:-1}"
    elif [[ "${hunter_env_value}" == \'*\' && "${hunter_env_value}" == *\' ]]; then
      hunter_env_value="${hunter_env_value:1:-1}"
    fi
    [[ -z "${hunter_env_value}" ]] && return 1
    export "HUNTER_BRAVE_SEARCH_API_KEY=${hunter_env_value}"
    return 0
  done < "${hunter_env_file}"
  return 1
}

send_website_growth_teams_message() {
  local message="$1"
  local openclaw_command="${OPENCLAW_BIN:-openclaw}"
  local -a teams_arguments

  if [[ -z "${WEBSITE_GROWTH_TEAMS_TARGET:-}" ]]; then
    return 1
  fi

  teams_arguments=(message send --channel msteams --target "${WEBSITE_GROWTH_TEAMS_TARGET}" --message "${message}")
  if [[ -n "${WEBSITE_GROWTH_TEAMS_ACCOUNT:-}" ]]; then
    teams_arguments+=(--account "${WEBSITE_GROWTH_TEAMS_ACCOUNT}")
  fi
  "${openclaw_command}" "${teams_arguments[@]}"
}
