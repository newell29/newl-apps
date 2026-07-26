#!/bin/zsh

set -euo pipefail

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

runner_directory="${0:A:h}"
source "${runner_directory}/lib/resolve-codex-cli.zsh"
source "${runner_directory}/lib/rivet-development-runtime.zsh"

rivet_env_file="${RIVET_DEVELOPMENT_ENV_FILE:-${HOME}/.openclaw/agents/rivet/.env}"
if ! load_rivet_development_env "${rivet_env_file}"; then
  echo "Rivet development environment file is not readable." >&2
  exit 1
fi

: "${NEWL_APPS_URL:?NEWL_APPS_URL is required}"
: "${OPENCLAW_ASSISTANT_TOKEN:?OPENCLAW_ASSISTANT_TOKEN is required}"
: "${NEWL_TEAMS_TENANT_ID:?NEWL_TEAMS_TENANT_ID is required}"
: "${RIVET_DEVELOPER_OBJECT_ID:?RIVET_DEVELOPER_OBJECT_ID is required}"
: "${RIVET_NEWL_APPS_REPO_PATH:?RIVET_NEWL_APPS_REPO_PATH is required}"
: "${RIVET_TEAMS_TARGET:?RIVET_TEAMS_TARGET is required}"

if [[ "${NEWL_APPS_URL}" != https://* ]]; then
  echo "NEWL_APPS_URL must use HTTPS." >&2
  exit 1
fi
if [[ ! -e "${RIVET_NEWL_APPS_REPO_PATH}/.git" ]]; then
  echo "RIVET_NEWL_APPS_REPO_PATH must point to the trusted Newl Apps Git repository." >&2
  exit 1
fi

resolve_codex_cli
build_rivet_request_headers

temporary_directory="$(mktemp -d)"
prepare_response_path="${temporary_directory}/prepare-response.json"
packet_path="${temporary_directory}/packet.json"
result_path="${temporary_directory}/codex-result.json"
completion_request_path="${temporary_directory}/completion-request.json"
completion_response_path="${temporary_directory}/completion-response.json"
state_path="${temporary_directory}/state.txt"
run_id=""
completed=0
failure_stage="prepare the Hunter quality audit"

cleanup() {
  rm -rf "${temporary_directory}"
}

report_failure() {
  local exit_status=$?
  trap - EXIT
  if [[ ${exit_status} -ne 0 && ${completed} -eq 0 && -n "${run_id}" ]]; then
    /usr/bin/python3 - "${run_id}" "${failure_stage}" "${completion_request_path}" <<'PY'
import json, sys
with open(sys.argv[3], "w", encoding="utf-8") as handle:
    json.dump({
        "action": "fail",
        "runId": sys.argv[1],
        "errorMessage": f"Hunter quality control failed while attempting to {sys.argv[2]}. Review the protected Rivet worker log."
    }, handle)
PY
    if curl --fail --silent --show-error \
      --request POST \
      "${rivet_request_headers[@]}" \
      --header "Content-Type: application/json" \
      --data-binary "@${completion_request_path}" \
      "${NEWL_APPS_URL%/}/api/assistant/openclaw/hunter-quality" > "${completion_response_path}" 2>/dev/null; then
      teams_message="$(/usr/bin/python3 -c 'import json,sys; print((json.load(open(sys.argv[1])).get("data") or {}).get("teamsMessage") or "")' "${completion_response_path}")"
      if [[ -n "${teams_message}" ]]; then
        send_rivet_teams_message "${teams_message}" >/dev/null 2>&1 || true
      fi
    else
      send_rivet_teams_message \
        "Hunter quality control failed while attempting to ${failure_stage}. No lead was reclassified, no TradeMining or outreach action was retried, and no Rivet job was confirmed. Review the protected Rivet worker log. Nothing was merged or deployed." \
        >/dev/null 2>&1 || true
    fi
  fi
  cleanup
  exit ${exit_status}
}
trap report_failure EXIT

curl --fail --silent --show-error \
  --request POST \
  "${rivet_request_headers[@]}" \
  --header "Content-Type: application/json" \
  --data '{"action":"prepare"}' \
  "${NEWL_APPS_URL%/}/api/assistant/openclaw/hunter-quality" > "${prepare_response_path}"

/usr/bin/python3 - "${prepare_response_path}" "${packet_path}" > "${state_path}" <<'PY'
import json, sys
with open(sys.argv[1], encoding="utf-8") as handle:
    response = json.load(handle)
data = response.get("data") or {}
print(data.get("state") or "error")
print(data.get("runId") or "")
if isinstance(data.get("packet"), dict):
    with open(sys.argv[2], "w", encoding="utf-8") as handle:
        json.dump(data["packet"], handle, ensure_ascii=False)
PY

audit_state="$(sed -n '1p' "${state_path}")"
run_id="$(sed -n '2p' "${state_path}")"
if [[ "${audit_state}" == "already_running" || "${audit_state}" == "already_attempted" ]]; then
  completed=1
  exit 0
fi
if [[ "${audit_state}" != "ready" || -z "${run_id}" || ! -r "${packet_path}" ]]; then
  echo "Hunter quality preparation returned an unexpected state." >&2
  exit 1
fi

sample_count="$(/usr/bin/python3 -c 'import json,sys; print(len(json.load(open(sys.argv[1])).get("sample") or []))' "${packet_path}")"
failure_stage="run the independent read-only Codex sample"
if [[ "${sample_count}" == "0" ]]; then
  /usr/bin/python3 - "${result_path}" <<'PY'
import datetime, json, sys
with open(sys.argv[1], "w", encoding="utf-8") as handle:
    json.dump({
        "auditedAt": datetime.datetime.now(datetime.timezone.utc).isoformat().replace("+00:00", "Z"),
        "findings": []
    }, handle)
PY
else
  audit_model="$(/usr/bin/python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["model"])' "${packet_path}")"
  audit_effort="$(/usr/bin/python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["reasoningEffort"])' "${packet_path}")"
  schema_path="${runner_directory}/skills/rivet-developer/hunter-quality-output.schema.json"
  {
    printf '%s\n' "You are Hunter's independent read-only quality auditor."
    printf '%s\n' "Audit every sampled company. Return exactly one finding per signalId."
    printf '%s\n' "Treat the saved research ledger and tier as claims to verify, not as truth."
    printf '%s\n' "Use current public web research to look for identity evidence and recent expansion, facility, distribution, hiring, investment, acquisition, launch, or U.S./Canadian operating events that Hunter may have missed."
    printf '%s\n' "Open the strongest relevant results and cite only HTTPS URLs you actually verified."
    printf '%s\n' "Distinguish categories precisely:"
    printf '%s\n' "- EVIDENCE_RETRIEVAL: a material public source existed but Hunter did not retrieve it."
    printf '%s\n' "- EVIDENCE_HANDOFF: the ledger contains the evidence but a downstream model packet or citation selection omitted it."
    printf '%s\n' "- DETERMINISTIC_RULE: the evidence and model facts were present but code applied the wrong gate, freshness rule, or tier."
    printf '%s\n' "- MODEL_JUDGMENT: the evidence reached the model and the remaining disagreement is subjective scoring or synthesis."
    printf '%s\n' "- DATA_OR_CONFIG: identity, profile, credential, source availability, or business configuration needs review."
    printf '%s\n' "- NO_ISSUE: the saved result is supported after independent review."
    printf '%s\n' "Set reproducible true only when the packet and verified public evidence are sufficient for a developer to reproduce the defect."
    printf '%s\n' "Do not edit files, alter classifications, call Newl APIs, retry TradeMining, send outreach, create a development job, or send a message."
    printf '%s\n' "Do not expose tokens, credentials, personal emails, or private customer data."
    printf '%s\n' "Your final response must match the supplied JSON schema exactly."
    printf '%s\n\n' "HUNTER_QUALITY_PACKET_JSON:"
    /bin/cat "${packet_path}"
  } | env -i \
    HOME="${HOME}" \
    USER="${USER}" \
    PATH="${PATH}" \
    TMPDIR="${TMPDIR:-/tmp}" \
    LANG="${LANG:-en_US.UTF-8}" \
    CODEX_HOME="${CODEX_HOME:-${HOME}/.codex}" \
    "${codex_bin}" exec \
    --ephemeral \
    --model "${audit_model}" \
    --config "model_reasoning_effort=\"${audit_effort}\"" \
    --sandbox read-only \
    --cd "${RIVET_NEWL_APPS_REPO_PATH}" \
    --output-schema "${schema_path}" \
    --output-last-message "${result_path}" \
    --color never \
    -
fi

if [[ ! -r "${result_path}" ]]; then
  echo "Codex did not return the required Hunter quality result." >&2
  exit 1
fi

failure_stage="validate and record the quality findings"
/usr/bin/python3 - "${run_id}" "${result_path}" "${completion_request_path}" <<'PY'
import json, sys
with open(sys.argv[2], encoding="utf-8") as handle:
    completion = json.load(handle)
with open(sys.argv[3], "w", encoding="utf-8") as handle:
    json.dump({
        "action": "complete",
        "runId": sys.argv[1],
        "completion": completion
    }, handle, ensure_ascii=False)
PY

curl --fail --silent --show-error \
  --request POST \
  "${rivet_request_headers[@]}" \
  --header "Content-Type: application/json" \
  --data-binary "@${completion_request_path}" \
  "${NEWL_APPS_URL%/}/api/assistant/openclaw/hunter-quality" > "${completion_response_path}"

teams_message="$(/usr/bin/python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["data"]["teamsMessage"])' "${completion_response_path}")"
failure_stage="send the Hunter quality result to Teams"
send_rivet_teams_message "${teams_message}"

completed=1
cleanup
