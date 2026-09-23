#!/usr/bin/env python3
"""Idempotent schedule cutover after reviewed app/runtime deployment; never sends outreach."""
import argparse
import json
import subprocess
from authority_executor import api

LEGACY_KEYS = {"newl.website-growth.backlink-discovery.weekly.v1", "newl.website-growth.backlink-outreach.weekday.v1",
               "newl.rivet.website-growth.backlink-failure-monitor.v1"}


def cutover_plan(jobs):
    replacement = [j for j in jobs if j.get("declarationKey") == "newl.website-growth.authority.v1"]
    if len(replacement) != 1:
        raise RuntimeError("Exactly one installed authority schedule is required")
    legacy = [j for j in jobs if j.get("declarationKey") in LEGACY_KEYS]
    if any((j.get("state") or {}).get("runningAtMs") for j in legacy + replacement):
        raise RuntimeError("A relevant job is running. Let it finish and reconcile external actions before cutover.")
    return {"disable": [j["id"] for j in legacy if j.get("enabled")], "enable": replacement[0]["id"]}


def run(apply=False):
    raw = json.loads(subprocess.check_output(["openclaw", "cron", "list", "--all", "--json"], text=True))
    plan = cutover_plan(raw.get("jobs", []) if isinstance(raw, dict) else raw)
    # No app request, job mutation or external action during dry run.
    if not apply:
        print(json.dumps({"mode": "dry-run", **plan}, indent=2))
        return
    state = api({"action": "prepare"})
    if not state.get("campaignEnabled") or state.get("sync") != "OK":
        raise RuntimeError("Enable the reviewed campaign and restore mailbox sync before cutover.")
    for job_id in plan["disable"]:
        subprocess.run(["openclaw", "cron", "disable", job_id], check=True)
    subprocess.run(["openclaw", "cron", "enable", plan["enable"]], check=True)
    print("Authority schedule enabled; retired schedules disabled. Newl Apps still requires exact individual action approval.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    run(parser.parse_args().apply)
