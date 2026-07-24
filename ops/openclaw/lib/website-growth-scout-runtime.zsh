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
      NEWL_APPS_URL|OPENCLAW_WEBSITE_GROWTH_TOKEN|NEWL_WEBSITE_REPO_PATH|WEBSITE_GROWTH_TEAMS_TARGET|WEBSITE_GROWTH_TEAMS_ACCOUNT|VERCEL_AUTOMATION_BYPASS_SECRET|CODEX_BIN)
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

send_website_growth_teams_message() {
  local message="$1"
  local -a teams_arguments

  if [[ -z "${WEBSITE_GROWTH_TEAMS_TARGET:-}" ]]; then
    return 1
  fi

  teams_arguments=(message send --channel msteams --target "${WEBSITE_GROWTH_TEAMS_TARGET}" --message "${message}")
  if [[ -n "${WEBSITE_GROWTH_TEAMS_ACCOUNT:-}" ]]; then
    teams_arguments+=(--account "${WEBSITE_GROWTH_TEAMS_ACCOUNT}")
  fi
  openclaw "${teams_arguments[@]}"
}
