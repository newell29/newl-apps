#!/usr/bin/env python3
"""Run one tenant-bound Hunter TradeMining request at a time."""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path
from typing import Any, Optional

from hunter_ingest import api_request, clean, required_env


SCRIPT_DIR = Path(__file__).resolve().parent


def load_profiles(base_url: str, token: str) -> list[dict[str, Any]]:
    response = api_request(base_url, token, "GET", "/api/integrations/trademining/search-profiles")
    data = response.get("data") if isinstance(response.get("data"), dict) else {}
    profiles = data.get("profiles") if isinstance(data.get("profiles"), list) else []
    return [profile for profile in profiles if isinstance(profile, dict)]


def load_run_requests(base_url: str, token: str) -> list[dict[str, Any]]:
    response = api_request(base_url, token, "GET", "/api/integrations/trademining/run-requests")
    data = response.get("data") if isinstance(response.get("data"), dict) else {}
    requests = data.get("requests") if isinstance(data.get("requests"), list) else []
    return [request for request in requests if isinstance(request, dict)]


def update_run_request(base_url: str, token: str, request_id: str, status: str, metadata: dict[str, Any]) -> None:
    api_request(
        base_url,
        token,
        "PATCH",
        f"/api/integrations/trademining/run-requests/{request_id}",
        {"status": status, "metadata": metadata},
    )


def load_port_ids() -> dict[str, str]:
    raw = required_env("HUNTER_TRADEMINING_PORTS_JSON")
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as error:
        raise RuntimeError("HUNTER_TRADEMINING_PORTS_JSON must be valid JSON") from error
    if not isinstance(parsed, dict):
        raise RuntimeError("HUNTER_TRADEMINING_PORTS_JSON must be a name-to-ID object")
    result: dict[str, str] = {}
    for name, port_id in parsed.items():
        if isinstance(name, str) and isinstance(port_id, (str, int)) and str(port_id).strip():
            result[normalize_port_name(name)] = str(port_id).strip()
    return result


def normalize_port_name(value: str) -> str:
    return re.sub(r"\s+", " ", value.strip()).lower()


def slug(value: str) -> str:
    normalized = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return normalized[:60] or "profile"


def resolve_profile(profiles: list[dict[str, Any]], profile_id: Optional[str], profile_name: Optional[str]) -> dict[str, Any]:
    if profile_id:
        match = next((profile for profile in profiles if clean(profile.get("id")) == profile_id), None)
    else:
        normalized_name = (profile_name or "").strip().lower()
        match = next((profile for profile in profiles if str(profile.get("name", "")).strip().lower() == normalized_name), None)
    if not match:
        raise RuntimeError("requested TradeMining profile is not enabled for this tenant")
    return match


def run_profile(profile: dict[str, Any]) -> dict[str, Any]:
    profile_id = clean(profile.get("id"))
    profile_name = clean(profile.get("name"))
    if not profile_id or not profile_name:
        raise RuntimeError("TradeMining profile is missing its ID or name")

    destination_ports = [str(value).strip() for value in profile.get("destinationPorts", []) if str(value).strip()]
    if not destination_ports:
        raise RuntimeError(f'profile "{profile_name}" has no destination ports')
    port_ids = load_port_ids()
    missing_ports = [name for name in destination_ports if normalize_port_name(name) not in port_ids]
    if missing_ports:
        raise RuntimeError("TradeMining port IDs are not configured for: " + ", ".join(missing_ports))

    collection_days = max(1, int(os.environ.get("HUNTER_COLLECTION_DAYS", "7")))
    lookback_days = max(1, int(profile.get("lookbackDays") or collection_days))
    days = min(collection_days, lookback_days)
    end_date_override = clean(os.environ.get("HUNTER_END_DATE"))
    run_date = end_date_override or dt.datetime.now(dt.timezone.utc).date().isoformat()
    run_slug = f"{run_date}-{slug(profile_name)}-{profile_id[-8:]}"
    export_root = Path(required_env("HUNTER_EXPORT_DIRECTORY")).expanduser().resolve()
    processed_root = Path(required_env("HUNTER_PROCESSED_DIRECTORY")).expanduser().resolve() / slug(profile_id)

    port_keys: list[str] = []
    port_specs: list[str] = []
    for index, port_name in enumerate(destination_ports, start=1):
        key = f"profile-port-{index}"
        port_keys.append(key)
        port_specs.extend(["--port-spec", f"{key}|{port_name}|{port_ids[normalize_port_name(port_name)]}"])

    export_command = [
        sys.executable,
        str(SCRIPT_DIR / "trademining_export.py"),
        "--ports",
        ",".join(port_keys),
        "--days",
        str(days),
        "--run-slug",
        run_slug,
        "--output-root",
        str(export_root),
        *port_specs,
    ]
    if end_date_override:
        export_command.extend(["--end-date", end_date_override])
    subprocess.run(export_command, check=True)

    run_dir = export_root / run_slug
    subprocess.run(
        [
            sys.executable,
            str(SCRIPT_DIR / "trademining_summary.py"),
            "--run-dir",
            str(run_dir),
            "--output-root",
            str(processed_root),
        ],
        check=True,
    )

    export_manifest = json.loads((run_dir / "manifest.json").read_text())
    as_of = str(export_manifest["end_date"])
    processed_manifest = json.loads((processed_root / as_of / "manifest.json").read_text())
    canonical_csv = Path(processed_manifest["raw_path"]).resolve()
    destination_markets = [str(value).strip() for value in profile.get("destinationMarkets", []) if str(value).strip()]

    ingest_command = [
        sys.executable,
        str(SCRIPT_DIR / "hunter_ingest.py"),
        "--profile-id",
        profile_id,
        "--profile-name",
        profile_name,
        "--canonical-csv",
        str(canonical_csv),
    ]
    if destination_markets:
        ingest_command.extend(["--destination-market", destination_markets[0]])
    subprocess.run(ingest_command, check=True)

    return {
        "profileId": profile_id,
        "profileName": profile_name,
        "runSlug": run_slug,
        "portCount": len(destination_ports),
        "collectionDays": days,
        "canonicalCsv": canonical_csv.name,
    }


def build_profile_plan(profile: dict[str, Any]) -> dict[str, Any]:
    profile_id = clean(profile.get("id"))
    profile_name = clean(profile.get("name"))
    destination_ports = [str(value).strip() for value in profile.get("destinationPorts", []) if str(value).strip()]
    configured_ports = load_port_ids()
    missing_ports = [name for name in destination_ports if normalize_port_name(name) not in configured_ports]
    collection_days = max(1, int(os.environ.get("HUNTER_COLLECTION_DAYS", "7")))
    lookback_days = max(1, int(profile.get("lookbackDays") or collection_days))
    return {
        "profileId": profile_id,
        "profileName": profile_name,
        "destinationPorts": destination_ports,
        "missingPortMappings": missing_ports,
        "collectionDays": min(collection_days, lookback_days),
        "ready": bool(profile_id and profile_name and destination_ports and not missing_ports),
    }


def process_once(base_url: str, token: str, explicit_profile_id: Optional[str], explicit_profile_name: Optional[str]) -> bool:
    profiles = load_profiles(base_url, token)
    if explicit_profile_id or explicit_profile_name:
        result = run_profile(resolve_profile(profiles, explicit_profile_id, explicit_profile_name))
        print(json.dumps(result, indent=2))
        return True

    requests = load_run_requests(base_url, token)
    if not requests:
        print("No Hunter TradeMining run request is waiting.")
        return False

    request = requests[0]
    request_id = clean(request.get("requestId"))
    profile_id = clean(request.get("searchProfileId"))
    if not request_id or not profile_id:
        raise RuntimeError("queued run request is missing its request or profile ID")

    update_run_request(base_url, token, request_id, "RUNNING", {"agent": "Hunter"})
    try:
        result = run_profile(resolve_profile(profiles, profile_id, None))
        update_run_request(base_url, token, request_id, "COMPLETED", {"agent": "Hunter", **result})
        print(json.dumps(result, indent=2))
    except Exception as error:
        update_run_request(base_url, token, request_id, "FAILED", {"agent": "Hunter", "error": str(error)[:500]})
        raise
    return True


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--once", action="store_true")
    parser.add_argument("--plan", action="store_true", help="Validate one profile without logging in or exporting.")
    parser.add_argument("--collection-days", type=int, help="Override the configured trailing collection window.")
    parser.add_argument("--end-date", help="Use a specific YYYY-MM-DD TradeMining end date for a controlled run.")
    profile = parser.add_mutually_exclusive_group()
    profile.add_argument("--profile-id")
    profile.add_argument("--profile-name")
    args = parser.parse_args()

    if args.collection_days is not None:
        if args.collection_days < 1:
            raise RuntimeError("--collection-days must be at least 1")
        os.environ["HUNTER_COLLECTION_DAYS"] = str(args.collection_days)
    if args.end_date:
        dt.date.fromisoformat(args.end_date)
        os.environ["HUNTER_END_DATE"] = args.end_date

    base_url = required_env("NEWL_APPS_BASE_URL")
    token = required_env("INGESTION_API_TOKEN")
    poll_ms = max(5000, int(os.environ.get("HUNTER_POLL_MS", "60000")))

    if args.plan:
        if not args.profile_id and not args.profile_name:
            raise RuntimeError("--plan requires --profile-id or --profile-name")
        profiles = load_profiles(base_url, token)
        print(json.dumps(build_profile_plan(resolve_profile(profiles, clean(args.profile_id), clean(args.profile_name))), indent=2))
        return 0

    while True:
        process_once(base_url, token, clean(args.profile_id), clean(args.profile_name))
        if args.once or args.profile_id or args.profile_name:
            return 0
        time.sleep(poll_ms / 1000)


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except subprocess.CalledProcessError as error:
        print(f"Hunter child process failed with exit code {error.returncode}", file=sys.stderr)
        raise SystemExit(1)
    except Exception as error:
        print(f"Hunter worker failed: {error}", file=sys.stderr)
        raise SystemExit(1)
