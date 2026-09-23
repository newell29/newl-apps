#!/bin/zsh
# Run only against the owner-merged runtime checkout. Installs disabled; no external action occurs.
set -euo pipefail
runner_directory="${0:A:h}"
runtime_repo_path="${NEWL_APPS_SCOUT_RUNTIME_REPO_PATH:-${HOME}/Developer/newl-apps-scout-runtime}"
runner_path="${runtime_repo_path}/ops/openclaw/run-scout-authority.sh"
[[ -r "${runner_path}" ]] || { echo "Update the reviewed runtime checkout first."; exit 1; }
npm --prefix "${runtime_repo_path}/ops/openclaw/plugins/newl-website-growth" run plugin:validate
openclaw plugins install --force "${runtime_repo_path}/ops/openclaw/plugins/newl-website-growth"
agent_index="$(openclaw config get agents.list --json | /usr/bin/python3 -c 'import json,sys; print(next((str(i) for i,a in enumerate(json.load(sys.stdin)) if a.get("id")=="scout-authority"),""))')"
if [[ -z "${agent_index}" ]]; then
  openclaw agents add scout-authority --non-interactive --workspace "${HOME}/.openclaw/workspace-scout-authority" --model openai/gpt-5.4-mini
  agent_index="$(openclaw config get agents.list --json | /usr/bin/python3 -c 'import json,sys; print(next(str(i) for i,a in enumerate(json.load(sys.stdin)) if a.get("id")=="scout-authority"))')"
fi
openclaw config set "agents.list[${agent_index}].tools" '{"profile":"minimal","alsoAllow":["browser","newl_authority_action"],"deny":["exec","bash","read","write","edit","apply_patch","process","message","sessions_spawn","newl_backlink_claim","newl_backlink_send_email","newl_backlink_send_follow_up","newl_backlink_report","newl_backlink_fill_directory_credentials"]}' --strict-json
job_id="$(openclaw cron list --all --json | /usr/bin/python3 -c 'import json,sys; v=json.load(sys.stdin); jobs=v.get("jobs",[]) if isinstance(v,dict) else v; ids=[j["id"] for j in jobs if j.get("declarationKey")=="newl.website-growth.authority.v1"]; assert len(ids)<=1,"Duplicate authority schedules require reconciliation"; print(ids[0] if ids else "")')"
runner_argv="$(/usr/bin/python3 -c 'import json,sys; print(json.dumps(["/bin/zsh",sys.argv[1]]))' "${runner_path}")"
if [[ -n "${job_id}" ]]; then
  # Preserve the existing schedule and enabled/disabled choice on an upgrade.
  openclaw cron edit "${job_id}" --command-argv "${runner_argv}" --command-cwd "${runtime_repo_path}" --timeout-seconds 900 --no-deliver
else
  openclaw cron add --name "NEWL Scout Authority" --description "One exact approved authority action; Newl Apps owns state, approval, receipts and isolated holds." --declaration-key "newl.website-growth.authority.v1" --cron "15,45 9-16 * * 1-5" --tz America/Toronto --command-argv "${runner_argv}" --command-cwd "${runtime_repo_path}" --timeout-seconds 900 --no-deliver --disabled
fi
echo "Installed. Before enabling: verify model auth and the scoped tools, save the campaign in Newl Apps, disable retired discovery/outreach/failure-monitor jobs, then run one empty wake and one separately approved action. No legacy or new schedule was enabled by this installer."
