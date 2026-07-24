#!/bin/zsh

set -euo pipefail

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

script_directory="${0:A:h}"
repo_path="${script_directory:h:h}"
plugin_path="${script_directory}/plugins/newl-website-growth"
skill_path="${script_directory}/skills/website-growth-backlink-executor"
prompt_path="${script_directory}/prompts/website-growth-backlink-executor.md"
scout_env_file="${WEBSITE_GROWTH_SCOUT_ENV_FILE:-${HOME}/.openclaw/agents/scout/.env}"
profile_source="${WEBSITE_GROWTH_BACKLINK_PROFILE_SOURCE:-}"
profile_target="${HOME}/.openclaw/agents/scout/backlink-business-profile.json"
scout_workspace="${HOME}/.openclaw/workspace-scout"
scout_agent_directory="${HOME}/.openclaw/agents/scout/agent"

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

node -e '
const fs = require("node:fs");
const value = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
if (value.status !== "OWNER_APPROVED_2026-07-24") throw new Error("Business profile is not owner approved.");
if (value.outreachMailbox !== "partnerships@newlgroup.com") throw new Error("Unexpected outreach mailbox.");
if (value.outreachPolicy?.manualOpportunityApproval !== true) throw new Error("Manual opportunity approval must remain enabled.");
if (value.submissionRules?.allowPayment !== false) throw new Error("Payment must remain disabled.");
' "${profile_source}"

mkdir -p "${HOME}/.openclaw/agents/scout"
install -m 600 "${profile_source}" "${profile_target}"

if ! openclaw agents list --json | grep -Eq '"id"[[:space:]]*:[[:space:]]*"scout"'; then
  openclaw agents add scout \
    --workspace "${scout_workspace}" \
    --agent-dir "${scout_agent_directory}" \
    --model "openai/gpt-5.6-sol" \
    --non-interactive
fi

(cd "${plugin_path}" && npm ci && npm run plugin:validate)
openclaw plugins install --force "${plugin_path}"

plugin_config="$(node -e '
console.log(JSON.stringify({
  enabled: true,
  config: {
    baseUrl: process.argv[1],
    backlinkTokenEnv: "OPENCLAW_WEBSITE_GROWTH_BACKLINK_TOKEN"
  }
}));
' "${NEWL_APPS_URL}")"
openclaw config set plugins.entries.newl-website-growth "${plugin_config}" --strict-json

openclaw skills install "${skill_path}" \
  --agent scout \
  --as website-growth-backlink-executor \
  --force

cron_arguments=(
  cron add
  --name "NEWL Website Growth Backlink Outreach"
  --display-name "NEWL Website Growth Backlink Outreach"
  --description "Process only approved free backlink outreach, follow-ups and verification; send the owner a Teams reminder."
  --declaration-key "newl.website-growth.backlink-outreach.weekday.v1"
  --agent scout
  --model "openai/gpt-5.6-sol"
  --thinking high
  --cron "0 11 * * 1-5"
  --tz "America/Toronto"
  --exact
  --session isolated
  --message "$(cat "${prompt_path}")"
  --tools "browser,newl_backlink_sync_replies,newl_backlink_follow_ups,newl_backlink_verification,newl_backlink_claim,newl_backlink_send_email,newl_backlink_report,newl_backlink_summary,read"
  --announce
  --channel msteams
  --to "${WEBSITE_GROWTH_TEAMS_TARGET}"
  --timeout-seconds 1800
  --disabled
)
if [[ -n "${WEBSITE_GROWTH_TEAMS_ACCOUNT:-}" ]]; then
  cron_arguments+=(--account "${WEBSITE_GROWTH_TEAMS_ACCOUNT}")
fi
openclaw "${cron_arguments[@]}"

echo "Installed the dedicated Scout agent, Website Growth plugin, protected profile and disabled weekday outreach job."
echo "Complete the reviewed Newl Apps deployment and supervised one-message test before enabling the cron."
