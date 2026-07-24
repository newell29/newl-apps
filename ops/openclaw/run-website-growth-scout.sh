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

schema_path="${runner_directory}/skills/website-growth-scout/scout-output.schema.json"
temporary_directory="$(mktemp -d)"
prepare_path="${temporary_directory}/prepare.json"
packet_path="${temporary_directory}/packet.json"
result_path="${temporary_directory}/result.json"
completion_request_path="${temporary_directory}/completion-request.json"
completion_response_path="${temporary_directory}/completion-response.json"
report_manifest_path="${temporary_directory}/report-manifest.json"
run_id=""
completed=0
failure_stage="validate Scout runtime configuration"

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
    json.dump({"runId": sys.argv[1], "message": "The read-only Codex Scout or SEMrush MCP step failed. Review the Scout worker log."}, handle)
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
: "${NEWL_WEBSITE_REPO_PATH:?NEWL_WEBSITE_REPO_PATH is required}"
: "${WEBSITE_GROWTH_TEAMS_TARGET:?WEBSITE_GROWTH_TEAMS_TARGET is required}"

if [[ "${NEWL_APPS_URL}" != https://* ]]; then
  echo "NEWL_APPS_URL must use HTTPS." >&2
  exit 1
fi
if [[ ! -e "${NEWL_WEBSITE_REPO_PATH}/.git" ]]; then
  echo "NEWL_WEBSITE_REPO_PATH must point to the Newl website repository." >&2
  exit 1
fi

scout_curl_headers=(--header "Authorization: Bearer ${OPENCLAW_WEBSITE_GROWTH_TOKEN}")
if [[ -n "${VERCEL_AUTOMATION_BYPASS_SECRET:-}" ]]; then
  scout_curl_headers+=(--header "x-vercel-protection-bypass: ${VERCEL_AUTOMATION_BYPASS_SECRET}")
fi

failure_stage="validate Scout dependencies"

resolve_codex_cli
node_bin="$(command -v node)"
if [[ -z "${node_bin}" ]]; then
  echo "Node.js is required to create the Website Growth Excel reports." >&2
  exit 1
fi
if ! "${codex_bin}" mcp get semrush >/dev/null 2>&1; then
  echo "Official SEMrush MCP is not configured for Codex. Run configure-semrush-mcp.sh first." >&2
  exit 1
fi

failure_stage="refresh Search Console, GA4, forms, and the review queue"
curl --fail --silent --show-error \
  --request POST \
  "${scout_curl_headers[@]}" \
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

failure_stage="run read-only Codex and official SEMrush research"
{
  printf '%s\n' "You are the read-only Newl Website Growth Scout."
  printf '%s\n' "Review every candidate in the supplied packet against the current website repository."
  printf '%s\n' "You must query the official SEMrush MCP server for each candidate and use only relevant, targeted rows."
  printf '%s\n' "You must also inspect Newl Group's current SEMrush Position Tracking campaign, even when the packet has no page candidates."
  printf '%s\n' "You must run a bounded backlink review on every run using SEMrush backlink profiles, referring domains, backlink gaps, and new/lost links."
  printf '%s\n' "Review broadly but return no more than 15 high-quality, actionable backlink prospects after deduplication and spam screening. Never return the raw backlink inventory."
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
"${node_bin}" --experimental-strip-types \
  "${runner_directory}/lib/create-website-growth-reports.ts" \
  "${completion_response_path}" \
  "${temporary_directory}" > "${report_manifest_path}"

failure_stage="send the Scout summary to Teams"
send_website_growth_teams_message "${teams_message}"

failure_stage="attach the SEO performance workbook in Teams"
performance_path="$(/usr/bin/python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["performance"]["path"])' "${report_manifest_path}")"
performance_filename="$(/usr/bin/python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["performance"]["filename"])' "${report_manifest_path}")"
performance_arguments=(message send --channel msteams --target "${WEBSITE_GROWTH_TEAMS_TARGET}" --message "SEO performance report attached: ${performance_filename}" --media "${performance_path}")
if [[ -n "${WEBSITE_GROWTH_TEAMS_ACCOUNT:-}" ]]; then
  performance_arguments+=(--account "${WEBSITE_GROWTH_TEAMS_ACCOUNT}")
fi
openclaw "${performance_arguments[@]}"

keyword_import_count="$(/usr/bin/python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["keywordImport"]["rowCount"])' "${report_manifest_path}")"
if [[ "${keyword_import_count}" -gt 0 ]]; then
  failure_stage="attach the SEMrush keyword import workbook in Teams"
  keyword_import_path="$(/usr/bin/python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["keywordImport"]["path"])' "${report_manifest_path}")"
  keyword_import_filename="$(/usr/bin/python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["keywordImport"]["filename"])' "${report_manifest_path}")"
  keyword_arguments=(message send --channel msteams --target "${WEBSITE_GROWTH_TEAMS_TARGET}" --message "SEMrush keyword import attached: ${keyword_import_filename}. These keywords were selected automatically from approved Website Growth briefs and deduplicated against the live Position Tracking campaign." --media "${keyword_import_path}")
  if [[ -n "${WEBSITE_GROWTH_TEAMS_ACCOUNT:-}" ]]; then
    keyword_arguments+=(--account "${WEBSITE_GROWTH_TEAMS_ACCOUNT}")
  fi
  openclaw "${keyword_arguments[@]}"
fi

completed=1
exit 0
