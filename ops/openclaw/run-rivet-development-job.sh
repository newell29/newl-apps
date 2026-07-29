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
review_result_path="${temporary_directory}/codex-review-result.json"
remediation_result_path="${temporary_directory}/codex-remediation-result.json"
review_request_path="${temporary_directory}/review-request.json"
preflight_report_path="${temporary_directory}/preflight-report.json"
sibling_report_path="${temporary_directory}/sibling-report.json"
open_pulls_path="${temporary_directory}/open-pulls.json"
open_pull_numbers_path="${temporary_directory}/open-pull-numbers.txt"
pull_files_path="${temporary_directory}/pull-files.json"
diff_path="${temporary_directory}/review.diff"
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
pull_request_number=""
commit_sha=""
review_attempt=0
autofix_attempt=0
max_autofix_attempts=2
failure_stage="claim the next approved suggestion"

cleanup() {
  rm -rf "${temporary_directory}"
}

write_pull_request_payload() {
  local mode="$1"
  /usr/bin/python3 - \
    "${packet_path}" \
    "${result_path}" \
    "${commit_sha}" \
    "${pull_request_path}" \
    "${mode}" \
    "${review_result_path}" \
    "${changed_paths_file}" <<'PY'
import json, os, sys
with open(sys.argv[1], encoding="utf-8") as handle:
    packet = json.load(handle)
with open(sys.argv[2], encoding="utf-8") as handle:
    result = json.load(handle)
review = None
if os.path.isfile(sys.argv[6]):
    with open(sys.argv[6], encoding="utf-8") as handle:
        review = json.load(handle)
with open(sys.argv[7], encoding="utf-8") as handle:
    changed_paths = [line.strip() for line in handle if line.strip()]
review_lines = [
    "## Independent Codex review",
    "",
    (
        f"- Verdict: **{review['verdict']}**"
        if review
        else "- Verdict: **PENDING**"
    ),
    *(
        [
            f"- Risk: {review['riskLevel']}",
            f"- Summary: {review['summary']}",
        ]
        if review
        else ["- Rivet will not mark this PR ready until a fresh read-only Codex review passes the exact commit."]
    ),
]
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
    *[f"- `{item}`" for item in changed_paths],
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
    *review_lines,
    "",
    "## Safety",
    "",
    "Rivet prepared this branch and pull request after explicit approval. It did not merge, deploy, execute a migration, update Teamship, print, release an order, change permissions, or contact a customer.",
    "",
    f"Commit: `{sys.argv[3]}`"
])
payload = {"body": body}
if sys.argv[5] == "create":
    payload.update({
        "title": packet["title"],
        "head": packet["branchName"],
        "base": packet["baseBranch"],
        "draft": True,
        "maintainer_can_modify": True
    })
with open(sys.argv[4], "w", encoding="utf-8") as handle:
    json.dump(payload, handle)
PY
}

report_failure() {
  local exit_status=$?
  trap - EXIT
  if [[ ${exit_status} -ne 0 && ${completed} -eq 0 && -n "${job_id}" && -n "${lease_token}" ]]; then
    /usr/bin/python3 - \
      "${job_id}" \
      "${lease_token}" \
      "${failure_stage}" \
      "${completion_request_path}" \
      "${branch_name:-}" \
      "${commit_sha}" \
      "${pull_request_url}" <<'PY'
import json, sys
with open(sys.argv[4], "w", encoding="utf-8") as handle:
    payload = {
        "action": "fail",
        "jobId": sys.argv[1],
        "leaseToken": sys.argv[2],
        "errorCode": "RIVET_WORKER_FAILED",
        "errorMessage": f"Rivet failed while attempting to {sys.argv[3]}. Review the protected local worker log."
    }
    if sys.argv[5]:
        payload["branchName"] = sys.argv[5]
    if sys.argv[6]:
        payload["commitSha"] = sys.argv[6]
    if sys.argv[7]:
        payload["pullRequestUrls"] = [sys.argv[7]]
    json.dump(payload, handle)
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
  printf '%s\n' "Never copy production customer, order, address, email, serial, credential, token, or other live data from the packet into code, tests, fixtures, documentation, commit messages, or your structured result. Use clearly synthetic reserved examples."
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

while true; do
  review_attempt=$((review_attempt + 1))
  review_started_at="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  failure_stage="prepare independent Codex review round ${review_attempt}"

  git -C "${job_worktree}" fetch origin "${base_branch}"
  git -C "${job_worktree}" diff --check "origin/${base_branch}...HEAD"
  git -C "${job_worktree}" diff --name-only "origin/${base_branch}...HEAD" | sort -u > "${changed_paths_file}"
  git -C "${job_worktree}" diff --unified=0 --no-color "origin/${base_branch}...HEAD" > "${diff_path}"
  # Build the prospective PR payload for read-only review without opening a PR.
  write_pull_request_payload "create"

  mergeable_with_main=1
  if ! git -C "${job_worktree}" merge-tree --write-tree "origin/${base_branch}" HEAD \
    > "${temporary_directory}/merge-tree.txt" 2>&1; then
    mergeable_with_main=0
  fi

  /usr/bin/python3 \
    "${runner_directory}/rivet-review-preflight.py" \
    "${diff_path}" \
    "${preflight_report_path}" \
    "${mergeable_with_main}"

  curl --fail --silent --show-error \
    --request GET \
    --header "Accept: application/vnd.github+json" \
    --header "Authorization: Bearer ${RIVET_GITHUB_TOKEN}" \
    --header "X-GitHub-Api-Version: 2022-11-28" \
    "https://api.github.com/repos/${repository}/pulls?state=open&base=${base_branch}&per_page=50" \
    > "${open_pulls_path}"
  /usr/bin/python3 - \
    "${open_pulls_path}" \
    "0" \
    "${open_pull_numbers_path}" \
    "${sibling_report_path}" <<'PY'
import json, sys
with open(sys.argv[1], encoding="utf-8") as handle:
    pulls = json.load(handle)
current = int(sys.argv[2])
numbers = [
    item["number"]
    for item in pulls
    if isinstance(item, dict) and isinstance(item.get("number"), int) and item["number"] != current
][:25]
with open(sys.argv[3], "w", encoding="utf-8") as handle:
    handle.write("\n".join(str(number) for number in numbers))
with open(sys.argv[4], "w", encoding="utf-8") as handle:
    json.dump({"checkedPullRequests": numbers, "overlaps": []}, handle)
PY
  while IFS= read -r sibling_number || [[ -n "${sibling_number}" ]]; do
    [[ -z "${sibling_number}" ]] && continue
    curl --fail --silent --show-error \
      --request GET \
      --header "Accept: application/vnd.github+json" \
      --header "Authorization: Bearer ${RIVET_GITHUB_TOKEN}" \
      --header "X-GitHub-Api-Version: 2022-11-28" \
      "https://api.github.com/repos/${repository}/pulls/${sibling_number}/files?per_page=100" \
      > "${pull_files_path}"
    /usr/bin/python3 - \
      "${changed_paths_file}" \
      "${pull_files_path}" \
      "${sibling_report_path}" \
      "${sibling_number}" <<'PY'
import json, sys
with open(sys.argv[1], encoding="utf-8") as handle:
    changed = {line.strip() for line in handle if line.strip()}
with open(sys.argv[2], encoding="utf-8") as handle:
    files = {
        item.get("filename")
        for item in json.load(handle)
        if isinstance(item, dict) and isinstance(item.get("filename"), str)
    }
with open(sys.argv[3], encoding="utf-8") as handle:
    report = json.load(handle)
overlap = sorted(changed & files)
if overlap:
    report["overlaps"].append({
        "pullRequestNumber": int(sys.argv[4]),
        "paths": overlap
    })
with open(sys.argv[3], "w", encoding="utf-8") as handle:
    json.dump(report, handle)
PY
  done < "${open_pull_numbers_path}"

  preflight_status="$(/usr/bin/python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["status"])' "${preflight_report_path}")"
  if [[ "${preflight_status}" != "PASS" ]]; then
    /usr/bin/python3 - \
      "${preflight_report_path}" \
      "${review_result_path}" <<'PY'
import json, sys
with open(sys.argv[1], encoding="utf-8") as handle:
    preflight = json.load(handle)
with open(sys.argv[2], "w", encoding="utf-8") as handle:
    json.dump({
        "verdict": preflight["status"],
        "riskLevel": "CRITICAL" if any(item["severity"] == "CRITICAL" for item in preflight["findings"]) else "HIGH",
        "summary": (
            "Deterministic Rivet preflight found safe corrections."
            if preflight["status"] == "NEEDS_CHANGES"
            else "Deterministic Rivet preflight blocked the independent review."
        ),
        "findings": preflight["findings"],
        "ticketCoverage": {"implemented": [], "missing": [], "outOfScope": []},
        "checks": {
            "privacy": {
                "status": (
                    "FAIL"
                    if any(item["category"] in {"PRIVACY", "SECRETS"} for item in preflight["findings"])
                    else "PASS"
                ),
                "note": "High-confidence protected-data and credential patterns were checked."
            },
            "tenantIsolation": {"status": "NOT_APPLICABLE", "note": "Not evaluated because preflight blocked the review."},
            "approvalBoundaries": {"status": "NOT_APPLICABLE", "note": "Not evaluated because preflight blocked the review."},
            "tests": {"status": "NOT_APPLICABLE", "note": "Not evaluated because preflight blocked the review."},
            "documentation": {"status": "NOT_APPLICABLE", "note": "Not evaluated because preflight blocked the review."},
            "mergeability": {
                "status": "PASS" if preflight["mergeableWithCurrentMain"] else "FAIL",
                "note": "Current-main mergeability was checked deterministically."
            },
            "prBodyAccuracy": {"status": "NOT_APPLICABLE", "note": "Not evaluated because preflight blocked the review."}
        },
        "tests": {"required": [], "passed": [], "knownFailures": []},
        "businessQuestions": []
    }, handle)
PY
  else
    failure_stage="run independent read-only Codex review round ${review_attempt}"
    review_schema_path="${runner_directory}/skills/rivet-developer/review-output.schema.json"
    {
      /bin/cat "${runner_directory}/prompts/rivet-code-review.md"
      printf '\nAPPROVED_DEVELOPMENT_PACKET_JSON:\n'
      /bin/cat "${packet_path}"
      printf '\nDETERMINISTIC_PREFLIGHT_JSON:\n'
      /bin/cat "${preflight_report_path}"
      printf '\nOPEN_SIBLING_PULL_REQUEST_OVERLAPS_JSON:\n'
      /bin/cat "${sibling_report_path}"
      printf '\nCURRENT_PULL_REQUEST_PAYLOAD_JSON:\n'
      /bin/cat "${pull_request_path}"
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
      --sandbox read-only \
      --cd "${job_worktree}" \
      --output-schema "${review_schema_path}" \
      --output-last-message "${review_result_path}" \
      --color never \
      -
  fi

  if [[ ! -r "${review_result_path}" ]]; then
    echo "The independent Codex reviewer did not return the required structured result." >&2
    exit 1
  fi
  /usr/bin/python3 - "${review_result_path}" <<'PY'
import json, sys
with open(sys.argv[1], encoding="utf-8") as handle:
    result = json.load(handle)
verdict = result.get("verdict")
findings = result.get("findings") or []
questions = result.get("businessQuestions") or []
coverage = result.get("ticketCoverage") or {}
if verdict == "PASS" and (
    findings or questions or coverage.get("missing") or coverage.get("outOfScope")
):
    raise SystemExit("A PASS review cannot contain unresolved findings, questions, missing scope, or out-of-scope changes.")
if verdict in {"NEEDS_CHANGES", "BLOCKED"} and not findings and not questions:
    raise SystemExit("A non-passing review must contain a finding or business question.")
PY

  /usr/bin/python3 - \
    "${job_id}" \
    "${lease_token}" \
    "${commit_sha}" \
    "${review_attempt}" \
    "${review_started_at}" \
    "${review_result_path}" \
    "${review_request_path}" <<'PY'
import json, sys
with open(sys.argv[6], encoding="utf-8") as handle:
    review = json.load(handle)
with open(sys.argv[7], "w", encoding="utf-8") as handle:
    json.dump({
        "action": "review",
        "jobId": sys.argv[1],
        "leaseToken": sys.argv[2],
        "commitSha": sys.argv[3],
        "reviewAttempt": int(sys.argv[4]),
        "reviewStartedAt": sys.argv[5],
        "reviewVerdict": review["verdict"],
        "reviewRiskLevel": review["riskLevel"],
        "reviewSummary": review["summary"],
        "reviewFindings": review["findings"],
        "ticketCoverage": review["ticketCoverage"],
        "reviewChecks": review["checks"],
        "reviewTests": review["tests"],
        "businessQuestions": review["businessQuestions"]
    }, handle)
PY
  curl --fail --silent --show-error \
    --request POST \
    "${rivet_request_headers[@]}" \
    --header "Content-Type: application/json" \
    --data-binary "@${review_request_path}" \
    "${NEWL_APPS_URL%/}/api/assistant/openclaw/development-jobs" >/dev/null

  /usr/bin/python3 - "${review_result_path}" > "${temporary_directory}/review-decision.txt" <<'PY'
import json, sys
with open(sys.argv[1], encoding="utf-8") as handle:
    review = json.load(handle)
findings = review.get("findings") or []
questions = review.get("businessQuestions") or []
can_fix = (
    review.get("verdict") == "NEEDS_CHANGES"
    and bool(findings)
    and not questions
    and all(
        item.get("autoFixable") is True
        and item.get("businessDecisionRequired") is not True
        for item in findings
    )
)
print(review.get("verdict") or "BLOCKED")
print("1" if can_fix else "0")
print(" ".join(str(review.get("summary") or "").split())[:900])
PY
  review_verdict="$(sed -n '1p' "${temporary_directory}/review-decision.txt")"
  can_auto_fix="$(sed -n '2p' "${temporary_directory}/review-decision.txt")"
  review_summary="$(sed -n '3p' "${temporary_directory}/review-decision.txt")"

  if [[ "${review_verdict}" == "PASS" ]]; then
    failure_stage="open the independently reviewed draft pull request"
    write_pull_request_payload "create"
    curl --fail --silent --show-error \
      --request POST \
      --header "Accept: application/vnd.github+json" \
      --header "Authorization: Bearer ${RIVET_GITHUB_TOKEN}" \
      --header "Content-Type: application/json" \
      --header "X-GitHub-Api-Version: 2022-11-28" \
      --data-binary "@${pull_request_path}" \
      "https://api.github.com/repos/${repository}/pulls" > "${pull_response_path}"
    pull_request_url="$(/usr/bin/python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["html_url"])' "${pull_response_path}")"
    pull_request_number="$(/usr/bin/python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["number"])' "${pull_response_path}")"
    break
  fi

  if [[ "${can_auto_fix}" == "1" && ${autofix_attempt} -lt ${max_autofix_attempts} ]]; then
    autofix_attempt=$((autofix_attempt + 1))
    failure_stage="apply safe Rivet review corrections ${autofix_attempt} of ${max_autofix_attempts}"

    /usr/bin/python3 - "${job_id}" "${lease_token}" "${autofix_attempt}" "${completion_request_path}" <<'PY'
import json, sys
with open(sys.argv[4], "w", encoding="utf-8") as handle:
    json.dump({
        "action": "progress",
        "jobId": sys.argv[1],
        "leaseToken": sys.argv[2],
        "progressMessage": f"Rivet is correcting safe independent-review findings (attempt {sys.argv[3]} of 2)."
    }, handle)
PY
    curl --fail --silent --show-error \
      --request POST \
      "${rivet_request_headers[@]}" \
      --header "Content-Type: application/json" \
      --data-binary "@${completion_request_path}" \
      "${NEWL_APPS_URL%/}/api/assistant/openclaw/development-jobs" >/dev/null

    if [[ -d "${rivet_repo_path}/node_modules" && ! -e "${job_worktree}/node_modules" ]]; then
      ln -s "${rivet_repo_path}/node_modules" "${job_worktree}/node_modules"
      node_modules_linked=1
    fi
    {
      /bin/cat "${runner_directory}/prompts/rivet-review-remediation.md"
      printf '\nAPPROVED_DEVELOPMENT_PACKET_JSON:\n'
      /bin/cat "${packet_path}"
      printf '\nINDEPENDENT_REVIEW_JSON:\n'
      /bin/cat "${review_result_path}"
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
      --output-last-message "${remediation_result_path}" \
      --color never \
      -
    if [[ ${node_modules_linked} -eq 1 && -L "${job_worktree}/node_modules" ]]; then
      unlink "${job_worktree}/node_modules"
      node_modules_linked=0
    fi
    if [[ ! -r "${remediation_result_path}" ]]; then
      echo "Codex did not return the required remediation result." >&2
      exit 1
    fi

    git -C "${job_worktree}" diff --check
    {
      git -C "${job_worktree}" diff --name-only
      git -C "${job_worktree}" ls-files --others --exclude-standard
    } | sort -u > "${changed_paths_file}"
    if [[ ! -s "${changed_paths_file}" ]]; then
      echo "Codex reported remediation without changing the branch." >&2
      exit 1
    fi
    /usr/bin/python3 - "${changed_paths_file}" <<'PY'
import re, sys
blocked = re.compile(r"(^|/)(?:\.env(?:\.|$)|node_modules(?:/|$)|outputs?(?:/|$)|.*\.(?:pem|key|p12|pfx)$)", re.I)
with open(sys.argv[1], encoding="utf-8") as handle:
    paths = [line.strip() for line in handle if line.strip()]
for path in paths:
    if path.startswith("/") or ".." in path.split("/") or blocked.search(path):
        raise SystemExit(f"Codex produced a blocked remediation path: {path}")
PY

    /bin/cp "${remediation_result_path}" "${result_path}"
    git -C "${job_worktree}" add -A
    git -C "${job_worktree}" commit -m "Address Rivet review findings (${autofix_attempt})"
    commit_sha="$(git -C "${job_worktree}" rev-parse HEAD)"
    git -C "${job_worktree}" push origin "${branch_name}"

    git -C "${job_worktree}" diff --name-only "origin/${base_branch}...HEAD" | sort -u > "${changed_paths_file}"
    unlink "${review_result_path}"
    continue
  fi

  failure_stage="record the independent review blocker"
  /usr/bin/python3 - \
    "${job_id}" \
    "${lease_token}" \
    "${branch_name}" \
    "${commit_sha}" \
    "${review_summary}" \
    "${completion_request_path}" <<'PY'
import json, sys
with open(sys.argv[6], "w", encoding="utf-8") as handle:
    json.dump({
        "action": "fail",
        "jobId": sys.argv[1],
        "leaseToken": sys.argv[2],
        "branchName": sys.argv[3],
        "commitSha": sys.argv[4],
        "errorCode": "RIVET_REVIEW_BLOCKED",
        "errorMessage": f"Independent Codex review blocked this branch before PR creation: {sys.argv[5]}"
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
  completed=1
  cleanup
  trap - EXIT
  exit 0
done

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
