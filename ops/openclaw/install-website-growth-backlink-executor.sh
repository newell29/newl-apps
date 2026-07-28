#!/bin/zsh

set -euo pipefail

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

script_directory="${0:A:h}"
repo_path="${script_directory:h:h}"
plugin_path="${script_directory}/plugins/newl-website-growth"
skill_path="${script_directory}/skills/website-growth-backlink-executor"
executor_runner_path="${script_directory}/run-website-growth-backlink-executor.sh"
failure_monitor_path="${script_directory}/run-rivet-backlink-failure-monitor.sh"
scout_env_file="${WEBSITE_GROWTH_SCOUT_ENV_FILE:-${HOME}/.openclaw/agents/scout/.env}"
profile_source="${WEBSITE_GROWTH_BACKLINK_PROFILE_SOURCE:-}"
profile_target="${HOME}/.openclaw/agents/scout/backlink-business-profile.json"
scout_workspace="${HOME}/.openclaw/workspace-scout"
scout_agent_directory="${HOME}/.openclaw/agents/scout/agent"
temporary_directory="$(mktemp -d)"
executor_install_result="${temporary_directory}/executor-install-result.json"
cron_snapshot="${temporary_directory}/cron-snapshot.json"
cleanup() {
  rm -rf "${temporary_directory}"
}
trap cleanup EXIT

if [[ ! -r "${scout_env_file}" ]]; then
  echo "The protected Website Growth Scout environment file is not readable." >&2
  exit 1
fi
if [[ -z "${profile_source}" || ! -r "${profile_source}" ]]; then
  echo "Set WEBSITE_GROWTH_BACKLINK_PROFILE_SOURCE to the owner-approved profile JSON." >&2
  exit 1
fi

while IFS= read -r env_line || [[ -n "${env_line}" ]]; do
  [[ -z "${env_line}" || "${env_line}" == \#* || "${env_line}" != *=* ]] && continue
  env_name="${env_line%%=*}"
  env_value="${env_line#*=}"
  case "${env_name}" in
    NEWL_APPS_URL|WEBSITE_GROWTH_TEAMS_TARGET|WEBSITE_GROWTH_TEAMS_ACCOUNT)
      if [[ "${env_value}" == \"*\" && "${env_value}" == *\" ]]; then
        env_value="${env_value:1:-1}"
      elif [[ "${env_value}" == \'*\' && "${env_value}" == *\' ]]; then
        env_value="${env_value:1:-1}"
      fi
      export "${env_name}=${env_value}"
      ;;
  esac
done < "${scout_env_file}"

: "${NEWL_APPS_URL:?NEWL_APPS_URL is required}"
: "${WEBSITE_GROWTH_TEAMS_TARGET:?WEBSITE_GROWTH_TEAMS_TARGET is required}"

if [[ "${NEWL_APPS_URL}" != https://* ]]; then
  echo "NEWL_APPS_URL must use HTTPS." >&2
  exit 1
fi
if ! grep -Eq '^OPENCLAW_WEBSITE_GROWTH_BACKLINK_TOKEN=.+' "${HOME}/.openclaw/.env"; then
  echo "OPENCLAW_WEBSITE_GROWTH_BACKLINK_TOKEN must be configured in the protected OpenClaw gateway environment." >&2
  exit 1
fi
if ! grep -Eq '^NEWL_DIRECTORY_PASSWORD_MASTER_V1=.+' "${HOME}/.openclaw/.env"; then
  echo "NEWL_DIRECTORY_PASSWORD_MASTER_V1 must be configured in the protected OpenClaw gateway environment." >&2
  exit 1
fi

node -e '
const fs = require("node:fs");
const value = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
if (value.status !== "OWNER_APPROVED_2026-07-24") throw new Error("Business profile is not owner approved.");
if (value.outreachMailbox !== "partnerships@newlgroup.com") throw new Error("Unexpected outreach mailbox.");
if (value.outreachPolicy?.manualOpportunityApproval !== true) throw new Error("Manual opportunity approval must remain enabled.");
if (value.submissionRules?.allowPayment !== false) throw new Error("Payment must remain disabled.");
' "${profile_source}"

mkdir -p "${HOME}/.openclaw/agents/scout"
if [[ "${profile_source:A}" == "${profile_target:A}" ]]; then
  chmod 600 "${profile_target}"
else
  install -m 600 "${profile_source}" "${profile_target}"
fi

if ! openclaw agents list --json | grep -Eq '"id"[[:space:]]*:[[:space:]]*"scout"'; then
  openclaw agents add scout \
    --workspace "${scout_workspace}" \
    --agent-dir "${scout_agent_directory}" \
    --model "openai/gpt-5.6-sol" \
    --non-interactive
fi

(cd "${plugin_path}" && npm ci && npm run plugin:validate)

plugin_config="$(node -e '
console.log(JSON.stringify({
  enabled: true,
  config: {
    baseUrl: process.argv[1],
    backlinkTokenEnv: "OPENCLAW_WEBSITE_GROWTH_BACKLINK_TOKEN",
    directoryPasswordMasterEnv: "NEWL_DIRECTORY_PASSWORD_MASTER_V1",
    businessProfilePath: process.argv[2]
  }
}));
' "${NEWL_APPS_URL}" "${profile_target}")"
openclaw config set plugins.entries.newl-website-growth "${plugin_config}" --strict-json
openclaw plugins install --force "${plugin_path}"

openclaw skills install "${skill_path}" \
  --agent scout \
  --as website-growth-backlink-executor \
  --force

scout_agent_index="$(openclaw config get agents.list --json | /usr/bin/python3 -c '
import json, sys
agents = json.load(sys.stdin)
for index, agent in enumerate(agents):
    if agent.get("id") == "scout":
        print(index)
        break
')"
if [[ -z "${scout_agent_index}" ]]; then
  echo "The Scout agent could not be located for tool-policy enforcement." >&2
  exit 1
fi
scout_tools_policy="$(node -e '
console.log(JSON.stringify({
  profile: "minimal",
  allow: [
    "browser",
    "newl_backlink_business_profile",
    "newl_backlink_sync_replies",
    "newl_backlink_sync_directory_verifications",
    "newl_backlink_follow_ups",
    "newl_backlink_verification",
    "newl_backlink_claim",
    "newl_backlink_send_email",
    "newl_backlink_fill_directory_credentials",
    "newl_backlink_report"
  ],
  deny: ["exec", "bash", "read", "write", "edit", "apply_patch", "process"]
}));
')"
openclaw config set \
  "agents.list[${scout_agent_index}].tools" \
  "${scout_tools_policy}" \
  --strict-json

executor_argv="$(node -e '
console.log(JSON.stringify(["/bin/zsh", process.argv[1]]));
' "${executor_runner_path}")"
openclaw cron add \
  --name "NEWL Website Growth Backlink Outreach" \
  --display-name "NEWL Website Growth Backlink Outreach" \
  --description "Process only approved free backlink outreach, follow-ups and verification; always send the deterministic owner summary." \
  --declaration-key "newl.website-growth.backlink-outreach.weekday.v1" \
  --cron "0 11 * * 1-5" \
  --tz "America/Toronto" \
  --exact \
  --command-argv "${executor_argv}" \
  --command-env "WEBSITE_GROWTH_SCOUT_ENV_FILE=${scout_env_file}" \
  --command-env "OPENCLAW_GATEWAY_ENV_FILE=${HOME}/.openclaw/.env" \
  --command-cwd "${repo_path}" \
  --timeout-seconds 1800 \
  --no-deliver \
  --disabled \
  --json > "${executor_install_result}"

canonical_executor_job_id="$(/usr/bin/python3 - "${executor_install_result}" <<'PY'
import json, sys
with open(sys.argv[1], encoding="utf-8") as handle:
    payload = json.load(handle)
job = payload.get("job") if isinstance(payload, dict) else None
job = job if isinstance(job, dict) else payload
if not isinstance(job, dict) or job.get("id") in (None, ""):
    raise SystemExit("OpenClaw did not return the installed backlink executor job.")
if (job.get("payload") or {}).get("kind") != "command":
    raise SystemExit("The installed backlink executor is not a command job.")
print(job["id"])
PY
)"

openclaw cron list --json > "${cron_snapshot}"
while IFS= read -r stale_job_id; do
  [[ -z "${stale_job_id}" ]] && continue
  openclaw cron rm "${stale_job_id}"
done < <(/usr/bin/python3 - "${cron_snapshot}" "${canonical_executor_job_id}" <<'PY'
import json, sys
with open(sys.argv[1], encoding="utf-8") as handle:
    payload = json.load(handle)
jobs = payload.get("jobs") if isinstance(payload, dict) else payload
jobs = jobs if isinstance(jobs, list) else []
for job in jobs:
    if (
        job.get("declarationKey")
        == "newl.website-growth.backlink-outreach.weekday.v1"
        and job.get("id")
        and job.get("id") != sys.argv[2]
    ):
        print(job["id"])
PY
)

failure_monitor_argv="$(node -e '
console.log(JSON.stringify(["/bin/zsh", process.argv[1]]));
' "${failure_monitor_path}")"
openclaw cron add \
  --name "NEWL Rivet Backlink Failure Monitor" \
  --display-name "NEWL Rivet Backlink Failure Monitor" \
  --description "Record failed backlink runs, start approved Rivet code triage, notify the owner and stop repeated identical failures." \
  --declaration-key "newl.rivet.website-growth.backlink-failure-monitor.v1" \
  --every "15m" \
  --command-argv "${failure_monitor_argv}" \
  --command-env "WEBSITE_GROWTH_SCOUT_ENV_FILE=${scout_env_file}" \
  --command-env "OPENCLAW_GATEWAY_ENV_FILE=${HOME}/.openclaw/.env" \
  --command-cwd "${repo_path}" \
  --timeout-seconds 120 \
  --no-deliver

echo "Installed the dedicated Scout agent, Website Growth plugin, protected profile, Rivet failure monitor and disabled weekday outreach job."
echo "After the supervised send succeeds, run ops/openclaw/enable-website-growth-backlink-executor.sh once."
