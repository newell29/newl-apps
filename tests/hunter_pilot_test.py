"""Synthetic regression cases; no network, credentials or production lead fixtures."""
import datetime as dt
import json
import os
import importlib.util
from pathlib import Path
import socket
import sys
import tempfile
import subprocess
import unittest
import urllib.error
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "ops/openclaw/hunter"))
from hunter_pilot import Pilot, PilotTextParser, BudgetExceeded, atomic_write, digest, UTC, ZONE
from hunter_pilot import (LocalModel, LocalModelResponseError, configured_model, MISSION,
    TOOLS, SCHEMA, SOURCE_CATALOG_VERSION)
from hunter_model_diagnostics import (COMPACT_MISSION, MAX_ADDITIONAL_ATTEMPTS,
    compact_packet, memory_sample, record_run_source, reserve_diagnostic, run_attempt,
    unload_test_model, validate_matched_models)
from pilot_subscription_model import (SubscriptionModel, subscription_environment,
    require_subscription, output_schema, run_bounded, DISABLED_FEATURES)


class PilotTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name)
        self.time = dt.datetime(2026, 9, 16, 15, tzinfo=UTC)
        self.config = {"tenantId": "tenant-a", "tenantSlug": "synthetic", "model": "synthetic-local",
            "expiresAt": "2026-09-24T00:00:00+00:00", "searchProvider": "DUCKDUCKGO", "searchCostMicros": 0,
            "limits": {"searches": 40, "pages": 60, "people": 20, "modelCalls": 40, "modelSeconds": 3600,
                       "dailyUsdMicros": 10_000_000, "totalUsdMicros": 50_000_000}}
        atomic_write(self.path / "config.json", self.config)
        atomic_write(self.path / "state.json", {"tenantId": "tenant-a", "companies": {}, "evidence": {},
            "attempts": {}, "budgets": {}, "usdMicros": 0, "events": [], "feedback": []})
        self.bridge = Mock(return_value={"tenantId": "tenant-a", "tenantSlug": "synthetic", "allowed": True})
        self.search = Mock(return_value=[{"url": "https://supply.example/", "title": "Synthetic Supply", "snippet": "New Canadian wholesale distribution."}])
        self.fetch = Mock(return_value=("Synthetic Supply sells by the case to retailers.", None))
        self.model = Mock(return_value=({"action": "wait", "purpose": "No useful work", "args": {"reason": "No new evidence", "minutes": 30}}, {}))
        self.p = Pilot(self.path, self.bridge, self.model, self.search, self.fetch, lambda: self.time)

    def action(self, action_name, **args):
        if action_name == "search":
            args.setdefault("sourceKey", "open_web")
        return self.p.execute({"action": action_name, "purpose": "Resolve a specific uncertainty", "args": args})

    def open(self):
        evidence = self.action("search", query="synthetic wholesale", direction="gta")["evidenceIds"]
        self.action("open_company", name="Synthetic Supply", domain="supply.example", direction="gta", hypothesis="Case picking could fit", evidenceIds=evidence)
        return self.p.state["companies"]["supply.example"]

    def decision(self, status="recommended", quote="sells by the case", evidence=None):
        if evidence is None:
            evidence = self.action("fetch", url="https://supply.example/", company="supply.example")["evidenceIds"][0]
        return self.action("decide", company="supply.example", status=status, summary="Possible case picking fit",
            uncertainty="Outsourcing and buying intent unconfirmed", nextAction="Verify storage arrangements",
            evidenceIds=[evidence], quote=quote, quoteEvidenceId=evidence, revisitDays=30, revisitWhen="New Canadian retailer announcement")

    def test_cross_tenant_state_rejected(self):
        self.p.state["tenantId"] = "tenant-b"; self.p.save()
        with self.assertRaisesRegex(RuntimeError, "TENANT_MISMATCH"):
            Pilot(self.path)

    def test_live_tenant_drift_rejected(self):
        self.bridge.return_value = {"tenantId": "tenant-b", "tenantSlug": "synthetic"}
        with self.assertRaisesRegex(RuntimeError, "TENANT_MISMATCH"):
            self.action("search", query="x", direction="gta")
        self.search.assert_not_called()

    def test_kill_switch_failure_stops_io(self):
        self.bridge.side_effect = RuntimeError("HUNTER_DISABLED")
        with self.assertRaisesRegex(RuntimeError, "HUNTER_DISABLED"):
            self.action("search", query="x", direction="gta")
        self.search.assert_not_called()

    def test_stop_file_blocks_all_actions(self):
        self.path.joinpath("STOP").touch()
        with self.assertRaisesRegex(RuntimeError, "STOP_REQUESTED"):
            self.action("search", query="x", direction="gta")

    def test_expiry_is_enforced(self):
        self.time = dt.datetime(2026, 10, 1, tzinfo=UTC)
        with self.assertRaisesRegex(RuntimeError, "PILOT_EXPIRED"):
            self.p.tick(force=True)

    def test_unknown_write_actions_are_rejected(self):
        for name in ["send", "enroll", "enrich", "shell", "approve", "change_budget"]:
            with self.assertRaises(ValueError):
                self.action(name)

    def test_daily_budget_stops_before_search(self):
        self.p.budget()["searches"] = 40
        with self.assertRaises(BudgetExceeded):
            self.action("search", query="x", direction="gta")
        self.search.assert_not_called()

    def test_failed_search_is_charged_and_remembered(self):
        self.search.side_effect = RuntimeError("Unavailable")
        with self.assertRaises(RuntimeError):
            self.action("search", query="x", direction="gta")
        self.assertEqual(self.p.budget()["searches"], 1)
        self.assertEqual(self.action("search", query="x", direction="gta")["state"], "cached_or_already_attempted")
        self.assertEqual(self.search.call_count, 1)

    def test_budget_denial_does_not_cache_an_unexecuted_search(self):
        self.p.budget()["searches"] = 40
        with self.assertRaises(BudgetExceeded):
            self.action("search", query="new clue", direction="gta")
        self.assertFalse(self.p.state["attempts"])
        self.time += dt.timedelta(days=1)
        self.assertTrue(self.action("search", query="new clue", direction="gta")["evidenceIds"])
        self.search.assert_called_once()

    def test_reordered_case_variants_use_cache_after_restart(self):
        self.action("search", query="Canada wholesale BRAND", direction="gta")
        restarted = Pilot(self.path, self.bridge, self.model, self.search, self.fetch, lambda: self.time)
        result = restarted.execute({"action": "search", "purpose": "Same question", "args": {
            "query": "brand wholesale canada", "direction": "gta", "sourceKey": "open_web"}})
        self.assertEqual(result["state"], "cached_or_already_attempted")
        self.assertEqual(self.search.call_count, 1)
        observation = restarted.context()["recentEvents"][-1]["result"]
        self.assertEqual(observation["state"], "cached_or_already_attempted")
        self.assertIn("retryAfter", observation)

    def test_total_budget_survives_day_change(self):
        self.p.state["usdMicros"] = 50_000_000
        self.time += dt.timedelta(days=1)
        with self.assertRaises(BudgetExceeded):
            self.p.reserve("searches", 1)

    def test_local_calendar_day_resets_daily_not_total(self):
        self.p.reserve("searches", 100)
        self.time += dt.timedelta(days=1)
        self.assertEqual(self.p.budget()["searches"], 0)
        self.assertEqual(self.p.state["usdMicros"], 100)

    def test_model_time_budget_reserved_before_inference(self):
        self.p.budget()["modelSeconds"] = 3500
        with self.assertRaises(BudgetExceeded):
            self.p.tick(force=True)
        self.model.assert_not_called()

    def test_weekend_and_night_do_not_call_model(self):
        for t in [dt.datetime(2026, 9, 19, 15, tzinfo=UTC), dt.datetime(2026, 9, 16, 2, tzinfo=UTC)]:
            self.time = t; self.p.tick()
        self.model.assert_not_called()

    def test_wait_sets_future_wake_without_more_work(self):
        self.p.tick()
        self.p.tick()
        self.assertEqual(self.model.call_count, 1)
        self.assertEqual(self.p.state["health"], "waiting")

    def test_error_remains_visible_until_a_wake_completes(self):
        self.p.state.update(health="error", lastError="HTTPError", nextWakeAt=(self.time + dt.timedelta(minutes=30)).isoformat())
        self.p.tick()
        self.assertEqual(self.p.state["lastError"], "HTTPError")
        self.assertEqual(self.p.state["health"], "error")
        self.p.tick(force=True)
        self.assertIsNone(self.p.state["lastError"])

    def test_two_stalled_wakes_leave_room_to_change_direction(self):
        self.p.tick(force=True)
        self.p.tick(force=True)
        self.assertEqual(self.p.state["health"], "waiting")
        self.assertEqual(dt.datetime.fromisoformat(self.p.state["nextWakeAt"]), self.time + dt.timedelta(minutes=30))

    def test_repeated_stalls_surface_review_and_stop_until_next_business_day(self):
        self.time = dt.datetime(2026, 9, 18, 19, tzinfo=UTC)  # Friday afternoon
        for _ in range(3):
            self.p.tick(force=True)
        self.assertEqual(self.p.state["health"], "needs_review")
        self.assertEqual(dt.datetime.fromisoformat(self.p.state["nextWakeAt"]), dt.datetime(2026, 9, 21, 13, tzinfo=UTC))
        self.time += dt.timedelta(minutes=30)
        self.p.tick()
        self.assertEqual(self.model.call_count, 3)

    def test_one_clue_cannot_pause_global_research_for_a_day(self):
        result = self.action("wait", reason="One property page is unavailable", minutes=1440)
        self.assertEqual(dt.datetime.fromisoformat(self.p.state["nextWakeAt"]), self.time + dt.timedelta(minutes=30))
        self.assertEqual(result["requestedMinutes"], 1440)
        self.assertEqual(result["minutes"], 30)

    def test_upgrade_recovers_existing_long_wait_without_resetting_usage_or_history(self):
        self.p.state.update(health="waiting", nextWakeAt=(self.time + dt.timedelta(days=1)).isoformat(),
                            lastCompletedWakeAt=(self.time - dt.timedelta(hours=2)).isoformat())
        self.p.budget()["modelCalls"] = 38
        self.p.state["attempts"]["prior"] = {"action": "search", "query": "synthetic old clue", "at": self.time.isoformat()}
        self.p.tick()
        self.assertEqual(self.model.call_count, 1)
        self.assertEqual(self.p.budget()["modelCalls"], 39)
        self.assertIn("prior", self.p.state["attempts"])
        self.assertEqual(len([e for e in self.p.state["events"] if e["kind"] == "schedule_recovered"]), 1)

    def test_upgrade_does_not_shorten_budget_or_error_waits(self):
        for health in ("budget_wait", "error", "needs_review"):
            wake = (self.time + dt.timedelta(days=1)).isoformat()
            self.p.state.update(health=health, nextWakeAt=wake)
            self.p.state.pop("schedulePolicyVersion", None)
            self.p.tick()
            self.assertEqual(self.p.state["nextWakeAt"], wake)
        self.model.assert_not_called()

    def test_upgrade_after_graceful_stop_uses_recorded_wait_cause(self):
        wake = (self.time + dt.timedelta(days=1)).isoformat()
        self.p.state.update(health="stopped", nextWakeAt=wake,
                            lastCompletedWakeAt=(self.time - dt.timedelta(hours=2)).isoformat())
        self.p.event("action", action="wait", result={"state": "waiting", "reason": "One clue is unavailable"})
        self.p.tick()
        self.assertEqual(self.model.call_count, 1)
        self.assertNotEqual(self.p.state["nextWakeAt"], wake)

    def test_stopped_budget_error_or_unknown_schedule_is_not_recovered(self):
        for kind in ("budget_stop", "error", None):
            wake = (self.time + dt.timedelta(days=1)).isoformat()
            self.p.state.update(health="stopped", nextWakeAt=wake, events=[])
            self.p.state.pop("schedulePolicyVersion", None)
            if kind:
                self.p.event(kind)
            self.p.tick()
            self.assertEqual(self.p.state["nextWakeAt"], wake)
        self.model.assert_not_called()

    def test_recovered_wait_does_not_bypass_stop_or_exhausted_budget(self):
        self.p.state.update(health="waiting", nextWakeAt=(self.time + dt.timedelta(days=1)).isoformat(),
                            lastCompletedWakeAt=(self.time - dt.timedelta(hours=2)).isoformat())
        self.p.budget()["modelCalls"] = 40
        with self.assertRaises(BudgetExceeded):
            self.p.tick()
        self.path.joinpath("STOP").touch()
        with self.assertRaisesRegex(RuntimeError, "STOP_REQUESTED"):
            self.p.tick(force=True)
        self.model.assert_not_called()

    def test_default_wakes_continue_research_across_the_day(self):
        counter = 0
        def model(_context):
            nonlocal counter
            counter += 1
            return ({"action": "search", "purpose": "Investigate a new market clue", "args": {
                "query": f"synthetic wholesale brand {counter}", "direction": "gta",
                "sourceKey": "official_company_retailer"}}, {})
        self.p.model = model
        for _ in range(4):
            self.p.tick()
            self.time += dt.timedelta(minutes=30)
        self.assertEqual(counter, 12)
        self.assertEqual(self.p.budget()["modelCalls"], 12)
        self.assertEqual(self.p.state["unproductiveWakes"], 0)

    def test_unsaved_company_decision_can_recover_by_exploring_another_clue(self):
        self.model.side_effect = [
            ({"action": "decide", "purpose": "Abandon a weak clue", "args": {
                "company": "provider.example", "status": "parked", "summary": "Provider, not a proven buyer",
                "uncertainty": "No partnership basis found", "nextAction": "Move to another clue",
                "evidenceIds": [], "revisitDays": 30, "revisitWhen": "A referral relationship emerges"}}, {}),
            ({"action": "search", "purpose": "Abandon that provider and investigate goods distributors", "args": {
                "query": "synthetic Canadian housewares distributors", "direction": "gta",
                "sourceKey": "official_company_retailer"}}, {}),
            ({"action": "wait", "purpose": "Continue next session", "args": {"minutes": 30, "reason": "Resume saved clues"}}, {})]
        self.p.tick()
        self.assertFalse(self.p.state["companies"])
        self.assertEqual(self.search.call_count, 1)
        self.assertEqual(self.p.state["unproductiveWakes"], 0)
        self.assertEqual(self.p.context()["researchCoverage"]["directions"]["gta"]["attempts"], 1)

    def test_search_coverage_survives_restart_and_records_empty_attempts(self):
        self.search.return_value = []
        self.action("search", query="synthetic retail expansion", direction="charlotte")
        restarted = Pilot(self.path, self.bridge, self.model, self.search, self.fetch, lambda: self.time)
        coverage = restarted.context()["researchCoverage"]
        self.assertEqual(coverage["directions"]["charlotte"]["attempts"], 1)
        self.assertEqual(coverage["directions"]["gta"]["attempts"], 0)
        self.assertEqual(coverage["directions"]["charlotte"]["recentQueries"], ["synthetic retail expansion"])

    def test_source_family_performance_exposes_yield_without_forcing_rotation(self):
        evidence = self.action("search", query="synthetic distributor", direction="gta")["evidenceIds"]
        self.action("dismiss_clue", evidenceIds=evidence,
            reason="No supported local movement or external logistics fit",
            name="Synthetic Supply", domain="supply.example")
        row = self.p.context()["researchCoverage"]["sourceFamilies"][0]
        self.assertEqual(row, {"source": "supply.example", "searches": 1,
            "targetedSearches": 0, "emptySearches": 0, "unreadClues": 0,
            "recommendedCompanies": 0, "parkedCompanies": 0, "dismissedClues": 1,
            "lastSearchAt": self.time.isoformat()})
        self.assertIn("observed source outcomes", self.p.context()["workSelection"])
        self.assertIn("not quotas", self.p.context()["workSelection"])
        self.assertIn("evidence of marginal", MISSION)

    def test_source_catalog_is_versioned_and_does_not_remove_open_discovery(self):
        catalog = self.p.context()["researchSourceCatalog"]
        self.assertEqual(catalog["version"], SOURCE_CATALOG_VERSION)
        sources = {row["key"]: row for row in catalog["sources"]}
        self.assertEqual(sources["high_point_market"]["domains"], ["highpointmarket.org"])
        self.assertIn("gta", sources["ciffa_members"]["directions"])
        self.assertIn("open_web", sources)
        self.assertIn("other_named_source", sources)

    def test_structured_search_preserves_bounded_candidate_batch_and_source_outcomes(self):
        self.search.return_value = [{"url": f"https://candidate-{index}.example/", "title": f"Candidate {index}",
                                     "snippet": "Synthetic GTA manufacturer."} for index in range(15)]
        result = self.action("search", query="site:supportontariomade.ca Mississauga manufacturers",
                             direction="gta", sourceKey="ontario_made")
        self.assertEqual(result["resultCount"], 10)
        self.assertEqual(len(self.p.context()["unreadClues"]), 10)
        self.assertTrue(all(clue["sourceKey"] == "ontario_made"
                            for clue in self.p.context()["unreadClues"]))
        strategy = self.p.context()["researchCoverage"]["sourceStrategies"][0]
        self.assertEqual(strategy["sourceKey"], "ontario_made")
        self.assertEqual(strategy["candidateClues"], 10)
        self.assertEqual(strategy["unreadClues"], 10)

    def test_source_strategy_tracks_company_and_dismissal_outcomes(self):
        evidence = self.action("search", query="site:ciffa.com synthetic Toronto forwarder",
                               direction="gta", sourceKey="ciffa_members")["evidenceIds"]
        self.action("open_company", name="Synthetic Supply", domain="supply.example", direction="gta",
                    hypothesis="Local cartage fit", evidenceIds=evidence)
        page = self.action("fetch", url="https://supply.example/", company="supply.example")["evidenceIds"][0]
        self.decision(evidence=page)
        row = next(row for row in self.p.source_strategy_performance()
                   if row["sourceKey"] == "ciffa_members")
        self.assertEqual(row["recommendedCompanies"], 1)
        self.assertEqual(self.p.state["companies"]["supply.example"]["discoverySourceKeys"],
                         ["ciffa_members"])

    def test_source_strategy_backfills_historical_outcomes_without_rewriting_history(self):
        evidence = self.action("search", query="synthetic historical distributor",
                               direction="gta", sourceKey="open_web")["evidenceIds"]
        self.action("open_company", name="Synthetic Supply", domain="supply.example", direction="gta",
                    hypothesis="Local distribution fit", evidenceIds=evidence)
        page = self.action("fetch", url="https://supply.example/", company="supply.example")["evidenceIds"][0]
        self.decision(evidence=page)
        search_attempt = next(row for row in self.p.state["attempts"].values()
                              if row.get("action") == "search")
        search_attempt.pop("sourceKey")
        self.p.state["companies"]["supply.example"].pop("discoverySourceKeys")
        for eid in evidence:
            self.p.state["evidence"][eid].pop("sourceKey")
            self.p.state["evidence"][eid].pop("sourceKeys")
        row = next(row for row in self.p.source_strategy_performance()
                   if row["sourceKey"] == "open_web")
        self.assertEqual(row["recommendedCompanies"], 1)
        self.assertNotIn("sourceKey", search_attempt)

    def test_unknown_source_key_is_rejected_before_search(self):
        with self.assertRaisesRegex(ValueError, "researchSourceCatalog"):
            self.action("search", query="synthetic", direction="gta", sourceKey="invented_source")
        self.search.assert_not_called()

    def test_source_family_performance_remembers_empty_site_target(self):
        self.search.return_value = []
        self.action("search", query='site:directory.example exhibitors "North Carolina"', direction="charlotte")
        row = next(row for row in self.p.context()["researchCoverage"]["sourceFamilies"]
                   if row["source"] == "directory.example")
        self.assertEqual(row["searches"], 1)
        self.assertEqual(row["targetedSearches"], 1)
        self.assertEqual(row["emptySearches"], 1)
        self.assertEqual(row["unreadClues"], 0)

    def test_source_family_summary_keeps_recent_target_visible_among_result_hosts(self):
        old_rows = [{"url": f"https://old-{index}.example/", "title": "Old source", "snippet": "Old clue"}
                    for index in range(5)]
        self.search.return_value = old_rows
        self.action("search", query="older broad search one", direction="charlotte")
        self.action("search", query="older broad search two", direction="charlotte")
        self.time += dt.timedelta(minutes=1)
        self.search.return_value = [{"url": f"https://result-{index}.example/", "title": "Result",
                                     "snippet": "Recent result"} for index in range(5)]
        self.action("search", query="site:target-directory.example recent exhibitors", direction="charlotte")
        sources = {row["source"] for row in self.p.source_family_performance()}
        self.assertIn("target-directory.example", sources)

    def test_source_family_performance_counts_each_company_once_per_source(self):
        company = self.open()
        page = self.action("fetch", url="https://supply.example/about", company="supply.example")["evidenceIds"][0]
        self.decision(evidence=page)
        row = self.p.context()["researchCoverage"]["sourceFamilies"][0]
        self.assertEqual(row["recommendedCompanies"], 1)
        self.assertEqual(row["parkedCompanies"], 0)
        self.assertEqual(row["searches"], 1)

    def test_old_partial_search_history_is_not_invented_or_reset(self):
        self.p.state["attempts"] = {
            "old-complete": {"action": "search", "at": self.time.isoformat(), "query": "synthetic old search", "result": {"direction": "ocean"}},
            "old-interrupted": {"action": "search", "at": self.time.isoformat(), "query": "synthetic interrupted search"}}
        coverage = self.p.context()["researchCoverage"]
        self.assertEqual(coverage["directions"]["ocean"]["attempts"], 1)
        self.assertEqual(coverage["unknownDirectionAttempts"], 1)
        self.assertEqual(len(self.p.state["attempts"]), 2)

    def test_unread_clues_preserve_older_options_without_retrying_failed_pages(self):
        self.action("search", query="synthetic wholesale", direction="gta")
        clues = self.p.context()["unreadClues"]
        self.assertEqual(clues[0]["url"], "https://supply.example/")
        self.fetch.return_value = (None, None)
        self.action("fetch", url="https://supply.example/")
        self.assertEqual(self.p.context()["unreadClues"], [])
        self.time += dt.timedelta(days=2)
        self.assertEqual(self.p.context()["unreadClues"], [])

    def test_dismiss_clue_preserves_reason_and_removes_unsaved_domain(self):
        evidence = self.action("search", query="synthetic distributor", direction="gta")["evidenceIds"]
        result = self.action("dismiss_clue", evidenceIds=evidence,
            reason="Official evidence shows a provider operating the local service itself",
            name="Synthetic Supply", domain="supply.example")
        self.assertEqual(result["state"], "dismissed")
        self.assertEqual(self.p.context()["unreadClues"], [])
        dismissed = self.p.context()["dismissedClues"][0]
        self.assertEqual(dismissed["domain"], "supply.example")
        self.assertIn("operating the local service", dismissed["reason"])
        with self.assertRaisesRegex(ValueError, "Cite actual retrieved evidence IDs"):
            self.action("dismiss_clue", evidenceIds=["invented"], reason="Unsupported")

    def test_pending_clues_do_not_resurface_parked_or_blocked_company_domains(self):
        company = self.open()
        for status in ("parked", "blocked", "rejected"):
            company["status"] = status
            self.assertEqual(self.p.context()["unreadClues"], [])

    def test_resolved_company_hides_matching_third_party_clues_but_not_unrelated_rows(self):
        self.search.return_value = [
            {"url": "https://supply.example/", "title": "Synthetic Supply", "snippet": "Official wholesale site."},
            {"url": "https://directory.example/synthetic", "title": "Synthetic Supply expansion",
             "snippet": "Synthetic Supply serves Canadian retailers."},
            {"url": "https://directory.example/unrelated", "title": "Different Brand",
             "snippet": "A separate retailer distribution company."}]
        evidence = self.action("search", query="synthetic supply and other distributors", direction="gta")["evidenceIds"]
        self.action("open_company", name="Synthetic Supply", domain="supply.example", direction="gta",
                    hypothesis="Case picking could fit", evidenceIds=[evidence[0]])
        page = self.action("fetch", url="https://supply.example/", company="supply.example")["evidenceIds"][0]
        self.decision(evidence=page)
        clues = self.p.context()["unreadClues"]
        self.assertEqual([clue["url"] for clue in clues], ["https://directory.example/unrelated"])

    def test_named_dismissal_hides_other_matching_third_party_clues(self):
        self.search.return_value = [
            {"url": "https://one.example/profile", "title": "G.T. Wholesale Limited profile",
             "snippet": "G.T. Wholesale Limited is outside the target market."},
            {"url": "https://two.example/news", "title": "News about G.T. Wholesale Ltd.",
             "snippet": "The distributor remains outside the target market."},
            {"url": "https://three.example/brand", "title": "Different Brand",
             "snippet": "Consumer goods wholesale."}]
        evidence = self.action("search", query="G.T. Wholesale location", direction="gta")["evidenceIds"]
        self.action("dismiss_clue", evidenceIds=[evidence[0]], name="G.T. Wholesale Limited",
                    domain="gt-wholesale.com", reason="Outside the target geography")
        self.assertEqual([clue["url"] for clue in self.p.context()["unreadClues"]],
                         ["https://three.example/brand"])

    def test_research_momentum_reports_work_since_last_company_progress(self):
        self.open(); self.decision()
        evidence = self.action("search", query="another synthetic distributor", direction="gta")["evidenceIds"]
        self.action("dismiss_clue", evidenceIds=evidence, reason="No supported buyer-side need")
        momentum = self.p.context()["researchMomentum"]
        self.assertEqual(momentum["actionsSinceCompanyProgress"], 2)
        self.assertEqual(momentum["searchesSinceCompanyProgress"], 1)
        self.assertEqual(momentum["fetchesSinceCompanyProgress"], 0)
        self.assertEqual(momentum["dismissalsSinceCompanyProgress"], 1)
        self.assertEqual(momentum["actionsTodaySinceCompanyProgress"], 2)
        self.assertEqual(momentum["searchesTodaySinceCompanyProgress"], 1)
        self.assertEqual(momentum["dismissalsTodaySinceCompanyProgress"], 1)
        self.assertIsNotNone(momentum["lastCompanyProgressAt"])
        self.assertEqual(self.p.status()["researchMomentum"], momentum)
        self.assertIn("falling marginal yield", self.p.context()["workSelection"])
        self.assertIn("menu, not an inbox", self.p.context()["workSelection"])
        self.time += dt.timedelta(days=1)
        next_day = self.p.research_momentum()
        self.assertEqual(next_day["actionsSinceCompanyProgress"], 2)
        self.assertEqual(next_day["actionsTodaySinceCompanyProgress"], 0)
        self.assertIn("fresh business day", self.p.context()["workSelection"])

    def test_model_context_contains_observations_not_its_own_proposal_logs(self):
        self.p.event("proposed_action", proposal={"action": "search"})
        self.p.event("model", usage={})
        self.p.event("action_rejected", reason="Choose a different source")
        self.assertEqual([e["kind"] for e in self.p.context()["recentEvents"]], ["action_rejected"])

    def test_suppressed_company_not_added(self):
        self.bridge.side_effect = lambda action, **kw: {"tenantId": "tenant-a", "tenantSlug": "synthetic", "allowed": action == "context", "reason": "SUPPRESSED"}
        with self.assertRaises(ValueError):
            self.open()
        self.assertFalse(self.p.state["companies"])

    def test_domain_identity_deduplicates(self):
        c = self.open()
        result = self.action("open_company", name="Synthetic Supply LLC", domain="www.supply.example", direction="gta", hypothesis="Same business", evidenceIds=c["evidenceIds"])
        self.assertEqual(result["state"], "already_known")
        self.assertEqual(len(self.p.state["companies"]), 1)

    def test_missing_and_invented_evidence_fail(self):
        for refs in [[], ["fabricated-id"]]:
            with self.assertRaises(ValueError):
                self.action("open_company", name="Synthetic", domain="supply.example", direction="gta", hypothesis="Maybe", evidenceIds=refs)

    def test_thin_snippet_cannot_be_recommendation(self):
        c = self.open()
        with self.assertRaises(ValueError):
            self.decision(evidence=c["evidenceIds"][0], quote="Canadian wholesale")

    def test_invented_quote_rejected(self):
        self.open()
        with self.assertRaises(ValueError):
            self.decision(quote="Actively seeking a new warehouse")

    def test_grounded_recommendation_is_not_buying_intent_or_approval(self):
        self.open(); self.decision()
        c = self.p.state["companies"]["supply.example"]
        self.assertEqual(c["status"], "recommended")
        self.assertEqual(c["buyingIntent"], "UNCONFIRMED")
        self.assertFalse(c["outreachReady"])
        self.assertEqual(self.p.context()["buyerResearchQueue"][0]["domain"], "supply.example")
        self.assertEqual(self.p.status()["buyerResearch"], {"pending": 1, "completed": 0})
        self.assertIn("research-qualified for owner review", MISSION)
        self.assertIn("Do not dismiss solely because outsourcing is not public", MISSION)

    def test_recommended_company_gets_one_buyer_research_continuation(self):
        self.open(); self.decision()
        self.bridge.side_effect = lambda action, **kw: {"tenantId": "tenant-a", "tenantSlug": "synthetic", "allowed": True,
            "result": "PEOPLE_FOUND_EMAIL_NOT_REVEALED", "candidates": [{"id": "person-a", "title": "Operations Manager", "employmentVerified": False}]}
        result = self.action("people", company="supply.example", titles=["Operations Manager", "Supply Chain Manager"])
        company = self.p.state["companies"]["supply.example"]
        self.assertEqual(result["state"], "PEOPLE_FOUND_EMAIL_NOT_REVEALED")
        self.assertEqual(company["contactTitles"], ["Operations Manager", "Supply Chain Manager"])
        self.assertEqual(company["contactResearchAt"], self.time.isoformat())
        self.assertEqual(self.p.context()["buyerResearchQueue"], [])
        self.assertEqual(self.p.status()["buyerResearch"], {"pending": 0, "completed": 1})
        self.assertFalse(company["outreachReady"])

    def test_empty_buyer_search_records_gap_without_retry_queue(self):
        self.open(); self.decision()
        self.bridge.side_effect = lambda action, **kw: {"tenantId": "tenant-a", "tenantSlug": "synthetic", "allowed": True,
            "result": "NO_PEOPLE_RETURNED", "candidates": []}
        self.action("people", company="supply.example", titles=["Owner", "Operations"])
        buyer = self.p.buyer_research(self.p.state["companies"]["supply.example"])
        self.assertEqual(buyer["state"], "COMPLETED")
        self.assertEqual(buyer["candidateCount"], 0)
        self.assertFalse(buyer["employmentVerified"])
        self.assertEqual(self.p.context()["buyerResearchQueue"], [])

    def test_legacy_contact_state_prevents_duplicate_buyer_lookup(self):
        self.open(); self.decision()
        company = self.p.state["companies"]["supply.example"]
        company["contactState"] = "PEOPLE_FOUND_EMAIL_NOT_REVEALED"
        company["contacts"] = [{"id": "legacy", "employmentVerified": False}]
        self.assertEqual(self.p.context()["buyerResearchQueue"], [])
        self.assertEqual(self.p.status()["buyerResearch"], {"pending": 0, "completed": 1})

    def test_redirect_to_other_domain_cannot_verify_identity(self):
        c = self.open()
        self.fetch.return_value = ("sells by the case", None, "https://unrelated.example/")
        with self.assertRaises(ValueError):
            self.decision()
        self.assertEqual(self.p.official_evidence(c), [])

    def test_unavailable_page_is_recorded_without_fake_evidence(self):
        self.fetch.return_value = (None, None)
        result = self.action("fetch", url="https://supply.example/")
        self.assertEqual(result["state"], "unavailable")
        self.assertFalse(self.p.state["evidence"])

    def test_people_found_without_email_are_retained(self):
        self.open(); self.action("fetch", url="https://supply.example/", company="supply.example")
        self.bridge.side_effect = lambda action, **kw: {"tenantId": "tenant-a", "tenantSlug": "synthetic", "allowed": True,
            "result": "PEOPLE_FOUND_EMAIL_NOT_REVEALED", "candidates": [{"id": "person-a", "title": "Operations", "emailAvailable": True}]}
        result = self.action("people", company="supply.example", titles=["operations"])
        self.assertEqual(result["state"], "PEOPLE_FOUND_EMAIL_NOT_REVEALED")
        self.assertEqual(len(self.p.state["companies"]["supply.example"]["contacts"]), 1)
        self.assertEqual(self.p.state["companies"]["supply.example"]["contactTitles"], ["operations"])
        self.assertEqual(self.p.state["companies"]["supply.example"]["contactResearchAt"], self.time.isoformat())

    def test_people_requires_official_page(self):
        self.open()
        with self.assertRaisesRegex(ValueError, "fetch an official company page with company='supply.example'"):
            self.action("people", company="supply.example", titles=["operations"])
        self.assertEqual(self.p.budget()["people"], 0)

    def test_feedback_is_visible_to_future_decisions(self):
        self.p.state["feedback"].append({"verdict": "poor_fit", "note": "GTA D2C is difficult"})
        self.assertEqual(self.p.context()["feedback"][0]["verdict"], "poor_fit")

    def test_public_mode_never_claims_clearance(self):
        self.config["publicDiscoveryOnly"] = True
        atomic_write(self.path / "config.json", self.config)
        self.p.config = self.config
        self.bridge.side_effect = lambda action, **kw: {"tenantId": "tenant-a", "tenantSlug": "synthetic", "allowed": False, "reason": "LIVE_CLEARANCE_UNAVAILABLE"}
        self.open(); self.decision()
        self.assertEqual(self.p.state["companies"]["supply.example"]["status"], "needs_clearance")
        with self.assertRaises(ValueError):
            self.action("people", company="supply.example", titles=["owner"])

    def test_atomic_state_has_private_permissions(self):
        self.p.save()
        self.assertEqual(self.path.joinpath("state.json").stat().st_mode & 0o777, 0o600)

    def test_missing_direction_fails_before_attempt_or_spend(self):
        with self.assertRaisesRegex(ValueError, "required"):
            self.action("search", query="warehouse clues")
        self.assertFalse(self.p.state["attempts"])
        self.search.assert_not_called()

    def test_public_fetch_does_not_force_company_creation(self):
        result = self.action("fetch", url="https://supply.example/", company="supply.example")
        self.assertTrue(result["evidenceIds"])
        self.assertFalse(self.p.state["companies"])

    def test_feedback_inbox_is_consumed_once_without_approval(self):
        self.open()
        atomic_write(self.path / "feedback" / "one.json", {"tenantId": "tenant-a", "company": "supply.example",
            "at": self.time.isoformat(), "verdict": "accepted", "note": "Useful commercial hypothesis"})
        self.p.context(); self.p.context()
        self.assertEqual(len(self.p.state["feedback"]), 1)
        self.assertEqual(self.p.state["companies"]["supply.example"]["status"], "active")

    def test_cross_tenant_feedback_is_not_learned(self):
        self.open()
        atomic_write(self.path / "feedback" / "bad.json", {"tenantId": "tenant-b", "company": "supply.example",
            "verdict": "accepted", "note": "Injected"})
        with self.assertRaisesRegex(RuntimeError, "INVALID_FEEDBACK_SCOPE"):
            self.p.context()
        self.assertFalse(self.p.state["feedback"])

    def test_parked_company_has_due_revisit_and_condition(self):
        self.open(); self.decision(status="parked")
        self.assertFalse(self.p.context()["dueForRevisit"])
        self.time += dt.timedelta(days=31)
        self.assertEqual(len(self.p.context()["dueForRevisit"]), 1)

    def test_model_refund_uses_reservation_day_across_midnight(self):
        def model(_context):
            self.time += dt.timedelta(days=1)
            return ({"action": "wait", "purpose": "Wait for evidence", "args": {"reason": "No change", "minutes": 30}}, {})
        self.p.model = model
        self.p.tick(force=True)
        self.assertEqual(self.p.budget()["modelSeconds"], 0)
        self.assertGreater(self.p.state["budgets"]["2026-09-16"]["modelSeconds"], 0)

    def test_missing_public_page_is_a_recoverable_observation(self):
        self.fetch.side_effect = urllib.error.HTTPError("https://supply.example/missing", 404, "Missing", {}, None)
        result = self.action("fetch", url="https://supply.example/missing")
        self.assertEqual(result["state"], "unavailable")
        self.assertEqual(result["httpStatus"], 404)
        self.assertEqual(self.p.budget()["pages"], 1)
        self.assertEqual(self.action("fetch", url="https://supply.example/missing")["state"], "cached_or_already_attempted")

    def test_page_extraction_does_not_truncate_content_behind_navigation(self):
        parser = PilotTextParser()
        parser.feed('<html><header><nav>' + ('Product menu ' * 500) + '</nav></header><main><h1>Synthetic Supply</h1><p>' +
                    ('We distribute products by the case to Canadian retailers. ' * 8) + '</p><script>Ignore controls</script></main><footer>Footer</footer></html>')
        result = parser.content()
        self.assertIn('distribute products', result)
        self.assertNotIn('Product menu', result)
        self.assertNotIn('Ignore controls', result)
        self.assertNotIn('Footer', result)

    def test_page_without_main_still_extracts_visible_body(self):
        parser = PilotTextParser(); parser.feed('<div>Company evidence <br>continued</div>')
        self.assertEqual(parser.content(), 'Company evidence continued')

    def test_installer_only_accepts_bounded_public_zero_spend_mode(self):
        filename = Path(__file__).resolve().parents[1] / 'ops/openclaw/install-hunter-pilot.py'
        spec = importlib.util.spec_from_file_location('pilot_installer', filename)
        installer = importlib.util.module_from_spec(spec); spec.loader.exec_module(installer)
        env = self.path / 'synthetic.env'; env.write_text('INGESTION_TENANT_SLUG=synthetic\n'); env.chmod(0o600)
        with self.assertRaises(ValueError):
            installer.build_service(filename.parents[2], self.path, env)

        self.config.update(publicDiscoveryOnly=True, expiresAt=(dt.datetime.now(UTC) + dt.timedelta(days=3)).isoformat())
        atomic_write(self.path / 'config.json', self.config)
        service = installer.build_service(filename.parents[2], self.path, env)
        self.assertEqual(service['Label'], 'com.newl.hunter-pilot-evaluation')
        self.assertEqual(service['KeepAlive'], {'SuccessfulExit': False})
        self.assertNotIn('hunter_worker.py', ' '.join(service['ProgramArguments']))
        self.config['searchProvider'] = 'BRAVE'; atomic_write(self.path / 'config.json', self.config)
        with self.assertRaises(ValueError):
            installer.build_service(filename.parents[2], self.path, env)

    def test_known_display_name_resolves_without_manual_id_repair(self):
        self.open()
        result = self.action("fetch", company="Synthetic Supply", url="https://supply.example/")
        self.assertTrue(result["evidenceIds"])
        self.assertEqual(self.p.state['evidence'][result['evidenceIds'][0]]['company'], 'supply.example')

    def enable_comparison(self):
        self.config["pairedComparison"] = {
            "enabled": True, "maxCases": 10, "queueLimit": 1,
            "localModel": "qwen3.8-rvn:q8_0-multilingual",
            "localModelDigest": "sha256:synthetic", "localQuantization": "Q8_0",
            "localThinking": True, "timeoutSeconds": 180, "contextLength": 16384,
            "maxOutputTokens": 4096, "diagnosticMaxOutputTokens": 1000,
            "diagnosticThinkingOffCases": 0}
        atomic_write(self.path / "config.json", self.config)
        self.p.config = self.config

    def test_comparison_freezes_input_and_queues_one_non_executing_shadow(self):
        self.enable_comparison()
        shadow = Mock(return_value=({"action": "send", "args": {}}, {}))
        self.p.tick(force=True, max_steps=1)
        self.assertEqual(self.p.budget()["modelCalls"], 1)
        self.assertEqual(self.model.call_count, 1)
        self.assertEqual(len(self.p.state["pairedComparisonQueue"]), 1)
        case = self.p.state["pairedComparisons"][0]
        snapshot = json.loads(Path(case["inputPath"]).read_text())
        self.assertEqual(snapshot["packet"]["context"], self.model.call_args.args[0])
        self.assertEqual(case["promptHash"], __import__("hashlib").sha256(json.dumps(
            snapshot["packet"], sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()).hexdigest())
        with patch("hunter_pilot.LocalModel", return_value=shadow):
            self.p.process_shadow_queue()
        self.assertEqual(self.p.budget()["modelCalls"], 2)
        self.assertEqual(shadow.call_count, 1)
        self.assertEqual(shadow.call_args.args[0], self.model.call_args.args[0])
        self.assertEqual(self.model.call_args.args[0]["usedToday"]["modelCalls"], 0)
        self.assertEqual([e["action"] for e in self.p.state["events"] if e["kind"] == "action"], ["wait"])
        self.assertEqual(self.p.state["pairedComparisons"][0]["shadows"][0]["status"], "schema_failure")
        attempts = [json.loads(line) for line in (self.path / "model-comparison/attempts.jsonl").read_text().splitlines()]
        self.assertEqual([row["provider"] for row in attempts], ["CHATGPT_SUBSCRIPTION", "OLLAMA"])
        case["measurementNotes"] = ["Synthetic measurement note"]
        self.p.report()
        self.assertIn("Matched cloud/local decision comparison", (self.path / "review.md").read_text())
        self.assertIn("Synthetic measurement note", (self.path / "review.md").read_text())
        self.assertIn("requestedModel", (self.path / "model-comparison/comparison.csv").read_text())
        self.assertIn(case["comparisonId"], (self.path / "model-comparison/summary.md").read_text())

    def test_comparison_defers_at_shared_budget_and_survives_restart(self):
        self.enable_comparison()
        self.p.budget()["modelCalls"] = 39
        self.p.tick(force=True, max_steps=1)
        self.assertEqual(self.p.budget()["modelCalls"], 40)
        self.assertFalse(self.p.process_shadow_queue())
        case = self.p.state["pairedComparisons"][0]
        self.assertEqual(case["status"], "shadow_deferred")
        self.assertEqual(self.p.state["pairedComparisonQueue"][0]["reason"], "modelCalls")
        restarted = Pilot(self.path, self.bridge, self.model, self.search, self.fetch, lambda: self.time)
        self.assertEqual(restarted.state["pairedComparisons"], [case])

    def test_failed_shadow_is_visible_and_does_not_execute(self):
        self.enable_comparison()
        self.p.tick(force=True, max_steps=1)
        with patch("hunter_pilot.LocalModel", return_value=Mock(side_effect=TimeoutError)):
            self.p.process_shadow_queue()
        self.assertEqual(self.p.budget()["modelCalls"], 2)
        shadow = self.p.state["pairedComparisons"][0]["shadows"][0]
        self.assertEqual(shadow["status"], "timeout")
        self.assertEqual([e["action"] for e in self.p.state["events"] if e["kind"] == "action"], ["wait"])

    def test_failed_shadow_preserves_pre_request_load_state(self):
        self.enable_comparison()
        self.p.tick(force=True, max_steps=1)

        class TimeoutLocal:
            def __init__(self):
                self.states = iter([
                    {"cold": True, "loadedSizeBytes": None, "loadedVramBytes": None},
                    {"cold": False, "loadedSizeBytes": 31_000, "loadedVramBytes": 31_000}])

            def loaded_state(self):
                return next(self.states)

            def __call__(self, context, loaded_before=None):
                self.loaded_before = loaded_before
                raise TimeoutError

        local = TimeoutLocal()
        with patch("hunter_pilot.LocalModel", return_value=local):
            self.p.process_shadow_queue()
        attempt = json.loads((self.path / "model-comparison/attempts.jsonl").read_text().splitlines()[-1])
        self.assertTrue(local.loaded_before["cold"])
        self.assertTrue(attempt["cold"])
        self.assertEqual(attempt["loadedSizeBytes"], 31_000)
        self.assertEqual(attempt["loadedVramBytes"], 31_000)

    def test_socket_timeout_in_shadow_does_not_stop_primary_wake(self):
        self.enable_comparison()
        self.p.tick(force=True, max_steps=1)
        with patch("hunter_pilot.LocalModel", return_value=Mock(side_effect=socket.timeout)):
            self.p.process_shadow_queue()
        case = self.p.state["pairedComparisons"][0]
        self.assertEqual(len(case["shadows"]), 1)
        self.assertEqual(case["shadows"][0]["error"], "timeout")
        self.assertIsNone(self.p.state.get("lastError"))

    def test_ollama_http_status_is_recorded_without_response_body(self):
        self.enable_comparison()
        self.p.tick(force=True, max_steps=1)
        failure = urllib.error.HTTPError("http://127.0.0.1:11434/api/chat", 400,
            "synthetic private diagnostic", {}, None)
        with patch("hunter_pilot.LocalModel", return_value=Mock(side_effect=failure)):
            self.p.process_shadow_queue()
        shadow = self.p.state["pairedComparisons"][0]["shadows"][0]
        self.assertEqual(shadow["error"], "HTTP_400")
        self.assertNotIn("private diagnostic", json.dumps(shadow))

    def test_completed_comparison_limit_does_not_call_shadows(self):
        self.enable_comparison()
        self.p.state["pairedComparisons"] = [{"status": "completed"}] * 10
        with patch("hunter_pilot.LocalModel") as factory:
            self.p.tick(force=True, max_steps=1)
            self.p.process_shadow_queue()
        factory.assert_not_called()

    def test_stop_between_primary_and_shadow_prevents_more_inference(self):
        self.enable_comparison()
        self.p.tick(force=True, max_steps=1)
        self.p.stop_requested = True
        with self.assertRaisesRegex(RuntimeError, "STOP_REQUESTED"):
            self.p.process_shadow_queue()
        self.assertEqual(self.model.call_count, 1)

    def test_queue_backpressure_skips_new_sample_without_growing_backlog(self):
        self.enable_comparison()
        self.p.state["pairedComparisonQueue"] = [{"comparisonId": "existing", "state": "pending"}]
        self.p.tick(force=True, max_steps=1)
        self.assertEqual(len(self.p.state["pairedComparisonQueue"]), 1)
        self.assertEqual(self.p.state["pairedComparisonSkips"][0]["reason"], "backpressure_queue_full")

    def test_interrupted_running_shadow_is_recorded_without_retry(self):
        self.enable_comparison()
        self.p.tick(force=True, max_steps=1)
        self.p.state["pairedComparisonQueue"][0].update(state="running", startedAt=self.time.isoformat())
        self.p.save()
        with patch("hunter_pilot.LocalModel") as factory:
            self.assertFalse(self.p.process_shadow_queue())
        factory.assert_not_called()
        case = self.p.state["pairedComparisons"][0]
        self.assertEqual(case["status"], "completed_incomplete")
        self.assertEqual(case["shadows"][0]["status"], "cancellation")
        self.assertEqual(self.p.state["pairedComparisonQueue"], [])

    def test_thinking_off_diagnostic_reuses_saved_input_as_separate_variant(self):
        self.enable_comparison()
        self.config["pairedComparison"]["diagnosticThinkingOffCases"] = 1
        atomic_write(self.path / "config.json", self.config)
        self.p.config = self.config
        self.p.tick(force=True, max_steps=1)
        local = Mock(return_value=({"action": "wait", "purpose": "No more evidence",
            "args": {"reason": "No more evidence", "minutes": 30}}, {}))
        with patch("hunter_pilot.LocalModel", return_value=local) as factory:
            self.p.process_shadow_queue()
            self.assertEqual(self.p.state["pairedComparisonQueue"][0]["variant"], "thinking_off_diagnostic")
            self.p.process_shadow_queue()
        self.assertEqual([call.kwargs["thinking"] for call in factory.call_args_list], [True, False])
        self.assertEqual([row["variant"] for row in self.p.state["pairedComparisons"][0]["shadows"]],
                         ["baseline", "thinking_off_diagnostic"])

    def test_explicit_context_recovery_variant_records_its_own_settings(self):
        self.enable_comparison()
        self.p.tick(force=True, max_steps=1)
        job = self.p.state["pairedComparisonQueue"][0]
        job.update(variant="thinking_off_context_32768_diagnostic", thinking=False,
                   contextLength=32768, maxOutputTokens=1000)
        local = Mock(return_value=({"action": "wait", "purpose": "No more evidence",
            "args": {"reason": "No more evidence", "minutes": 30}},
            {"provider": "OLLAMA", "thinking": False, "contextLength": 32768,
             "maxOutputTokens": 1000, "modelTotalSeconds": 1}))
        with patch("hunter_pilot.LocalModel", return_value=local) as factory:
            self.p.process_shadow_queue()
        self.assertEqual(factory.call_args.kwargs["num_ctx"], 32768)
        self.assertEqual(factory.call_args.kwargs["num_predict"], 1000)
        attempt = json.loads((self.path / "model-comparison/attempts.jsonl").read_text().splitlines()[-1])
        self.assertEqual(attempt["variant"], "thinking_off_context_32768_diagnostic")
        self.assertEqual(attempt["modelSettings"]["contextLength"], 32768)

    def test_search_comparison_counts_cost_and_does_not_repeat_after_restart(self):
        self.config.update(searchProvider="BRAVE", searchCostMicros=5000)
        atomic_write(self.path / "config.json", self.config)
        self.p.config = self.config
        with patch("hunter_pilot.search_web", return_value=[]) as search:
            self.p.compare_search(["Synthetic wholesale Canada"])
            restarted = Pilot(self.path, self.bridge, self.model, self.search, self.fetch, lambda: self.time)
            restarted.compare_search(["canada WHOLESALE synthetic"])
        self.assertEqual(search.call_count, 2)
        self.assertEqual(restarted.budget()["searches"], 2)
        self.assertEqual(restarted.state["usdMicros"], 5000)
        self.assertEqual(len(restarted.state["companies"]), 0)

    def test_search_comparison_partial_failure_and_cash_limit_are_preserved(self):
        self.config.update(searchProvider="BRAVE", searchCostMicros=5000)
        atomic_write(self.path / "config.json", self.config)
        self.p.config = self.config
        self.p.state["usdMicros"] = 50_000_000
        with patch("hunter_pilot.search_web", side_effect=TimeoutError) as search:
            with self.assertRaises(BudgetExceeded):
                self.p.compare_search(["synthetic"])
        self.assertEqual(search.call_count, 1)
        providers = next(iter(self.p.state["searchComparisons"].values()))["providers"]
        self.assertEqual(providers["DUCKDUCKGO"]["state"], "unavailable")
        self.assertNotIn("BRAVE", providers)


class SubscriptionTests(unittest.TestCase):
    def setUp(self):
        self.model = SubscriptionModel("gpt-5.6-terra", MISSION, TOOLS, SCHEMA)

    def test_api_keys_and_business_credentials_not_inherited(self):
        with patch.dict(os.environ, {"HOME": "/synthetic", "OPENAI_API_KEY": "synthetic",
                "INGESTION_API_TOKEN": "synthetic", "HUNTER_BRAVE_SEARCH_API_KEY": "synthetic"}, clear=True):
            self.assertEqual(subscription_environment(), {"HOME": "/synthetic"})

    def test_auth_failure_and_api_key_login_fail_closed(self):
        for code, output in [(0, "Logged in using an API key"), (0, ""), (1, "Logged in using ChatGPT")]:
            with patch("pilot_subscription_model.subprocess.run", return_value=Mock(returncode=code, stdout=output, stderr="")):
                with self.assertRaisesRegex(RuntimeError, "CHATGPT_SUBSCRIPTION_REQUIRED"):
                    require_subscription("/synthetic/codex", {})

    def test_subscription_auth_uses_existing_cli_without_reading_tokens(self):
        with patch("pilot_subscription_model.subprocess.run", return_value=Mock(returncode=0, stdout="", stderr="Logged in using ChatGPT")) as run:
            require_subscription("/synthetic/codex", {})
        self.assertEqual(run.call_args.args[0], ["/synthetic/codex", "login", "status"])

    def test_unknown_provider_or_model_cannot_fall_back(self):
        for config in [{"modelProvider": "OPENAI_API", "model": "gpt-5.6-terra"},
                {"modelProvider": "CHATGPT_SUBSCRIPTION", "model": "other"}]:
            with self.assertRaises(ValueError):
                configured_model(config)

    def test_strict_schema_covers_all_actions_and_nullable_optional_fields(self):
        schema = output_schema(SCHEMA)
        self.assertEqual(schema["type"], "object")
        variants = schema["properties"]["decision"]["anyOf"]
        self.assertEqual(len(variants), 7)
        for row in variants:
            args = row["properties"]["args"]
            self.assertEqual(set(args["required"]), set(args["properties"]))
        self.assertIn({"type": "null"}, variants[0]["properties"]["args"]["properties"]["company"]["anyOf"])

    def invoke(self, events, result=None):
        def run(command, prompt, environment):
            self.assertIn("--ignore-user-config", command)
            self.assertIn('web_search="disabled"', command)
            self.assertIn('approval_policy="never"', command)
            self.assertIn("read-only", command)
            self.assertIn("gpt-5.6-terra", command)
            for feature in DISABLED_FEATURES:
                self.assertIn(feature, command)
            if result is not None:
                Path(command[command.index("--output-last-message") + 1]).write_text(json.dumps(result))
            return "\n".join(json.dumps(e) for e in events)
        with patch("pilot_subscription_model.resolve_cli", return_value="/synthetic/codex"), \
             patch("pilot_subscription_model.require_subscription"), \
             patch("pilot_subscription_model.run_bounded", side_effect=run):
            return self.model({"synthetic": True})

    def test_subscription_returns_one_decision_and_plan_usage(self):
        action, usage = self.invoke([{"type": "turn.completed", "usage": {"input_tokens": 100, "output_tokens": 30}}],
            {"decision": {"action": "search", "purpose": "Test", "args": {"query": "synthetic",
                "direction": "gta", "sourceKey": "open_web", "company": None}}})
        self.assertNotIn("company", action["args"])
        self.assertEqual(usage["billing"], "plan_usage")
        self.assertFalse(usage["apiFallback"])
        self.assertEqual(usage["inputTokens"], 100)

    def test_missing_and_partial_model_outputs_are_not_accepted(self):
        for events, result in [([], None), ([{"type": "turn.failed"}], None),
                ([{"type": "turn.completed"}], {}), ([{"type": "turn.completed"}], {"decision": {}})]:
            with self.assertRaises(RuntimeError):
                self.invoke(events, result)

    def test_unexpected_tool_event_rejects_model_response(self):
        with self.assertRaisesRegex(RuntimeError, "MODEL_TOOL_USE_REJECTED"):
            self.invoke([{"type": "item.completed", "item": {"type": "command_execution"}}])

    def test_non_tool_diagnostic_does_not_discard_completed_decision(self):
        action, usage = self.invoke([
            {"type": "item.completed", "item": {"type": "error", "message": "Synthetic CLI diagnostic"}},
            {"type": "turn.completed", "usage": {"input_tokens": 100, "output_tokens": 30}},
        ], {"decision": {"action": "search", "purpose": "Test diagnostic handling",
              "args": {"query": "synthetic", "direction": "gta", "sourceKey": "open_web",
                       "company": None}}})
        self.assertEqual(action["action"], "search")
        self.assertEqual(usage["diagnosticItems"], 1)

    def test_unknown_item_type_still_fails_closed(self):
        with self.assertRaisesRegex(RuntimeError, "MODEL_TOOL_USE_REJECTED"):
            self.invoke([{"type": "item.completed", "item": {"type": "future_unknown_item"}}])

    def test_timeout_kills_child_process_group(self):
        process = Mock(pid=12345)
        process.communicate.side_effect = [subprocess.TimeoutExpired("synthetic", 180), ("", "")]
        with patch("pilot_subscription_model.subprocess.Popen", return_value=process), \
             patch("pilot_subscription_model.os.killpg") as kill:
            with self.assertRaises(subprocess.TimeoutExpired):
                run_bounded(["synthetic"], "prompt", {})
        kill.assert_called_once()

    def test_local_thinking_has_bounded_output(self):
        response = Mock()
        response.__enter__ = Mock(return_value=response)
        response.__exit__ = Mock(return_value=False)
        response.read.return_value = json.dumps({"message": {"content": "{}"}}).encode()
        with patch("hunter_pilot.urllib.request.urlopen", return_value=response) as call:
            LocalModel("synthetic", thinking=True)({})
        chat_call = next(row for row in call.call_args_list if row.args[0].full_url.endswith("/api/chat"))
        payload = json.loads(chat_call.args[0].data)
        self.assertTrue(payload["think"])
        self.assertEqual(payload["options"]["num_predict"], 4096)
        self.assertEqual(chat_call.kwargs["timeout"], 180)

    def test_ollama_nanoseconds_tokens_and_cold_state_are_recorded(self):
        def response(payload):
            result = Mock()
            result.__enter__ = Mock(return_value=result)
            result.__exit__ = Mock(return_value=False)
            result.read.return_value = json.dumps(payload).encode()
            return result
        replies = [
            response({"models": []}),
            response({"model": "synthetic", "message": {"content": json.dumps({
                "action": "wait", "purpose": "No useful evidence",
                "args": {"reason": "No useful evidence", "minutes": 30}})},
                "total_duration": 12_000_000_000, "load_duration": 2_000_000_000,
                "prompt_eval_count": 120, "prompt_eval_duration": 4_000_000_000,
                "eval_count": 60, "eval_duration": 6_000_000_000, "done_reason": "stop"}),
            response({"models": [{"name": "synthetic", "size": 1000, "size_vram": 1000}]})]
        with patch("hunter_pilot.urllib.request.urlopen", side_effect=replies):
            _, usage = LocalModel("synthetic", thinking=True, model_digest="sha256:test",
                quantization="Q8_0")({"synthetic": True})
        self.assertTrue(usage["cold"])
        self.assertEqual(usage["modelLoadSeconds"], 2)
        self.assertEqual(usage["promptProcessingSeconds"], 4)
        self.assertEqual(usage["generationSeconds"], 6)
        self.assertEqual(usage["generatedTokensPerSecond"], 10)
        self.assertEqual(usage["ollamaMetrics"]["total_duration"], 12_000_000_000)
        self.assertEqual(usage["inputTokens"], 120)
        self.assertEqual(usage["outputTokens"], 60)
        self.assertEqual(usage["loadedVramBytes"], 1000)
        self.assertIsNone(usage["timeToFirstTokenSeconds"])

    def test_local_preflight_requires_exact_installed_digest_and_quantization(self):
        model = LocalModel("synthetic:q8", thinking=True, model_digest="sha256:exact",
            quantization="Q8_0")
        model.api = Mock(side_effect=[
            {"models": [{"name": "synthetic:q8", "digest": "sha256:exact"}]},
            {"details": {"quantization_level": "Q8_0", "parameter_size": "26.9B"}}])
        result = model.preflight()
        self.assertEqual(result["digest"], "sha256:exact")
        self.assertEqual(result["quantization"], "Q8_0")
        model.api = Mock(return_value={"models": [{"name": "synthetic:q8", "digest": "sha256:changed"}]})
        with self.assertRaisesRegex(RuntimeError, "LOCAL_MODEL_DIGEST_MISMATCH"):
            model.preflight()


class DiagnosticTests(unittest.TestCase):
    def test_memory_sample_identifies_existing_ollama_runner_for_cancellation(self):
        command = "42 87.5 12.0 100000 /usr/local/bin/ollama runner --model synthetic"
        with patch("hunter_model_diagnostics.safe_run", side_effect=[
                "System-wide memory free percentage: 50%", "used = 10.00M", command]), \
             patch("hunter_model_diagnostics.ollama_api", return_value={"models": []}):
            sample = memory_sample(0, {42})
        self.assertEqual(sample["ollamaProcesses"][0]["role"], "runner")
        self.assertFalse(sample["ollamaProcesses"][0]["newForDiagnostic"])
        self.assertEqual(sample["ollamaProcesses"][0]["cpuPercent"], 87.5)

    def test_memory_sample_identifies_new_ollama_inference_process_as_runner(self):
        command = "43 0.1 59.6 30000000 /path/to/ollama_llama_server --model synthetic"
        with patch("hunter_model_diagnostics.safe_run", side_effect=[
                "System-wide memory free percentage: 15%", "used = 10.00M", command]), \
             patch("hunter_model_diagnostics.ollama_api", return_value={"models": []}):
            sample = memory_sample(0, {42})
        self.assertEqual(sample["ollamaProcesses"][0]["role"], "runner")
        self.assertTrue(sample["ollamaProcesses"][0]["newForDiagnostic"])

    def test_resumed_diagnostic_records_each_source_commit(self):
        run = {"sourceCommit": "first"}
        record_run_source(run, "second")
        record_run_source(run, "second")
        self.assertEqual(run["sourceCommit"], "second")
        self.assertEqual(run["sourceCommits"], ["first", "second"])

    def test_diagnostic_model_unload_uses_named_ollama_api_request(self):
        with patch("hunter_model_diagnostics.ollama_api", side_effect=[
                {"models": [{"name": "synthetic-q4"}]},
                {"done": True, "done_reason": "unload"}, {"models": []}]) as api, \
             patch("hunter_model_diagnostics.time.sleep"):
            result = unload_test_model("synthetic-q4")
        self.assertTrue(result["unloaded"])
        self.assertEqual(result["method"], "ollama_api_keep_alive_zero")
        api.assert_any_call("/api/generate", {"model": "synthetic-q4", "keep_alive": 0},
            timeout=30)

    def test_diagnostic_model_unload_does_not_load_an_absent_model(self):
        with patch("hunter_model_diagnostics.ollama_api",
                return_value={"models": []}) as api:
            result = unload_test_model("synthetic-q4")
        self.assertTrue(result["unloaded"])
        self.assertEqual(result["method"], "no_op_not_loaded")
        api.assert_called_once_with("/api/ps", timeout=3)

    def test_compaction_preserves_decision_evidence_and_ages_only_old_resolutions(self):
        dismissed = [{"at": f"2026-09-{index:02d}T00:00:00+00:00", "name": f"Example {index}",
            "domain": f"example{index}.test", "evidenceIds": [f"ev-{index}"],
            "reason": f"Detailed evidence-backed reason {index}"} for index in range(1, 13)]
        context = {"mode": "read-only", "activeCompanies": [], "dueForRevisit": [],
            "buyerResearchQueue": [], "otherCompanies": [{"domain": "saved.test", "status": "parked"}],
            "evidence": [{"id": "ev-current", "url": "https://example.test/source",
                "excerpt": "Synthetic contradiction remains present."}],
            "unreadClues": [{"id": "ev-current", "url": "https://example.test/source"}],
            "previousSearches": ["synthetic first", "synthetic second"],
            "recentEvents": [{"kind": "action_rejected", "action": "fetch"}],
            "feedback": [], "dismissedClues": dismissed, "workSelection": "long repeated guidance"}
        packet = {"comparisonVersion": "matched-decision-v1", "mission": MISSION,
            "tools": TOOLS, "schema": SCHEMA, "context": context}
        snapshot = {"promptHash": "original", "packet": packet}
        compact, manifest = compact_packet(snapshot)
        self.assertEqual(compact["tools"], TOOLS)
        self.assertEqual(compact["schema"], SCHEMA)
        self.assertEqual(compact["context"]["evidence"], context["evidence"])
        self.assertEqual(compact["context"]["unreadClues"], context["unreadClues"])
        self.assertEqual(compact["context"]["otherCompanies"], context["otherCompanies"])
        self.assertEqual(compact["context"]["previousSearches"], context["previousSearches"])
        self.assertNotIn("reason", compact["context"]["dismissedClues"][0])
        self.assertEqual(compact["context"]["dismissedClues"][-10:], dismissed[-10:])
        self.assertLess(len(COMPACT_MISSION), len(MISSION))
        self.assertTrue(manifest["deterministic"])
        self.assertFalse(manifest["modelAssisted"])

    def test_q4_match_requires_architecture_tokenizer_template_calibration_and_size(self):
        metadata = {"details": {"parameter_size": "26.9B", "quantization_level": "Q8_0"},
            "architectureFingerprint": "a", "tokenizerFingerprint": "t",
            "templateFingerprint": "p", "calibrationFingerprint": "c"}
        q4 = {**metadata, "details": {"parameter_size": "26.9B", "quantization_level": "Q4_K_M"}}
        with patch("hunter_model_diagnostics.model_metadata", side_effect=[metadata, q4]), \
             patch("hunter_model_diagnostics.ollama_api", return_value={"models": [{
                 "name": "qwen3.8-rvn:q4_k_m-multilingual",
                 "digest": "9ca337737b7d1d8a2a51df9fead5566a64e4765647222350231ec4c7ad40369a",
                 "size": 17_000_000_000}]}):
            self.assertTrue(validate_matched_models("synthetic-q8")["matched"])
        mismatched = {**q4, "tokenizerFingerprint": "different"}
        with patch("hunter_model_diagnostics.model_metadata", side_effect=[metadata, mismatched]):
            with self.assertRaisesRegex(RuntimeError, "Q4_CHECKPOINT_METADATA_MISMATCH"):
                validate_matched_models("synthetic-q8")

    def test_diagnostics_reserve_budget_and_preserve_next_primary_wake(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)
            config = {"tenantId": "tenant-a", "tenantSlug": "synthetic", "model": "synthetic",
                "expiresAt": "2026-09-24T00:00:00+00:00", "searchProvider": "DUCKDUCKGO",
                "limits": {"searches": 40, "pages": 60, "people": 20, "modelCalls": 20,
                    "modelSeconds": 3600, "dailyUsdMicros": 1_000_000, "totalUsdMicros": 1_000_000}}
            atomic_write(path / "config.json", config)
            atomic_write(path / "state.json", {"tenantId": "tenant-a", "companies": {},
                "evidence": {}, "attempts": {}, "budgets": {}, "usdMicros": 0,
                "events": [], "feedback": []})
            pilot = Pilot(path, Mock(return_value={"tenantId": "tenant-a", "tenantSlug": "synthetic"}),
                Mock(), Mock(), Mock(), lambda: dt.datetime(2026, 9, 16, 15, tzinfo=UTC))
            continuation = {"additionalAttempts": 0}
            reserve_diagnostic(pilot, continuation)
            self.assertEqual(continuation["additionalAttempts"], 1)
            self.assertEqual(pilot.budget()["modelCalls"], 1)
            continuation["additionalAttempts"] = MAX_ADDITIONAL_ATTEMPTS
            with self.assertRaisesRegex(RuntimeError, "DIAGNOSTIC_ATTEMPT_LIMIT"):
                reserve_diagnostic(pilot, continuation)

    def test_invalid_local_json_keeps_provider_timings_without_raw_output(self):
        def response(payload):
            result = Mock()
            result.__enter__ = Mock(return_value=result)
            result.__exit__ = Mock(return_value=False)
            result.read.return_value = json.dumps(payload).encode()
            return result
        replies = [response({"models": []}), response({"model": "synthetic",
            "message": {"content": "not-json"}, "total_duration": 5_000_000_000,
            "load_duration": 1_000_000_000, "prompt_eval_count": 80,
            "prompt_eval_duration": 2_000_000_000, "eval_count": 20,
            "eval_duration": 2_000_000_000, "done_reason": "length"}),
            response({"models": [{"name": "synthetic", "size": 1000, "size_vram": 1000}]})]
        with patch("hunter_pilot.urllib.request.urlopen", side_effect=replies):
            with self.assertRaises(LocalModelResponseError) as caught:
                LocalModel("synthetic")({"synthetic": True})
        self.assertEqual(caught.exception.usage["inputTokens"], 80)
        self.assertEqual(caught.exception.usage["outputTokens"], 20)
        self.assertEqual(caught.exception.usage["completionReason"], "length")
        self.assertNotIn("not-json", json.dumps(caught.exception.usage))

    def test_saved_replay_logs_shadow_output_without_executing_it(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)
            config = {"tenantId": "tenant-a", "tenantSlug": "synthetic", "model": "synthetic",
                "expiresAt": "2026-09-24T00:00:00+00:00", "searchProvider": "DUCKDUCKGO",
                "limits": {"searches": 40, "pages": 60, "people": 20, "modelCalls": 20,
                    "modelSeconds": 3600, "dailyUsdMicros": 1_000_000, "totalUsdMicros": 1_000_000}}
            atomic_write(path / "config.json", config)
            atomic_write(path / "state.json", {"tenantId": "tenant-a", "companies": {},
                "evidence": {}, "attempts": {}, "budgets": {}, "usdMicros": 0,
                "events": [], "feedback": [], "modelDiagnosticContinuation": {"additionalAttempts": 0}})
            bridge = Mock(return_value={"tenantId": "tenant-a", "tenantSlug": "synthetic"})
            pilot = Pilot(path, bridge, Mock(), Mock(), Mock(),
                lambda: dt.datetime(2026, 9, 16, 15, tzinfo=UTC))
            packet = {"mission": "Synthetic safe mission", "tools": TOOLS, "schema": SCHEMA,
                "context": {"evidence": [], "previousSearches": []}}
            run = {"runId": "diag-synthetic", "sourceCommit": "synthetic", "completedKeys": [],
                "attemptIds": [], "running": None}
            adapter = Mock(return_value=({"action": "wait", "purpose": "No useful evidence",
                "args": {"reason": "No useful evidence", "minutes": 30}},
                {"modelTotalSeconds": 1, "requestElapsedSeconds": 0.9,
                 "validationSeconds": 0.01, "thinking": False, "contextLength": 32768,
                 "maxOutputTokens": 1000, "temperature": 0.2, "keepAlive": "10m",
                 "cold": True, "localModelDigest": "digest", "localQuantization": "Q4_K_M"}))
            adapter.loaded_state.return_value = {"cold": True, "loadedSizeBytes": None,
                "loadedVramBytes": None}
            monitor = Mock()
            monitor.summary.return_value = {"minimumMemoryFreePercent": 50,
                "nativeGpuResident": True}
            with patch("hunter_model_diagnostics.LocalModel", return_value=adapter), \
                 patch("hunter_model_diagnostics.ResourceMonitor", return_value=monitor), \
                 patch("hunter_model_diagnostics.ollama_pids", return_value=set()), \
                 patch.object(pilot, "execute") as execute:
                result = run_attempt(pilot, run, packet=packet, comparison_id="cmp-synthetic",
                    original_hash="original", experiment="A_quantization_full", input_variant="full",
                    variant="q4_full_cold", model="synthetic-q4", provider="OLLAMA",
                    quantization="Q4_K_M", digest_value="digest", expect_warm=False)
            execute.assert_not_called()
            self.assertEqual(result["status"], "success")
            self.assertEqual(pilot.budget()["modelCalls"], 1)
            self.assertEqual(json.loads((path / "model-comparison/attempts.jsonl").read_text())
                             ["finalOutput"]["action"], "wait")


if __name__ == "__main__":
    unittest.main()
