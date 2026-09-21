#!/bin/zsh

set -euo pipefail

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

script_directory="${0:A:h}"
source "${script_directory}/lib/website-growth-scout-runtime.zsh"

openclaw_command="${OPENCLAW_BIN:-openclaw}"
scout_env_file="${WEBSITE_GROWTH_SCOUT_ENV_FILE:-${HOME}/.openclaw/agents/scout/.env}"
gateway_env_file="${OPENCLAW_GATEWAY_ENV_FILE:-${HOME}/.openclaw/.env}"
profile_path="${WEBSITE_GROWTH_BACKLINK_PROFILE_PATH:-${HOME}/.openclaw/agents/scout/backlink-business-profile.json}"
temporary_directory="$(mktemp -d)"
cleanup() {
  rm -rf "${temporary_directory}"
}
trap cleanup EXIT

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
if [[ "${NEWL_APPS_URL}" != https://* ]]; then
  echo "NEWL_APPS_URL must use HTTPS." >&2
  exit 1
fi
if ! grep -Eq '^NEWL_DIRECTORY_PASSWORD_MASTER_V1=.+' "${gateway_env_file}"; then
  echo "NEWL_DIRECTORY_PASSWORD_MASTER_V1 must be configured in the protected OpenClaw gateway environment." >&2
  exit 1
fi
if [[ ! -r "${profile_path}" ]]; then
  echo "The owner-approved backlink business profile is not readable." >&2
  exit 1
fi

model_status_path="${temporary_directory}/model-status.json"
plugin_path="${temporary_directory}/plugin.json"
skill_path="${temporary_directory}/skill.json"
agents_path="${temporary_directory}/agents.json"
cron_path="${temporary_directory}/cron.json"

"${openclaw_command}" models status --agent scout --json > "${model_status_path}"
/usr/bin/python3 "${script_directory}/validate-scout-openai-auth.py" "${model_status_path}"
"${openclaw_command}" plugins inspect newl-website-growth --json --runtime > "${plugin_path}"
"${openclaw_command}" skills info website-growth-backlink-executor --agent scout --json > "${skill_path}"
"${openclaw_command}" config get agents.list --json > "${agents_path}"
"${openclaw_command}" cron list --all --json > "${cron_path}"

schedule_state="$(/usr/bin/python3 - \
  "${plugin_path}" \
  "${skill_path}" \
  "${agents_path}" \
  "${cron_path}" \
  "${profile_path}" <<'PY'
import json
import sys


def load(path):
    with open(path, encoding="utf-8") as handle:
        return json.load(handle)


plugin_payload, skill, agents, cron_payload, profile = map(load, sys.argv[1:])
plugin = plugin_payload.get("plugin") if isinstance(plugin_payload, dict) else None
if not isinstance(plugin, dict) or plugin.get("status") != "loaded":
    raise SystemExit("The Newl Website Growth plugin is not loaded.")
required_tools = {
    "newl_backlink_business_profile",
    "newl_backlink_claim",
    "newl_backlink_follow_ups",
    "newl_backlink_verification",
    "newl_backlink_sync_replies",
    "newl_backlink_sync_directory_verifications",
    "newl_backlink_summary",
    "newl_backlink_send_email",
    "newl_backlink_send_follow_up",
    "newl_backlink_fill_directory_credentials",
    "newl_backlink_report",
}
if not required_tools.issubset(set(plugin.get("toolNames") or [])):
    raise SystemExit("The Newl Website Growth plugin is missing required tools.")
if not isinstance(skill, dict) or skill.get("eligible") is not True or skill.get("modelVisible") is not True:
    raise SystemExit("The backlink executor skill is not eligible and model-visible for Scout.")

if not isinstance(agents, list):
    raise SystemExit("The OpenClaw agent configuration was not a list.")
scout = next((agent for agent in agents if isinstance(agent, dict) and agent.get("id") == "scout"), None)
tools = (scout or {}).get("tools") or {}
if tools.get("profile") != "minimal":
    raise SystemExit("Scout must use the minimal tool profile.")
required_allow = {
    "browser",
    "newl_backlink_business_profile",
    "newl_backlink_sync_replies",
    "newl_backlink_sync_directory_verifications",
    "newl_backlink_follow_ups",
    "newl_backlink_verification",
    "newl_backlink_claim",
    "newl_backlink_send_email",
    "newl_backlink_send_follow_up",
    "newl_backlink_fill_directory_credentials",
    "newl_backlink_report",
}
required_deny = {"exec", "bash", "read", "write", "edit", "apply_patch", "process"}
if not required_allow.issubset(set(tools.get("alsoAllow") or [])):
    raise SystemExit("Scout is missing one or more required constrained tools.")
if not required_deny.issubset(set(tools.get("deny") or [])):
    raise SystemExit("Scout is missing one or more required tool denials.")

if not isinstance(profile, dict) or not str(profile.get("status") or "").startswith("OWNER_APPROVED_"):
    raise SystemExit("The backlink business profile is not owner approved.")
if profile.get("outreachMailbox") != "partnerships@newlgroup.com":
    raise SystemExit("The backlink business profile has an unexpected outreach mailbox.")
if (profile.get("outreachPolicy") or {}).get("manualOpportunityApproval") is not True:
    raise SystemExit("Manual opportunity approval must remain enabled.")
if (profile.get("submissionRules") or {}).get("allowPayment") is not False:
    raise SystemExit("Paid submissions must remain disabled.")

jobs = cron_payload.get("jobs") if isinstance(cron_payload, dict) else cron_payload
jobs = jobs if isinstance(jobs, list) else []
matches = [
    job for job in jobs
    if isinstance(job, dict)
    and job.get("declarationKey") == "newl.website-growth.backlink-outreach.weekday.v1"
]
if len(matches) != 1:
    raise SystemExit("Exactly one Website Growth backlink outreach schedule must be installed.")
job = matches[0]
if (job.get("payload") or {}).get("kind") != "command":
    raise SystemExit("The Website Growth backlink outreach schedule is not a command job.")
if "run-website-growth-backlink-executor.sh" not in json.dumps(job.get("payload") or {}):
    raise SystemExit("The Website Growth backlink schedule does not call the deterministic executor.")
print("enabled" if job.get("enabled") is True else "disabled")
PY
)"

echo "Backlink executor preflight passed (schedule ${schedule_state}). No opportunity was claimed and no message was sent."
