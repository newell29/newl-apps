load_rivet_development_env() {
  local env_file="$1"
  if [[ ! -r "${env_file}" ]]; then
    return 1
  fi

  set -a
  source "${env_file}"
  set +a
}

build_rivet_request_headers() {
  rivet_request_headers=(
    --header "Authorization: Bearer ${OPENCLAW_ASSISTANT_TOKEN}"
    --header "x-newl-teams-tenant-id: ${NEWL_TEAMS_TENANT_ID}"
    --header "x-newl-teams-aad-object-id: ${RIVET_DEVELOPER_OBJECT_ID}"
  )
  if [[ -n "${VERCEL_AUTOMATION_BYPASS_SECRET:-}" ]]; then
    rivet_request_headers+=(--header "x-vercel-protection-bypass: ${VERCEL_AUTOMATION_BYPASS_SECRET}")
  fi
}

send_rivet_teams_message() {
  local message="$1"
  local arguments=(message send --channel msteams --target "${RIVET_TEAMS_TARGET}" --message "${message}")
  if [[ -n "${RIVET_TEAMS_ACCOUNT:-}" ]]; then
    arguments+=(--account "${RIVET_TEAMS_ACCOUNT}")
  fi
  openclaw "${arguments[@]}"
}
