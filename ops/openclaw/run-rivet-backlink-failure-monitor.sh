#!/bin/zsh

set -euo pipefail

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

runner_directory="${0:A:h}"
source "${runner_directory}/lib/website-growth-scout-runtime.zsh"

scout_env_file="${WEBSITE_GROWTH_SCOUT_ENV_FILE:-${HOME}/.openclaw/agents/scout/.env}"
gateway_env_file="${OPENCLAW_GATEWAY_ENV_FILE:-${HOME}/.openclaw/.env}"
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

temporary_directory="$(mktemp -d)"
jobs_path="${temporary_directory}/jobs.json"
runs_path="${temporary_directory}/runs.json"
request_path="${temporary_directory}/failure-request.json"
response_path="${temporary_directory}/failure-response.json"
parsed_path="${temporary_directory}/parsed.txt"
cleanup() {
  rm -rf "${temporary_directory}"
}
trap cleanup EXIT

openclaw cron list --json > "${jobs_path}"
outreach_job_id="$(/usr/bin/python3 - "${jobs_path}" <<'PY'
import json, sys
with open(sys.argv[1], encoding="utf-8") as handle:
    payload = json.load(handle)
jobs = payload.get("jobs") if isinstance(payload, dict) else payload
jobs = jobs if isinstance(jobs, list) else []
for job in jobs:
    if job.get("declarationKey") == "newl.website-growth.backlink-outreach.weekday.v1":
        print(job.get("id") or "")
        break
PY
)"
if [[ -z "${outreach_job_id}" ]]; then
  echo "The declared Website Growth backlink executor job was not found." >&2
  exit 1
fi

openclaw cron runs --id "${outreach_job_id}" --limit 1 > "${runs_path}"
/usr/bin/python3 - "${runs_path}" "${request_path}" > "${parsed_path}" <<'PY'
import datetime, json, sys
with open(sys.argv[1], encoding="utf-8") as handle:
    payload = json.load(handle)
entries = payload.get("entries") if isinstance(payload, dict) else []
entries = entries if isinstance(entries, list) else []
entry = entries[0] if entries else None
if not isinstance(entry, dict) or entry.get("status") not in {"error", "skipped"}:
    print("ignore")
    raise SystemExit(0)
diagnostics = entry.get("diagnostics") or {}
diagnostic_entries = diagnostics.get("entries") if isinstance(diagnostics, dict) else []
messages = []
for item in diagnostic_entries or []:
    if isinstance(item, dict) and isinstance(item.get("message"), str):
        messages.append(item["message"])
run_id = entry.get("runId") or f'{entry.get("jobId", "unknown")}:{entry.get("runAtMs", entry.get("ts", "unknown"))}'
run_at_ms = entry.get("runAtMs")
run_at = None
if isinstance(run_at_ms, (int, float)):
    run_at = datetime.datetime.fromtimestamp(
        run_at_ms / 1000,
        tz=datetime.timezone.utc
    ).isoformat().replace("+00:00", "Z")
request = {
    "sourceJobId": entry.get("jobId") or "",
    "sourceRunId": str(run_id),
    "status": entry.get("status"),
    "error": entry.get("error"),
    "errorReason": entry.get("errorReason"),
    "summary": entry.get("summary"),
    "diagnostics": messages[:20],
    "runAt": run_at
}
with open(sys.argv[2], "w", encoding="utf-8") as handle:
    json.dump(request, handle)
print("report")
PY

if [[ "$(sed -n '1p' "${parsed_path}")" != "report" ]]; then
  exit 0
fi

request_headers=(
  --header "Authorization: Bearer ${OPENCLAW_WEBSITE_GROWTH_BACKLINK_TOKEN}"
  --header "Content-Type: application/json"
)
if [[ -n "${VERCEL_AUTOMATION_BYPASS_SECRET:-}" ]]; then
  request_headers+=(--header "x-vercel-protection-bypass: ${VERCEL_AUTOMATION_BYPASS_SECRET}")
fi

curl --fail --silent --show-error \
  --request POST \
  "${request_headers[@]}" \
  --data-binary "@${request_path}" \
  "${NEWL_APPS_URL%/}/api/website-growth/backlinks/executor/failures" > "${response_path}"

/usr/bin/python3 - "${response_path}" > "${parsed_path}" <<'PY'
import json, sys
with open(sys.argv[1], encoding="utf-8") as handle:
    payload = json.load(handle)
data = payload.get("data") or {}
print("1" if data.get("notify") else "0")
print("1" if data.get("disableExecutor") else "0")
print((data.get("teamsMessage") or "").replace("\r", ""))
PY

notify="$(sed -n '1p' "${parsed_path}")"
disable_executor="$(sed -n '2p' "${parsed_path}")"
if [[ "${disable_executor}" == "1" ]]; then
  openclaw cron disable "${outreach_job_id}"
fi
if [[ "${notify}" == "1" ]]; then
  teams_message="$(sed -n '3,$p' "${parsed_path}")"
  send_website_growth_teams_message "${teams_message}"
fi
