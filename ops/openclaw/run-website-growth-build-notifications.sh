#!/bin/zsh

set -euo pipefail

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

runner_directory="${0:A:h}"
source "${runner_directory}/lib/website-growth-scout-runtime.zsh"

scout_env_file="${WEBSITE_GROWTH_SCOUT_ENV_FILE:-${HOME}/.openclaw/agents/scout/.env}"
curl_command="${CURL_BIN:-curl}"
worker_id="openclaw-website-growth-build-notifier"

if ! load_website_growth_scout_env "${scout_env_file}"; then
  echo "The protected Website Growth Scout environment file is not readable." >&2
  exit 1
fi

: "${NEWL_APPS_URL:?NEWL_APPS_URL is required}"
: "${OPENCLAW_WEBSITE_GROWTH_TOKEN:?OPENCLAW_WEBSITE_GROWTH_TOKEN is required}"
: "${WEBSITE_GROWTH_TEAMS_TARGET:?WEBSITE_GROWTH_TEAMS_TARGET is required}"

if [[ "${NEWL_APPS_URL}" != https://* ]]; then
  echo "NEWL_APPS_URL must use HTTPS." >&2
  exit 1
fi

temporary_directory="$(mktemp -d)"
chmod 700 "${temporary_directory}"
cleanup() {
  rm -rf "${temporary_directory}"
}
trap cleanup EXIT

request_headers=(
  --header "Authorization: Bearer ${OPENCLAW_WEBSITE_GROWTH_TOKEN}"
  --header "Content-Type: application/json"
)
if [[ -n "${VERCEL_AUTOMATION_BYPASS_SECRET:-}" ]]; then
  request_headers+=(--header "x-vercel-protection-bypass: ${VERCEL_AUTOMATION_BYPASS_SECRET}")
fi

for iteration in {1..10}; do
  claim_request_path="${temporary_directory}/claim-request-${iteration}.json"
  claim_response_path="${temporary_directory}/claim-response-${iteration}.json"
  message_path="${temporary_directory}/message-${iteration}.txt"
  ack_request_path="${temporary_directory}/ack-request-${iteration}.json"

  /usr/bin/python3 - "${claim_request_path}" "${worker_id}" <<'PY'
import json, sys
with open(sys.argv[1], "w", encoding="utf-8") as handle:
    json.dump({"action": "claim", "workerId": sys.argv[2]}, handle)
PY

  "${curl_command}" --fail --silent --show-error --max-time 60 \
    --request POST \
    "${request_headers[@]}" \
    --data-binary "@${claim_request_path}" \
    "${NEWL_APPS_URL%/}/api/website-growth/scout/build-notifications" \
    > "${claim_response_path}"

  has_notification="$(/usr/bin/python3 - "${claim_response_path}" "${message_path}" "${ack_request_path}" <<'PY'
import json, sys
with open(sys.argv[1], encoding="utf-8") as handle:
    payload = json.load(handle)
notification = (payload.get("data") or {}).get("notification")
if not isinstance(notification, dict):
    print("no")
    raise SystemExit(0)
message = notification.get("message")
if not isinstance(message, str) or not message.strip():
    raise SystemExit("Website Growth build notification did not include a message.")
with open(sys.argv[2], "w", encoding="utf-8") as handle:
    handle.write(message.strip())
with open(sys.argv[3], "w", encoding="utf-8") as handle:
    json.dump({
        "action": "ack",
        "requestId": notification["requestId"],
        "event": notification["event"],
        "claimToken": notification["claimToken"],
    }, handle)
print("yes")
PY
)"

  if [[ "${has_notification}" != "yes" ]]; then
    exit 0
  fi

  send_website_growth_teams_message "$(cat "${message_path}")" >/dev/null

  "${curl_command}" --fail --silent --show-error --max-time 60 \
    --request POST \
    "${request_headers[@]}" \
    --data-binary "@${ack_request_path}" \
    "${NEWL_APPS_URL%/}/api/website-growth/scout/build-notifications" \
    >/dev/null
done

echo "Website Growth build notification batch reached its ten-message safety limit." >&2
exit 1
