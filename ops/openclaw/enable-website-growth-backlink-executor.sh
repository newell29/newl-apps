#!/bin/zsh

set -euo pipefail

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

temporary_file="$(mktemp)"
cleanup() {
  rm -f "${temporary_file}"
}
trap cleanup EXIT

openclaw cron list --json > "${temporary_file}"
job_id="$(/usr/bin/python3 - "${temporary_file}" <<'PY'
import json, sys
with open(sys.argv[1], encoding="utf-8") as handle:
    payload = json.load(handle)
jobs = payload.get("jobs") if isinstance(payload, dict) else payload
jobs = jobs if isinstance(jobs, list) else []
for job in jobs:
    if job.get("declarationKey") == "newl.website-growth.backlink-outreach.weekday.v1":
        print(job.get("id") or "")
        break
PY
)"
if [[ -z "${job_id}" ]]; then
  echo "Install the Website Growth backlink executor before enabling it." >&2
  exit 1
fi

openclaw cron enable "${job_id}"
echo "Enabled Website Growth backlink outreach for 11:00 AM America/Toronto on weekdays."
