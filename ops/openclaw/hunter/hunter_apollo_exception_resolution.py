#!/usr/bin/env python3
"""Resolve one tenant-scoped Apollo company exception with bounded public evidence."""

from __future__ import annotations

import urllib.parse
from typing import Any

from hunter_company_research import search_brave
from hunter_ingest import api_request, clean, required_env


TERMINAL_STATES = {"already_processing", "disabled", "idle"}
MAX_PUBLIC_EVIDENCE = 20


def run_apollo_exception_resolution(base_url: str, token: str) -> dict[str, Any]:
    """Prepare and complete at most one exception; the server owns all authorization."""
    response = api_request(
        base_url,
        token,
        "POST",
        "/api/lead-gen/hunter/apollo-exceptions/prepare",
        {},
    )
    prepared = response.get("data") if isinstance(response.get("data"), dict) else response
    state = str(prepared.get("state") or "")
    if state in TERMINAL_STATES:
        return prepared
    if state != "prepared":
        raise RuntimeError("Newl Apps returned an invalid Apollo exception preparation state")

    run_id = clean(prepared.get("runId"))
    queries = prepared.get("queries") if isinstance(prepared.get("queries"), list) else []
    limits = prepared.get("limits") if isinstance(prepared.get("limits"), dict) else {}
    maximum_queries = _bounded_integer(limits.get("publicQueries"), 1, 5, 5)
    maximum_evidence = _bounded_integer(
        limits.get("publicEvidence"), 1, MAX_PUBLIC_EVIDENCE, MAX_PUBLIC_EVIDENCE
    )
    if not run_id:
        raise RuntimeError("Newl Apps did not return an Apollo exception run ID")

    try:
        brave_key = required_env("HUNTER_BRAVE_SEARCH_API_KEY")
        public_evidence = _collect_public_evidence(
            queries[:maximum_queries],
            brave_key,
            maximum_evidence,
        )
        completed = api_request(
            base_url,
            token,
            "POST",
            "/api/lead-gen/hunter/apollo-exceptions/complete",
            {"runId": run_id, "publicEvidence": public_evidence},
        )
        return completed.get("data") if isinstance(completed.get("data"), dict) else completed
    except Exception as error:
        try:
            api_request(
                base_url,
                token,
                "POST",
                "/api/lead-gen/hunter/apollo-exceptions/fail",
                {"runId": run_id, "errorMessage": str(error)[:500]},
            )
        except Exception:
            pass
        raise


def _collect_public_evidence(
    queries: list[Any],
    brave_key: str,
    maximum_evidence: int,
) -> list[dict[str, str]]:
    evidence: list[dict[str, str]] = []
    seen_urls: set[str] = set()
    for raw_query in queries:
        query = clean(raw_query)
        if not query:
            continue
        for result in search_brave(query, brave_key, 4):
            url = clean(result.get("url"))
            title = clean(result.get("title"))
            excerpt = clean(result.get("snippet"))
            if not url or not title or not excerpt:
                continue
            canonical_url = _canonical_url(url)
            if not canonical_url or canonical_url in seen_urls:
                continue
            seen_urls.add(canonical_url)
            evidence.append(
                {
                    "query": query,
                    "title": title,
                    "url": url,
                    "excerpt": excerpt,
                }
            )
            if len(evidence) >= maximum_evidence:
                return evidence
    return evidence


def _canonical_url(value: str) -> str | None:
    try:
        parsed = urllib.parse.urlsplit(value)
    except ValueError:
        return None
    if parsed.scheme.lower() != "https" or not parsed.hostname:
        return None
    path = parsed.path.rstrip("/") or "/"
    return urllib.parse.urlunsplit(("https", parsed.hostname.lower(), path, "", ""))


def _bounded_integer(value: Any, minimum: int, maximum: int, fallback: int) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return fallback
    return max(minimum, min(maximum, parsed))
