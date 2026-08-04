#!/usr/bin/env python3
"""Bounded public-web backlink discovery for Website Growth Scout."""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from collections import Counter
from pathlib import Path
from typing import Any

HUNTER_DIRECTORY = Path(__file__).resolve().parent / "hunter"
sys.path.insert(0, str(HUNTER_DIRECTORY))

from hunter_company_research import fetch_page_evidence, search_web  # noqa: E402


DEFAULT_OLLAMA_URL = "http://127.0.0.1:11434"
DEFAULT_QWEN_MODEL = "qwen3.6:27b-q4_K_M"
QWEN_BATCH_SIZE = 10
QWEN_MAX_ATTEMPTS = 2
ALLOWED_CATEGORIES = [
    "DIRECTORY_CITATION",
    "LINK_RECLAMATION",
    "PARTNER_ECOSYSTEM",
    "CONTENT_CONTRIBUTION",
    "RESOURCE_PAGE",
    "DIGITAL_PR",
    "PAID_PLACEMENT",
]

TRIAGE_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "decisions": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "id": {"type": "string"},
                    "disposition": {"type": "string", "enum": ["FETCH", "REJECT"]},
                    "category": {"type": ["string", "null"], "enum": [*ALLOWED_CATEGORIES, None]},
                    "confidence": {"type": "integer", "minimum": 0, "maximum": 100},
                    "reason": {"type": "string"},
                },
                "required": ["id", "disposition", "category", "confidence", "reason"],
            },
        }
    },
    "required": ["decisions"],
}

FINALIST_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "decisions": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "id": {"type": "string"},
                    "disposition": {"type": "string", "enum": ["FETCHED", "FINALIST"]},
                    "category": {"type": "string", "enum": ALLOWED_CATEGORIES},
                    "confidence": {"type": "integer", "minimum": 0, "maximum": 100},
                    "reason": {"type": "string"},
                    "pageSummary": {"type": "string"},
                },
                "required": [
                    "id",
                    "disposition",
                    "category",
                    "confidence",
                    "reason",
                    "pageSummary",
                ],
            },
        }
    },
    "required": ["decisions"],
}


def api_request(path: str, payload: dict[str, Any]) -> dict[str, Any]:
    base_url = required_env("NEWL_APPS_URL").rstrip("/")
    token = required_env("OPENCLAW_WEBSITE_GROWTH_TOKEN")
    headers = {
        "Accept": "application/json",
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
        "User-Agent": "Newl-Website-Growth-Backlink-Discovery/1.0",
    }
    bypass = os.environ.get("VERCEL_AUTOMATION_BYPASS_SECRET", "").strip()
    if bypass:
        headers["x-vercel-protection-bypass"] = bypass
    request = urllib.request.Request(
        f"{base_url}{path}",
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        method="POST",
        headers=headers,
    )
    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            envelope = json.loads(response.read().decode("utf-8", "replace"))
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", "replace")[:1_000]
        raise RuntimeError(f"Newl Apps returned HTTP {error.code}: {detail}") from error
    data = envelope.get("data")
    if not isinstance(data, dict):
        raise RuntimeError("Newl Apps returned an invalid backlink discovery response.")
    return data


def ollama_request(
    schema: dict[str, Any],
    system_prompt: str,
    rows: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    decisions: list[dict[str, Any]] = []
    for batch_number, start in enumerate(range(0, len(rows), QWEN_BATCH_SIZE), start=1):
        batch = rows[start : start + QWEN_BATCH_SIZE]
        decisions.extend(
            _ollama_batch_with_recovery(
                schema,
                system_prompt,
                batch,
                batch_label=str(batch_number),
            )
        )
    return decisions


def _ollama_batch_with_recovery(
    schema: dict[str, Any],
    system_prompt: str,
    rows: list[dict[str, Any]],
    *,
    batch_label: str,
) -> list[dict[str, Any]]:
    expected_ids = [str(row.get("id") or "") for row in rows]
    if any(not row_id for row_id in expected_ids) or len(set(expected_ids)) != len(expected_ids):
        raise RuntimeError("Local Qwen backlink triage received invalid candidate IDs.")

    collected: dict[str, dict[str, Any]] = {}
    remaining = list(rows)
    last_error: RuntimeError | None = None
    for _attempt in range(QWEN_MAX_ATTEMPTS):
        if not remaining:
            break
        remaining_ids = {str(row["id"]) for row in remaining}
        try:
            batch_decisions = _ollama_batch(schema, system_prompt, remaining)
            actual_ids: list[str] = []
            for decision in batch_decisions:
                if not isinstance(decision, dict):
                    raise RuntimeError("Local Qwen backlink triage returned an invalid decision.")
                decision_id = str(decision.get("id") or "")
                if not decision_id or decision_id not in remaining_ids:
                    raise RuntimeError("Local Qwen backlink triage returned an unexpected candidate ID.")
                actual_ids.append(decision_id)
            if len(set(actual_ids)) != len(actual_ids):
                raise RuntimeError("Local Qwen backlink triage returned duplicate candidate IDs.")
            for decision in batch_decisions:
                collected[str(decision["id"])] = decision
            remaining = [row for row in remaining if str(row["id"]) not in collected]
            if remaining:
                last_error = RuntimeError(
                    "Local Qwen backlink triage did not return one decision per candidate."
                )
            else:
                last_error = None
        except RuntimeError as error:
            last_error = error

    if remaining:
        if len(remaining) == 1:
            fallback = _safe_qwen_fallback(schema, remaining[0])
            collected[str(remaining[0]["id"])] = fallback
            print(
                f"Local Qwen backlink triage used a fail-closed fallback for batch {batch_label}.",
                file=sys.stderr,
            )
        else:
            midpoint = max(1, len(remaining) // 2)
            recovered = [
                *_ollama_batch_with_recovery(
                    schema,
                    system_prompt,
                    remaining[:midpoint],
                    batch_label=f"{batch_label}.1",
                ),
                *_ollama_batch_with_recovery(
                    schema,
                    system_prompt,
                    remaining[midpoint:],
                    batch_label=f"{batch_label}.2",
                ),
            ]
            collected.update({str(row["id"]): row for row in recovered})

    if len(collected) != len(expected_ids):
        raise RuntimeError(
            f"Local Qwen backlink triage batch {batch_label} could not be recovered."
        ) from last_error
    return [collected[row_id] for row_id in expected_ids]


def _safe_qwen_fallback(
    schema: dict[str, Any],
    row: dict[str, Any],
) -> dict[str, Any]:
    disposition_options = (
        schema.get("properties", {})
        .get("decisions", {})
        .get("items", {})
        .get("properties", {})
        .get("disposition", {})
        .get("enum", [])
    )
    if "REJECT" in disposition_options:
        return {
            "id": str(row["id"]),
            "disposition": "REJECT",
            "category": None,
            "confidence": 0,
            "reason": "Local Qwen could not complete a structured classification; excluded safely.",
        }

    initial_triage = row.get("initialTriage")
    initial_category = initial_triage.get("category") if isinstance(initial_triage, dict) else None
    category = initial_category if initial_category in ALLOWED_CATEGORIES else "RESOURCE_PAGE"
    return {
        "id": str(row["id"]),
        "disposition": "FETCHED",
        "category": category,
        "confidence": 0,
        "reason": "Local Qwen could not complete a structured finalist review; excluded safely.",
        "pageSummary": "The candidate was not promoted because its structured review was incomplete.",
    }


def _ollama_batch(
    schema: dict[str, Any],
    system_prompt: str,
    rows: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    request = urllib.request.Request(
        f"{os.environ.get('WEBSITE_GROWTH_QWEN_URL', DEFAULT_OLLAMA_URL).rstrip('/')}/api/chat",
        data=json.dumps(
            {
                "model": os.environ.get("WEBSITE_GROWTH_QWEN_MODEL", DEFAULT_QWEN_MODEL),
                "stream": False,
                "think": False,
                "format": schema,
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {
                        "role": "user",
                        "content": json.dumps(rows, ensure_ascii=False),
                    },
                ],
                "options": {"temperature": 0, "num_predict": 7000},
            },
            ensure_ascii=False,
        ).encode("utf-8"),
        method="POST",
        headers={"Accept": "application/json", "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=900) as response:
            envelope = json.loads(response.read().decode("utf-8", "replace"))
        parsed = json.loads(envelope["message"]["content"])
        decisions = parsed["decisions"]
    except (KeyError, TypeError, ValueError, urllib.error.URLError) as error:
        raise RuntimeError("Local Qwen backlink triage returned an invalid response.") from error
    if not isinstance(decisions, list):
        raise RuntimeError("Local Qwen backlink triage did not return decisions.")
    return decisions


def discover(packet: dict[str, Any]) -> dict[str, Any]:
    discovery = packet.get("backlinkDiscovery")
    if not isinstance(discovery, dict):
        raise RuntimeError("Scout packet is missing backlinkDiscovery.")
    queries = discovery.get("queries")
    if not isinstance(queries, list) or len(queries) > 12:
        raise RuntimeError("Scout packet contains an invalid backlink query plan.")

    results: list[dict[str, Any]] = []
    for row in queries:
        lane = str(row.get("lane") or "")
        query = str(row.get("query") or "")
        if not lane or not query:
            continue
        for result in search_web("BRAVE", query, 10):
            results.append(
                {
                    "queryLane": lane,
                    "queryText": query,
                    "url": result.get("url"),
                    "title": result.get("title"),
                    "snippet": result.get("snippet"),
                    "publishedAt": result.get("publishedAt"),
                }
            )

    ingest = api_request(
        "/api/website-growth/scout/backlink-discovery/ingest",
        {"runId": packet["runId"], "queries": queries, "results": results},
    )
    candidates = ingest.get("candidates")
    limits = ingest.get("limits")
    if not isinstance(candidates, list) or not isinstance(limits, dict):
        raise RuntimeError("Newl Apps did not return bounded discovery candidates.")
    if not candidates:
        complete = api_request(
            "/api/website-growth/scout/backlink-discovery/complete",
            {"runId": packet["runId"], "decisions": []},
        )
        return complete

    triage_prompt = (
        "You are the cheap first-pass backlink opportunity classifier for Newl Group, a Canadian and "
        "US logistics, warehousing, fulfillment, kitting, retail-compliance, freight, and Teamship WMS "
        "provider. Use only the supplied search-result title and snippet. FETCH only a plausible, legitimate "
        "directory/citation, link-reclamation, partner, content-contribution, resource-page, digital-PR, "
        "editorial-source, podcast, association, or transparent paid-research opportunity. Reject competitors' "
        "own pages, lead-selling lists, irrelevant sites, link farms, automated-link schemes, coupon sites, "
        "thin aggregators, paid dofollow offers, and pages with no credible path to an earned citation. "
        "Do not browse, invent contacts, or treat ranking enthusiasm as evidence. Return one decision for "
        "every supplied id."
    )
    triage = ollama_request(TRIAGE_SCHEMA, triage_prompt, candidates)
    candidate_by_id = {row["id"]: row for row in candidates}
    fetchable = [
        row for row in triage
        if row.get("disposition") == "FETCH" and row.get("id") in candidate_by_id
    ]
    fetchable.sort(key=lambda row: (-int(row.get("confidence") or 0), str(row.get("id"))))
    per_domain: Counter[str] = Counter()
    selected: list[dict[str, Any]] = []
    for decision in fetchable:
        candidate = candidate_by_id[decision["id"]]
        domain = candidate["sourceDomain"]
        if per_domain[domain] >= int(limits.get("pagesPerDomain") or 2):
            continue
        if len(selected) >= int(limits.get("fetches") or 40):
            break
        per_domain[domain] += 1
        selected.append({**candidate, "initialTriage": decision})

    rejected = [
        {
            "id": row["id"],
            "disposition": "REJECT",
            "category": row.get("category"),
            "confidence": bounded_score(row.get("confidence")),
            "reason": bounded_text(row.get("reason"), "Rejected by initial Qwen triage.", 1_000),
            "pageSummary": None,
            "fetchError": None,
        }
        for row in triage
        if row.get("disposition") == "REJECT" and row.get("id") in candidate_by_id
    ]
    fetched: list[dict[str, Any]] = []
    failed: list[dict[str, Any]] = []
    for row in selected:
        excerpt, _ = fetch_page_evidence(row["canonicalUrl"])
        if not excerpt:
            failed.append(
                {
                    "id": row["id"],
                    "disposition": "FETCH_FAILED",
                    "category": row["initialTriage"].get("category"),
                    "confidence": bounded_score(row["initialTriage"].get("confidence")),
                    "reason": "The public page could not be retrieved safely as HTML.",
                    "pageSummary": None,
                    "fetchError": "Safe public HTML retrieval returned no readable content.",
                }
            )
            continue
        fetched.append({**row, "pageExcerpt": excerpt})

    final_prompt = (
        "You are the second-pass backlink opportunity reviewer for Newl Group. Use only the supplied search "
        "evidence and downloaded public-page excerpt. Mark no more than 15 as FINALIST. A finalist must have "
        "a specific, credible way for Newl Group to earn a relevant citation through a legitimate listing, "
        "membership, editorial source request, useful content contribution, partner/resource relationship, "
        "podcast, digital PR, reclamation, or transparent paid research placement. Do not approve outreach; "
        "Codex will perform the final review. Reject link schemes, competitors, generic search lists, stale "
        "or irrelevant pages, pages with no submission/contact path, and paid dofollow offers. Summarize the "
        "page without inventing contacts, prices, authority metrics, or acceptance terms. Return one decision "
        "for every supplied id."
    )
    final_decisions = ollama_request(FINALIST_SCHEMA, final_prompt, fetched) if fetched else []
    normalized_final = []
    finalist_count = 0
    for row in sorted(
        final_decisions,
        key=lambda item: (-int(item.get("confidence") or 0), str(item.get("id"))),
    ):
        if row.get("id") not in candidate_by_id:
            continue
        disposition = row.get("disposition")
        if disposition == "FINALIST" and finalist_count < int(limits.get("finalists") or 15):
            finalist_count += 1
        else:
            disposition = "FETCHED"
        normalized_final.append(
            {
                "id": row["id"],
                "disposition": disposition,
                "category": row.get("category"),
                "confidence": bounded_score(row.get("confidence")),
                "reason": bounded_text(row.get("reason"), "Reviewed by Qwen.", 1_000),
                "pageSummary": bounded_text(row.get("pageSummary"), "No summary supplied.", 3_000),
                "fetchError": None,
            }
        )

    return api_request(
        "/api/website-growth/scout/backlink-discovery/complete",
        {
            "runId": packet["runId"],
            "decisions": [*rejected, *failed, *normalized_final],
        },
    )


def bounded_score(value: Any) -> int:
    try:
        return max(0, min(100, int(value)))
    except (TypeError, ValueError):
        return 0


def bounded_text(value: Any, fallback: str, maximum: int) -> str:
    text = " ".join(str(value or fallback).split())
    return text[:maximum]


def required_env(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise RuntimeError(f"{name} is required.")
    return value


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--packet", required=True)
    parser.add_argument("--output", required=True)
    arguments = parser.parse_args()
    with open(arguments.packet, encoding="utf-8") as handle:
        packet = json.load(handle)
    result = discover(packet)
    with open(arguments.output, "w", encoding="utf-8") as handle:
        json.dump(result, handle, ensure_ascii=False)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
