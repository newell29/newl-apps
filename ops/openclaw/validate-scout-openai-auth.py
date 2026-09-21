#!/usr/bin/env python3
"""Require a usable subscription-backed OpenAI route for the Scout agent."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any


ERROR = (
    "Scout needs a healthy effective OpenAI OAuth profile. "
    "API-key fallback is disabled for Website Growth."
)


def _provider_name(value: Any) -> str:
    if isinstance(value, str):
        return value.split("(", 1)[0].strip().lower()
    if isinstance(value, dict):
        return str(value.get("provider") or value.get("id") or "").strip().lower()
    return ""


def has_usable_openai_oauth(status: dict[str, Any]) -> bool:
    auth = status.get("auth")
    if not isinstance(auth, dict):
        return False

    oauth = auth.get("oauth")
    if isinstance(oauth, dict):
        providers = oauth.get("providers")
        if isinstance(providers, list):
            for provider in providers:
                if not isinstance(provider, dict) or provider.get("provider") != "openai":
                    continue
                profiles = provider.get("effectiveProfiles")
                if isinstance(profiles, list) and any(
                    isinstance(profile, dict)
                    and profile.get("type") == "oauth"
                    and profile.get("status") == "ok"
                    for profile in profiles
                ):
                    return True

    routes = auth.get("runtimeAuthRoutes")
    oauth_providers = auth.get("providersWithOAuth")
    missing = auth.get("missingProvidersInUse")
    has_oauth_provider = isinstance(oauth_providers, list) and any(
        _provider_name(provider) == "openai" for provider in oauth_providers
    )
    openai_missing = isinstance(missing, list) and any(
        _provider_name(provider) == "openai" for provider in missing
    )
    has_usable_codex_route = isinstance(routes, list) and any(
        isinstance(route, dict)
        and route.get("provider") == "openai"
        and route.get("runtime") == "codex"
        and route.get("status") == "usable"
        for route in routes
    )
    return has_oauth_provider and has_usable_codex_route and not openai_missing


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("status_path", type=Path)
    args = parser.parse_args()

    try:
        status = json.loads(args.status_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise SystemExit(f"Could not read Scout model status: {error}") from error
    if not isinstance(status, dict) or not has_usable_openai_oauth(status):
        raise SystemExit(ERROR)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
