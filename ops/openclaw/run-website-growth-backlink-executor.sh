#!/bin/zsh

set -uo pipefail

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

runner_directory="${0:A:h}"
source "${runner_directory}/lib/website-growth-scout-runtime.zsh"

scout_env_file="${WEBSITE_GROWTH_SCOUT_ENV_FILE:-${HOME}/.openclaw/agents/scout/.env}"
gateway_env_file="${OPENCLAW_GATEWAY_ENV_FILE:-${HOME}/.openclaw/.env}"
prompt_path="${runner_directory}/prompts/website-growth-backlink-executor.md"
validator_path="${runner_directory}/validate-website-growth-backlink-agent-run.py"
openclaw_command="${OPENCLAW_BIN:-openclaw}"
curl_command="${CURL_BIN:-curl}"
scout_sessions_directory="${OPENCLAW_SCOUT_SESSIONS_DIR:-${HOME}/.openclaw/agents/scout/sessions}"

if ! load_website_growth_scout_env "${scout_env_file}"; then
  echo "The protected Website Growth Scout environment file is not readable." >&2
  exit 1
fi
if ! load_website_growth_scout_env "${gateway_env_file}"; then
  echo "The protected OpenClaw gateway environment file is not readable." >&2
  exit 1
fi

: "${NEWL_APPS_URL:?NEWL_APPS_URL is required}"
: "${OPENCLAW_WEBSITE_GROWTH_BACKLINK_TOKEN:?OPENCLAW_WEBSITE_GROWTH_BACKLINK_TOKEN is required}"
: "${WEBSITE_GROWTH_TEAMS_TARGET:?WEBSITE_GROWTH_TEAMS_TARGET is required}"

if [[ "${NEWL_APPS_URL}" != https://* ]]; then
  echo "NEWL_APPS_URL must use HTTPS." >&2
  exit 1
fi
if [[ ! -r "${prompt_path}" ]]; then
  echo "The Website Growth backlink executor prompt is not readable." >&2
  exit 1
fi
if [[ ! -r "${validator_path}" ]]; then
  echo "The Website Growth backlink executor validator is not readable." >&2
  exit 1
fi

temporary_directory="$(mktemp -d)"
chmod 700 "${temporary_directory}"
agent_output_path="${temporary_directory}/agent-output.json"
agent_error_path="${temporary_directory}/agent-error.log"
summary_request_path="${temporary_directory}/summary-request.json"
summary_response_path="${temporary_directory}/summary-response.json"
summary_message_path="${temporary_directory}/summary-message.txt"
cleanup() {
  rm -rf "${temporary_directory}"
}
trap cleanup EXIT

run_started_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
session_key="agent:scout:backlink-outreach-$(date -u +%Y%m%dT%H%M%SZ)-$$"
agent_status=0

"${openclaw_command}" agent \
  --agent scout \
  --model "openai/gpt-5.4-mini" \
  --thinking high \
  --timeout 1500 \
  --session-key "${session_key}" \
  --message-file "${prompt_path}" \
  --json > "${agent_output_path}" 2> "${agent_error_path}" || agent_status=$?

if [[ "${agent_status}" -eq 0 ]]; then
  if ! /usr/bin/python3 "${validator_path}" \
    --agent-output "${agent_output_path}" \
    --sessions-directory "${scout_sessions_directory}" \
    >> "${agent_error_path}" 2>&1; then
    agent_status=70
  fi
fi

/usr/bin/python3 - "${run_started_at}" "${agent_status}" "${summary_request_path}" <<'PY'
import json, sys
with open(sys.argv[3], "w", encoding="utf-8") as handle:
    json.dump({
        "runStartedAt": sys.argv[1],
        "executionStatus": "SUCCESS" if int(sys.argv[2]) == 0 else "ERROR",
    }, handle)
PY

request_headers=(
  --header "Authorization: Bearer ${OPENCLAW_WEBSITE_GROWTH_BACKLINK_TOKEN}"
  --header "Content-Type: application/json"
)
if [[ -n "${VERCEL_AUTOMATION_BYPASS_SECRET:-}" ]]; then
  request_headers+=(--header "x-vercel-protection-bypass: ${VERCEL_AUTOMATION_BYPASS_SECRET}")
fi

summary_status=0
"${curl_command}" --fail --silent --show-error --max-time 60 \
  --request POST \
  "${request_headers[@]}" \
  --data-binary "@${summary_request_path}" \
  "${NEWL_APPS_URL%/}/api/website-growth/backlinks/executor/summary" \
  > "${summary_response_path}" || summary_status=$?

if [[ "${summary_status}" -eq 0 ]]; then
  /usr/bin/python3 - "${summary_response_path}" "${summary_message_path}" <<'PY'
import json, sys
with open(sys.argv[1], encoding="utf-8") as handle:
    payload = json.load(handle)
message = (payload.get("data") or {}).get("message")
if not isinstance(message, str) or not message.strip():
    raise SystemExit("The deterministic backlink summary did not include a message.")
with open(sys.argv[2], "w", encoding="utf-8") as handle:
    handle.write(message.strip())
PY
  summary_status=$?
fi

if [[ "${summary_status}" -eq 0 ]]; then
  teams_message="$(cat "${summary_message_path}")"
  if ! send_website_growth_teams_message "${teams_message}"; then
    echo "The deterministic Website Growth summary was created but Teams delivery failed." >&2
    exit 1
  fi
else
  safe_message="Website Growth backlink work ended, but its deterministic summary could not be created. Do not rerun the outreach cycle automatically because an external action may already have completed. Review Newl Apps and the protected Scout session ${session_key}."
  send_website_growth_teams_message "${safe_message}" || true
  echo "The Website Growth backlink summary failed after the Scout work phase. Session: ${session_key}" >&2
  exit 1
fi

if [[ "${agent_status}" -ne 0 ]]; then
  echo "The Scout browser work phase failed after its deterministic summary was delivered. Session: ${session_key}. Do not retry automatically." >&2
  exit "${agent_status}"
fi

echo "Website Growth backlink work completed and its deterministic Teams summary was delivered."
