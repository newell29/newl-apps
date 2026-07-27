#!/usr/bin/env python3
"""Drain Newl Apps' bounded, tenant-scoped Hunter outreach handoff queue."""

from __future__ import annotations

import datetime as dt
import time
from typing import Any, Optional

from hunter_ingest import api_request


TERMINAL_STATES = {"completed", "disabled", "idle"}


def drain_outreach_handoff(
    base_url: str,
    token: str,
    run_id: Optional[str] = None,
    max_requests: int = 100,
) -> dict[str, Any]:
    """Process at most one company per request until the selected queue is drained."""
    latest: dict[str, Any] = {"state": "idle"}
    for _ in range(max_requests):
        response = api_request(
            base_url,
            token,
            "POST",
            "/api/lead-gen/hunter/outreach-handoff/process",
            {"runId": run_id} if run_id else {},
        )
        latest = response.get("data") if isinstance(response.get("data"), dict) else response
        state = str(latest.get("state") or "")
        if state in TERMINAL_STATES or state == "already_processing":
            return latest
        if state in {"retry_wait", "retry_scheduled"}:
            next_attempt = latest.get("nextAttemptAt")
            wait_seconds = _retry_wait_seconds(next_attempt)
            if wait_seconds > 60:
                return latest
            time.sleep(max(1, wait_seconds))
    return {
        "state": "bounded",
        "message": f"Hunter stopped after {max_requests} handoff requests.",
        "lastResult": latest,
    }


def _retry_wait_seconds(value: Any) -> int:
    if not isinstance(value, str):
        return 60
    try:
        target = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
        now = dt.datetime.now(dt.timezone.utc)
        return max(1, int((target.astimezone(dt.timezone.utc) - now).total_seconds()))
    except ValueError:
        return 60
