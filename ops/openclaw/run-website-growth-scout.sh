#!/bin/zsh

set -euo pipefail

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

runner_directory="${0:A:h}"
source "${runner_directory}/lib/resolve-codex-cli.zsh"
source "${runner_directory}/lib/website-growth-scout-runtime.zsh"

scout_env_file="${WEBSITE_GROWTH_SCOUT_ENV_FILE:-${HOME}/.openclaw/agents/scout/.env}"
if ! load_website_growth_scout_env "${scout_env_file}"; then
  echo "Website Growth Scout environment file is not readable." >&2
  exit 1
fi
hunter_env_file="${HUNTER_ENV_FILE:-${HOME}/.openclaw/agents/hunter/.env}"
load_website_growth_search_env "${hunter_env_file}" || true

schema_path="${runner_directory}/skills/website-growth-scout/scout-output.schema.json"
temporary_directory="$(mktemp -d)"
prepare_path="${temporary_directory}/prepare.json"
packet_path="${temporary_directory}/packet.json"
result_path="${temporary_directory}/result.json"
completion_request_path="${temporary_directory}/completion-request.json"
completion_response_path="${temporary_directory}/completion-response.json"
discovery_path="${temporary_directory}/backlink-discovery.json"
run_id=""
completed=0
failure_stage="validate Scout runtime configuration"
scout_mode="${1:-deep}"

cleanup() {
  rm -rf "${temporary_directory}"
}

report_failure() {
  local exit_status=$?
  trap - EXIT
  if [[ ${exit_status} -ne 0 && ${completed} -eq 0 ]]; then
    if [[ -n "${run_id}" ]]; then
      /usr/bin/python3 - "${run_id}" "${temporary_directory}/failure.json" <<'PY'
import json, sys
with open(sys.argv[2], "w", encoding="utf-8") as handle:
    json.dump({"runId": sys.argv[1], "message": "The bounded backlink discovery or read-only Codex Scout step failed. Review the Scout worker log."}, handle)
PY
      curl --fail --silent --show-error \
        --request POST \
        "${scout_curl_headers[@]}" \
        --header "Content-Type: application/json" \
        --data-binary "@${temporary_directory}/failure.json" \
        "${NEWL_APPS_URL%/}/api/website-growth/scout/fail" >/dev/null 2>&1 || true
    fi
    send_website_growth_teams_message \
      "Website Growth Scout failed during ${failure_stage}. No website work was approved, merged, or published. Review the Website Growth job in Newl Apps and the OpenClaw worker log." \
      >/dev/null 2>&1 || true
  fi
  cleanup
  exit ${exit_status}
}
trap report_failure EXIT

: "${NEWL_APPS_URL:?NEWL_APPS_URL is required}"
: "${OPENCLAW_WEBSITE_GROWTH_TOKEN:?OPENCLAW_WEBSITE_GROWTH_TOKEN is required}"
: "${WEBSITE_GROWTH_TEAMS_TARGET:?WEBSITE_GROWTH_TEAMS_TARGET is required}"
: "${HUNTER_BRAVE_SEARCH_API_KEY:?HUNTER_BRAVE_SEARCH_API_KEY is required for bounded backlink discovery}"

if [[ "${NEWL_APPS_URL}" != https://* ]]; then
  echo "NEWL_APPS_URL must use HTTPS." >&2
  exit 1
fi
scout_curl_headers=(--header "Authorization: Bearer ${OPENCLAW_WEBSITE_GROWTH_TOKEN}")
if [[ -n "${VERCEL_AUTOMATION_BYPASS_SECRET:-}" ]]; then
  scout_curl_headers+=(--header "x-vercel-protection-bypass: ${VERCEL_AUTOMATION_BYPASS_SECRET}")
fi

if [[ "${scout_mode}" == "--light" ]]; then
  failure_stage="refresh first-party evidence and read the SEMrush cache"
  curl --fail --silent --show-error \
    --request POST \
    "${scout_curl_headers[@]}" \
    "${NEWL_APPS_URL%/}/api/website-growth/scout/check-in" > "${completion_response_path}"
  teams_message="$(/usr/bin/python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["data"]["teamsMessage"])' "${completion_response_path}")"
  failure_stage="send the weekday Scout check-in to Teams"
  send_website_growth_teams_message "${teams_message}"
  completed=1
  exit 0
fi
if [[ "${scout_mode}" != "deep" ]]; then
  echo "Website Growth Scout mode must be deep or --light." >&2
  exit 1
fi

: "${NEWL_WEBSITE_REPO_PATH:?NEWL_WEBSITE_REPO_PATH is required}"
if [[ ! -e "${NEWL_WEBSITE_REPO_PATH}/.git" ]]; then
  echo "NEWL_WEBSITE_REPO_PATH must point to the Newl website repository." >&2
  exit 1
fi

failure_stage="validate Scout dependencies"

resolve_codex_cli

failure_stage="refresh Search Console, GA4, forms, and the review queue"
research_scope="weekly"
day_of_month="$((10#$(/bin/date +%d)))"
if [[ "${day_of_month}" -le 7 ]]; then
  research_scope="monthly"
fi
curl --fail --silent --show-error \
  --request POST \
  "${scout_curl_headers[@]}" \
  --header "x-website-growth-research-scope: ${research_scope}" \
  "${NEWL_APPS_URL%/}/api/website-growth/scout/prepare" > "${prepare_path}"

/usr/bin/python3 - "${prepare_path}" "${packet_path}" > "${temporary_directory}/state.txt" <<'PY'
import json, sys
with open(sys.argv[1], encoding="utf-8") as handle:
    response = json.load(handle)
data = response.get("data") or {}
print(data.get("state") or "error")
if data.get("packet"):
    with open(sys.argv[2], "w", encoding="utf-8") as handle:
        json.dump(data["packet"], handle, ensure_ascii=False)
print(data.get("runId") or "")
PY

scout_state="$(sed -n '1p' "${temporary_directory}/state.txt")"
run_id="$(sed -n '2p' "${temporary_directory}/state.txt")"
if [[ "${scout_state}" == "already_running" ]]; then
  send_website_growth_teams_message \
    "Website Growth Scout checked in, but another Scout run is already active. No duplicate run was started; the active run will send its own result when it finishes."
  completed=1
  exit 0
fi
if [[ "${scout_state}" != "ready" || -z "${run_id}" ]]; then
  echo "Website Growth Scout preparation returned an unexpected state." >&2
  exit 1
fi

scout_model="$(/usr/bin/python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["model"])' "${packet_path}")"
scout_effort="$(/usr/bin/python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["reasoningEffort"])' "${packet_path}")"

failure_stage="run bounded Brave Search and local Qwen backlink triage"
/usr/bin/python3 "${runner_directory}/website_growth_backlink_discovery.py" \
  --packet "${packet_path}" \
  --output "${discovery_path}"

/usr/bin/python3 - "${packet_path}" "${discovery_path}" <<'PY'
import json, sys
with open(sys.argv[1], encoding="utf-8") as handle:
    packet = json.load(handle)
with open(sys.argv[2], encoding="utf-8") as handle:
    discovery = json.load(handle)
packet["backlinkDiscovery"]["finalists"] = discovery.get("finalists") or []
packet["backlinkDiscovery"]["summary"] = discovery.get("summary") or {}
with open(sys.argv[1], "w", encoding="utf-8") as handle:
    json.dump(packet, handle, ensure_ascii=False)
PY

failure_stage="run read-only Codex final review"
{
  printf '%s\n' "You are the read-only Newl Website Growth Scout."
  printf '%s\n' "Review every candidate in the supplied packet against the current website repository."
  printf '%s\n' "SEMrush is optional supporting evidence, not the primary backlink source. Do not use SEMrush for backlink discovery."
  printf '%s\n' "When official SEMrush API units are available, use only relevant targeted rows and the matching Newl Position Tracking campaign."
  printf '%s\n' "This packet contains the most recent sanitized SEMrush cache. If the official MCP reports that API units are unavailable, and only if the packet marks the cache fresh, reuse that exact cache instead of failing or inventing data."
  printf '%s\n' "If neither live SEMrush nor a fresh cache is available, return source UNAVAILABLE, queried false, current observedAt, an empty evidence row list, and an empty/null Position Tracking snapshot. The Scout run must continue."
  printf '%s\n' "For live MCP evidence set source to LIVE_MCP, queried true, and observedAt to the current ISO time. For cached evidence set source to CACHE, queried false, and preserve the cache observedAt exactly."
  printf '%s\n' "Broad competitor-gap discovery runs only when semrush.researchScope is MONTHLY. On WEEKLY runs, rely on the persisted Newl Apps opportunity/backlink queues and make only candidate-specific competitive calls."
  printf '%s\n' "The packet's backlinkDiscovery.finalists are the only new public-web backlink candidates you may promote."
  printf '%s\n' "Make the final evidence-based review and return no more than 5 high-quality, actionable prospects. Set backlinks.source to WEB_DISCOVERY, queried true, and observedAt to the current ISO time."
  printf '%s\n' "Use backlinkDiscovery.summary.rawResults for rawProspectsReviewed and summary.duplicatesSkipped for duplicatesRejected. Set qualityRejected to summary.qwenRejected plus the finalists you do not promote. Never return or reconstruct the raw search inventory."
  printf '%s\n' "Classify each returned prospect as directory/citation, link reclamation, partner/ecosystem, content contribution, resource page, digital PR, or paid placement."
  printf '%s\n' "Reject link farms, irrelevant directories, automated link schemes, paid dofollow offers, and HIGH-spam-risk prospects."
  printf '%s\n' "Paid placements are research-only and require a separate human spending decision. Do not recommend buying ranking credit."
  printf '%s\n' "Use only the campaign whose root domain matches the current Newl website; do not combine newl.ca, Teamship, or another project."
  printf '%s\n' "Return the campaign visibility, ranking-bucket and movement totals, plus every tracked keyword available up to the 500-row schema limit; paginate the report when required."
  printf '%s\n' "When the packet has no page candidates, return no candidate evidence rows and no drafts, but still return the Position Tracking snapshot and backlink review."
  printf '%s\n' "Use Search Console for query/ranking truth, GA4 for landing-page engagement, and first-party forms for lead truth."
  printf '%s\n' "SEMrush is supporting competitive and market evidence; do not relabel its search volume as Search Console impressions."
  printf '%s\n' "Return a draft only for ideas you recommend sending to the owner for approval. Do not approve anything."
  printf '%s\n' "Match existing Newl routes, templates, forms, hero patterns, CTAs, FAQs, and internal links."
  printf '%s\n' "Treat candidates marked questionOpportunity as a dedicated customer-question and AI-answer lane."
  printf '%s\n' "For question-led candidates, inspect the existing site answer first and prefer a direct answer section on the strongest relevant page."
  printf '%s\n' "Recommend a dedicated question guide only when the intent is substantial, distinct, commercially relevant, and cannot be answered well on an existing page."
  printf '%s\n' "Reject thin FAQ pages, duplicate intent, keyword-swapped pages, unsupported structured data, and any claim that a change guarantees an AI citation or ranking."
  printf '%s\n' "Do not write files, change Git, open pull requests, send messages, or expose personal information."
  printf '%s\n' "Avoid guarantees and unsupported numerical, certification, customer, comparative, or affiliation claims."
  printf '%s\n\n' "Your final response must match the supplied JSON schema exactly."
  printf '%s\n' "SCOUT_PACKET_JSON:"
  /bin/cat "${packet_path}"
} | "${codex_bin}" exec \
  --ephemeral \
  --model "${scout_model}" \
  --config "model_reasoning_effort=\"${scout_effort}\"" \
  --sandbox read-only \
  --cd "${NEWL_WEBSITE_REPO_PATH}" \
  --output-schema "${schema_path}" \
  --output-last-message "${result_path}" \
  --color never \
  -

failure_stage="validate and save the Scout result in Newl Apps"
/usr/bin/python3 - "${run_id}" "${result_path}" "${completion_request_path}" <<'PY'
import json, sys
with open(sys.argv[2], encoding="utf-8") as handle:
    completion = json.load(handle)
with open(sys.argv[3], "w", encoding="utf-8") as handle:
    json.dump({"runId": sys.argv[1], "completion": completion}, handle, ensure_ascii=False)
PY

curl --fail --silent --show-error \
  --request POST \
  "${scout_curl_headers[@]}" \
  --header "Content-Type: application/json" \
  --data-binary "@${completion_request_path}" \
  "${NEWL_APPS_URL%/}/api/website-growth/scout/complete" > "${completion_response_path}"

teams_message="$(/usr/bin/python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["data"]["teamsMessage"])' "${completion_response_path}")"

failure_stage="send the Scout summary to Teams"
send_website_growth_teams_message "${teams_message}"

completed=1
exit 0
