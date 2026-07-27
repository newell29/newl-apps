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
: "${RIVET_GITHUB_TOKEN:?RIVET_GITHUB_TOKEN is required}"
: "${RIVET_TEAMS_TARGET:?RIVET_TEAMS_TARGET is required}"

if [[ "${NEWL_APPS_URL}" != https://* ]]; then
  echo "NEWL_APPS_URL must use HTTPS." >&2
  exit 1
fi
rivet_repo_path="${runner_directory:h:h}"
if [[ ! -e "${rivet_repo_path}/.git" ]]; then
  echo "Rivet's dedicated runtime is not a trusted Newl Apps Git repository." >&2
  exit 1
fi

resolve_codex_cli
build_rivet_request_headers

temporary_directory="$(mktemp -d)"
claim_response_path="${temporary_directory}/claim-response.json"
packet_path="${temporary_directory}/packet.json"
result_path="${temporary_directory}/codex-result.json"
completion_request_path="${temporary_directory}/completion-request.json"
completion_response_path="${temporary_directory}/completion-response.json"
pull_request_path="${temporary_directory}/pull-request.json"
pull_response_path="${temporary_directory}/pull-response.json"
changed_paths_file="${temporary_directory}/changed-paths.txt"
packet_fields_path="${temporary_directory}/packet-fields.txt"
required_context_path="${temporary_directory}/required-context.txt"
job_id=""
lease_token=""
job_worktree=""
node_modules_linked=0
completed=0
pull_request_url=""
failure_stage="claim the next approved suggestion"

cleanup() {
  rm -rf "${temporary_directory}"
}

report_failure() {
  local exit_status=$?
  trap - EXIT
  if [[ ${exit_status} -ne 0 && ${completed} -eq 0 && -n "${job_id}" && -n "${lease_token}" ]]; then
    /usr/bin/python3 - "${job_id}" "${lease_token}" "${failure_stage}" "${completion_request_path}" <<'PY'
import json, sys
with open(sys.argv[4], "w", encoding="utf-8") as handle:
    json.dump({
        "action": "fail",
        "jobId": sys.argv[1],
        "leaseToken": sys.argv[2],
        "errorCode": "RIVET_WORKER_FAILED",
        "errorMessage": f"Rivet failed while attempting to {sys.argv[3]}. Review the protected local worker log."
    }, handle)
PY
    curl --fail --silent --show-error \
      --request POST \
      "${rivet_request_headers[@]}" \
      --header "Content-Type: application/json" \
      --data-binary "@${completion_request_path}" \
      "${NEWL_APPS_URL%/}/api/assistant/openclaw/development-jobs" >/dev/null 2>&1 || true
    if [[ -n "${pull_request_url}" ]]; then
      send_rivet_teams_message \
        "Rivet opened ${pull_request_url} but could not finish recording approved development job ${job_id} while attempting to ${failure_stage}. Nothing was merged or deployed. Review the PR and the failed Rivet job before retrying." \
        >/dev/null 2>&1 || true
    else
      send_rivet_teams_message \
        "Rivet could not complete approved development job ${job_id} while attempting to ${failure_stage}. No pull request was confirmed, merged, or deployed. Review the Rivet job in Newl Apps." \
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
  --data '{"action":"claim"}' \
  "${NEWL_APPS_URL%/}/api/assistant/openclaw/development-jobs" > "${claim_response_path}"

/usr/bin/python3 - "${claim_response_path}" "${packet_path}" > "${temporary_directory}/claim-state.txt" <<'PY'
import json, sys
with open(sys.argv[1], encoding="utf-8") as handle:
    response = json.load(handle)
data = response.get("data") or {}
print(data.get("state") or "error")
print(data.get("jobId") or "")
print(data.get("leaseToken") or "")
if data.get("packet"):
    with open(sys.argv[2], "w", encoding="utf-8") as handle:
        json.dump(data["packet"], handle, ensure_ascii=False)
PY

claim_state="$(sed -n '1p' "${temporary_directory}/claim-state.txt")"
job_id="$(sed -n '2p' "${temporary_directory}/claim-state.txt")"
lease_token="$(sed -n '3p' "${temporary_directory}/claim-state.txt")"
if [[ "${claim_state}" == "expired" ]]; then
  send_rivet_teams_message \
    "Rivet development job ${job_id} stopped before completion and its lease expired. It was not retried automatically. Review the failed job in Newl Apps, then use Retry Rivet when safe."
  completed=1
  exit 0
fi
if [[ "${claim_state}" == "empty" || "${claim_state}" == "contended" || "${claim_state}" == "invalid" ]]; then
  completed=1
  exit 0
fi
if [[ "${claim_state}" != "claimed" || -z "${job_id}" || -z "${lease_token}" || ! -r "${packet_path}" ]]; then
  echo "Rivet received an unexpected development claim response." >&2
  exit 1
fi

failure_stage="validate the approved development packet"
if ! /usr/bin/python3 - "${packet_path}" "${packet_fields_path}" "${required_context_path}" <<'PY'
import json, os, re, sys
with open(sys.argv[1], encoding="utf-8") as handle:
    packet = json.load(handle)
for field in ("repository", "baseBranch", "branchName", "model", "reasoningEffort", "title", "issueKey"):
    if not isinstance(packet.get(field), str) or not packet[field].strip():
        raise SystemExit(f"Missing packet field: {field}")
if packet["repository"] != os.environ.get("RIVET_GITHUB_REPOSITORY", "newell29/newl-apps"):
    raise SystemExit("The approved repository does not match Rivet's configured repository.")
if not re.fullmatch(r"codex/[A-Za-z0-9][A-Za-z0-9._/-]{2,119}", packet["branchName"]):
    raise SystemExit("The approved Rivet branch is invalid.")
for path in packet.get("requiredContextPaths", []):
    if not isinstance(path, str) or path.startswith("/") or ".." in path.split("/"):
        raise SystemExit("The approved context manifest contains an unsafe path.")
with open(sys.argv[2], "w", encoding="utf-8") as handle:
    handle.write("\t".join([
        packet["repository"],
        packet["baseBranch"],
        packet["branchName"],
        packet["model"],
        packet["reasoningEffort"],
        packet["title"].replace("\n", " ").replace("\t", " ")[:120],
        packet["issueKey"]
    ]) + "\n")
with open(sys.argv[3], "w", encoding="utf-8") as handle:
    for path in packet.get("requiredContextPaths", []):
        handle.write(path + "\n")
PY
then
  exit 1
fi
IFS=$'\t' read -r repository base_branch branch_name codex_model codex_effort title issue_key < "${packet_fields_path}"
if [[ -z "${repository}" || -z "${base_branch}" || -z "${branch_name}" || -z "${codex_model}" || -z "${codex_effort}" || -z "${title}" || -z "${issue_key}" ]]; then
  echo "The approved development packet did not produce complete validated fields." >&2
  exit 1
fi

failure_stage="prepare the isolated Codex branch"
jobs_root="${RIVET_DEVELOPMENT_JOBS_ROOT:-${HOME}/.openclaw/rivet/jobs}"
mkdir -p "${jobs_root}"
job_worktree="${jobs_root}/${job_id}"
if [[ -e "${job_worktree}" ]]; then
  echo "The Rivet job worktree already exists; refusing to overwrite it." >&2
  exit 1
fi
git -C "${rivet_repo_path}" fetch origin "${base_branch}"
while IFS= read -r context_path || [[ -n "${context_path}" ]]; do
  [[ -z "${context_path}" ]] && continue
  if ! git -C "${rivet_repo_path}" cat-file -e "origin/${base_branch}:${context_path}"; then
    echo "Required context is missing from origin/${base_branch}: ${context_path}" >&2
    exit 1
  fi
done < "${required_context_path}"
git -C "${rivet_repo_path}" worktree add -b "${branch_name}" "${job_worktree}" "origin/${base_branch}"
if [[ -d "${rivet_repo_path}/node_modules" && ! -e "${job_worktree}/node_modules" ]]; then
  ln -s "${rivet_repo_path}/node_modules" "${job_worktree}/node_modules"
  node_modules_linked=1
fi

/usr/bin/python3 - "${job_id}" "${lease_token}" "${completion_request_path}" <<'PY'
import json, sys
with open(sys.argv[3], "w", encoding="utf-8") as handle:
    json.dump({
        "action": "progress",
        "jobId": sys.argv[1],
        "leaseToken": sys.argv[2],
        "progressMessage": "Rivet claimed the approved issue and started the isolated Codex build."
    }, handle)
PY
curl --fail --silent --show-error \
  --request POST \
  "${rivet_request_headers[@]}" \
  --header "Content-Type: application/json" \
  --data-binary "@${completion_request_path}" \
  "${NEWL_APPS_URL%/}/api/assistant/openclaw/development-jobs" >/dev/null

failure_stage="run Codex against the approved issue"
schema_path="${runner_directory}/skills/rivet-developer/development-output.schema.json"
{
  printf '%s\n' "You are Rivet's restricted Newl Apps developer operating through Codex."
  printf '%s\n' "This development packet was approved by a Newl administrator. It authorizes only the cohesive issue identified by issueKey."
  printf '%s\n' "Before changing any file, read AGENTS.md completely and read every requiredContextPaths entry in the packet completely."
  printf '%s\n' "For Garland work, those files are the required operating understanding; do not substitute generic WMS assumptions."
  printf '%s\n' "Inspect the existing implementation across UI, API, services, database, permissions, tests, and documentation."
  printf '%s\n' "Similar employee reports have already been grouped. Confirm they share one root cause; do not broaden the task to unrelated feedback."
  printf '%s\n' "Implement the smallest complete fix, add regression tests for the confirmed failure, and update the relevant documentation."
  printf '%s\n' "Preserve tenant filtering and authorization. Never use production credentials or perform production writes."
  printf '%s\n' "Do not merge, deploy, execute a database migration, update Teamship, print, ship/release an order, change permissions, or contact a customer."
  printf '%s\n' "Do not commit, push, or open a pull request; the trusted wrapper performs those actions after validating the result."
  printf '%s\n' "Run the most relevant focused tests and lint/type checks. Report any repository-wide pre-existing failure precisely."
  printf '%s\n' "Your final response must match the supplied JSON schema exactly."
  printf '%s\n\n' "APPROVED_DEVELOPMENT_PACKET_JSON:"
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
  --model "${codex_model}" \
  --config "model_reasoning_effort=\"${codex_effort}\"" \
  --sandbox workspace-write \
  --cd "${job_worktree}" \
  --output-schema "${schema_path}" \
  --output-last-message "${result_path}" \
  --color never \
  -

if [[ ${node_modules_linked} -eq 1 && -L "${job_worktree}/node_modules" ]]; then
  unlink "${job_worktree}/node_modules"
  node_modules_linked=0
fi
if [[ ! -r "${result_path}" ]]; then
  echo "Codex did not return the required structured result." >&2
  exit 1
fi

failure_stage="validate and commit the Codex changes"
git -C "${job_worktree}" diff --check
{
  git -C "${job_worktree}" diff --name-only
  git -C "${job_worktree}" ls-files --others --exclude-standard
} | sort -u > "${changed_paths_file}"
if [[ ! -s "${changed_paths_file}" ]]; then
  echo "Codex completed without producing an implementation change." >&2
  exit 1
fi
/usr/bin/python3 - "${changed_paths_file}" <<'PY'
import os, re, sys
blocked = re.compile(r"(^|/)(?:\.env(?:\.|$)|node_modules(?:/|$)|outputs?(?:/|$)|.*\.(?:pem|key|p12|pfx)$)", re.I)
with open(sys.argv[1], encoding="utf-8") as handle:
    paths = [line.strip() for line in handle if line.strip()]
for path in paths:
    if path.startswith("/") or ".." in path.split("/") or blocked.search(path):
        raise SystemExit(f"Codex produced a blocked path: {path}")
PY

git -C "${job_worktree}" add -A
git -C "${job_worktree}" commit -m "${title}"
commit_sha="$(git -C "${job_worktree}" rev-parse HEAD)"

failure_stage="push the isolated branch"
git -C "${job_worktree}" push -u origin "${branch_name}"

failure_stage="open the reviewed pull request"
/usr/bin/python3 - "${packet_path}" "${result_path}" "${commit_sha}" "${pull_request_path}" <<'PY'
import json, sys
with open(sys.argv[1], encoding="utf-8") as handle:
    packet = json.load(handle)
with open(sys.argv[2], encoding="utf-8") as handle:
    result = json.load(handle)
body = "\n".join([
    "## Approved Rivet development job",
    "",
    f"- Job: `{packet['jobId']}`",
    f"- Issue key: `{packet['issueKey']}`",
    f"- Approved feedback items: {len(packet.get('sourceFeedback', []))}",
    "",
    "## What changed",
    "",
    result["summary"],
    "",
    "## Root cause",
    "",
    result["rootCause"],
    "",
    "## Files changed",
    "",
    *[f"- `{item}`" for item in result["filesChanged"]],
    "",
    "## Verification",
    "",
    *[f"- {item}" for item in result["tests"]],
    "",
    "## Known limitations",
    "",
    *([f"- {item}" for item in result["knownLimitations"]] or ["- None reported."]),
    "",
    "## Business questions",
    "",
    *([f"- {item}" for item in result["businessQuestions"]] or ["- None."]),
    "",
    "## Safety",
    "",
    "Rivet prepared this branch and pull request after explicit approval. It did not merge, deploy, execute a migration, update Teamship, print, release an order, change permissions, or contact a customer.",
    "",
    f"Commit: `{sys.argv[3]}`"
])
with open(sys.argv[4], "w", encoding="utf-8") as handle:
    json.dump({
        "title": packet["title"],
        "head": packet["branchName"],
        "base": packet["baseBranch"],
        "body": body,
        "draft": True,
        "maintainer_can_modify": True
    }, handle)
PY
curl --fail --silent --show-error \
  --request POST \
  --header "Accept: application/vnd.github+json" \
  --header "Authorization: Bearer ${RIVET_GITHUB_TOKEN}" \
  --header "Content-Type: application/json" \
  --header "X-GitHub-Api-Version: 2022-11-28" \
  --data-binary "@${pull_request_path}" \
  "https://api.github.com/repos/${repository}/pulls" > "${pull_response_path}"
pull_request_url="$(/usr/bin/python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["html_url"])' "${pull_response_path}")"

/usr/bin/python3 - "${job_id}" "${lease_token}" "${branch_name}" "${commit_sha}" "${pull_request_url}" "${result_path}" "${completion_request_path}" <<'PY'
import json, sys
with open(sys.argv[6], encoding="utf-8") as handle:
    result = json.load(handle)
with open(sys.argv[7], "w", encoding="utf-8") as handle:
    json.dump({
        "action": "complete",
        "jobId": sys.argv[1],
        "leaseToken": sys.argv[2],
        "branchName": sys.argv[3],
        "commitSha": sys.argv[4],
        "pullRequestUrls": [sys.argv[5]],
        "summary": result["summary"],
        "tests": result["tests"],
        "knownLimitations": result["knownLimitations"]
    }, handle)
PY
curl --fail --silent --show-error \
  --request POST \
  "${rivet_request_headers[@]}" \
  --header "Content-Type: application/json" \
  --data-binary "@${completion_request_path}" \
  "${NEWL_APPS_URL%/}/api/assistant/openclaw/development-jobs" > "${completion_response_path}"

teams_message="$(/usr/bin/python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["data"]["teamsMessage"])' "${completion_response_path}")"
send_rivet_teams_message "${teams_message}"

failure_stage="clean up the completed worktree"
git -C "${rivet_repo_path}" worktree remove "${job_worktree}"
completed=1
cleanup
trap - EXIT
exit 0
