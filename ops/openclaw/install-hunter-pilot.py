#!/usr/bin/env python3
"""Install ONLY the bounded, zero-spend public evaluator; never alter the main Hunter service."""
import argparse
import datetime as dt
import json
import os
from pathlib import Path
import plistlib
import subprocess
import sys

LABEL = "com.newl.hunter-pilot-evaluation"


def build_service(repo, state, env_file):
    config = json.loads((state / "config.json").read_text())
    if config.get("publicDiscoveryOnly") is not True or config.get("searchProvider") != "DUCKDUCKGO" or config.get("searchCostMicros") != 0:
        raise ValueError("Installer permits only public discovery with zero paid-service spending")
    expiry = dt.datetime.fromisoformat(config["expiresAt"])
    current = dt.datetime.now(dt.timezone.utc)
    if not current < expiry <= current + dt.timedelta(days=10):
        raise ValueError("Evaluator must have an active, bounded expiration")
    if (state / "STOP").exists():
        raise ValueError("STOP is present; do not silently resume a stopped pilot")
    if not env_file.is_file() or env_file.stat().st_mode & 0o077:
        raise ValueError("Existing Hunter environment must be private and readable")
    script = repo / "ops/openclaw/hunter/hunter_pilot.py"
    return {"Label": LABEL, "ProgramArguments": [sys.executable, str(script), "serve",
            "--state-dir", str(state), "--env-file", str(env_file)],
        "WorkingDirectory": str(repo), "RunAtLoad": True, "KeepAlive": {"SuccessfulExit": False},
        "ThrottleInterval": 60, "ProcessType": "Background", "LowPriorityIO": True,
        "EnvironmentVariables": {"PATH": "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin",
                                 "PYTHONDONTWRITEBYTECODE": "1", "PYTHONUNBUFFERED": "1"},
        "StandardOutPath": str(state / "worker.log"), "StandardErrorPath": str(state / "worker-error.log")}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--state-dir", required=True)
    parser.add_argument("--env-file", required=True)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    repo = Path(__file__).resolve().parents[2]
    state = Path(args.state_dir).expanduser().resolve()
    if repo == state or repo in state.parents:
        raise ValueError("Use a private state directory outside the checkout")
    service = build_service(repo, state, Path(args.env_file).expanduser().resolve())
    dirty = subprocess.check_output(["git", "status", "--porcelain"], cwd=repo, text=True).strip()
    if dirty:
        raise ValueError("Commit and validate the isolated pilot worktree before installing")
    if args.check:
        print(json.dumps({"state": "installable", "label": LABEL, "paidServices": False}))
        return
    target = Path.home() / "Library/LaunchAgents" / (LABEL + ".plist")
    if target.exists():
        raise ValueError("Pilot service already exists; refusing to replace its schedule")
    target.parent.mkdir(parents=True, exist_ok=True)
    os.umask(0o077)
    for logfile in [state / "worker.log", state / "worker-error.log"]:
        logfile.touch(mode=0o600, exist_ok=True)
    with open(target, "xb") as handle:
        plistlib.dump(service, handle)
    subprocess.run(["launchctl", "bootstrap", f"gui/{os.getuid()}", str(target)], check=True)
    print(json.dumps({"state": "installed", "label": LABEL, "publicDiscoveryOnly": True}))


if __name__ == "__main__":
    main()
