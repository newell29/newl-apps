#!/usr/bin/env python3
"""Isolated, read-only Hunter research pilot. Standard library; private durable journal.

The model selects one of six bounded actions. It cannot execute code, change its
configuration, mutate Newl Apps/Apollo, reveal emails, or communicate externally.
"""
from __future__ import annotations

import argparse
import datetime as dt
import fcntl
import hashlib
from html.parser import HTMLParser
import json
import os
from pathlib import Path
import re
import signal
import sys
import time
import urllib.request
import urllib.error
import uuid
from zoneinfo import ZoneInfo

from hunter_company_research import search_web, fetch_bytes, parse_page_published_at
from hunter_ingest import api_request
from pilot_subscription_model import SubscriptionModel

UTC = dt.timezone.utc
ZONE = ZoneInfo("America/Toronto")
REPO = Path(__file__).resolve().parents[3]
MISSION = Path(__file__).with_name("pilot-mission.md").read_text()
VERSION = "hunter-autonomous-pilot-v3"
DEFAULT_WAKE_STEPS = 3
EXTRACTOR_VERSION = "main-content-v2"
ACTIONS = ["search", "fetch", "open_company", "dismiss_clue", "people", "decide", "wait"]
DIRECTIONS = ["charlotte", "gta", "ocean", "referral"]
ENV_KEYS = {"INGESTION_API_TOKEN", "INGESTION_TENANT_SLUG", "HUNTER_BRAVE_SEARCH_API_KEY",
            "NEWL_APPS_BASE_URL", "VERCEL_AUTOMATION_BYPASS_SECRET"}
ARG_TYPES = {key: {"type": "string"} for key in ["query", "company", "url", "name", "domain", "hypothesis",
    "summary", "uncertainty", "nextAction", "quote", "quoteEvidenceId", "revisitWhen", "reason"]}
ARG_TYPES.update(direction={"type": "string", "enum": DIRECTIONS},
    status={"type": "string", "enum": ["active", "parked", "rejected", "recommended"]},
    evidenceIds={"type": "array", "items": {"type": "string"}},
    titles={"type": "array", "items": {"type": "string"}},
    revisitDays={"type": "integer", "minimum": 1, "maximum": 180},
    minutes={"type": "integer", "minimum": 30, "maximum": 1440})
CONTRACTS = {
    "search": (["query", "direction"], ["company"]), "fetch": (["url"], ["company"]),
    "open_company": (["name", "domain", "direction", "hypothesis", "evidenceIds"], []),
    "dismiss_clue": (["evidenceIds", "reason"], ["name", "domain"]),
    "people": (["company", "titles"], []),
    "decide": (["company", "status", "summary", "uncertainty", "nextAction", "evidenceIds", "revisitDays", "revisitWhen"], ["quote", "quoteEvidenceId"]),
    "wait": (["reason", "minutes"], [])}
SCHEMA = {"oneOf": [{"type": "object", "additionalProperties": False,
    "properties": {"action": {"const": action}, "purpose": {"type": "string"},
                   "args": {"type": "object", "additionalProperties": False,
                            "properties": {k: ARG_TYPES[k] for k in required + optional}, "required": required}},
    "required": ["action", "purpose", "args"]} for action, (required, optional) in CONTRACTS.items()]}
TOOLS = """
Return exactly one JSON action {action, purpose, args}. purpose states what the action will resolve.
direction must be exactly one of: charlotte, gta, ocean, referral.
search: {query, direction, company?} -- company is an existing domain, or omit for discovery.
fetch: {url, company?} -- read a public HTTPS page. Prefer official evidence and useful links.
open_company: {name, domain, direction, hypothesis, evidenceIds:[id,...]} -- remember a company
  supported by retrieved evidence. Domain deduplicates identity; all companies receive a safety check.
dismiss_clue: {evidenceIds:[id,...], reason, name?, domain?} -- remember why an unsaved clue is not worth
  more work. Use this for a named company that is clearly irrelevant or buyer-inappropriate; it is not
  a company rejection, suppression decision, or permanent statement about future fit.
people: {company, titles:[up to 8 roles]} -- zero-credit Apollo search, no email reveal. Use only
  after an official company page was fetched with company set to the saved domain, so that page evidence
  is attached to the company. Results never count as verified employment.
decide: {company, status:'active'|'parked'|'rejected'|'recommended', summary, uncertainty,
  nextAction, evidenceIds:[id,...], quote, quoteEvidenceId, revisitDays, revisitWhen}.
  company must be an already-saved domain from activeCompanies, dueForRevisit or otherCompanies.
  Do not create a company merely to reject it or call decide for an unknown company.
  A recommendation needs an exact supporting quote from a fetched official page. Missing evidence
  must remain explicit. Use active to pivot a hypothesis. Park/reject instead of filling a quota.
wait: {reason, minutes:30..1440} -- global pause, capped to 30 minutes. For a known company,
  use decide/parked with a revisit condition instead. One blocked clue is not global exhaustion.
No mandatory order or research passes. Do not loop over the same failed action. At most five active
companies; choose whether to finish/park one or explore a better direction. Complete useful decisions
instead of only collecting sources. After fetching a named company's official page for a stated
uncertainty, normally open it, dismiss the clue, or fetch one clearly necessary source before starting
another broad search. References must be actual evidence IDs in the journal.
buyerResearchQueue contains commercially recommended companies that have not yet received one tailored,
zero-credit people lookup. Normally finish one pending buyer-role check before another broad discovery
search unless an active investigation has an immediately decisive source. This prepares owner review;
it does not verify employment, reveal an email, approve outreach, or make contact mandatory for fit.
Work continues across wakes; do not try to finish all research in one search or one wake. Use
researchCoverage and unreadClues to consider alternatives after a dead end; neither is a quota.
"""


def now():
    return dt.datetime.now(UTC)


def iso(value):
    return value.astimezone(UTC).isoformat()


def parse_time(value):
    result = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
    if result.tzinfo is None:
        raise ValueError("Timestamp requires timezone")
    return result.astimezone(UTC)


def next_business_start(value):
    day = value.astimezone(ZONE).date() + dt.timedelta(days=1)
    while day.weekday() >= 5:
        day += dt.timedelta(days=1)
    return dt.datetime.combine(day, dt.time(9), ZONE)


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True).encode()).hexdigest()[:24]


def domain(value):
    value = str(value).strip().lower().removeprefix("https://").removeprefix("http://").removeprefix("www.").rstrip("/")
    if len(value) > 253 or not re.fullmatch(r"[a-z0-9.-]+\.[a-z]{2,}", value) or value.endswith(".local"):
        raise ValueError("Invalid company domain")
    return value


def text(value, maximum=1200):
    if not isinstance(value, str) or not value.strip() or len(value) > maximum:
        raise ValueError("Missing or oversized text")
    return value.strip().replace("\x00", "")


def atomic_write(path, data):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temporary = path.with_suffix(path.suffix + ".tmp")
    with open(temporary, "w", encoding="utf-8") as handle:
        os.chmod(temporary, 0o600)
        json.dump(data, handle, ensure_ascii=False, indent=2)
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(temporary, path)


def load_env(paths):
    # Explicit allowlist: unrelated production credentials never enter the worker.
    for path in paths:
        for line in Path(path).expanduser().read_text().splitlines():
            if "=" not in line or line.lstrip().startswith("#"):
                continue
            key, value = line.split("=", 1)
            if key.strip() in ENV_KEYS:
                value = value.strip()
                if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
                    value = value[1:-1]
                os.environ[key.strip()] = value.replace("\\n", "\n").strip()


class PublicDiscoveryBridge:
    """Existing approved read interface only. Never fabricates a suppression clearance.

    Public discovery can be evaluated before the production-side read bridge is
    available. Its companies remain NEEDS_CLEARANCE and its people tool is disabled.
    """
    def __call__(self, action, **_kwargs):
        base = os.environ.get("NEWL_APPS_BASE_URL", "").rstrip("/")
        if not base.startswith("https://"):
            raise RuntimeError("APP_URL_REQUIRED")
        response = api_request(base, os.environ.get("INGESTION_API_TOKEN", ""), "GET",
                               "/api/integrations/trademining/search-profiles")
        tenant = response.get("data", {}).get("tenant", {})
        slug = tenant.get("slug")
        if not slug or slug != os.environ.get("INGESTION_TENANT_SLUG"):
            raise RuntimeError("TENANT_MISMATCH")
        context = {"tenantId": "public-discovery:" + digest([base, slug]), "tenantSlug": slug,
                   "readOnly": True, "apolloAvailable": False, "suppressionAvailable": False}
        if action == "context":
            return context
        return {**context, "allowed": False, "reason": "LIVE_CLEARANCE_UNAVAILABLE"}


class RemoteReadBridge:
    """Use server-held credentials; the Mac receives no database or Apollo secret."""
    def __call__(self, action, **kwargs):
        base = os.environ.get("NEWL_APPS_BASE_URL", "").rstrip("/")
        if not base.startswith("https://"):
            raise RuntimeError("APP_URL_REQUIRED")
        response = api_request(base, os.environ.get("INGESTION_API_TOKEN", ""), "POST",
            "/api/lead-gen/hunter/pilot/read", {"action": action, **kwargs})
        result = response.get("data")
        if not isinstance(result, dict) or not result.get("tenantId"):
            raise RuntimeError("PILOT_READ_UNAVAILABLE")
        return result


class PilotTextParser(HTMLParser):
    """Prefer article/main content; don't spend the evidence window on repeated navigation."""
    VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"}
    IGNORE = {"script", "style", "noscript", "svg", "nav", "header", "footer", "aside", "form"}

    def __init__(self):
        super().__init__()
        self.stack, self.parts, self.main_parts = [], [], []

    def handle_starttag(self, tag, attrs):
        if tag in self.VOID:
            return
        attributes = dict(attrs)
        ignored = tag in self.IGNORE or attributes.get("role") == "navigation" or (self.stack and self.stack[-1][1])
        preferred = tag in {"main", "article"} or attributes.get("role") == "main" or (self.stack and self.stack[-1][2])
        self.stack.append((tag, bool(ignored), bool(preferred)))

    def handle_endtag(self, tag):
        for i in range(len(self.stack) - 1, -1, -1):
            if self.stack[i][0] == tag:
                del self.stack[i:]
                break

    def handle_data(self, data):
        value = " ".join(data.split())
        if value and not (self.stack and self.stack[-1][1]):
            self.parts.append(value)
            if self.stack and self.stack[-1][2]:
                self.main_parts.append(value)

    def content(self):
        preferred = " ".join(self.main_parts)
        return preferred if len(preferred) > 100 else " ".join(self.parts)


def fetch_public_page(url):
    from hunter_company_research import ensure_public_https_url
    request = urllib.request.Request(ensure_public_https_url(url), headers={
        "Accept": "text/html,application/xhtml+xml", "User-Agent": "Newl-Hunter-Pilot/1.0"})
    body, final_url, content_type = fetch_bytes(request, timeout=30, maximum=1_000_000)
    if "html" not in content_type.lower():
        return None, None, final_url
    document = body.decode("utf-8", "replace")
    parser = PilotTextParser()
    parser.feed(document)
    return parser.content()[:6000], parse_page_published_at(document), final_url


class LocalModel:
    def __init__(self, model, thinking=False):
        self.model = model
        self.thinking = thinking

    def __call__(self, context):
        request = urllib.request.Request("http://127.0.0.1:11434/api/chat", method="POST",
            headers={"Content-Type": "application/json"}, data=json.dumps({
                "model": self.model, "stream": False, "think": self.thinking, "format": SCHEMA,
                "messages": [{"role": "system", "content": MISSION + "\n" + TOOLS},
                             {"role": "user", "content": json.dumps(context, ensure_ascii=False)}],
                "options": {"temperature": 0.2, "num_ctx": 16384, "num_predict": 4096 if self.thinking else 1000},
                "keep_alive": "10m"
            }).encode())
        with urllib.request.urlopen(request, timeout=180) as response:
            payload = json.loads(response.read(100_000))
        return json.loads(payload["message"]["content"]), {
            "provider": "OLLAMA", "thinking": self.thinking,
            "inputTokens": payload.get("prompt_eval_count", 0), "outputTokens": payload.get("eval_count", 0)}


def configured_model(config):
    provider = config.get("modelProvider", "OLLAMA")
    if provider == "CHATGPT_SUBSCRIPTION":
        return SubscriptionModel(config["model"], MISSION, TOOLS, SCHEMA,
            binary=config.get("codexBinary"), effort=config.get("reasoningEffort", "medium"))
    if provider != "OLLAMA":
        raise ValueError("Unknown pilot model provider; no paid API fallback")
    return LocalModel(config["model"], thinking=config.get("localThinking", False))


class BudgetExceeded(Exception):
    pass


class Pilot:
    def __init__(self, directory, bridge=None, model=None, search=None, fetch=None, clock=now):
        self.directory = Path(directory).expanduser().resolve()
        self.config = json.loads((self.directory / "config.json").read_text())
        self.state_path = self.directory / "state.json"
        self.state = json.loads(self.state_path.read_text())
        self.clock = clock
        self.stop_requested = False
        self.bridge = bridge or (PublicDiscoveryBridge() if self.config.get("publicDiscoveryOnly") else RemoteReadBridge())
        self.model = model or configured_model(self.config)
        self.search = search or (lambda q: search_web(self.config["searchProvider"], q, 5))
        self.fetch = fetch or fetch_public_page
        if self.state["tenantId"] != self.config["tenantId"]:
            raise RuntimeError("TENANT_MISMATCH")

    def save(self):
        atomic_write(self.state_path, self.state)

    def event(self, kind, **values):
        self.state["events"].append({"at": iso(self.clock()), "kind": kind, **values})
        self.save()

    def guard(self):
        current = json.loads((self.directory / "config.json").read_text())
        if current != self.config:
            raise RuntimeError("CONFIG_CHANGED_RESTART_REQUIRED")
        if self.stop_requested or (self.directory / "STOP").exists():
            raise RuntimeError("STOP_REQUESTED")
        if self.clock() >= parse_time(self.config["expiresAt"]):
            raise RuntimeError("PILOT_EXPIRED")
        context = self.bridge("context")
        if context["tenantId"] != self.config["tenantId"] or context["tenantSlug"] != self.config["tenantSlug"]:
            raise RuntimeError("TENANT_MISMATCH")
        return context

    def budget(self):
        day = self.clock().astimezone(ZONE).date().isoformat()
        return self.state["budgets"].setdefault(day, {"searches": 0, "pages": 0, "people": 0,
            "modelCalls": 0, "modelSeconds": 0, "usdMicros": 0})

    def reserve(self, kind, cost=0):
        if not isinstance(cost, int) or cost < 0:
            raise ValueError("Invalid cost reservation")
        budget = self.budget()
        limits = self.config["limits"]
        if budget[kind] + 1 > limits[kind]:
            raise BudgetExceeded(kind)
        if budget["usdMicros"] + cost > limits["dailyUsdMicros"] or self.state["usdMicros"] + cost > limits["totalUsdMicros"]:
            raise BudgetExceeded("cash")
        if kind == "modelCalls" and budget["modelSeconds"] + 180 > limits["modelSeconds"]:
            raise BudgetExceeded("model_time")
        budget[kind] += 1
        budget["usdMicros"] += cost
        self.state["usdMicros"] += cost
        if kind == "modelCalls":
            budget["modelSeconds"] += 180  # reserve timeout; a crash cannot refund unobserved work
        self.save()  # reservation precedes the external call, including failed calls

    def evidence(self, row, kind, company=None):
        url = text(row["url"], 2000)
        key = digest([url, row.get("snippet", ""), kind])
        self.state["evidence"][key] = {"id": key, "url": url, "title": str(row.get("title", ""))[:200],
            "excerpt": str(row.get("snippet", ""))[:6000], "publishedAt": row.get("publishedAt"),
            "retrievedAt": iso(self.clock()), "kind": kind, "company": company,
            "extractorVersion": EXTRACTOR_VERSION if kind == "page" else None}
        return key

    def refs(self, args):
        ids = args.get("evidenceIds")
        if not isinstance(ids, list) or not 1 <= len(ids) <= 10 or any(i not in self.state["evidence"] for i in ids):
            raise ValueError("Cite actual retrieved evidence IDs")
        return list(dict.fromkeys(ids))

    def company(self, args):
        key = domain(args.get("company", ""))
        if key not in self.state["companies"]:
            raise ValueError("Open company before using its domain")
        return self.state["companies"][key]

    def ingest_feedback(self):
        processed = self.state.setdefault("feedbackFiles", [])
        for path in sorted((self.directory / "feedback").glob("*.json")):
            if path.name in processed:
                continue
            item = json.loads(path.read_text())
            if item.get("tenantId") != self.config["tenantId"] or item.get("company") not in self.state["companies"]:
                raise RuntimeError("INVALID_FEEDBACK_SCOPE")
            self.state["feedback"].append(item)
            company = self.state["companies"][item["company"]]
            if item["verdict"] in {"reject", "wrong_company", "poor_fit"}:
                company["status"] = "rejected"
                company["nextAction"] = "Owner feedback: " + item["note"]
            elif item["verdict"] in {"timing", "wrong_buyer"}:
                company["status"] = "parked"
                company["nextAction"] = "Reconsider using owner feedback: " + item["note"]
            # Acceptance is feedback only; it never promotes readiness or removes a safety hold.
            processed.append(path.name)
        self.save()

    def official_evidence(self, company):
        from urllib.parse import urlparse
        return [e for e in self.state["evidence"].values() if e["kind"] == "page" and e["excerpt"] and
                urlparse(e["url"]).hostname in {company["domain"], "www." + company["domain"]}]

    def buyer_research(self, company):
        attempted = "contactState" in company or bool(company.get("contactResearchAt"))
        candidates = company.get("contacts", [])
        return {"state": "COMPLETED" if attempted else "PENDING",
                "contactState": company.get("contactState", "NOT_RESEARCHED"),
                "candidateCount": len(candidates) if isinstance(candidates, list) else 0,
                "titles": company.get("contactTitles", []),
                "researchedAt": company.get("contactResearchAt"),
                "employmentVerified": False,
                "outreachReady": False}

    def safety(self, company):
        result = self.bridge("company", name=company["name"], domain=company["domain"])
        if result.get("tenantId") != self.config["tenantId"]:
            raise RuntimeError("TENANT_MISMATCH")
        if self.config.get("publicDiscoveryOnly") and result.get("reason") == "LIVE_CLEARANCE_UNAVAILABLE":
            company["clearance"] = "NEEDS_CLEARANCE"
            return
        if not result.get("allowed"):
            company["status"] = "blocked"
            company["nextAction"] = result.get("reason", "SAFETY_HOLD")
            self.save()
            raise ValueError("Company is blocked by Newl controls; do not investigate further")
        company["clearance"] = "RESEARCH_ALLOWED_NOT_OUTREACH_APPROVED"

    def cache_key(self, action, args):
        if action == "search":
            return digest([action, sorted(re.findall(r"[\w]+", args["query"].casefold()))])
        if action == "fetch":
            from urllib.parse import urlsplit, urlunsplit
            url = urlsplit(args["url"])
            return digest([action, EXTRACTOR_VERSION, urlunsplit((url.scheme, url.netloc.lower(), url.path.rstrip("/"), url.query, ""))])
        if action == "people":
            return digest([action, args["company"], sorted(t.lower().strip() for t in args["titles"])])
        return None

    def execute(self, action):
        if not isinstance(action, dict) or action.get("action") not in ACTIONS or not isinstance(action.get("args"), dict):
            raise ValueError("Invalid action contract")
        name, args = action["action"], action["args"]
        required, optional = CONTRACTS[name]
        if any(k not in args for k in required) or set(args) - set(required + optional):
            raise ValueError("Action arguments must follow the tool contract; required: " + ", ".join(required))
        if isinstance(args.get("company"), str) and args["company"] not in self.state["companies"]:
            matches = [c["domain"] for c in self.state["companies"].values()
                       if c["name"].casefold() == args["company"].strip().casefold()]
            if len(matches) == 1:
                args = {**args, "company": matches[0]}  # exact known label only; never fuzzy remap
        if name in {"search", "fetch"} and args.get("company") not in self.state["companies"]:
            # An optional discovery hint must not force company creation before reading a public clue.
            args = {k: v for k, v in args.items() if k != "company"}
        purpose = text(action.get("purpose"), 700)
        self.guard()  # kill switch and tenant rechecked before every action
        key = self.cache_key(name, args)
        if key and key in self.state["attempts"]:
            attempt = self.state["attempts"][key]
            cooldown = 1 if name == "fetch" else 7
            if self.clock() - parse_time(attempt["at"]) < dt.timedelta(days=cooldown):
                result = {"state": "cached_or_already_attempted", "previous": attempt,
                          "retryAfter": iso(parse_time(attempt["at"]) + dt.timedelta(days=cooldown)),
                          "nextStep": "Do not repeat or paraphrase this lookup. Resolve a different uncertainty, change research direction, or wait."}
                self.event("action", action=name, purpose=purpose, company=args.get("company"), result=result)
                return result
        if name in {"search", "fetch"} and args.get("company"):
            self.safety(self.company(args))
        # Save the attempt BEFORE I/O, so interrupted/failed lookups are not repeated on restart.
        if key:
            self.state["attempts"][key] = {"at": iso(self.clock()), "action": name, "purpose": purpose,
                "query": args.get("query"), "url": args.get("url"), "direction": args.get("direction"), "state": "started"}
            self.save()
        try:
            result = self.perform(name, args)
        except BudgetExceeded:
            # No external call was made. Leave this action available after the daily reset.
            if key:
                del self.state["attempts"][key]
                self.save()
            raise
        if key:
            self.state["attempts"][key]["state"] = "completed"
            self.state["attempts"][key]["result"] = result
        self.event("action", action=name, purpose=purpose, company=args.get("company"), result=result)
        return result

    def perform(self, name, args):
        if name == "search":
            query = text(args.get("query"), 350)
            if args.get("direction") not in DIRECTIONS:
                raise ValueError("Choose a business direction")
            cost = self.config["searchCostMicros"]
            if self.config["searchProvider"] == "BRAVE" and cost <= 0:
                raise ValueError("Paid search requires a configured conservative per-call cost")
            self.reserve("searches", cost)
            try:
                rows = self.search(query)
            except (urllib.error.URLError, TimeoutError) as error:
                return {"state": "unavailable", "provider": self.config["searchProvider"],
                        "httpStatus": getattr(error, "code", None)}
            ids = [self.evidence(r, "search", args.get("company")) for r in rows[:5]]
            return {"evidenceIds": ids, "direction": args["direction"], "empty": not ids}
        if name == "fetch":
            url = text(args.get("url"), 2000)
            self.reserve("pages")
            try:
                fetched = self.fetch(url)
            except (urllib.error.URLError, TimeoutError) as error:
                return {"state": "unavailable", "url": url, "httpStatus": getattr(error, "code", None)}
            excerpt, published = fetched[:2]
            final_url = fetched[2] if len(fetched) > 2 else url
            if not excerpt:
                return {"state": "unavailable", "url": url}
            eid = self.evidence({"url": final_url, "snippet": excerpt, "publishedAt": published}, "page", args.get("company"))
            if args.get("company"):
                company = self.company(args)
                company["evidenceIds"] = list(dict.fromkeys(company["evidenceIds"] + [eid]))
            return {"evidenceIds": [eid]}
        if name == "open_company":
            key = domain(args.get("domain", ""))
            ids = self.refs(args)
            if args.get("direction") not in DIRECTIONS:
                raise ValueError("Choose a business direction")
            if key in self.state["companies"]:
                return {"state": "already_known", "company": key, "status": self.state["companies"][key]["status"]}
            if sum(c["status"] == "active" for c in self.state["companies"].values()) >= 5:
                raise ValueError("Five active investigations; finish or park one first")
            company = {"name": text(args.get("name"), 200), "domain": key, "direction": args["direction"],
                "hypothesis": text(args.get("hypothesis")), "evidenceIds": ids, "status": "active",
                "openedAt": iso(self.clock()), "contacts": [], "buyingIntent": "UNCONFIRMED",
                "nextAction": "Investigate the most important unresolved question", "uncertainty": "Initial hypothesis; verify fit"}
            self.safety(company)
            self.state["companies"][key] = company
            return {"state": "opened", "company": key}
        if name == "dismiss_clue":
            ids = self.refs(args)
            item = {"at": iso(self.clock()), "evidenceIds": ids,
                "reason": text(args.get("reason")), "name": None, "domain": None}
            if args.get("name") is not None:
                item["name"] = text(args.get("name"), 200)
            if args.get("domain") is not None:
                item["domain"] = domain(args.get("domain"))
            self.state.setdefault("dismissedClues", []).append(item)
            return {"state": "dismissed", "evidenceIds": ids}
        if name == "people":
            if self.config.get("publicDiscoveryOnly"):
                raise ValueError("People search disabled: live suppression bridge is unavailable. Prepare public research only.")
            company = self.company(args)
            self.safety(company)
            if not self.official_evidence(company):
                raise ValueError("Before people search, fetch an official company page with company='" +
                                 company["domain"] + "' so page evidence is attached to this company")
            titles = args.get("titles")
            if not isinstance(titles, list) or not 1 <= len(titles) <= 8:
                raise ValueError("Choose 1–8 relevant roles")
            titles = [text(t, 80) for t in titles]
            self.reserve("people")
            result = self.bridge("people", name=company["name"], domain=company["domain"], titles=titles)
            if result.get("tenantId") != self.config["tenantId"] or not result.get("allowed"):
                raise RuntimeError("CONTACT_LOOKUP_NOT_ALLOWED")
            company["contacts"] = result.get("candidates", [])
            company["contactState"] = result["result"]
            company["contactTitles"] = titles
            company["contactResearchAt"] = iso(self.clock())
            return {"state": result["result"], "candidates": company["contacts"]}
        if name == "decide":
            company = self.company(args)
            self.safety(company)
            status = args.get("status")
            if status not in {"active", "parked", "rejected", "recommended"}:
                raise ValueError("Invalid decision")
            ids = self.refs(args)
            summary = text(args.get("summary"))
            uncertainty = text(args.get("uncertainty"))
            next_action = text(args.get("nextAction"))
            if status == "recommended":
                quote = text(args.get("quote"), 1000)
                evidence = self.state["evidence"].get(args.get("quoteEvidenceId"))
                if not evidence or evidence["id"] not in ids or evidence not in self.official_evidence(company) or quote not in evidence["excerpt"]:
                    raise ValueError("Recommendation requires an exact quote from fetched official evidence")
                if self.config.get("publicDiscoveryOnly"):
                    status = "needs_clearance"
            revisit_days = args.get("revisitDays", 30)
            if type(revisit_days) is not int or not 1 <= revisit_days <= 180:
                raise ValueError("Revisit must be 1–180 days")
            revisit_when = text(args.get("revisitWhen"))
            company.update(status=status, summary=summary, uncertainty=uncertainty, nextAction=next_action,
                evidenceIds=list(dict.fromkeys(company["evidenceIds"] + ids)), decidedAt=iso(self.clock()),
                revisitAt=iso(self.clock() + dt.timedelta(days=revisit_days)), revisitWhen=revisit_when,
                buyingIntent="UNCONFIRMED", outreachReady=False)
            return {"state": status, "company": company["domain"], "outreachReady": False}
        if name == "wait":
            minutes = args.get("minutes", 30)
            if type(minutes) is not int or not 30 <= minutes <= 1440:
                raise ValueError("Wait must be 30–1440 minutes")
            reason = text(args.get("reason"))
            self.state["nextWakeAt"] = iso(self.clock() + dt.timedelta(minutes=30))
            return {"state": "waiting", "reason": reason, "requestedMinutes": minutes, "minutes": 30,
                    "nextStep": "Reconsider the best available investigation next wake. A blocked clue does not exhaust other companies, sources or services."}
        raise ValueError("Action not allowed")

    def research_coverage(self):
        # Derive coverage from durable attempts, not model claims or repeated cached actions.
        # Old journals may lack direction on interrupted calls; keep that uncertainty explicit.
        rows = {d: {"attempts": 0, "lastAttemptAt": None, "recentQueries": []} for d in DIRECTIONS}
        unknown = 0
        for attempt in self.state["attempts"].values():
            if attempt.get("action") != "search":
                continue
            direction = attempt.get("direction") or (attempt.get("result") or {}).get("direction")
            if direction not in rows:
                unknown += 1
                continue
            row = rows[direction]
            row["attempts"] += 1
            row["lastAttemptAt"] = attempt.get("at")
            if attempt.get("query"):
                row["recentQueries"] = (row["recentQueries"] + [attempt["query"]])[-3:]
        return {"directions": rows, "unknownDirectionAttempts": unknown}

    def unread_clues(self):
        from urllib.parse import urlparse
        clues, seen = [], set()
        dismissed = self.state.get("dismissedClues", [])
        dismissed_ids = {eid for item in dismissed for eid in item.get("evidenceIds", [])}
        dismissed_domains = {item.get("domain") for item in dismissed if item.get("domain")}
        for evidence in reversed(list(self.state["evidence"].values())):
            if evidence["kind"] != "search":
                continue
            if evidence["id"] in dismissed_ids:
                continue
            url = evidence["url"]
            host = (urlparse(url).hostname or "").removeprefix("www.")
            if host in dismissed_domains:
                continue
            company = self.state["companies"].get(evidence.get("company")) or self.state["companies"].get(host)
            if company and company["status"] != "active":
                continue  # Known dispositions/revisits already have their own context.
            key = self.cache_key("fetch", {"url": url})
            attempt = self.state["attempts"].get(key)
            if key in seen or attempt:
                continue
            seen.add(key)
            clues.append({k: evidence.get(k) for k in ("id", "url", "title", "publishedAt")})
            clues[-1]["excerpt"] = evidence.get("excerpt", "")[:500]
            if len(clues) == 8:
                break
        return clues

    def context(self):
        self.ingest_feedback()
        companies = list(self.state["companies"].values())
        active = [c for c in companies if c["status"] == "active"]
        due = [c for c in companies if c.get("revisitAt") and parse_time(c["revisitAt"]) <= self.clock() and c["status"] in {"parked", "rejected"}]
        buyer_pending = [c for c in companies if c["status"] == "recommended" and
                         self.buyer_research(c)["state"] == "PENDING"]
        wanted = set(i for c in active + due + buyer_pending for i in c.get("evidenceIds", []))
        evidence = list(self.state["evidence"].values())
        chosen = [e for e in evidence if e["id"] in wanted][-8:]
        chosen += [e for e in evidence[-4:] if e not in chosen]
        return {"now": iso(self.clock()), "mode": "public discovery only: people tool disabled, all recommendations require live clearance" if self.config.get("publicDiscoveryOnly") else "read-only pilot; no buying intent confirmed",
            "activeCompanies": active, "dueForRevisit": due[:5],
            "buyerResearchQueue": [{**{k: c.get(k) for k in ("name", "domain", "direction", "summary", "uncertainty", "nextAction")},
                                     "buyerResearch": self.buyer_research(c),
                                     "officialEvidenceAttached": bool(self.official_evidence(c))}
                                    for c in buyer_pending[:5]] if not self.config.get("publicDiscoveryOnly") else [],
            "otherCompanies": [{**{k: c.get(k) for k in ("domain", "status", "summary", "revisitAt", "revisitWhen", "contactState")},
                                "buyerResearch": self.buyer_research(c) if c["status"] == "recommended" else None}
                               for c in companies if c not in active][-40:],
            "evidence": [{**e, "excerpt": e["excerpt"][:2600]} for e in chosen],
            "extractionNote": "Current extractor is " + EXTRACTOR_VERSION + "; older page excerpts may contain mostly navigation. Re-fetch if the content is needed.",
            # Proposed actions and token logs are audit data, not observations. Replaying them
            # encouraged the local model to imitate its own unsuccessful proposals.
            "recentEvents": [e for e in self.state["events"] if e["kind"] in
                             {"action", "action_rejected", "yield", "error", "budget_stop"}][-6:],
            "feedback": self.state["feedback"][-20:],
            "dismissedClues": self.state.get("dismissedClues", [])[-20:],
            "previousSearches": [a.get("query") for a in self.state["attempts"].values() if a.get("query")][-50:],
            "researchCoverage": self.research_coverage(), "unreadClues": self.unread_clues(),
            "consecutiveStalledWakes": self.state.get("unproductiveWakes", 0),
            "workSelection": "A pending buyerResearchQueue item is high-value unfinished work: normally complete one tailored people lookup before broad discovery unless an active company has an immediately decisive source. Resolve a fetched named-company clue by opening it, dismissing it with evidence, or fetching one clearly necessary source before starting another broad search. Follow promising investigations across wakes. After a resolved dead end, choose a materially different company, source or service hypothesis. Coverage counts are not quotas or proof that a market is exhausted.",
            "usedToday": self.budget(), "limits": self.config["limits"]}

    def recover_legacy_wait(self):
        if self.state.get("schedulePolicyVersion") == 2:
            return
        wake = self.state.get("nextWakeAt")
        last_schedule = next((e for e in reversed(self.state["events"]) if e["kind"] in {"budget_stop", "error", "yield"} or
                              (e["kind"] == "action" and e.get("action") == "wait")), {})
        legacy_wait = self.state.get("health") in {"waiting", "waiting_no_progress"} or (
            self.state.get("health") == "stopped" and last_schedule.get("kind") in {"action", "yield"})
        if legacy_wait and wake and parse_time(wake) > self.clock() + dt.timedelta(minutes=30):
            # Only v1 model/no-progress waits are shortened. Budget, error, STOP and expiry
            # remain authoritative; no history, counters, dispositions or limits are reset.
            completed = self.state.get("lastCompletedWakeAt")
            due = parse_time(completed) + dt.timedelta(minutes=30) if completed else self.clock() + dt.timedelta(minutes=30)
            self.state["nextWakeAt"] = iso(min(parse_time(wake), max(self.clock(), due)))
            self.event("schedule_recovered", previousWakeAt=wake, nextWakeAt=self.state["nextWakeAt"])
        self.state["schedulePolicyVersion"] = 2
        self.save()

    def tick(self, force=False, max_steps=DEFAULT_WAKE_STEPS):
        self.recover_legacy_wait()
        self.state["heartbeatAt"] = iso(self.clock())
        self.state["pid"] = os.getpid()
        self.save()
        local = self.clock().astimezone(ZONE)
        if not force and (local.weekday() >= 5 or not 9 <= local.hour < 17):
            self.state["health"] = "outside_business_hours"
            self.save()
            return
        if not force and self.state.get("nextWakeAt") and parse_time(self.state["nextWakeAt"]) > self.clock():
            return
        self.guard()
        self.state["health"] = "running"
        self.state["nextWakeAt"] = iso(self.clock() + dt.timedelta(minutes=30))
        self.event("wake_started")
        deadline = time.monotonic() + 600
        unproductive = 0
        productive = False
        starting_calls = self.budget()["modelCalls"]
        compared = False
        for _ in range(max_steps):
            if time.monotonic() >= deadline or self.budget()["modelCalls"] - starting_calls >= max_steps:
                break
            context = json.loads(json.dumps(self.context()))  # identical immutable packet for all three models
            action, usage = self.infer(self.model, self.config["model"], context)
            self.event("proposed_action", proposal=action)
            waiting = False
            try:
                result = self.execute(action)
                unproductive = unproductive + 1 if result.get("state") in {"cached_or_already_attempted", "unavailable", "already_known"} or result.get("empty") else 0
                if unproductive == 0 and action["action"] != "wait":
                    productive = True
                    self.state["lastUsefulActionAt"] = iso(self.clock())
                if action["action"] == "wait":
                    waiting = True
            except (ValueError, KeyError, TypeError) as error:
                self.event("action_rejected", reason=str(error)[:300])
                unproductive += 1
            # Temporary matched evaluation, not another production decision stage.
            # Execute the primary action first; local proposals are never executed.
            if not compared and max_steps >= 3 and self.budget()["modelCalls"] - starting_calls == 1:
                self.compare_models(context, action, deadline)
                compared = True
            if waiting:
                break
            if unproductive >= 2:
                self.event("yield", reason="Two unproductive actions; wait for the next wake")
                break
        self.state["health"] = "waiting"
        self.state["unproductiveWakes"] = 0 if productive else self.state.get("unproductiveWakes", 0) + 1
        if self.state["unproductiveWakes"] >= 3:
            self.state["health"] = "needs_review"
            self.state["nextWakeAt"] = iso(next_business_start(self.clock()))
            self.event("yield", reason="Three consecutive wakes made no useful progress despite alternatives in context. Research quality needs review; pause until next business day rather than spend the budget looping.")
        self.state["lastError"] = None
        self.state["lastCompletedWakeAt"] = iso(self.clock())
        self.event("wake_completed")

    def infer(self, model, name, context, evaluation=False):
        self.guard()
        reserved_budget = self.budget()
        self.reserve("modelCalls")
        started = time.monotonic()
        try:
            action, usage = model(context)
        finally:
            elapsed = min(180, int(time.monotonic() - started) + 1)
            reserved_budget["modelSeconds"] -= 180 - elapsed
            self.save()
        self.event("model", model=name, version=VERSION, usage=usage, evaluation=evaluation)
        return action, usage

    def compare_models(self, context, primary, deadline):
        limit = self.config.get("comparisonCases", 0)
        if not isinstance(limit, int) or not 0 <= limit <= 10:
            raise ValueError("Comparison must be limited to at most ten cases")
        cases = self.state.setdefault("modelComparisons", [])
        if len(cases) >= limit:
            return
        case = {"at": iso(self.clock()), "contextId": digest(context), "context": context,
                "primaryModel": self.config["model"], "primary": primary, "shadows": []}
        cases.append(case)
        self.save()  # partial cases remain visible and never silently retried
        for name in ["qwen3.8-rvn:q4_k_m-multilingual", "qwen3.8-rvn:q8_0-multilingual"]:
            if time.monotonic() + 180 > deadline:
                case["incomplete"] = "wake_time"
                break
            try:
                proposal, usage = self.infer(LocalModel(name, thinking=True), name, context, evaluation=True)
                case["shadows"].append({"model": name, "proposal": proposal, "usage": usage})
            except BudgetExceeded as error:
                case["incomplete"] = str(error)
                break
            except (OSError, urllib.error.URLError, TimeoutError, ValueError, KeyError, TypeError) as error:
                case["shadows"].append({"model": name, "error": type(error).__name__})
            finally:
                self.save()

    def compare_search(self, queries):
        if not isinstance(queries, list) or not 1 <= len(queries) <= 10:
            raise ValueError("Search comparison needs 1–10 matched queries")
        cost = self.config["searchCostMicros"]
        if self.config["searchProvider"] != "BRAVE" or not 0 < cost <= 1_000_000:
            raise ValueError("Configure the approved Brave price before comparing search")
        trials = self.state.setdefault("searchComparisons", {})
        for query in queries:
            query = text(query, 350)
            key = digest(sorted(re.findall(r"[\w]+", query.casefold())))
            if key not in trials and len(trials) >= 10:
                raise ValueError("Ten search comparison cases already recorded")
            trial = trials.setdefault(key, {"query": query, "providers": {}})
            for provider in ["DUCKDUCKGO", "BRAVE"]:
                if provider in trial["providers"]:
                    continue
                self.guard()
                self.reserve("searches", cost if provider == "BRAVE" else 0)
                record = {"at": iso(self.clock()), "state": "started"}
                trial["providers"][provider] = record
                self.save()
                started = time.monotonic()
                try:
                    record["results"] = search_web(provider, query, 5)
                    record["state"] = "completed"
                except (urllib.error.URLError, TimeoutError) as error:
                    record["state"], record["error"] = "unavailable", type(error).__name__
                finally:
                    record["seconds"] = round(time.monotonic() - started, 2)
                    self.save()
        self.event("search_comparison", cases=len(trials), recommendations=0)

    def status(self):
        counts = {s: sum(c["status"] == s for c in self.state["companies"].values())
                  for s in ["active", "parked", "rejected", "recommended", "needs_clearance", "blocked"]}
        recommended = [c for c in self.state["companies"].values() if c["status"] == "recommended"]
        buyer_research = {"pending": sum(self.buyer_research(c)["state"] == "PENDING" for c in recommended),
                          "completed": sum(self.buyer_research(c)["state"] == "COMPLETED" for c in recommended)}
        alive = False
        if self.state.get("pid"):
            try:
                os.kill(self.state["pid"], 0)
                alive = True
            except ProcessLookupError:
                pass
        heartbeat = self.state.get("heartbeatAt")
        stale = not heartbeat or self.clock() - parse_time(heartbeat) > dt.timedelta(minutes=15)
        return {"version": VERSION, "health": self.state.get("health", "initialized"), "processAlive": alive,
            "heartbeatStale": stale,
            "heartbeatAt": self.state.get("heartbeatAt"), "lastCompletedWakeAt": self.state.get("lastCompletedWakeAt"),
            "lastUsefulActionAt": self.state.get("lastUsefulActionAt"),
            "nextWakeAt": self.state.get("nextWakeAt"), "expiresAt": self.config["expiresAt"],
            "counts": counts, "usedToday": self.budget(), "totalUsdMicros": self.state["usdMicros"],
            "unproductiveWakes": self.state.get("unproductiveWakes", 0),
            "researchNeedsReview": self.state.get("unproductiveWakes", 0) >= 3,
            "buyerResearch": buyer_research,
            "searchesByDirection": {d: r["attempts"] for d, r in self.research_coverage()["directions"].items()},
            "model": self.config["model"], "searchProvider": self.config["searchProvider"],
            "modelProvider": self.config.get("modelProvider", "OLLAMA"),
            "comparisonCases": len(self.state.get("modelComparisons", [])),
            "dismissedClues": len(self.state.get("dismissedClues", [])),
            "searchComparisonCases": len(self.state.get("searchComparisons", {})),
            "publicDiscoveryOnly": self.config.get("publicDiscoveryOnly", False),
            "externalWrites": 0, "paidEmailEnrichments": 0, "lastError": self.state.get("lastError")}

    def report(self):
        rows = ["# Hunter pilot research review", "", "Local research notes only. No outreach approval or confirmed buying intent.", "",
                "```json", json.dumps(self.status(), indent=2), "```", ""]
        for c in self.state["companies"].values():
            if c["status"] == "blocked":
                continue
            rows += [f"## {c['name']} — {c['status']}", "", c.get("summary", c["hypothesis"]), "",
                     "Uncertain: " + c["uncertainty"], "", "Next action: " + c["nextAction"], "",
                     "Contact preparation: " + c.get("contactState", "Not yet researched") + ". No contact cleared for sending.", "",
                     "Revisit: " + c.get("revisitWhen", "Still investigating"), ""]
            if c["status"] == "recommended":
                buyer = self.buyer_research(c)
                rows += ["Owner review preparation: " + ("buyer-role research pending."
                         if buyer["state"] == "PENDING" else
                         "buyer-role search completed; any returned candidates remain employment-unverified."), ""]
            for eid in c["evidenceIds"]:
                e = self.state["evidence"][eid]
                rows.append(f"- [{e['title'] or e['url']}]({e['url']}) — retrieved {e['retrievedAt']}")
            rows.append("")
        if self.state.get("dismissedClues"):
            rows += ["## Dismissed discovery clues", "", "Saved research dead ends; not company rejections.", ""]
            for item in self.state["dismissedClues"][-40:]:
                label = item.get("name") or item.get("domain") or "Unnamed clue"
                rows.append(f"- **{label}** — {item['reason']}")
            rows.append("")
        path = self.directory / "review.md"
        rows += ["## Matched model evaluation", "", "Shadow proposals are not executed or recommendations.", ""]
        for case in self.state.get("modelComparisons", []):
            rows += ["### " + case["contextId"], "", "```json",
                     json.dumps({k: v for k, v in case.items() if k != "context"}, indent=2), "```", ""]
        path.write_text("\n".join(rows))
        os.chmod(path, 0o600)
        return str(path)


def initialize(args, bridge=None):
    directory = Path(args.state_dir).expanduser().resolve()
    if directory == REPO or REPO in directory.parents:
        raise ValueError("Pilot data must live outside the repository")
    if (directory / "config.json").exists():
        raise ValueError("Pilot already initialized; refusing to reset its budget/history")
    expires = parse_time(args.expires_at)
    if not now() < expires <= now() + dt.timedelta(days=10):
        raise ValueError("Pilot must expire within ten calendar days")
    context = (bridge or (PublicDiscoveryBridge() if args.public_only else RemoteReadBridge()))("context")
    expected = os.environ.get("INGESTION_TENANT_SLUG")
    if not expected or context["tenantSlug"] != expected:
        raise ValueError("Authenticated tenant must match configured Hunter tenant")
    cost = round(args.search_cost_usd * 1_000_000)
    if args.search_provider == "BRAVE" and not 0 < cost <= 1_000_000:
        raise ValueError("Brave needs a conservative verified per-call price")
    config = {"version": VERSION, "tenantId": context["tenantId"], "tenantSlug": context["tenantSlug"],
        "publicDiscoveryOnly": args.public_only,
        "model": args.model, "expiresAt": iso(expires), "searchProvider": args.search_provider,
        "modelProvider": args.model_provider, "localThinking": args.local_thinking,
        "reasoningEffort": args.reasoning_effort, "comparisonCases": args.comparison_cases,
        "searchCostMicros": cost if args.search_provider == "BRAVE" else 0,
        "limits": {"searches": 40, "pages": 60, "people": 20, "modelCalls": 40, "modelSeconds": 3600,
                   "dailyUsdMicros": 5_000_000, "totalUsdMicros": 10_000_000}}
    configured_model(config)  # reject incompatible provider/model before writing state
    atomic_write(directory / "config.json", config)
    atomic_write(directory / "state.json", {"tenantId": context["tenantId"], "companies": {}, "evidence": {},
        "attempts": {}, "budgets": {}, "usdMicros": 0, "events": [], "feedback": [], "health": "initialized"})


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["init", "once", "serve", "status", "report", "feedback", "stop", "preflight", "compare-search"])
    parser.add_argument("--state-dir", required=True)
    parser.add_argument("--env-file", action="append", default=[])
    parser.add_argument("--model", default="qwen3.8-rvn:q4_k_m-multilingual")
    parser.add_argument("--model-provider", choices=["OLLAMA", "CHATGPT_SUBSCRIPTION"], default="OLLAMA")
    parser.add_argument("--local-thinking", action="store_true")
    parser.add_argument("--reasoning-effort", choices=["low", "medium", "high"], default="medium")
    parser.add_argument("--comparison-cases", type=int, choices=range(11), default=0)
    parser.add_argument("--search-provider", choices=["DUCKDUCKGO", "BRAVE"], default="DUCKDUCKGO")
    parser.add_argument("--search-cost-usd", type=float, default=0)
    parser.add_argument("--expires-at")
    parser.add_argument("--public-only", action="store_true", help="Evaluate public discovery; no live suppression clearance or Apollo")
    parser.add_argument("--company")
    parser.add_argument("--verdict", choices=["accepted", "wrong_company", "wrong_buyer", "poor_fit", "timing", "reject"])
    parser.add_argument("--note")
    parser.add_argument("--force", action="store_true", help="One supervised wake outside hours; never bypass safety/budget/expiry")
    parser.add_argument("--max-steps", type=int, default=DEFAULT_WAKE_STEPS)
    parser.add_argument("--query-file", help="Private JSON list of up to ten matched search queries")
    args = parser.parse_args()
    load_env(args.env_file)
    directory = Path(args.state_dir).expanduser().resolve()
    if args.command == "init":
        if not args.expires_at:
            parser.error("init requires --expires-at")
        initialize(args)
        print(json.dumps({"state": "initialized", "readOnly": True}))
        return
    if args.command == "stop":
        directory.joinpath("STOP").touch(mode=0o600)
        print(json.dumps({"state": "stop_requested"}))
        return
    if args.command in {"status", "report"}:
        pilot = Pilot(directory)
        print(json.dumps(pilot.status() if args.command == "status" else {"report": pilot.report()}))
        return
    if args.command == "feedback":
        pilot = Pilot(directory)
        pilot.guard()
        key = domain(args.company or "")
        if key not in pilot.state["companies"] or not args.verdict:
            parser.error("feedback requires a known --company and --verdict")
        # A separate atomic inbox works while the worker holds its single-run lock.
        atomic_write(directory / "feedback" / (uuid.uuid4().hex + ".json"), {
            "tenantId": pilot.config["tenantId"], "at": iso(now()), "company": key,
            "verdict": args.verdict, "note": text(args.note)})
        print(json.dumps({"state": "feedback_saved", "outreachApproved": False}))
        return
    if not 1 <= args.max_steps <= 6:
        parser.error("max-steps must be 1–6")
    with open(directory / "worker.lock", "a+") as lock:
        os.chmod(directory / "worker.lock", 0o600)
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            print(json.dumps({"state": "already_running"}))
            return
        pilot = Pilot(directory)
        if args.command == "preflight":
            pilot.guard()
            info = pilot.model.preflight() if isinstance(pilot.model, SubscriptionModel) else {"provider": "OLLAMA"}
            print(json.dumps({**info, "state": "preflight_passed", "inferenceRun": False}))
            return
        if args.command == "compare-search":
            if not args.query_file:
                parser.error("compare-search requires --query-file")
            pilot.compare_search(json.loads(Path(args.query_file).read_text()))
            print(json.dumps({"state": "search_comparison_completed", "cases": len(pilot.state.get("searchComparisons", {})), "usedToday": pilot.budget()}))
            return
        stopping = False
        def stop_handler(_signal, _frame):
            nonlocal stopping
            stopping = True
            pilot.stop_requested = True
        signal.signal(signal.SIGTERM, stop_handler)
        signal.signal(signal.SIGINT, stop_handler)
        while not stopping:
            try:
                if now() >= parse_time(pilot.config["expiresAt"]):
                    raise RuntimeError("PILOT_EXPIRED")
                pilot.tick(force=args.force and args.command == "once", max_steps=args.max_steps)
            except BudgetExceeded as error:
                pilot.state["health"] = "budget_wait"
                pilot.state["nextWakeAt"] = iso(next_business_start(now()))
                pilot.event("budget_stop", budget=str(error))
            except Exception as error:
                # Do not log raw transport exception text or model responses.
                code = str(error) if re.fullmatch(r"[A-Z_0-9]+", str(error)) else type(error).__name__
                pilot.state["health"] = "error"
                pilot.state["lastError"] = code
                pilot.state["nextWakeAt"] = iso(next_business_start(now()) if code.startswith("CHATGPT_") else now() + dt.timedelta(minutes=30))
                pilot.event("error", code=code)
                if code in {"STOP_REQUESTED", "PILOT_EXPIRED", "TENANT_MISMATCH", "CONFIG_CHANGED_RESTART_REQUIRED", "HUNTER_DISABLED", "PILOT_DISABLED"}:
                    stopping = True
            pilot.save()
            pilot.report()
            print(json.dumps(pilot.status()), flush=True)
            if args.command == "once":
                break
            for _ in range(30):
                if stopping or directory.joinpath("STOP").exists():
                    stopping = True
                    break
                time.sleep(1)
        pilot.state["pid"] = None
        if stopping:
            pilot.state["health"] = "stopped"
        pilot.save()
        pilot.report()


if __name__ == "__main__":
    main()
