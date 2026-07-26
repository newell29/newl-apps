#!/usr/bin/env python3
"""Evidence-first company research for Hunter's dry-run prospecting plan."""

from __future__ import annotations

import argparse
import datetime as dt
import html
import ipaddress
import json
import os
import re
import socket
import time
import urllib.error
import urllib.parse
import urllib.request
from html.parser import HTMLParser
from typing import Any, Optional

from hunter_ingest import api_request, clean, required_env


DEFAULT_OLLAMA_URL = "http://127.0.0.1:11434"
DEFAULT_QWEN_MODEL = "qwen3.5:35b"
DEFAULT_KIMI_URL = "https://api.moonshot.ai/v1"
DEFAULT_KIMI_MODEL = "kimi-k2.6"
DEFAULT_KIMI_VALIDATOR_MODEL = "kimi-k3"
PROMPT_VERSION = "hunter-company-research-v9"
ALLOWED_SERVICE_LINES = {"WAREHOUSING", "OCEAN_AIR", "TRUCKING"}
ALLOWED_OPERATING_REGIONS = {"NORTH_AMERICA", "CHINA", "OTHER_FOREIGN", "UNKNOWN"}
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
ALLOWED_PASSES = {"IDENTITY", "FRESH_EVENTS", "CAREERS", "DISTRIBUTION_FOOTPRINT", "FOLLOW_UP"}
SOURCE_TYPES = {"FIRST_PARTY", "GOVERNMENT", "NEWS", "CAREERS", "DIRECTORY", "OTHER"}
MAX_RESPONSE_BYTES = 2_000_000
MAX_PAGE_BYTES = 400_000
LEGAL_SUFFIXES = {
    "co",
    "company",
    "corp",
    "corporation",
    "inc",
    "incorporated",
    "llc",
    "ltd",
    "limited",
    "lp",
    "plc",
}
GENERIC_IDENTITY_MARKERS = {
    "americas",
    "compressors",
    "distribution",
    "holdings",
    "industries",
    "ips",
    "manufacturing",
    "north",
    "solutions",
    "systems",
}
REGIONAL_IDENTITY_MARKERS = {
    "america",
    "americas",
    "canada",
    "north america",
    "usa",
    "us",
}


SYNTHESIS_SCHEMA = {
    "type": "object",
    "properties": {
        "companies": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "companyKey": {"type": "string"},
                    "identityDisposition": {
                        "type": "string",
                        "enum": ["PASS", "AMBIGUOUS", "BLOCK"],
                    },
                    "identityConfidence": {"type": "integer", "minimum": 0, "maximum": 100},
                    "identityReason": {"type": "string"},
                    "logisticsProvider": {"type": "boolean"},
                    "namedExternalLogisticsProvider": {"type": "boolean"},
                    "stableExclusiveProviderEvidence": {"type": "boolean"},
                    "providerDisplacementEvidence": {"type": "boolean"},
                    "freshness": {
                        "type": "string",
                        "enum": ["FRESH", "CURRENT", "STALE", "NONE"],
                    },
                    "opportunitySummary": {"type": "string"},
                    "triggerEvidenceIndices": {
                        "type": "array",
                        "items": {"type": "integer", "minimum": 0},
                        "minItems": 1,
                        "maxItems": 5,
                    },
                    "geography": {"type": ["string", "null"]},
                    "companyCountry": {"type": ["string", "null"]},
                    "operatingRegion": {
                        "type": "string",
                        "enum": sorted(ALLOWED_OPERATING_REGIONS),
                    },
                    "verifiedUsDivision": {"type": "boolean"},
                    "usDivisionName": {"type": ["string", "null"]},
                    "usDivisionEvidenceIndices": {
                        "type": "array",
                        "items": {"type": "integer", "minimum": 0},
                        "maxItems": 5,
                    },
                    "serviceLine": {
                        "type": "string",
                        "enum": sorted(ALLOWED_SERVICE_LINES),
                    },
                    "signalType": {
                        "type": "string",
                        "enum": sorted(ALLOWED_SIGNAL_TYPES),
                    },
                    "confidence": {"type": "integer", "minimum": 0, "maximum": 100},
                    "rationale": {"type": "string"},
                    "missingEvidence": {
                        "type": "array",
                        "items": {"type": "string"},
                        "maxItems": 10,
                    },
                    "followUpQueries": {
                        "type": "array",
                        "items": {"type": "string"},
                        "maxItems": 2,
                    },
                },
                "required": [
                    "companyKey",
                    "identityDisposition",
                    "identityConfidence",
                    "identityReason",
                    "logisticsProvider",
                    "namedExternalLogisticsProvider",
                    "stableExclusiveProviderEvidence",
                    "providerDisplacementEvidence",
                    "freshness",
                    "opportunitySummary",
                    "triggerEvidenceIndices",
                    "geography",
                    "companyCountry",
                    "operatingRegion",
                    "verifiedUsDivision",
                    "usDivisionName",
                    "usDivisionEvidenceIndices",
                    "serviceLine",
                    "signalType",
                    "confidence",
                    "rationale",
                    "missingEvidence",
                    "followUpQueries",
                ],
            },
        }
    },
    "required": ["companies"],
}

VALIDATION_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "companies": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "companyKey": {"type": "string"},
                    "disposition": {
                        "type": "string",
                        "enum": ["CONFIRM", "DOWNGRADE_TO_WATCHLIST"],
                    },
                    "validatedScore": {"type": "integer", "minimum": 0, "maximum": 100},
                    "confidence": {"type": "integer", "minimum": 0, "maximum": 100},
                    "rationale": {"type": "string"},
                    "riskFlags": {
                        "type": "array",
                        "items": {"type": "string"},
                        "maxItems": 5,
                    },
                    "supportingEvidenceIndices": {
                        "type": "array",
                        "items": {"type": "integer", "minimum": 0},
                        "minItems": 1,
                        "maxItems": 5,
                    },
                },
                "required": [
                    "companyKey",
                    "disposition",
                    "validatedScore",
                    "confidence",
                    "rationale",
                    "riskFlags",
                    "supportingEvidenceIndices",
                ],
            },
        }
    },
    "required": ["companies"],
}


SCORING_SCHEMA = {
    "type": "object",
    "properties": {
        "companies": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "companyKey": {"type": "string"},
                    "serviceLine": {
                        "type": "string",
                        "enum": sorted(ALLOWED_SERVICE_LINES),
                    },
                    "opportunityType": {"type": "string"},
                    "rationale": {"type": "string"},
                    "recommendedPersona": {"type": "string"},
                    "recommendedCadence": {"type": "string"},
                    "dimensionScores": {
                        "type": "object",
                        "properties": {
                            "demandTrigger": {"type": "integer", "minimum": 0, "maximum": 20},
                            "serviceFit": {"type": "integer", "minimum": 0, "maximum": 20},
                            "timing": {"type": "integer", "minimum": 0, "maximum": 20},
                            "accessibility": {"type": "integer", "minimum": 0, "maximum": 20},
                            "evidenceQuality": {"type": "integer", "minimum": 0, "maximum": 20},
                        },
                        "required": [
                            "demandTrigger",
                            "serviceFit",
                            "timing",
                            "accessibility",
                            "evidenceQuality",
                        ],
                    },
                    "totalScore": {"type": "integer", "minimum": 0, "maximum": 100},
                    "confidence": {"type": "integer", "minimum": 0, "maximum": 100},
                },
                "required": [
                    "companyKey",
                    "serviceLine",
                    "opportunityType",
                    "rationale",
                    "recommendedPersona",
                    "recommendedCadence",
                    "dimensionScores",
                    "totalScore",
                    "confidence",
                ],
            },
        }
    },
    "required": ["companies"],
}


class DuckDuckGoParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.results: list[dict[str, str]] = []
        self._active: Optional[str] = None
        self._href: Optional[str] = None
        self._text: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, Optional[str]]]) -> None:
        attributes = dict(attrs)
        classes = attributes.get("class") or ""
        if tag == "a" and "result__a" in classes:
            self._active = "title"
            self._href = attributes.get("href")
            self._text = []
        elif tag in {"a", "div"} and "result__snippet" in classes:
            self._active = "snippet"
            self._text = []

    def handle_data(self, data: str) -> None:
        if self._active:
            self._text.append(data)

    def handle_endtag(self, tag: str) -> None:
        if not self._active or tag not in {"a", "div"}:
            return
        value = " ".join("".join(self._text).split())
        if self._active == "title" and self._href and value:
            self.results.append({"title": value, "url": unwrap_duckduckgo_url(self._href), "snippet": ""})
        elif self._active == "snippet" and self.results and value:
            self.results[-1]["snippet"] = value
        self._active = None
        self._href = None
        self._text = []


class VisibleTextParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self._ignored_depth = 0
        self.parts: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, Optional[str]]]) -> None:
        if tag in {"script", "style", "noscript", "svg"}:
            self._ignored_depth += 1

    def handle_endtag(self, tag: str) -> None:
        if tag in {"script", "style", "noscript", "svg"} and self._ignored_depth:
            self._ignored_depth -= 1

    def handle_data(self, data: str) -> None:
        if self._ignored_depth == 0:
            normalized = " ".join(data.split())
            if normalized:
                self.parts.append(normalized)


class PublicHttpsRedirectHandler(urllib.request.HTTPRedirectHandler):
    def redirect_request(
        self,
        request: urllib.request.Request,
        file_pointer: Any,
        code: int,
        message: str,
        headers: Any,
        new_url: str,
    ) -> Optional[urllib.request.Request]:
        safe_url = ensure_public_https_url(urllib.parse.urljoin(request.full_url, new_url))
        return super().redirect_request(request, file_pointer, code, message, headers, safe_url)


def unwrap_duckduckgo_url(value: str) -> str:
    parsed = urllib.parse.urlparse(html.unescape(value))
    parameters = urllib.parse.parse_qs(parsed.query)
    target = parameters.get("uddg", [None])[0]
    return urllib.parse.unquote(target) if target else html.unescape(value)


def bounded_text(value: Any, fallback: str, maximum: int) -> str:
    normalized = clean(value) or fallback
    return " ".join(str(normalized).split())[:maximum]


def bounded_utf16_text(value: Any, fallback: str, maximum_code_units: int) -> str:
    normalized = " ".join(str(clean(value) or fallback).split())
    encoded = normalized.encode("utf-16-le")
    if len(encoded) <= maximum_code_units * 2:
        return normalized
    return encoded[:maximum_code_units * 2].decode("utf-16-le", "ignore")


def normalized_hostname(value: str) -> str:
    return urllib.parse.urlparse(value).hostname.lower() if urllib.parse.urlparse(value).hostname else ""


def ensure_public_https_url(value: str) -> str:
    parsed = urllib.parse.urlparse(value)
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
        raise RuntimeError("Hunter research accepts public HTTPS URLs only.")
    hostname = parsed.hostname.lower()
    if hostname in {"localhost", "localhost.localdomain"} or hostname.endswith(".local"):
        raise RuntimeError("Hunter research cannot retrieve local hosts.")
    try:
        addresses = socket.getaddrinfo(hostname, parsed.port or 443, type=socket.SOCK_STREAM)
    except socket.gaierror as error:
        raise RuntimeError(f"Hunter research could not resolve {hostname}.") from error
    for address in addresses:
        ip = ipaddress.ip_address(address[4][0])
        if not ip.is_global:
            raise RuntimeError("Hunter research cannot retrieve private or non-global addresses.")
    return urllib.parse.urlunparse(parsed)


def fetch_bytes(request: urllib.request.Request, timeout: int, maximum: int) -> tuple[bytes, str, str]:
    opener = urllib.request.build_opener(PublicHttpsRedirectHandler())
    with opener.open(request, timeout=timeout) as response:
        final_url = ensure_public_https_url(response.geturl())
        content_type = response.headers.get("Content-Type", "")
        body = response.read(maximum + 1)
    if len(body) > maximum:
        raise RuntimeError("Hunter research response exceeded its size limit.")
    return body, final_url, content_type


def parse_brave_published_at(value: Any) -> Optional[str]:
    normalized = clean(value)
    if not normalized:
        return None
    try:
        parsed = dt.datetime.fromisoformat(normalized.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=dt.timezone.utc)
    return parsed.astimezone(dt.timezone.utc).isoformat()


def search_brave(query: str, api_key: str, limit: int) -> list[dict[str, Any]]:
    parameters = urllib.parse.urlencode(
        {"q": query, "count": str(limit), "search_lang": "en", "safesearch": "moderate"}
    )
    request = urllib.request.Request(
        f"https://api.search.brave.com/res/v1/web/search?{parameters}",
        headers={
            "Accept": "application/json",
            "X-Subscription-Token": api_key,
            "User-Agent": "Newl-Hunter-Research/1.0",
        },
    )
    body, _, _ = fetch_bytes(request, timeout=60, maximum=MAX_RESPONSE_BYTES)
    payload = json.loads(body.decode("utf-8", "replace"))
    rows = payload.get("web", {}).get("results", [])
    if not isinstance(rows, list):
        return []
    results: list[dict[str, Any]] = []
    for row in rows[:limit]:
        if not isinstance(row, dict):
            continue
        url = clean(row.get("url"))
        title = clean(row.get("title"))
        if not url or not title:
            continue
        try:
            ensure_public_https_url(url)
        except Exception:
            continue
        extra = row.get("extra_snippets") if isinstance(row.get("extra_snippets"), list) else []
        snippet = " ".join([clean(row.get("description")) or "", *[clean(item) or "" for item in extra]])
        results.append(
            {
                "url": url,
                "title": title,
                "snippet": bounded_text(snippet, title, 1_500),
                "publishedAt": parse_brave_published_at(row.get("page_age")),
            }
        )
    return results


def search_duckduckgo(query: str, limit: int) -> list[dict[str, Any]]:
    request = urllib.request.Request(
        "https://html.duckduckgo.com/html/",
        data=urllib.parse.urlencode({"q": query}).encode(),
        method="POST",
        headers={
            "Accept": "text/html",
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": "Newl-Hunter-Research/1.0",
        },
    )
    body, _, _ = fetch_bytes(request, timeout=60, maximum=MAX_RESPONSE_BYTES)
    parser = DuckDuckGoParser()
    parser.feed(body.decode("utf-8", "replace"))
    results: list[dict[str, Any]] = []
    for row in parser.results:
        try:
            ensure_public_https_url(row["url"])
        except Exception:
            continue
        results.append(row)
        if len(results) >= limit:
            break
    return results


def search_web(provider: str, query: str, limit: int) -> list[dict[str, Any]]:
    if provider == "BRAVE":
        return search_brave(query, required_env("HUNTER_BRAVE_SEARCH_API_KEY"), limit)
    if provider == "DUCKDUCKGO":
        return search_duckduckgo(query, limit)
    raise RuntimeError("HUNTER_RESEARCH_SEARCH_PROVIDER must be BRAVE or DUCKDUCKGO.")


def parse_page_published_at(value: str) -> Optional[str]:
    patterns = (
        r'<meta\b[^>]*(?:property|name)\s*=\s*["\'](?:article:published_time|datepublished)["\'][^>]*content\s*=\s*["\']([^"\']+)',
        r'<meta\b[^>]*content\s*=\s*["\']([^"\']+)["\'][^>]*(?:property|name)\s*=\s*["\'](?:article:published_time|datepublished)["\']',
        r'["\']datePublished["\']\s*:\s*["\']([^"\']+)',
    )
    for pattern in patterns:
        match = re.search(pattern, value, flags=re.IGNORECASE)
        if match:
            published_at = parse_brave_published_at(html.unescape(match.group(1)))
            if published_at:
                return published_at
    return None


def fetch_page_evidence(url: str) -> tuple[Optional[str], Optional[str]]:
    safe_url = ensure_public_https_url(url)
    request = urllib.request.Request(
        safe_url,
        headers={
            "Accept": "text/html,application/xhtml+xml",
            "User-Agent": "Newl-Hunter-Research/1.0",
        },
    )
    try:
        body, _, content_type = fetch_bytes(request, timeout=30, maximum=MAX_PAGE_BYTES)
    except Exception:
        return None, None
    if "html" not in content_type.lower():
        return None, None
    document = body.decode("utf-8", "replace")
    parser = VisibleTextParser()
    try:
        parser.feed(document)
    except Exception:
        return None, parse_page_published_at(document)
    return bounded_text(" ".join(parser.parts), "", 3_000) or None, parse_page_published_at(document)


def company_search_aliases(candidate: dict[str, Any]) -> list[str]:
    company = bounded_text(candidate.get("companyName"), "", 300)
    words = re.findall(r"[A-Za-z0-9]+", company)
    aliases = [company] if company else []
    without_suffix = list(words)
    while without_suffix and without_suffix[-1].lower() in LEGAL_SUFFIXES:
        without_suffix.pop()
    if without_suffix:
        aliases.append(" ".join(without_suffix))
    without_region = list(without_suffix)
    while without_region:
        last_two = " ".join(word.lower() for word in without_region[-2:])
        if len(without_region) >= 2 and last_two in REGIONAL_IDENTITY_MARKERS:
            without_region = without_region[:-2]
            continue
        if without_region[-1].lower() in REGIONAL_IDENTITY_MARKERS:
            without_region.pop()
            continue
        break
    if without_region and len("".join(without_region)) >= 5:
        aliases.append(" ".join(without_region))
    brand_words: list[str] = []
    for word in without_region:
        if brand_words and word.lower() in GENERIC_IDENTITY_MARKERS:
            break
        brand_words.append(word)
        if len(brand_words) >= 2:
            break
    if brand_words and len("".join(brand_words)) >= 5:
        aliases.append(" ".join(brand_words))
    return list(dict.fromkeys(alias for alias in aliases if alias))


def search_subject(candidate: dict[str, Any]) -> str:
    aliases = company_search_aliases(candidate)
    return "(" + " OR ".join(f'"{alias}"' for alias in aliases) + ")"


def is_likely_first_party(candidate: dict[str, Any], hostname: str) -> bool:
    normalized_host = hostname.lower().removeprefix("www.")
    company_domain = (clean(candidate.get("domain")) or "").lower().removeprefix("www.")
    if company_domain and (
        normalized_host == company_domain or normalized_host.endswith(f".{company_domain}")
    ):
        return True
    labels = normalized_host.split(".")
    if len(labels) < 2:
        return False
    registrable_label = re.sub(r"[^a-z0-9]+", "", labels[-2])
    if len(registrable_label) < 5:
        return False
    return any(
        re.sub(r"[^a-z0-9]+", "", alias.lower()) == registrable_label
        for alias in company_search_aliases(candidate)
    )


def build_research_queries(candidate: dict[str, Any]) -> list[dict[str, str]]:
    subject = search_subject(candidate)
    domain = clean(candidate.get("domain"))
    year = dt.datetime.now(dt.timezone.utc).year
    queries = [
        {
            "pass": "IDENTITY",
            "query": f"{subject} official company about parent ownership",
        },
        {
            "pass": "FRESH_EVENTS",
            "query": (
                f'{subject} (expansion OR "new facility" OR warehouse OR distribution OR investment '
                f'OR launch OR hiring) ({year - 1} OR {year})'
            ),
        },
        {
            "pass": "CAREERS",
            "query": (
                f'{"site:" + domain + " " if domain else ""}{subject} '
                "(careers OR jobs) (warehouse OR distribution OR logistics OR supply chain OR import)"
            ),
        },
        {
            "pass": "DISTRIBUTION_FOOTPRINT",
            "query": (
                f'{subject} ("distribution center" OR warehouse OR locations OR markets OR 3PL '
                'OR "logistics provider")'
            ),
        },
    ]
    if domain:
        queries.extend(
            [
                {
                    "pass": "IDENTITY",
                    "query": f"site:{domain} (about OR company OR ownership OR locations)",
                },
                {
                    "pass": "FRESH_EVENTS",
                    "query": (
                        f'site:{domain} (expansion OR "new facility" OR warehouse OR distribution '
                        f"OR investment OR launch OR hiring) ({year - 1} OR {year})"
                    ),
                },
            ]
        )
    return queries


def source_type_for(url: str, pass_id: str, first_party: bool) -> str:
    hostname = normalized_hostname(url)
    if pass_id == "CAREERS":
        return "CAREERS"
    if first_party:
        return "FIRST_PARTY"
    if hostname.endswith(".gov") or ".gov." in hostname:
        return "GOVERNMENT"
    if any(value in hostname for value in ("reuters.", "apnews.", "businesswire.", "prnewswire.")):
        return "NEWS"
    if any(value in hostname for value in ("linkedin.", "crunchbase.", "zoominfo.")):
        return "DIRECTORY"
    return "OTHER"


def collect_company_evidence(
    candidate: dict[str, Any],
    provider: str,
    results_per_query: int,
    pages_per_company: int,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], int]:
    evidence: list[dict[str, Any]] = []
    query_log: list[dict[str, Any]] = []
    fetched_pages = 0
    seen_urls: set[str] = set()
    for query_row in build_research_queries(candidate):
        query = query_row["query"]
        pass_id = query_row["pass"]
        try:
            results = search_web(provider, query, results_per_query)
            query_log.append({"query": query, "pass": pass_id, "resultCount": len(results), "error": None})
        except Exception as error:
            query_log.append({"query": query, "pass": pass_id, "resultCount": 0, "error": str(error)[:500]})
            continue
        for row in results:
            url = row["url"]
            canonical = canonical_url(url)
            if canonical in seen_urls:
                continue
            seen_urls.add(canonical)
            hostname = normalized_hostname(url)
            first_party = is_likely_first_party(candidate, hostname)
            excerpt = row.get("snippet") or row["title"]
            published_at = row.get("publishedAt")
            if fetched_pages < pages_per_company and (first_party or pass_id in {"FRESH_EVENTS", "CAREERS"}):
                page_excerpt, page_published_at = fetch_page_evidence(url)
                if page_excerpt:
                    excerpt = page_excerpt
                    fetched_pages += 1
                if page_published_at:
                    published_at = page_published_at
            evidence.append(
                {
                    "pass": pass_id,
                    "query": query[:500],
                    "title": bounded_text(row.get("title"), "Search result", 500),
                    "url": url,
                    "sourceDomain": hostname,
                    "sourceType": source_type_for(url, pass_id, first_party),
                    "publishedAt": published_at,
                    "excerpt": bounded_utf16_text(excerpt, row["title"], 2_000),
                    "firstParty": first_party,
                }
            )
            if len(evidence) >= 24:
                break
        if len(evidence) >= 24:
            break
    return evidence, query_log, fetched_pages


def canonical_url(value: str) -> str:
    parsed = urllib.parse.urlsplit(value)
    query = urllib.parse.parse_qsl(parsed.query, keep_blank_values=True)
    filtered = [(key, item) for key, item in query if not key.lower().startswith("utm_")]
    return urllib.parse.urlunsplit(
        (parsed.scheme.lower(), parsed.netloc.lower(), parsed.path.rstrip("/"), urllib.parse.urlencode(filtered), "")
    )


def ollama_synthesis_request(
    base_url: str,
    model: str,
    company_packets: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], dict[str, int]]:
    system_prompt = (
        "You are the evidence-synthesis stage of Hunter, Newl Group's logistics opportunity engine. "
        "You do not browse and you must use only the supplied TradeMining facts and public evidence. "
        "First resolve company identity and parent/beneficial owner. Block freight forwarders, carriers, "
        "brokers, for-hire warehouses, and 3PLs as prospects. A manufacturer, retailer, importer, or "
        "distributor with its own supply-chain, warehouse, transportation, or operations employees is a "
        "prospect, not a logistics provider. However, an organization that offers warehousing, transportation "
        "management, forwarding, brokerage, cross-docking, fulfillment, or similar logistics services to "
        "separate customers or member companies is a logisticsProvider even if it is member-owned, described "
        "as an industry consortium, or closely associated with manufacturers. Classify from the services it "
        "provides, not merely from its name or ownership. namedExternalLogisticsProvider is true only when the evidence "
        "explicitly names a separate carrier, forwarder, warehouse, or 3PL used by the prospect. "
        "stableExclusiveProviderEvidence is true only when evidence explicitly shows that named external "
        "relationship is current, stable, and exclusive or contractually committed; never infer it from "
        "ordinary internal operations. providerDisplacementEvidence is true when a disruption, service gap, "
        "rebid, outsourcing change, capacity need, or other credible reason to reconsider that provider is "
        "supported. FRESH means a material event whose supplied publishedAt value is within 18 months. "
        "The year in a search query and current crawl time are not event-date evidence. If a material event "
        "has no supplied publishedAt date, classify it as CURRENT at most. triggerEvidenceIndices must "
        "cite one to five supplied evidenceIndex values that directly support the opportunity summary. "
        "For FRESH, at least one cited item must describe that same material event and carry a recent "
        "publishedAt value; a recent generic company profile cannot date an unrelated old event. CURRENT means current "
        "operating footprint or hiring evidence without a discrete trigger. STALE or NONE must not be "
        "described as a near-term trigger. Never invent a location, facility, buyer, event, or relationship. "
        "Determine companyCountry and operatingRegion only from public identity evidence about the company "
        "or its verified parent, never from TradeMining shipment origin, foreign port, product, or routing "
        "facts. companyCountry must be the full human country name such as United States, Canada, France, "
        "or China; never return a region name or schema enum in companyCountry. NORTH_AMERICA means the United States or Canada. CHINA means a mainland-China operating "
        "company. OTHER_FOREIGN means a verified country outside the United States, Canada, and mainland "
        "China. Use UNKNOWN when public identity evidence does not establish the country. "
        "verifiedUsDivision is true only when supplied public evidence explicitly identifies a named U.S. "
        "operating subsidiary or division of the same company. A U.S. customer, shipment, distributor, "
        "port, address listing, or market presence alone is not a verified U.S. division. When true, provide "
        "usDivisionName and one to five exact evidenceIndex values; otherwise return null and an empty array. "
        "identityConfidence and confidence measure evidence reliability even when the opportunity is weak; "
        "do not set them to zero merely because no buying trigger or outsourcing evidence was found. A PASS "
        "identity should normally have identityConfidence of at least 70. Mark identity AMBIGUOUS when the "
        "candidate label is a facility, campus, address, department, truncated name, or unclear affiliate "
        "and the evidence does not establish it as an exact operating company or an unambiguous trade name. "
        "Do not silently substitute a plausible parent for an ambiguous candidate. "
        "Return one company for every supplied companyKey. You may request no more than two precise follow-up "
        "queries when a missing fact could materially change the decision."
    )
    user_prompt = (
        f"Prompt version: {PROMPT_VERSION}\n"
        "Synthesize these companies. Evidence is indexed within each company. Explain conflicts and list "
        "material missing evidence. Confidence measures the evidence, not sales enthusiasm.\n\n"
        f"{json.dumps(company_packets, ensure_ascii=False)}"
    )
    payload = {
        "model": model,
        "stream": False,
        "think": False,
        "format": SYNTHESIS_SCHEMA,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        "options": {"temperature": 0, "num_predict": 7000},
    }
    started = time.monotonic()
    request = urllib.request.Request(
        f"{base_url.rstrip('/')}/api/chat",
        data=json.dumps(payload).encode(),
        method="POST",
        headers={"Accept": "application/json", "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=900) as response:
            body = response.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as error:
        raise RuntimeError(f"Ollama returned HTTP {error.code}.") from error
    except urllib.error.URLError as error:
        raise RuntimeError(f"Ollama request failed: {error.reason}") from error
    try:
        envelope = json.loads(body)
        parsed = json.loads(envelope["message"]["content"])
        rows = parsed["companies"]
    except (json.JSONDecodeError, KeyError, TypeError) as error:
        raise RuntimeError("Ollama returned invalid structured company research.") from error
    if not isinstance(rows, list):
        raise RuntimeError("Ollama company research did not contain a companies array.")
    usage = {
        "inputTokens": int(envelope.get("prompt_eval_count") or 0),
        "outputTokens": int(envelope.get("eval_count") or 0),
        "durationMs": round((time.monotonic() - started) * 1000),
    }
    return rows, usage


def kimi_scoring_request(
    base_url: str,
    api_key: str,
    model: str,
    company_packets: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    system_prompt = (
        "You are the scoring stage of Hunter, Newl Group's logistics opportunity engine. Score only the "
        "supplied evidence and local synthesis. You cannot override identity, logistics-provider, stable "
        "exclusive external-provider, or "
        "evidence gates; the server applies those after your score. Score five 0-20 dimensions: demandTrigger "
        "(a concrete reason to buy now), serviceFit (60% warehousing, 30% ocean/air, 10% trucking business "
        "priority without inflating weak evidence), timing, accessibility (plausible buyer and approachable "
        "mid-market account), and evidenceQuality. totalScore must equal their sum. A shipment alone proves "
        "trade activity, not outsourcing intent. Current careers or footprint can support a moderate score; "
        "a fresh first-party expansion with a logistics implication can support a high score. Never invent."
    )
    user_prompt = (
        f"Prompt version: {PROMPT_VERSION}\n"
        "Return one result for every companyKey. Recommend the buyer persona and a specialized cadence "
        "category, but do not draft, enroll, or send outreach.\n\n"
        f"{json.dumps(company_packets, ensure_ascii=False)}"
    )
    payload = {
        "model": model,
        # Deterministic scoring uses K2.6 instant mode so a specified schema tool can be forced.
        "thinking": {"type": "disabled"},
        "temperature": 0.6,
        "max_tokens": 16_000,
        "tools": [
            {
                "type": "function",
                "function": {
                    "name": "submit_hunter_company_scores",
                    "description": "Submit the complete structured Hunter scoring batch.",
                    "parameters": SCORING_SCHEMA,
                },
            }
        ],
        "tool_choice": {
            "type": "function",
            "function": {"name": "submit_hunter_company_scores"},
        },
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
    }
    started = time.monotonic()
    request = urllib.request.Request(
        f"{base_url.rstrip('/')}/chat/completions",
        data=json.dumps(payload).encode(),
        method="POST",
        headers={
            "Accept": "application/json",
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=900) as response:
            body = response.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as error:
        detail = error.read(2_000).decode("utf-8", "replace") if error.fp else ""
        raise RuntimeError(f"Kimi returned HTTP {error.code}: {detail[:500]}") from error
    except urllib.error.URLError as error:
        raise RuntimeError(f"Kimi request failed: {error.reason}") from error
    try:
        envelope = json.loads(body)
        choice = envelope["choices"][0]
        message = choice["message"]
        tool_calls = message.get("tool_calls")
        if isinstance(tool_calls, list) and tool_calls:
            function = tool_calls[0].get("function")
            arguments = function.get("arguments") if isinstance(function, dict) else None
            parsed = parse_json_object(arguments)
            content = arguments
        else:
            content = message["content"]
            parsed = parse_json_object(content)
        rows = parsed["companies"]
    except (json.JSONDecodeError, KeyError, TypeError, IndexError) as error:
        finish_reason = clean(choice.get("finish_reason")) if isinstance(locals().get("choice"), dict) else None
        content_type = type(locals().get("content")).__name__
        content_length = len(content) if isinstance(locals().get("content"), str) else 0
        raise RuntimeError(
            "Kimi returned invalid structured company scoring "
            f"(finishReason={finish_reason or 'unknown'}, contentType={content_type}, "
            f"contentLength={content_length})."
        ) from error
    if not isinstance(rows, list):
        raise RuntimeError("Kimi scoring did not contain a companies array.")
    usage = envelope.get("usage") if isinstance(envelope.get("usage"), dict) else {}
    prompt_details = usage.get("prompt_tokens_details") if isinstance(usage.get("prompt_tokens_details"), dict) else {}
    return rows, {
        "inputTokens": int(usage.get("prompt_tokens") or 0),
        "cachedInputTokens": int(prompt_details.get("cached_tokens") or 0),
        "outputTokens": int(usage.get("completion_tokens") or 0),
        "durationMs": round((time.monotonic() - started) * 1000),
        "estimatedCostUsd": None,
    }

def kimi_validation_request(
    base_url: str,
    api_key: str,
    model: str,
    reasoning_effort: str,
    company_packets: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    system_prompt = (
        "You are the conservative final validator for Hunter's highest-ranked logistics opportunities. "
        "Use only the supplied public evidence, local synthesis, and K2.6 score. You cannot browse, promote "
        "a candidate, override any deterministic blocker, or raise the K2.6 score. CONFIRM only when the "
        "same cited evidence proves a material event within 18 months, the event has a concrete logistics "
        "implication, the company identity is exact, and the score is defensible. Otherwise choose "
        "DOWNGRADE_TO_WATCHLIST. validatedScore must be less than or equal to the supplied K2.6 score. "
        "supportingEvidenceIndices must cite the exact supplied evidenceIndex values used for the decision. "
        "Treat missing dates, weak company identity, generic growth language, ordinary operations, inaccessible "
        "foreign ownership, and unclear outsourcing need as downgrade risks. Never invent."
    )
    payload = {
        "model": model,
        "reasoning_effort": reasoning_effort.lower(),
        "max_tokens": 8_000,
        "response_format": {
            "type": "json_schema",
            "json_schema": {
                "name": "hunter_k3_opportunity_validation",
                "strict": True,
                "schema": VALIDATION_SCHEMA,
            },
        },
        "messages": [
            {"role": "system", "content": system_prompt},
            {
                "role": "user",
                "content": (
                    f"Prompt version: {PROMPT_VERSION}\n"
                    "Validate every supplied company conservatively. Return only the schema result.\n\n"
                    f"{json.dumps(company_packets, ensure_ascii=False)}"
                ),
            },
        ],
    }
    started = time.monotonic()
    request = urllib.request.Request(
        f"{base_url.rstrip('/')}/chat/completions",
        data=json.dumps(payload).encode(),
        method="POST",
        headers={
            "Accept": "application/json",
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=900) as response:
            body = response.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as error:
        detail = error.read(2_000).decode("utf-8", "replace") if error.fp else ""
        raise RuntimeError(f"Kimi K3 returned HTTP {error.code}: {detail[:500]}") from error
    except urllib.error.URLError as error:
        raise RuntimeError(f"Kimi K3 request failed: {error.reason}") from error
    try:
        envelope = json.loads(body)
        choice = envelope["choices"][0]
        parsed = parse_json_object(choice["message"]["content"])
        rows = parsed["companies"]
    except (json.JSONDecodeError, KeyError, TypeError, IndexError) as error:
        raise RuntimeError("Kimi K3 returned invalid structured validation.") from error
    if not isinstance(rows, list):
        raise RuntimeError("Kimi K3 validation did not contain a companies array.")
    usage = envelope.get("usage") if isinstance(envelope.get("usage"), dict) else {}
    prompt_details = usage.get("prompt_tokens_details") if isinstance(usage.get("prompt_tokens_details"), dict) else {}
    return rows, {
        "inputTokens": int(usage.get("prompt_tokens") or 0),
        "cachedInputTokens": int(prompt_details.get("cached_tokens") or 0),
        "outputTokens": int(usage.get("completion_tokens") or 0),
        "durationMs": round((time.monotonic() - started) * 1000),
        "estimatedCostUsd": None,
    }


def strip_json_fence(value: str) -> str:
    normalized = value.strip()
    if normalized.startswith("```"):
        normalized = re.sub(r"^```(?:json)?\s*", "", normalized)
        normalized = re.sub(r"\s*```$", "", normalized)
    return normalized


def parse_json_object(value: Any) -> dict[str, Any]:
    if not isinstance(value, str):
        raise json.JSONDecodeError("Model content is not text.", "", 0)
    normalized = strip_json_fence(value)
    try:
        parsed = json.loads(normalized)
    except json.JSONDecodeError:
        start = normalized.find("{")
        end = normalized.rfind("}")
        if start < 0 or end <= start:
            raise
        parsed = json.loads(normalized[start:end + 1])
    if not isinstance(parsed, dict):
        raise json.JSONDecodeError("Model content is not a JSON object.", normalized, 0)
    return parsed


def validate_synthesis(row: dict[str, Any], company_key: str) -> dict[str, Any]:
    if clean(row.get("companyKey")) != company_key:
        raise RuntimeError(f"Qwen omitted or changed companyKey {company_key}.")
    disposition = clean(row.get("identityDisposition"))
    freshness = clean(row.get("freshness"))
    service_line = clean(row.get("serviceLine"))
    signal_type = clean(row.get("signalType"))
    operating_region = clean(row.get("operatingRegion"))
    if disposition not in {"PASS", "AMBIGUOUS", "BLOCK"}:
        raise RuntimeError(f"Qwen returned an invalid identity disposition for {company_key}.")
    if freshness not in {"FRESH", "CURRENT", "STALE", "NONE"}:
        raise RuntimeError(f"Qwen returned invalid freshness for {company_key}.")
    if service_line not in ALLOWED_SERVICE_LINES or signal_type not in ALLOWED_SIGNAL_TYPES:
        raise RuntimeError(f"Qwen returned invalid Hunter enums for {company_key}.")
    if operating_region not in ALLOWED_OPERATING_REGIONS:
        raise RuntimeError(f"Qwen returned an invalid operating region for {company_key}.")
    raw_trigger_indices = row.get("triggerEvidenceIndices")
    if not isinstance(raw_trigger_indices, list) or not 1 <= len(raw_trigger_indices) <= 5:
        raise RuntimeError(f"Qwen must cite one to five trigger evidence records for {company_key}.")
    trigger_indices = [
        bounded_integer(item, 0, 23)
        for item in raw_trigger_indices
    ]
    verified_us_division = row.get("verifiedUsDivision") is True
    us_division_name = bounded_text(row.get("usDivisionName"), "", 300) or None
    raw_us_division_indices = row.get("usDivisionEvidenceIndices")
    if not isinstance(raw_us_division_indices, list) or len(raw_us_division_indices) > 5:
        raise RuntimeError(f"Qwen returned invalid U.S. division evidence for {company_key}.")
    us_division_indices = [
        bounded_integer(item, 0, 23)
        for item in raw_us_division_indices
    ]
    if verified_us_division and (not us_division_name or not us_division_indices):
        raise RuntimeError(f"Qwen must name and cite a verified U.S. division for {company_key}.")
    if not verified_us_division and us_division_indices:
        raise RuntimeError(f"Qwen cited a U.S. division without verifying one for {company_key}.")
    return {
        "identityDisposition": disposition,
        "identityConfidence": bounded_integer(row.get("identityConfidence"), 0, 100),
        "identityReason": bounded_text(row.get("identityReason"), "Identity unresolved.", 1_000),
        "logisticsProvider": row.get("logisticsProvider") is True,
        "namedExternalLogisticsProvider": row.get("namedExternalLogisticsProvider") is True,
        "stableExclusiveProviderEvidence": row.get("stableExclusiveProviderEvidence") is True,
        "providerDisplacementEvidence": row.get("providerDisplacementEvidence") is True,
        "freshness": freshness,
        "opportunitySummary": bounded_text(row.get("opportunitySummary"), "No opportunity summary.", 2_000),
        "geography": bounded_text(row.get("geography"), "", 300) or None,
        "companyCountry": bounded_text(row.get("companyCountry"), "", 200) or None,
        "operatingRegion": operating_region,
        "verifiedUsDivision": verified_us_division,
        "usDivisionName": us_division_name,
        "usDivisionEvidenceIndices": us_division_indices,
        "serviceLine": service_line,
        "signalType": signal_type,
        "confidence": bounded_integer(row.get("confidence"), 0, 100),
        "rationale": bounded_text(row.get("rationale"), "No rationale returned.", 2_000),
        "missingEvidence": bounded_string_list(row.get("missingEvidence"), 10, 300),
        "triggerEvidenceIndices": trigger_indices,
        "followUpQueries": bounded_string_list(row.get("followUpQueries"), 2, 500),
    }

def validate_k3_validation(
    row: dict[str, Any],
    company_key: str,
    maximum_score: int,
) -> dict[str, Any]:
    if clean(row.get("companyKey")) != company_key:
        raise RuntimeError(f"Kimi K3 omitted or changed companyKey {company_key}.")
    disposition = clean(row.get("disposition"))
    if disposition not in {"CONFIRM", "DOWNGRADE_TO_WATCHLIST"}:
        raise RuntimeError(f"Kimi K3 returned an invalid disposition for {company_key}.")
    validated_score = bounded_integer(row.get("validatedScore"), 0, 100)
    if validated_score > maximum_score:
        raise RuntimeError(f"Kimi K3 attempted to promote the score for {company_key}.")
    raw_indices = row.get("supportingEvidenceIndices")
    if not isinstance(raw_indices, list) or not 1 <= len(raw_indices) <= 5:
        raise RuntimeError(f"Kimi K3 must cite one to five evidence records for {company_key}.")
    return {
        "status": "VALIDATED",
        "disposition": disposition,
        "validatedScore": validated_score,
        "confidence": bounded_integer(row.get("confidence"), 0, 100),
        "rationale": bounded_text(row.get("rationale"), "No validation rationale returned.", 2_000),
        "riskFlags": bounded_string_list(row.get("riskFlags"), 5, 300),
        "supportingEvidenceIndices": [
            bounded_integer(item, 0, 23)
            for item in raw_indices
        ],
    }


def validate_scoring(row: dict[str, Any], company_key: str) -> dict[str, Any]:
    if clean(row.get("companyKey")) != company_key:
        raise RuntimeError(f"Kimi omitted or changed companyKey {company_key}.")
    service_line = clean(row.get("serviceLine"))
    if service_line not in ALLOWED_SERVICE_LINES:
        raise RuntimeError(f"Kimi returned an invalid service line for {company_key}.")
    raw_dimensions = row.get("dimensionScores")
    if not isinstance(raw_dimensions, dict):
        raise RuntimeError(f"Kimi omitted dimension scores for {company_key}.")
    dimensions = {
        name: bounded_integer(raw_dimensions.get(name), 0, 20)
        for name in ("demandTrigger", "serviceFit", "timing", "accessibility", "evidenceQuality")
    }
    total = bounded_integer(row.get("totalScore"), 0, 100)
    if sum(dimensions.values()) != total:
        raise RuntimeError(f"Kimi total score does not equal its dimensions for {company_key}.")
    return {
        "serviceLine": service_line,
        "opportunityType": bounded_text(row.get("opportunityType"), "Qualified logistics opportunity", 300),
        "rationale": bounded_text(row.get("rationale"), "No scoring rationale returned.", 2_000),
        "recommendedPersona": bounded_text(
            row.get("recommendedPersona"), "VP or Director of Supply Chain", 500
        ),
        "recommendedCadence": bounded_text(
            row.get("recommendedCadence"), "Evidence-led logistics opportunity", 300
        ),
        "dimensionScores": dimensions,
        "totalScore": total,
        "confidence": bounded_integer(row.get("confidence"), 0, 100),
    }


def bounded_integer(value: Any, minimum: int, maximum: int) -> int:
    if isinstance(value, bool):
        raise RuntimeError("Model returned a boolean where an integer was required.")
    try:
        parsed = int(value)
    except (TypeError, ValueError) as error:
        raise RuntimeError("Model returned an invalid integer.") from error
    if parsed < minimum or parsed > maximum:
        raise RuntimeError(f"Model integer must be between {minimum} and {maximum}.")
    return parsed


def bounded_string_list(value: Any, maximum_items: int, maximum_length: int) -> list[str]:
    if not isinstance(value, list):
        return []
    return [
        bounded_text(item, "", maximum_length)
        for item in value[:maximum_items]
        if bounded_text(item, "", maximum_length)
    ]


def batched(rows: list[Any], size: int) -> list[list[Any]]:
    return [rows[index:index + size] for index in range(0, len(rows), size)]


def select_model_evidence(
    evidence: list[dict[str, Any]],
    maximum_items: int = 5,
    maximum_excerpt_length: int = 700,
) -> list[dict[str, Any]]:
    """Choose a small, diverse evidence packet while preserving the full ledger elsewhere."""
    source_priority = {
        "FIRST_PARTY": 0,
        "GOVERNMENT": 1,
        "NEWS": 2,
        "CAREERS": 3,
        "OTHER": 4,
        "DIRECTORY": 5,
    }
    indexed = [
        {"evidenceIndex": index, **row}
        for index, row in enumerate(evidence)
        if isinstance(row, dict)
    ]
    ranked = sorted(
        indexed,
        key=lambda row: (
            source_priority.get(str(row.get("sourceType")), 9),
            0 if row.get("firstParty") is True else 1,
            int(row["evidenceIndex"]),
        ),
    )
    selected: list[dict[str, Any]] = []
    selected_indexes: set[int] = set()
    for pass_id in ("IDENTITY", "FRESH_EVENTS", "CAREERS", "DISTRIBUTION_FOOTPRINT", "FOLLOW_UP"):
        match = next((row for row in ranked if row.get("pass") == pass_id), None)
        if match is None:
            continue
        selected.append(match)
        selected_indexes.add(int(match["evidenceIndex"]))
        if len(selected) >= maximum_items:
            break
    for row in ranked:
        index = int(row["evidenceIndex"])
        if len(selected) >= maximum_items:
            break
        if index not in selected_indexes:
            selected.append(row)
            selected_indexes.add(index)
    return [
        {
            **row,
            "excerpt": bounded_text(
                row.get("excerpt"),
                bounded_text(row.get("title"), "No excerpt available.", maximum_excerpt_length),
                maximum_excerpt_length,
            ),
        }
        for row in selected
    ]


def synthesize_companies(
    ollama_url: str,
    model: str,
    candidates: list[dict[str, Any]],
    evidence_by_key: dict[str, list[dict[str, Any]]],
    batch_size: int,
) -> tuple[dict[str, dict[str, Any]], dict[str, int]]:
    results: dict[str, dict[str, Any]] = {}
    usage = {"inputTokens": 0, "outputTokens": 0, "durationMs": 0}
    for batch in batched(candidates, batch_size):
        packet = [
            {
                "companyKey": candidate["companyKey"],
                "companyName": candidate["companyName"],
                "domain": candidate.get("domain"),
                "priorityScore": candidate.get("priorityScore"),
                "primaryIndustry": candidate.get("primaryIndustry"),
                "shipmentEvidence": candidate.get("shipmentEvidence", []),
                "existingSignals": candidate.get("existingSignals", []),
                "publicEvidence": select_model_evidence(
                    evidence_by_key.get(candidate["companyKey"], [])
                ),
            }
            for candidate in batch
        ]
        rows, batch_usage = ollama_synthesis_request(ollama_url, model, packet)
        rows_by_key = {
            clean(row.get("companyKey")): row
            for row in rows
            if isinstance(row, dict) and clean(row.get("companyKey"))
        }
        for candidate in batch:
            key = candidate["companyKey"]
            row = rows_by_key.get(key)
            if not row:
                raise RuntimeError(f"Qwen did not return companyKey {key}.")
            results[key] = normalize_synthesis_for_evidence(
                candidate,
                evidence_by_key.get(key, []),
                validate_synthesis(row, key),
            )
        for name in usage:
            usage[name] += batch_usage[name]
    return results, usage


def score_companies(
    kimi_url: str,
    api_key: str,
    model: str,
    candidates: list[dict[str, Any]],
    evidence_by_key: dict[str, list[dict[str, Any]]],
    synthesis_by_key: dict[str, dict[str, Any]],
    batch_size: int,
) -> tuple[dict[str, dict[str, Any]], dict[str, Any]]:
    results: dict[str, dict[str, Any]] = {}
    usage: dict[str, Any] = {
        "inputTokens": 0,
        "cachedInputTokens": 0,
        "outputTokens": 0,
        "durationMs": 0,
        "estimatedCostUsd": None,
    }
    for batch in batched(candidates, batch_size):
        packet = [
            {
                "companyKey": candidate["companyKey"],
                "companyName": candidate["companyName"],
                "priorityScore": candidate.get("priorityScore"),
                "primaryIndustry": candidate.get("primaryIndustry"),
                "shipmentEvidence": candidate.get("shipmentEvidence", []),
                "evidence": select_model_evidence(
                    evidence_by_key.get(candidate["companyKey"], [])
                ),
                "synthesis": synthesis_by_key[candidate["companyKey"]],
            }
            for candidate in batch
        ]
        try:
            rows, batch_usage = kimi_scoring_request(kimi_url, api_key, model, packet)
        except RuntimeError as error:
            batch_keys = ", ".join(str(candidate["companyKey"]) for candidate in batch)
            raise RuntimeError(f"Kimi scoring failed for [{batch_keys}]: {error}") from error
        rows_by_key = {
            clean(row.get("companyKey")): row
            for row in rows
            if isinstance(row, dict) and clean(row.get("companyKey"))
        }
        for candidate in batch:
            key = candidate["companyKey"]
            row = rows_by_key.get(key)
            if not row:
                raise RuntimeError(f"Kimi did not return companyKey {key}.")
            results[key] = validate_scoring(row, key)
        for name in ("inputTokens", "cachedInputTokens", "outputTokens", "durationMs"):
            usage[name] += batch_usage[name]
    usage["estimatedCostUsd"] = estimate_kimi_cost(
        usage["inputTokens"], usage["cachedInputTokens"], usage["outputTokens"]
    )
    return results, usage


def estimate_kimi_cost(input_tokens: int, cached_tokens: int, output_tokens: int) -> float:
    # Operator estimate only. Pricing changes; the stored token counts remain authoritative.
    uncached = max(0, input_tokens - cached_tokens)
    return round((uncached * 0.95 + cached_tokens * 0.16 + output_tokens * 4.00) / 1_000_000, 6)


def estimate_k3_cost(input_tokens: int, cached_tokens: int, output_tokens: int) -> float:
    # Operator estimate only. Pricing changes; the stored token counts remain authoritative.
    uncached = max(0, input_tokens - cached_tokens)
    return round((uncached * 3.00 + cached_tokens * 0.30 + output_tokens * 15.00) / 1_000_000, 6)


def is_recent_trigger(
    synthesis: dict[str, Any],
    evidence: list[dict[str, Any]],
) -> bool:
    cutoff = dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=548)
    latest = dt.datetime.now(dt.timezone.utc) + dt.timedelta(days=1)
    for index in synthesis.get("triggerEvidenceIndices", []):
        if not isinstance(index, int) or index < 0 or index >= len(evidence):
            continue
        row = evidence[index]
        if row.get("pass") not in {"FRESH_EVENTS", "FOLLOW_UP"}:
            continue
        published_at = clean(row.get("publishedAt"))
        if not published_at:
            continue
        try:
            parsed = dt.datetime.fromisoformat(published_at.replace("Z", "+00:00"))
        except ValueError:
            continue
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=dt.timezone.utc)
        if cutoff <= parsed.astimezone(dt.timezone.utc) <= latest:
            return True
    return False


def has_corroborating_first_party_identity(
    candidate: dict[str, Any],
    evidence: list[dict[str, Any]],
) -> bool:
    aliases = [
        re.sub(r"[^a-z0-9]+", "", alias.lower())
        for alias in company_search_aliases(candidate)
        if len(re.sub(r"[^a-z0-9]+", "", alias.lower())) >= 5
    ]
    for row in evidence:
        if (
            row.get("pass") != "IDENTITY"
            or row.get("firstParty") is not True
            or row.get("sourceType") != "FIRST_PARTY"
        ):
            continue
        text = re.sub(
            r"[^a-z0-9]+",
            "",
            f"{row.get('title') or ''} {row.get('excerpt') or ''}".lower(),
        )
        if any(alias in text for alias in aliases):
            return True
    return False


def has_explicit_provider_service_evidence(evidence: list[dict[str, Any]]) -> bool:
    direct_provider_pattern = re.compile(
        r"\b(provider|provides?|providing|offers?|offering)\b[^.\n]{0,120}"
        r"\b(logistics services?|warehousing services?|transportation management|"
        r"freight forwarding|customs brokerage|fulfillment services?|cross[- ]docking)\b",
        re.IGNORECASE,
    )
    on_behalf_pattern = re.compile(
        r"\b(warehousing|warehouse|packaging|distribution|transportation)\b"
        r"[^.\n]{0,120}\bon behalf of\b",
        re.IGNORECASE,
    )
    for row in evidence:
        if row.get("pass") == "CAREERS" and row.get("firstParty") is not True:
            continue
        text = f"{row.get('title') or ''}\n{row.get('excerpt') or ''}"
        if direct_provider_pattern.search(text) or on_behalf_pattern.search(text):
            return True
    return False


def has_explicit_stable_provider_evidence(evidence: list[dict[str, Any]]) -> bool:
    patterns = [
        re.compile(
            r"\b(exclusive|sole|long[- ]term|multi[- ]year|strategic)\b[^.\n]{0,120}"
            r"\b(logistics|warehousing|freight|fulfillment|transportation|3pl)\b"
            r"[^.\n]{0,80}\b(provider|partner|agreement|contract)\b",
            re.IGNORECASE,
        ),
        re.compile(
            r"\b(logistics|warehousing|freight|fulfillment|transportation|3pl)\b"
            r"[^.\n]{0,80}\b(provider|partner)\b[^.\n]{0,120}"
            r"\b(exclusive|sole|long[- ]term|multi[- ]year|strategic)\b",
            re.IGNORECASE,
        ),
    ]
    return any(
        pattern.search(f"{row.get('title') or ''}\n{row.get('excerpt') or ''}")
        for row in evidence
        for pattern in patterns
    )


def recent_material_trigger_indices(
    candidate: dict[str, Any],
    evidence: list[dict[str, Any]],
) -> list[int]:
    aliases = [
        re.sub(r"[^a-z0-9]+", "", alias.lower())
        for alias in company_search_aliases(candidate)
        if len(re.sub(r"[^a-z0-9]+", "", alias.lower())) >= 5
    ]
    material_pattern = re.compile(
        r"\b(major investment|breaks? ground|broke ground|"
        r"new (?:facility|warehouse|distribution cent(?:er|re)|manufacturing site)|"
        r"expands? (?:its |the )?(?:production|manufacturing|warehouse|distribution|facility)|"
        r"increas(?:e|es|ed|ing) (?:its )?(?:manufacturing |production )?capacity|"
        r"(?:facility|warehouse|distribution cent(?:er|re)) expansion|"
        r"establish(?:es|ed|ing)? .{0,60} manufacturing)\b",
        re.IGNORECASE,
    )
    indices: list[int] = []
    for index, row in enumerate(evidence):
        if row.get("pass") not in {"FRESH_EVENTS", "FOLLOW_UP"}:
            continue
        if row.get("sourceType") in {"CAREERS", "DIRECTORY"}:
            continue
        if not is_recent_trigger({"triggerEvidenceIndices": [index]}, evidence):
            continue
        text = f"{row.get('title') or ''} {row.get('excerpt') or ''}"
        normalized_text = re.sub(r"[^a-z0-9]+", "", text.lower())
        if not any(alias in normalized_text for alias in aliases):
            continue
        if material_pattern.search(text):
            indices.append(index)
    return indices[:3]


def normalize_synthesis_for_evidence(
    candidate: dict[str, Any],
    evidence: list[dict[str, Any]],
    synthesis: dict[str, Any],
) -> dict[str, Any]:
    normalized = dict(synthesis)
    missing_evidence = list(normalized.get("missingEvidence") or [])
    rationale = clean(normalized.get("rationale")) or ""
    material_trigger_indices = recent_material_trigger_indices(candidate, evidence)
    if normalized.get("freshness") != "FRESH" and material_trigger_indices:
        normalized["freshness"] = "FRESH"
        normalized["triggerEvidenceIndices"] = list(
            dict.fromkeys(
                material_trigger_indices + list(normalized.get("triggerEvidenceIndices") or [])
            )
        )[:5]
        message = (
            "Deterministic evidence review found an exact-company, recent, dated material expansion "
            "that the synthesis did not classify as fresh."
        )
        rationale = f"{rationale} {message}".strip()
    if normalized.get("freshness") == "FRESH" and not is_recent_trigger(normalized, evidence):
        normalized["freshness"] = "CURRENT"
        message = "No cited trigger has a verifiable publication date within 18 months; evaluated as current fit."
        if message not in missing_evidence:
            missing_evidence.append(message)
        rationale = f"{rationale} {message}".strip()
    if (
        normalized.get("identityDisposition") != "PASS"
        and has_corroborating_first_party_identity(candidate, evidence)
    ):
        normalized["identityDisposition"] = "PASS"
        normalized["identityConfidence"] = max(70, int(normalized.get("identityConfidence") or 0))
        normalized["confidence"] = max(60, int(normalized.get("confidence") or 0))
        identity_reason = clean(normalized.get("identityReason")) or ""
        normalized["identityReason"] = (
            f"{identity_reason} The candidate identity is directly corroborated by matching first-party evidence."
        ).strip()
    if normalized.get("logisticsProvider") is True and not has_explicit_provider_service_evidence(evidence):
        normalized["logisticsProvider"] = False
        message = "The provider label lacked explicit evidence that the company sells logistics services to others."
        if message not in missing_evidence:
            missing_evidence.append(message)
    if (
        normalized.get("stableExclusiveProviderEvidence") is True
        and not has_explicit_stable_provider_evidence(evidence)
    ):
        normalized["stableExclusiveProviderEvidence"] = False
        message = "The incumbent-provider label lacked explicit evidence of a stable or exclusive agreement."
        if message not in missing_evidence:
            missing_evidence.append(message)
    normalized["missingEvidence"] = missing_evidence[:10]
    normalized["rationale"] = rationale
    return normalized


def effective_operating_region(synthesis: dict[str, Any]) -> str:
    country = re.sub(
        r"[^a-z]+",
        " ",
        str(synthesis.get("companyCountry") or "").lower(),
    ).strip()
    if not country:
        return str(synthesis.get("operatingRegion") or "UNKNOWN")
    if country in {
        "united states",
        "united states of america",
        "usa",
        "us",
        "canada",
        "north america",
    }:
        return "NORTH_AMERICA"
    if country in {"china", "mainland china", "people s republic of china", "prc"}:
        return "CHINA"
    if country in {"unknown", "unclear"}:
        return "UNKNOWN"
    return "OTHER_FOREIGN"


def select_k3_candidates(
    candidates: list[dict[str, Any]],
    evidence_by_key: dict[str, list[dict[str, Any]]],
    synthesis_by_key: dict[str, dict[str, Any]],
    scoring_by_key: dict[str, dict[str, Any]],
    limit: int,
    minimum_score: int,
    minimum_confidence: int,
) -> list[dict[str, Any]]:
    eligible: list[dict[str, Any]] = []
    for candidate in candidates:
        key = candidate["companyKey"]
        synthesis = synthesis_by_key[key]
        scoring = scoring_by_key[key]
        evidence = evidence_by_key.get(key, [])
        passes = {str(row.get("pass")) for row in evidence}
        accessible_region = (
            effective_operating_region(synthesis) == "NORTH_AMERICA"
            or synthesis["verifiedUsDivision"] is True
        )
        if not (
            synthesis["identityDisposition"] == "PASS"
            and synthesis["identityConfidence"] >= 70
            and synthesis["logisticsProvider"] is False
            and not (
                synthesis["stableExclusiveProviderEvidence"]
                and not synthesis["providerDisplacementEvidence"]
            )
            and synthesis["freshness"] == "FRESH"
            and len(evidence) >= 2
            and "IDENTITY" in passes
            and len(passes) >= 2
            and is_recent_trigger(synthesis, evidence)
            and accessible_region
            and scoring["totalScore"] >= minimum_score
            and min(synthesis["confidence"], scoring["confidence"]) >= minimum_confidence
        ):
            continue
        eligible.append(candidate)
    return sorted(
        eligible,
        key=lambda candidate: (
            scoring_by_key[candidate["companyKey"]]["totalScore"],
            min(
                synthesis_by_key[candidate["companyKey"]]["confidence"],
                scoring_by_key[candidate["companyKey"]]["confidence"],
            ),
            int(candidate.get("priorityScore") or 0),
        ),
        reverse=True,
    )[:limit]


def validate_top_companies(
    kimi_url: str,
    api_key: str,
    model: str,
    reasoning_effort: str,
    candidates: list[dict[str, Any]],
    evidence_by_key: dict[str, list[dict[str, Any]]],
    synthesis_by_key: dict[str, dict[str, Any]],
    scoring_by_key: dict[str, dict[str, Any]],
) -> tuple[dict[str, dict[str, Any]], dict[str, Any]]:
    if not candidates:
        return {}, {
            "status": "SKIPPED",
            "candidateCount": 0,
            "inputTokens": 0,
            "cachedInputTokens": 0,
            "outputTokens": 0,
            "durationMs": 0,
            "estimatedCostUsd": 0.0,
            "errorMessage": None,
        }
    packet = [
        {
            "companyKey": candidate["companyKey"],
            "companyName": candidate["companyName"],
            "evidence": select_model_evidence(evidence_by_key[candidate["companyKey"]]),
            "synthesis": synthesis_by_key[candidate["companyKey"]],
            "k2Scoring": scoring_by_key[candidate["companyKey"]],
        }
        for candidate in candidates
    ]
    validation_started = time.monotonic()
    try:
        rows, usage = kimi_validation_request(
            kimi_url, api_key, model, reasoning_effort, packet
        )
        rows_by_key = {
            clean(row.get("companyKey")): row
            for row in rows
            if isinstance(row, dict) and clean(row.get("companyKey"))
        }
        results: dict[str, dict[str, Any]] = {}
        for candidate in candidates:
            key = candidate["companyKey"]
            row = rows_by_key.get(key)
            if not row:
                raise RuntimeError(f"Kimi K3 did not return companyKey {key}.")
            results[key] = validate_k3_validation(
                row, key, scoring_by_key[key]["totalScore"]
            )
        usage["status"] = "SUCCESS"
        usage["candidateCount"] = len(candidates)
        usage["estimatedCostUsd"] = estimate_k3_cost(
            usage["inputTokens"], usage["cachedInputTokens"], usage["outputTokens"]
        )
        usage["errorMessage"] = None
        return results, usage
    except Exception as error:
        return {
            candidate["companyKey"]: {
                "status": "ERROR",
                "disposition": None,
                "validatedScore": None,
                "confidence": None,
                "rationale": "Kimi K3 validation was unavailable; this candidate cannot become Hot.",
                "riskFlags": ["VALIDATOR_UNAVAILABLE"],
                "supportingEvidenceIndices": [],
            }
            for candidate in candidates
        }, {
            "status": "ERROR",
            "candidateCount": len(candidates),
            "inputTokens": 0,
            "cachedInputTokens": 0,
            "outputTokens": 0,
            "durationMs": round((time.monotonic() - validation_started) * 1000),
            "estimatedCostUsd": None,
            "errorMessage": bounded_text(error, "Kimi K3 validation failed.", 1_000),
        }


def collect_follow_up_evidence(
    provider: str,
    candidates: list[dict[str, Any]],
    synthesis_by_key: dict[str, dict[str, Any]],
    evidence_by_key: dict[str, list[dict[str, Any]]],
    query_log: list[dict[str, Any]],
    results_per_query: int,
    follow_up_limit: int,
) -> int:
    fetched_pages = 0
    for candidate in candidates:
        key = candidate["companyKey"]
        seen = {canonical_url(item["url"]) for item in evidence_by_key.get(key, [])}
        for query in synthesis_by_key[key]["followUpQueries"][:follow_up_limit]:
            try:
                results = search_web(provider, query, results_per_query)
                query_log.append(
                    {
                        "companyKey": key,
                        "query": query,
                        "pass": "FOLLOW_UP",
                        "resultCount": len(results),
                        "error": None,
                    }
                )
            except Exception as error:
                query_log.append(
                    {
                        "companyKey": key,
                        "query": query,
                        "pass": "FOLLOW_UP",
                        "resultCount": 0,
                        "error": str(error)[:500],
                    }
                )
                continue
            for row in results:
                url = row["url"]
                canonical = canonical_url(url)
                if canonical in seen:
                    continue
                seen.add(canonical)
                hostname = normalized_hostname(url)
                evidence_by_key[key].append(
                    {
                        "pass": "FOLLOW_UP",
                        "query": query[:500],
                        "title": bounded_text(row.get("title"), "Search result", 500),
                        "url": url,
                        "sourceDomain": hostname,
                        "sourceType": source_type_for(url, "FOLLOW_UP", False),
                        "publishedAt": row.get("publishedAt"),
                        "excerpt": bounded_utf16_text(row.get("snippet"), row["title"], 2_000),
                        "firstParty": False,
                    }
                )
                if len(evidence_by_key[key]) >= 24:
                    break
    return fetched_pages


def prepare_request(
    base_url: str,
    token: str,
    force: bool,
    company_keys: Optional[list[str]],
) -> dict[str, Any]:
    return api_request(
        base_url,
        token,
        "POST",
        "/api/lead-gen/hunter/company-research/prepare",
        {"force": force, "companyKeys": company_keys} if company_keys is not None else {"force": force},
    )


def report_failure(base_url: str, token: str, run_id: Optional[str], error: Exception) -> None:
    if not run_id:
        return
    try:
        api_request(
            base_url,
            token,
            "POST",
            "/api/lead-gen/hunter/company-research/fail",
            {"runId": run_id, "errorMessage": str(error)[:1_000]},
        )
    except Exception:
        pass


def write_checkpoint(path: Optional[str], payload: dict[str, Any]) -> None:
    if not path:
        return
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2, ensure_ascii=False)


def read_checkpoint(path: Optional[str]) -> Optional[dict[str, Any]]:
    if not path:
        return None
    with open(path, "r", encoding="utf-8") as handle:
        payload = json.load(handle)
    if not isinstance(payload, dict):
        raise RuntimeError("Hunter research checkpoint must be a JSON object.")
    return payload


def validate_checkpoint_cohort(
    checkpoint: dict[str, Any],
    candidates: list[dict[str, Any]],
) -> None:
    expected = [str(candidate["companyKey"]) for candidate in candidates]
    received = checkpoint.get("candidateKeys")
    if not isinstance(received, list) or received != expected:
        raise RuntimeError("Hunter research checkpoint does not match the newly prepared tenant cohort.")
    if checkpoint.get("promptVersion") != PROMPT_VERSION:
        raise RuntimeError("Hunter research checkpoint uses a different prompt contract.")


def run_company_research(
    force: bool = False,
    dry_run: bool = False,
    company_keys: Optional[list[str]] = None,
    replay_output: Optional[str] = None,
    resume_checkpoint: Optional[str] = None,
    research_only: bool = False,
) -> dict[str, Any]:
    base_url = required_env("NEWL_APPS_BASE_URL")
    token = required_env("INGESTION_API_TOKEN")
    prepared = prepare_request(base_url, token, force, company_keys)
    data = prepared.get("data") if isinstance(prepared.get("data"), dict) else {}
    if data.get("state") != "ready":
        return data
    run_id = clean(data.get("runId"))
    packet = data.get("packet") if isinstance(data.get("packet"), dict) else None
    if not run_id or packet is None:
        raise RuntimeError("Newl Apps did not return a Hunter company-research packet.")

    try:
        candidates = packet.get("candidates") if isinstance(packet.get("candidates"), list) else []
        provider = (clean(os.environ.get("HUNTER_RESEARCH_SEARCH_PROVIDER")) or "BRAVE").upper()
        results_per_query = max(
            1, min(10, int(os.environ.get("HUNTER_RESEARCH_RESULTS_PER_QUERY", "5")))
        )
        pages_per_company = max(
            0, min(8, int(os.environ.get("HUNTER_RESEARCH_PAGES_PER_COMPANY", "4")))
        )
        qwen_batch_size = max(
            1, min(8, int(os.environ.get("HUNTER_RESEARCH_QWEN_BATCH_SIZE", "4")))
        )
        kimi_batch_size = max(
            1, min(20, int(os.environ.get("HUNTER_RESEARCH_KIMI_BATCH_SIZE", "5")))
        )
        k3_validator_limit = max(
            0, min(10, int(os.environ.get("HUNTER_RESEARCH_K3_VALIDATOR_LIMIT", "5")))
        )
        k3_reasoning_effort = (
            clean(os.environ.get("HUNTER_RESEARCH_K3_REASONING_EFFORT")) or "LOW"
        ).upper()
        if k3_reasoning_effort not in {"LOW", "HIGH", "MAX"}:
            raise RuntimeError("HUNTER_RESEARCH_K3_REASONING_EFFORT must be LOW, HIGH, or MAX.")
        follow_up_limit = max(
            0, min(2, int(os.environ.get("HUNTER_RESEARCH_FOLLOW_UP_QUERIES", "2")))
        )
        ollama_url = clean(os.environ.get("HUNTER_OLLAMA_BASE_URL")) or DEFAULT_OLLAMA_URL
        if not re.fullmatch(r"http://(127\.0\.0\.1|localhost)(:\d+)?", ollama_url):
            raise RuntimeError("HUNTER_OLLAMA_BASE_URL must use localhost or 127.0.0.1 over HTTP.")
        qwen_model = clean(os.environ.get("HUNTER_RESEARCH_QWEN_MODEL")) or str(
            packet.get("models", {}).get("synthesis", {}).get("recommended") or DEFAULT_QWEN_MODEL
        )
        kimi_url = clean(os.environ.get("HUNTER_KIMI_BASE_URL")) or DEFAULT_KIMI_URL
        if kimi_url.rstrip("/") != DEFAULT_KIMI_URL:
            raise RuntimeError("HUNTER_KIMI_BASE_URL must use the approved Moonshot API endpoint.")
        kimi_model = clean(os.environ.get("HUNTER_KIMI_MODEL")) or str(
            packet.get("models", {}).get("scoring", {}).get("recommended") or DEFAULT_KIMI_MODEL
        )
        kimi_validator_model = clean(os.environ.get("HUNTER_KIMI_VALIDATOR_MODEL")) or str(
            packet.get("models", {}).get("validation", {}).get("recommended")
            or DEFAULT_KIMI_VALIDATOR_MODEL
        )

        checkpoint = read_checkpoint(resume_checkpoint)
        if checkpoint:
            validate_checkpoint_cohort(checkpoint, candidates)
        checkpoint_stage = clean(checkpoint.get("stage")) if checkpoint else None
        if checkpoint_stage in {"RETRIEVAL_COMPLETE", "SYNTHESIS_COMPLETE"}:
            raw_evidence = checkpoint.get("evidenceByKey")
            raw_queries = checkpoint.get("queryLog")
            if not isinstance(raw_evidence, dict) or not isinstance(raw_queries, list):
                raise RuntimeError("Hunter research checkpoint is missing retrieval data.")
            evidence_by_key = {
                str(key): value
                for key, value in raw_evidence.items()
                if isinstance(value, list)
            }
            query_log = [row for row in raw_queries if isinstance(row, dict)]
            page_fetch_count = int(checkpoint.get("pageFetchCount") or 0)
        else:
            evidence_by_key = {}
            query_log = []
            page_fetch_count = 0
            for candidate in candidates:
                if not isinstance(candidate, dict):
                    continue
                evidence, company_queries, page_count = collect_company_evidence(
                    candidate, provider, results_per_query, pages_per_company
                )
                key = str(candidate["companyKey"])
                evidence_by_key[key] = evidence
                query_log.extend([{"companyKey": key, **row} for row in company_queries])
                page_fetch_count += page_count
            write_checkpoint(
                replay_output,
                {
                    "stage": "RETRIEVAL_COMPLETE",
                    "version": 1,
                    "promptVersion": PROMPT_VERSION,
                    "candidateKeys": [candidate["companyKey"] for candidate in candidates],
                    "provider": provider,
                    "evidenceByKey": evidence_by_key,
                    "queryLog": query_log,
                    "pageFetchCount": page_fetch_count,
                },
            )

        if checkpoint_stage == "SYNTHESIS_COMPLETE":
            raw_synthesis = checkpoint.get("synthesisByKey")
            raw_qwen_usage = checkpoint.get("qwenUsage")
            if not isinstance(raw_synthesis, dict) or not isinstance(raw_qwen_usage, dict):
                raise RuntimeError("Hunter research checkpoint is missing synthesis data.")
            synthesis_by_key = {
                str(key): value
                for key, value in raw_synthesis.items()
                if isinstance(value, dict)
            }
            qwen_usage = {
                "inputTokens": int(raw_qwen_usage.get("inputTokens") or 0),
                "outputTokens": int(raw_qwen_usage.get("outputTokens") or 0),
                "durationMs": int(raw_qwen_usage.get("durationMs") or 0),
            }
        else:
            synthesis_by_key, qwen_usage = synthesize_companies(
                ollama_url, qwen_model, candidates, evidence_by_key, qwen_batch_size
            )
            has_follow_ups = follow_up_limit > 0 and any(
                row["followUpQueries"] for row in synthesis_by_key.values()
            )
            if has_follow_ups:
                page_fetch_count += collect_follow_up_evidence(
                    provider,
                    candidates,
                    synthesis_by_key,
                    evidence_by_key,
                    query_log,
                    results_per_query,
                    follow_up_limit,
                )
                final_synthesis, final_usage = synthesize_companies(
                    ollama_url, qwen_model, candidates, evidence_by_key, qwen_batch_size
                )
                for name in qwen_usage:
                    qwen_usage[name] += final_usage[name]
                synthesis_by_key = final_synthesis
            write_checkpoint(
                replay_output,
                {
                    "stage": "SYNTHESIS_COMPLETE",
                    "version": 1,
                    "promptVersion": PROMPT_VERSION,
                    "candidateKeys": [candidate["companyKey"] for candidate in candidates],
                    "provider": provider,
                    "evidenceByKey": evidence_by_key,
                    "queryLog": query_log,
                    "pageFetchCount": page_fetch_count,
                    "synthesisByKey": synthesis_by_key,
                    "qwenUsage": qwen_usage,
                },
            )

        if research_only:
            report_failure(
                base_url,
                token,
                run_id,
                RuntimeError("Research-only run intentionally stopped before hosted scoring."),
            )
            return {
                "state": "research_only",
                "runId": run_id,
                "companyCount": len(candidates),
                "evidenceCount": sum(len(rows) for rows in evidence_by_key.values()),
                "queryCount": len(query_log),
                "failedQueryCount": sum(1 for row in query_log if row.get("error")),
                "qwen": qwen_usage,
                "checkpoint": replay_output,
            }

        kimi_api_key = required_env("HUNTER_KIMI_API_KEY")
        scoring_by_key, kimi_usage = score_companies(
            kimi_url,
            kimi_api_key,
            kimi_model,
            candidates,
            evidence_by_key,
            synthesis_by_key,
            kimi_batch_size,
        )
        thresholds = packet.get("thresholds") if isinstance(packet.get("thresholds"), dict) else {}
        k3_candidates = select_k3_candidates(
            candidates,
            evidence_by_key,
            synthesis_by_key,
            scoring_by_key,
            k3_validator_limit,
            int(thresholds.get("minimumPriorityScore") or 35),
            int(thresholds.get("minimumSignalConfidence") or 50),
        )
        validation_by_key, k3_usage = validate_top_companies(
            kimi_url,
            kimi_api_key,
            kimi_validator_model,
            k3_reasoning_effort,
            k3_candidates,
            evidence_by_key,
            synthesis_by_key,
            scoring_by_key,
        )
        completion = {
            "models": {
                "synthesis": {
                    "provider": "OLLAMA",
                    "name": qwen_model,
                    "promptVersion": PROMPT_VERSION,
                    "structuredOutput": True,
                    **qwen_usage,
                },
                "scoring": {
                    "provider": "KIMI",
                    "name": kimi_model,
                    "promptVersion": PROMPT_VERSION,
                    "structuredOutput": True,
                    **kimi_usage,
                },
                "validation": {
                    "provider": "KIMI",
                    "name": kimi_validator_model,
                    "promptVersion": PROMPT_VERSION,
                    "structuredOutput": True,
                    "reasoningEffort": k3_reasoning_effort,
                    **k3_usage,
                },
            },
            "search": {
                "provider": provider,
                "retrievedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
                "queryCount": len(query_log),
                "pageFetchCount": page_fetch_count,
                "failedQueryCount": sum(1 for row in query_log if row.get("error")),
            },
            "companies": [
                {
                    "companyId": candidate["companyId"],
                    "companyKey": candidate["companyKey"],
                    "companyName": candidate["companyName"],
                    "evidence": evidence_by_key[candidate["companyKey"]],
                    "synthesis": {
                        key: value
                        for key, value in synthesis_by_key[candidate["companyKey"]].items()
                        if key != "followUpQueries"
                    },
                    "scoring": scoring_by_key[candidate["companyKey"]],
                    "validation": validation_by_key.get(
                        candidate["companyKey"],
                        {
                            "status": "NOT_SELECTED",
                            "disposition": None,
                            "validatedScore": None,
                            "confidence": None,
                            "rationale": None,
                            "riskFlags": [],
                            "supportingEvidenceIndices": [],
                        },
                    ),
                }
                for candidate in candidates
            ],
        }
        if replay_output:
            with open(replay_output, "w", encoding="utf-8") as handle:
                json.dump(completion, handle, indent=2, ensure_ascii=False)
        if dry_run:
            report_failure(
                base_url,
                token,
                run_id,
                RuntimeError("Company-research dry run intentionally stopped before persistence."),
            )
            return {
                "state": "dry_run",
                "runId": run_id,
                "companyCount": len(completion["companies"]),
                "evidenceCount": sum(
                    len(company["evidence"]) for company in completion["companies"]
                ),
                "search": completion["search"],
                "models": completion["models"],
                "output": replay_output,
            }
        response = api_request(
            base_url,
            token,
            "POST",
            "/api/lead-gen/hunter/company-research/complete",
            {"runId": run_id, "completion": completion},
        )
        return response.get("data") if isinstance(response.get("data"), dict) else response
    except Exception as error:
        report_failure(base_url, token, run_id, error)
        raise


def read_company_keys(path: Optional[str]) -> Optional[list[str]]:
    if not path:
        return None
    with open(path, "r", encoding="utf-8") as handle:
        payload = json.load(handle)
    if not isinstance(payload, list) or len(payload) > 100:
        raise RuntimeError("The company cohort file must contain an array of at most 100 company names or keys.")
    return [str(item) for item in payload]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--company-keys-file")
    parser.add_argument("--output", help="Optional path for the redacted completion ledger.")
    parser.add_argument("--resume-checkpoint", help="Resume a matching retrieval or Qwen checkpoint.")
    parser.add_argument(
        "--research-only",
        action="store_true",
        help="Stop after retrieval and Qwen, preserving a redacted checkpoint without calling Kimi.",
    )
    args = parser.parse_args()
    print(
        json.dumps(
            run_company_research(
                force=args.force,
                dry_run=args.dry_run,
                company_keys=read_company_keys(args.company_keys_file),
                replay_output=args.output,
                resume_checkpoint=args.resume_checkpoint,
                research_only=args.research_only,
            ),
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f"Hunter company research failed: {error}", file=os.sys.stderr)
        raise SystemExit(1)
