#!/usr/bin/env python3
"""Discover recent external opportunity signals and classify them with local Ollama."""

from __future__ import annotations

import argparse
import datetime as dt
import email.utils
import json
import os
import re
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from typing import Any, Optional

from hunter_ingest import api_request, clean, required_env


DEFAULT_OLLAMA_URL = "http://127.0.0.1:11434"
DEFAULT_MODEL = "qwen3:30b-instruct"
PROMPT_VERSION = "hunter-signal-classifier-v3"
ALLOWED_SIGNAL_TYPES = {
    "EXPANSION",
    "FACILITY_OPENING",
    "RETAIL_ROLLOUT",
    "HIRING",
    "LEADERSHIP_CHANGE",
    "LEASE_OR_CONSTRUCTION",
    "FUNDING_OR_ACQUISITION",
    "NEWS",
    "OTHER",
}
ALLOWED_SERVICE_LINES = {"WAREHOUSING", "OCEAN_AIR", "TRUCKING"}


CLASSIFICATION_SCHEMA = {
    "type": "object",
    "properties": {
        "candidates": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "sourceIndex": {"type": "integer"},
                    "relevant": {"type": "boolean"},
                    "companyName": {"type": ["string", "null"]},
                    "signalType": {"type": "string", "enum": sorted(ALLOWED_SIGNAL_TYPES)},
                    "serviceLine": {"type": "string", "enum": sorted(ALLOWED_SERVICE_LINES)},
                    "opportunityTitle": {"type": "string"},
                    "summary": {"type": "string"},
                    "geography": {"type": ["string", "null"]},
                    "confidence": {"type": "integer", "minimum": 0, "maximum": 100},
                    "rationale": {"type": "string"},
                    "evidence": {
                        "type": "array",
                        "items": {"type": "string"},
                        "maxItems": 5,
                    },
                },
                "required": [
                    "sourceIndex",
                    "relevant",
                    "companyName",
                    "signalType",
                    "serviceLine",
                    "opportunityTitle",
                    "summary",
                    "geography",
                    "confidence",
                    "rationale",
                    "evidence",
                ],
            },
        }
    },
    "required": ["candidates"],
}


def fetch_json(
    url: str,
    timeout: int = 90,
    max_attempts: int = 3,
    headers: Optional[dict[str, str]] = None,
) -> dict[str, Any]:
    body = ""
    for attempt in range(1, max_attempts + 1):
        request = urllib.request.Request(
            url,
            headers={
                "Accept": "application/json",
                "User-Agent": "Newl-Hunter-Signal-Scout/1.0",
                **(headers or {}),
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                body = response.read().decode("utf-8", "replace")
            break
        except urllib.error.HTTPError as error:
            transient = error.code == 429 or error.code >= 500
            if not transient or attempt >= max_attempts:
                raise RuntimeError(f"Signal source returned HTTP {error.code}.") from error
            retry_after = clean(error.headers.get("Retry-After"))
            delay = int(retry_after) if retry_after and retry_after.isdigit() else 2 ** attempt
            time.sleep(min(30, max(1, delay)))
        except urllib.error.URLError as error:
            if attempt >= max_attempts:
                raise RuntimeError(f"Signal source request failed: {error.reason}") from error
            time.sleep(2 ** attempt)
    try:
        parsed = json.loads(body)
    except json.JSONDecodeError as error:
        raise RuntimeError("Signal source returned invalid JSON.") from error
    if not isinstance(parsed, dict):
        raise RuntimeError("Signal source returned an unexpected response shape.")
    return parsed


def fetch_brave_lens(
    endpoint: str,
    lens: dict[str, Any],
    freshness: str,
    max_records: int,
) -> tuple[list[dict[str, Any]], Optional[str]]:
    parameters = {
        "q": str(lens["query"]),
        "count": str(max_records),
        "search_lang": "en",
        "safesearch": "moderate",
        "freshness": freshness,
        "extra_snippets": "true",
    }
    try:
        payload = fetch_json(
            f"{endpoint}?{urllib.parse.urlencode(parameters)}",
            timeout=60,
            headers={"X-Subscription-Token": required_env("HUNTER_BRAVE_SEARCH_API_KEY")},
        )
    except Exception as error:
        return [], str(error)[:500]

    rows = payload.get("web", {}).get("results", [])
    if not isinstance(rows, list):
        return [], "Brave did not return a web results array."
    normalized: list[dict[str, Any]] = []
    for row in rows[:max_records]:
        if not isinstance(row, dict):
            continue
        source_url = clean(row.get("url"))
        title = clean(row.get("title"))
        if not source_url or not title:
            continue
        try:
            parsed_url = urllib.parse.urlparse(source_url)
        except ValueError:
            continue
        if parsed_url.scheme != "https" or not parsed_url.netloc:
            continue
        extra_snippets = (
            row.get("extra_snippets")
            if isinstance(row.get("extra_snippets"), list)
            else []
        )
        snippet_parts = [
            clean(row.get("description")) or "",
            *[
                clean(value) or ""
                for value in extra_snippets
                if isinstance(value, str)
            ],
        ]
        normalized.append(
            {
                "sourceUrl": source_url,
                "articleTitle": title[:500],
                "articleSnippet": " ".join(
                    part for part in snippet_parts if part
                )[:2_000],
                "sourceName": parsed_url.netloc,
                "sourcePublishedAt": normalize_gdelt_date(clean(row.get("page_age"))),
                "queryId": str(lens["id"]),
                "serviceHint": str(lens["serviceLine"]),
                "sourceCountry": None,
            }
        )
    return normalized, None


def fetch_gdelt_lens(
    endpoint: str,
    lens: dict[str, Any],
    lookback_hours: int,
    max_records: int,
) -> tuple[list[dict[str, Any]], Optional[str]]:
    parameters = {
        "query": str(lens["query"]),
        "mode": "artlist",
        "format": "json",
        "sort": "datedesc",
        "timespan": f"{lookback_hours}h",
        "maxrecords": str(max_records),
    }
    url = f"{endpoint}?{urllib.parse.urlencode(parameters)}"
    try:
        payload = fetch_json(url)
    except Exception as error:
        return [], str(error)[:500]

    articles = payload.get("articles")
    if not isinstance(articles, list):
        return [], "GDELT did not return an articles array."
    normalized: list[dict[str, Any]] = []
    for article in articles:
        if not isinstance(article, dict):
            continue
        source_url = clean(article.get("url"))
        title = clean(article.get("title"))
        if not source_url or not title:
            continue
        try:
            parsed_url = urllib.parse.urlparse(source_url)
        except ValueError:
            continue
        if parsed_url.scheme != "https" or not parsed_url.netloc:
            continue
        normalized.append(
            {
                "sourceUrl": source_url,
                "articleTitle": title[:500],
                "articleSnippet": "",
                "sourceName": clean(article.get("domain")) or parsed_url.netloc,
                "sourcePublishedAt": normalize_gdelt_date(clean(article.get("seendate"))),
                "queryId": str(lens["id"]),
                "serviceHint": str(lens["serviceLine"]),
                "sourceCountry": clean(article.get("sourcecountry")),
            }
        )
    return normalized, None


def fetch_google_news_lens(
    endpoint: str,
    lens: dict[str, Any],
    lookback_hours: int,
    max_records: int,
) -> tuple[list[dict[str, Any]], Optional[str]]:
    lookback_days = max(1, min(7, (lookback_hours + 23) // 24))
    parameters = {
        "q": f'({lens["query"]}) when:{lookback_days}d',
        "hl": "en-US",
        "gl": "US",
        "ceid": "US:en",
    }
    request = urllib.request.Request(
        f"{endpoint}?{urllib.parse.urlencode(parameters)}",
        headers={
            "Accept": "application/rss+xml, application/xml",
            "User-Agent": "Newl-Hunter-Signal-Scout/1.0",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=90) as response:
            root = ET.fromstring(response.read())
    except (urllib.error.HTTPError, urllib.error.URLError, ET.ParseError) as error:
        return [], f"Google News RSS request failed: {error}"[:500]

    normalized: list[dict[str, Any]] = []
    cutoff = dt.datetime.now(dt.timezone.utc) - dt.timedelta(hours=lookback_hours)
    for item in root.findall(".//item"):
        source_url = clean(item.findtext("link"))
        title = clean(item.findtext("title"))
        if not source_url or not title:
            continue
        try:
            parsed_url = urllib.parse.urlparse(source_url)
        except ValueError:
            continue
        if parsed_url.scheme != "https" or not parsed_url.netloc:
            continue
        source_element = item.find("source")
        source_name = clean(source_element.text if source_element is not None else None)
        published_at = normalize_rss_date(clean(item.findtext("pubDate")))
        if not published_at:
            continue
        if dt.datetime.fromisoformat(published_at).astimezone(dt.timezone.utc) < cutoff:
            continue
        normalized.append(
            {
                "sourceUrl": source_url,
                "articleTitle": title[:500],
                "articleSnippet": "",
                "sourceName": source_name or parsed_url.netloc,
                "sourcePublishedAt": published_at,
                "queryId": str(lens["id"]),
                "serviceHint": str(lens["serviceLine"]),
                "sourceCountry": "United States",
            }
        )
        if len(normalized) >= max_records:
            break
    return normalized, None


def normalize_gdelt_date(value: Optional[str]) -> Optional[str]:
    if not value:
        return None
    normalized = value.strip()
    for pattern in ("%Y%m%dT%H%M%SZ", "%Y%m%d%H%M%S"):
        try:
            return dt.datetime.strptime(normalized, pattern).replace(tzinfo=dt.timezone.utc).isoformat()
        except ValueError:
            pass
    try:
        parsed = dt.datetime.fromisoformat(normalized.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=dt.timezone.utc)
    return parsed.isoformat()


def normalize_rss_date(value: Optional[str]) -> Optional[str]:
    if not value:
        return None
    try:
        parsed = email.utils.parsedate_to_datetime(value)
    except (TypeError, ValueError):
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=dt.timezone.utc)
    return parsed.isoformat()


def canonical_url(value: str) -> str:
    parsed = urllib.parse.urlsplit(value)
    query = urllib.parse.parse_qsl(parsed.query, keep_blank_values=True)
    filtered = [(key, item) for key, item in query if not key.lower().startswith("utm_")]
    return urllib.parse.urlunsplit(
        (parsed.scheme.lower(), parsed.netloc.lower(), parsed.path, urllib.parse.urlencode(filtered), "")
    )


def is_obvious_non_event_article(article: dict[str, Any]) -> bool:
    title = (clean(article.get("articleTitle")) or "").lower()
    return bool(
        re.search(
            r"^(?:the\s+)?(?:top\s+\d+|best|largest)\s+(?:warehouses?|distribution centers?|"
            r"fulfillment centers?|logistics companies|warehousing companies|providers)\b",
            title,
        )
        or re.search(
            r"\b(?:warehousing|logistics|distribution)\s+companies\s+in\b.*\breviews?\b",
            title,
        )
        or re.search(r"\b(?:directory|list)\s+of\s+(?:warehouses?|companies|providers)\b", title)
    )


def collect_articles(
    packet: dict[str, Any],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, int]]:
    discovery = packet.get("discovery") if isinstance(packet.get("discovery"), dict) else {}
    brave_endpoint = clean(discovery.get("braveEndpoint"))
    google_news_endpoint = clean(discovery.get("googleNewsEndpoint"))
    freshness = clean(discovery.get("freshness")) or "pm"
    lenses = discovery.get("lenses") if isinstance(discovery.get("lenses"), list) else []
    lookback_hours = max(1, min(744, int(discovery.get("lookbackHours") or 744)))
    max_articles = max(1, min(100, int(discovery.get("maxArticles") or 40)))
    configured_service_limits = (
        discovery.get("maxArticlesByService")
        if isinstance(discovery.get("maxArticlesByService"), dict)
        else {}
    )
    service_limits = {
        service_line: max(
            0,
            min(max_articles, int(configured_service_limits.get(service_line) or 0)),
        )
        for service_line in ALLOWED_SERVICE_LINES
    }
    if sum(service_limits.values()) != max_articles:
        service_limits = {"WAREHOUSING": 24, "OCEAN_AIR": 12, "TRUCKING": 4}
        if max_articles != 40:
            service_limits = {
                "WAREHOUSING": round(max_articles * 0.6),
                "OCEAN_AIR": round(max_articles * 0.3),
                "TRUCKING": max_articles - round(max_articles * 0.6) - round(max_articles * 0.3),
            }
    lens_counts_by_service = {
        service_line: sum(
            1
            for lens in lenses
            if isinstance(lens, dict) and clean(lens.get("serviceLine")) == service_line
        )
        for service_line in ALLOWED_SERVICE_LINES
    }
    service_counts = {service_line: 0 for service_line in ALLOWED_SERVICE_LINES}
    existing_urls = {
        canonical_url(url)
        for url in packet.get("existingSourceUrls", [])
        if isinstance(url, str) and url.startswith("https://")
    }
    seen = set(existing_urls)
    articles: list[dict[str, Any]] = []
    query_results: list[dict[str, Any]] = []
    raw_result_count = 0
    duplicate_url_count = 0
    filtered_non_event_count = 0
    if brave_endpoint != "https://api.search.brave.com/res/v1/web/search":
        raise RuntimeError("Hunter signal scout received an unsupported Brave endpoint.")
    if google_news_endpoint != "https://news.google.com/rss/search":
        raise RuntimeError("Hunter signal scout received an unsupported Google News endpoint.")
    if freshness not in {"pd", "pw", "pm"}:
        raise RuntimeError("Hunter signal scout received an unsupported Brave freshness filter.")

    for lens in lenses:
        if not isinstance(lens, dict):
            continue
        lens_id = clean(lens.get("id"))
        query = clean(lens.get("query"))
        service_line = clean(lens.get("serviceLine"))
        if not lens_id or not query or service_line not in ALLOWED_SERVICE_LINES:
            continue
        remaining_for_service = service_limits[service_line] - service_counts[service_line]
        remaining_lenses = max(1, lens_counts_by_service[service_line])
        per_lens = max(1, min(50, (remaining_for_service + remaining_lenses - 1) // remaining_lenses))
        lens_counts_by_service[service_line] = max(0, remaining_lenses - 1)
        if remaining_for_service <= 0:
            continue
        found, error = fetch_brave_lens(brave_endpoint, lens, freshness, per_lens)
        raw_result_count += len(found)
        query_results.append(
            {
                "id": lens_id,
                "provider": "BRAVE_WEB",
                "resultCount": len(found),
                "error": error,
            }
        )
        if not found:
            fallback, fallback_error = fetch_google_news_lens(
                google_news_endpoint, lens, lookback_hours, per_lens
            )
            raw_result_count += len(fallback)
            query_results.append(
                {
                    "id": lens_id,
                    "provider": "GOOGLE_NEWS_RSS",
                    "resultCount": len(fallback),
                    "error": fallback_error,
                }
            )
            found = fallback
        for article in found:
            if is_obvious_non_event_article(article):
                filtered_non_event_count += 1
                continue
            key = canonical_url(str(article["sourceUrl"]))
            if key in seen:
                duplicate_url_count += 1
                continue
            seen.add(key)
            article["sourceIndex"] = len(articles)
            articles.append(article)
            service_counts[service_line] += 1
            if len(articles) >= max_articles or service_counts[service_line] >= service_limits[service_line]:
                break
        if len(articles) >= max_articles:
            break
    if not articles and query_results and all(row["error"] for row in query_results):
        errors = "; ".join(str(row["error"]) for row in query_results[:3])
        raise RuntimeError(f"Every configured signal-source query failed: {errors}")
    return (
        articles,
        query_results,
        {
            "rawResultCount": raw_result_count,
            "duplicateUrlCount": duplicate_url_count,
            "filteredNonEventCount": filtered_non_event_count,
            "selectedArticleCount": len(articles),
        },
    )


def ollama_request(base_url: str, model: str, articles: list[dict[str, Any]]) -> dict[str, Any]:
    safe_articles = [
        {
            "sourceIndex": article["sourceIndex"],
            "articleTitle": article["articleTitle"],
            "articleSnippet": article.get("articleSnippet") or "",
            "sourceName": article["sourceName"],
            "sourcePublishedAt": article["sourcePublishedAt"],
            "sourceCountry": article["sourceCountry"],
            "queryId": article["queryId"],
            "serviceHint": article["serviceHint"],
        }
        for article in articles
    ]
    system_prompt = (
        "You classify bounded public-search results into evidence-backed sales opportunities for Newl Group, "
        "a North American logistics provider. Return one result for every sourceIndex. Mark relevant=true "
        "only when the title or snippet explicitly identifies a non-logistics company and a concrete event likely "
        "to create near-term warehousing, international ocean/air, or trucking demand. Reject generic market "
        "commentary, government announcements without a target company, logistics providers/carriers/3PLs, "
        "job ads without a material expansion signal, stock-price stories, and articles where the prospect "
        "company is ambiguous. Also reject listicles, rankings, directories, facility histories, or roundups "
        "that do not announce a new company event. Reject one-off pop-ups, cafés, restaurants, entertainment "
        "activations, and individual store openings unless the result explicitly describes a multi-site rollout "
        "or a material distribution, production, sourcing, or import change. WAREHOUSING requires an explicit "
        "facility, fulfillment, capacity, production, or multi-site distribution event. OCEAN_AIR requires an "
        "explicit cross-border market entry, importing/exporting, international sourcing, manufacturing, or "
        "distribution event. TRUCKING requires an explicit regional delivery, distribution-network, production, "
        "capacity, or multi-site replenishment event. Never invent a company, geography, event, quantity, or supporting fact. "
        "Confidence measures evidence quality, not enthusiasm. Use the service hint only as a clue."
        " Confidence rubric: 90-100 means the headline explicitly names the prospect, concrete event, "
        "and geography; 70-89 means the prospect and event are explicit but one useful detail is missing; "
        "50-69 means a plausible event needs more verification; 1-49 is weak or ambiguous; 0 is reserved "
        "for irrelevant records. relevant=true requires confidence of at least 50."
    )
    user_prompt = (
        f"Prompt version: {PROMPT_VERSION}\n"
        "Classify these search-result records. Evidence strings must quote or closely paraphrase only words in "
        "the supplied title and snippet metadata. Treat each result as a discovery hypothesis that still requires "
        "full company research before Apollo. For irrelevant records, explain the rejection in rationale and "
        "still provide safe enum values and a short summary.\n\n"
        f"{json.dumps(safe_articles, ensure_ascii=False)}"
    )
    payload = {
        "model": model,
        "stream": False,
        "format": CLASSIFICATION_SCHEMA,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        "options": {"temperature": 0, "num_predict": 5000},
    }
    request = urllib.request.Request(
        f"{base_url.rstrip('/')}/api/chat",
        data=json.dumps(payload).encode(),
        method="POST",
        headers={"Accept": "application/json", "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=600) as response:
            body = response.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as error:
        raise RuntimeError(f"Ollama returned HTTP {error.code}.") from error
    except urllib.error.URLError as error:
        raise RuntimeError(f"Ollama request failed: {error.reason}") from error
    try:
        envelope = json.loads(body)
        content = envelope["message"]["content"]
        parsed = json.loads(content)
    except (json.JSONDecodeError, KeyError, TypeError) as error:
        raise RuntimeError("Ollama returned an invalid structured classification.") from error
    if not isinstance(parsed, dict):
        raise RuntimeError("Ollama returned an unexpected classification shape.")
    return parsed


def normalize_classifications(
    articles: list[dict[str, Any]], raw_candidates: Any
) -> list[dict[str, Any]]:
    if not isinstance(raw_candidates, list):
        raise RuntimeError("Ollama classification did not include a candidates array.")
    by_index = {int(article["sourceIndex"]): article for article in articles}
    results: list[dict[str, Any]] = []
    returned_indexes: set[int] = set()
    for candidate in raw_candidates:
        if not isinstance(candidate, dict):
            continue
        try:
            source_index = int(candidate.get("sourceIndex"))
        except (TypeError, ValueError):
            continue
        article = by_index.get(source_index)
        if not article or source_index in returned_indexes:
            continue
        returned_indexes.add(source_index)
        relevant = candidate.get("relevant") is True
        company_name = clean(candidate.get("companyName"))
        if relevant and not company_name:
            relevant = False
        signal_type = clean(candidate.get("signalType"))
        service_line = clean(candidate.get("serviceLine"))
        confidence = candidate.get("confidence")
        if signal_type not in ALLOWED_SIGNAL_TYPES:
            signal_type = "NEWS"
            relevant = False
        if service_line not in ALLOWED_SERVICE_LINES:
            service_line = str(article["serviceHint"])
            relevant = False
        if not isinstance(confidence, int) or confidence < 0 or confidence > 100:
            confidence = 0
            relevant = False
        if confidence < 50:
            relevant = False
        results.append(
            {
                "sourceIndex": source_index,
                "sourceUrl": article["sourceUrl"],
                "sourceName": article["sourceName"],
                "sourcePublishedAt": article["sourcePublishedAt"],
                "articleTitle": article["articleTitle"],
                "queryId": article["queryId"],
                "relevant": relevant,
                "companyName": company_name,
                "signalType": signal_type,
                "serviceLine": service_line,
                "opportunityTitle": bounded_text(
                    candidate.get("opportunityTitle"), article["articleTitle"], 300
                ),
                "summary": bounded_text(candidate.get("summary"), article["articleTitle"], 2000),
                "geography": bounded_optional_text(candidate.get("geography"), 200),
                "confidence": confidence,
                "rationale": bounded_text(
                    candidate.get("rationale"), "Classification evidence was insufficient.", 1000
                ),
                "evidence": [
                    str(value).strip()[:500]
                    for value in candidate.get("evidence", [])
                    if isinstance(value, str) and value.strip()
                ][:5],
            }
        )

    for source_index, article in by_index.items():
        if source_index in returned_indexes:
            continue
        results.append(
            {
                "sourceIndex": source_index,
                "sourceUrl": article["sourceUrl"],
                "sourceName": article["sourceName"],
                "sourcePublishedAt": article["sourcePublishedAt"],
                "articleTitle": article["articleTitle"],
                "queryId": article["queryId"],
                "relevant": False,
                "companyName": None,
                "signalType": "NEWS",
                "serviceLine": article["serviceHint"],
                "opportunityTitle": article["articleTitle"][:300],
                "summary": article["articleTitle"][:2000],
                "geography": None,
                "confidence": 0,
                "rationale": "The classifier omitted this source record.",
                "evidence": [],
            }
        )
    return sorted(results, key=lambda item: int(item["sourceIndex"]))


def bounded_text(value: Any, fallback: str, maximum: int) -> str:
    normalized = clean(value) or fallback
    return normalized[:maximum]


def bounded_optional_text(value: Any, maximum: int) -> Optional[str]:
    normalized = clean(value)
    return normalized[:maximum] if normalized else None


def classify_articles(
    base_url: str,
    model: str,
    articles: list[dict[str, Any]],
    batch_size: int,
) -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []
    for start in range(0, len(articles), batch_size):
        batch = articles[start : start + batch_size]
        response = ollama_request(base_url, model, batch)
        results.extend(normalize_classifications(batch, response.get("candidates")))
    return results


def report_failure(newl_base_url: str, token: str, run_id: str, error: Exception) -> None:
    try:
        api_request(
            newl_base_url,
            token,
            "POST",
            "/api/lead-gen/hunter/signal-scout/fail",
            {"runId": run_id, "errorMessage": str(error)[:1000]},
        )
    except Exception:
        pass


def run_signal_scout(force: bool = False, dry_run: bool = False) -> dict[str, Any]:
    newl_base_url = required_env("NEWL_APPS_BASE_URL")
    token = required_env("INGESTION_API_TOKEN")
    headers = {"x-hunter-signal-scout-force": "true"} if force else None
    if headers:
        # api_request intentionally has a fixed machine-auth surface. Force is used only by
        # this local operator command, so call the same endpoint with an explicit request.
        request = urllib.request.Request(
            f"{newl_base_url.rstrip('/')}/api/lead-gen/hunter/signal-scout/prepare",
            data=b"{}",
            method="POST",
            headers={
                "Authorization": f"Bearer {token}",
                "Accept": "application/json",
                "Content-Type": "application/json",
                "x-hunter-signal-scout-force": "true",
                **(
                    {"x-vercel-protection-bypass": os.environ["VERCEL_AUTOMATION_BYPASS_SECRET"]}
                    if clean(os.environ.get("VERCEL_AUTOMATION_BYPASS_SECRET"))
                    else {}
                ),
            },
        )
        with urllib.request.urlopen(request, timeout=120) as response:
            prepared = json.loads(response.read().decode("utf-8", "replace"))
    else:
        prepared = api_request(
            newl_base_url,
            token,
            "POST",
            "/api/lead-gen/hunter/signal-scout/prepare",
            {},
        )
    data = prepared.get("data") if isinstance(prepared.get("data"), dict) else {}
    if data.get("state") != "ready":
        return data
    run_id = clean(data.get("runId"))
    packet = data.get("packet") if isinstance(data.get("packet"), dict) else None
    if not run_id or packet is None:
        raise RuntimeError("Newl Apps did not return a Hunter signal scout packet.")

    try:
        articles, query_results, discovery_metrics = collect_articles(packet)
        model = clean(os.environ.get("HUNTER_CLASSIFICATION_MODEL")) or str(
            packet.get("model", {}).get("recommended") or DEFAULT_MODEL
        )
        ollama_url = clean(os.environ.get("HUNTER_OLLAMA_BASE_URL")) or DEFAULT_OLLAMA_URL
        if not re.fullmatch(r"http://(127\.0\.0\.1|localhost)(:\d+)?", ollama_url):
            raise RuntimeError("HUNTER_OLLAMA_BASE_URL must use localhost or 127.0.0.1 over HTTP.")
        batch_size = max(1, min(10, int(os.environ.get("HUNTER_CLASSIFICATION_BATCH_SIZE", "6"))))
        candidates = classify_articles(ollama_url, model, articles, batch_size) if articles else []
        completion = {
            "model": {
                "provider": "OLLAMA",
                "name": model,
                "promptVersion": PROMPT_VERSION,
                "structuredOutput": True,
            },
            "discovery": {
                "provider": "BRAVE_WEB",
                "lookbackHours": int(packet.get("discovery", {}).get("lookbackHours") or 744),
                "fetchedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
                "queries": query_results,
                **discovery_metrics,
            },
            "candidates": candidates,
        }
        if dry_run:
            report_failure(newl_base_url, token, run_id, RuntimeError("Local dry run intentionally stopped before persistence."))
            return {
                "state": "dry_run",
                "runId": run_id,
                "articleCount": len(articles),
                "candidateCount": len(candidates),
                "acceptedCount": sum(1 for item in candidates if item["relevant"]),
                **discovery_metrics,
                "model": model,
            }
        response = api_request(
            newl_base_url,
            token,
            "POST",
            "/api/lead-gen/hunter/signal-scout/complete",
            {"runId": run_id, "completion": completion},
        )
        return response.get("data") if isinstance(response.get("data"), dict) else response
    except Exception as error:
        report_failure(newl_base_url, token, run_id, error)
        raise


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--force", action="store_true", help="Run again even if today's scout already attempted.")
    parser.add_argument("--dry-run", action="store_true", help="Classify without persisting signals.")
    args = parser.parse_args()
    print(json.dumps(run_signal_scout(force=args.force, dry_run=args.dry_run), indent=2))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f"Hunter signal scout failed: {error}", file=os.sys.stderr)
        raise SystemExit(1)
