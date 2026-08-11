#!/bin/zsh

set -euo pipefail

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

openclaw_command="${OPENCLAW_BIN:-openclaw}"
temporary_file="$(mktemp)"
cleanup() {
  rm -f "${temporary_file}"
}
trap cleanup EXIT

"${openclaw_command}" cron list --all --json > "${temporary_file}"
job_id="$(/usr/bin/python3 - "${temporary_file}" <<'PY'
import json, sys
with open(sys.argv[1], encoding="utf-8") as handle:
    payload = json.load(handle)
jobs = payload.get("jobs") if isinstance(payload, dict) else payload
jobs = jobs if isinstance(jobs, list) else []
matches = [
    job for job in jobs
    if (
        job.get("declarationKey")
        == "newl.website-growth.backlink-outreach.weekday.v1"
        and (job.get("payload") or {}).get("kind") == "command"
        and job.get("id")
    )
]
if len(matches) == 1:
    print(matches[0]["id"])
PY
)"
if [[ -z "${job_id}" ]]; then
  echo "Exactly one deterministic Website Growth backlink command job must be installed before enabling it." >&2
  exit 1
fi

"${openclaw_command}" cron enable "${job_id}"
echo "Enabled Website Growth backlink outreach for 11:00 AM America/Toronto on weekdays."
