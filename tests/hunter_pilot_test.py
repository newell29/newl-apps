"""Synthetic regression cases; no network, credentials or production lead fixtures."""
import datetime as dt
import json
import os
import importlib.util
from pathlib import Path
import sys
import tempfile
import subprocess
import unittest
import urllib.error
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "ops/openclaw/hunter"))
from hunter_pilot import Pilot, PilotTextParser, BudgetExceeded, atomic_write, digest, UTC, ZONE
from hunter_pilot import LocalModel, configured_model, MISSION, TOOLS, SCHEMA
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
        result = restarted.execute({"action": "search", "purpose": "Same question", "args": {"query": "brand wholesale canada", "direction": "gta"}})
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
                "query": f"synthetic wholesale brand {counter}", "direction": "gta"}}, {})
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
                "query": "synthetic Canadian housewares distributors", "direction": "gta"}}, {}),
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

    def test_pending_clues_do_not_resurface_parked_or_blocked_company_domains(self):
        company = self.open()
        for status in ("parked", "blocked", "rejected"):
            company["status"] = status
            self.assertEqual(self.p.context()["unreadClues"], [])

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

    def test_people_requires_official_page(self):
        self.open()
        with self.assertRaises(ValueError):
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
        self.config["comparisonCases"] = 10
        atomic_write(self.path / "config.json", self.config)
        self.p.config = self.config

    def test_comparison_uses_same_context_without_executing_shadows(self):
        self.enable_comparison()
        shadow = Mock(return_value=({"action": "send", "args": {}}, {}))
        with patch("hunter_pilot.LocalModel", return_value=shadow):
            self.p.tick(force=True)
        self.assertEqual(self.p.budget()["modelCalls"], 3)
        self.assertEqual(self.model.call_count, 1)
        self.assertEqual(shadow.call_count, 2)
        self.assertEqual(shadow.call_args_list[0].args, self.model.call_args.args)
        self.assertEqual(self.model.call_args.args[0]["usedToday"]["modelCalls"], 0)
        self.assertEqual([e["action"] for e in self.p.state["events"] if e["kind"] == "action"], ["wait"])
        self.assertEqual(len(self.p.state["modelComparisons"]), 1)

    def test_partial_comparison_stops_at_shared_budget_and_survives_restart(self):
        self.enable_comparison()
        self.p.budget()["modelCalls"] = 38
        with patch("hunter_pilot.LocalModel", return_value=self.model):
            self.p.tick(force=True)
        self.assertEqual(self.p.budget()["modelCalls"], 40)
        case = self.p.state["modelComparisons"][0]
        self.assertEqual(len(case["shadows"]), 1)
        self.assertEqual(case["incomplete"], "modelCalls")
        restarted = Pilot(self.path, self.bridge, self.model, self.search, self.fetch, lambda: self.time)
        self.assertEqual(restarted.state["modelComparisons"], [case])

    def test_failed_shadow_is_visible_and_does_not_repeat_or_execute(self):
        self.enable_comparison()
        with patch("hunter_pilot.LocalModel", return_value=Mock(side_effect=TimeoutError)):
            self.p.tick(force=True)
        self.assertEqual(self.p.budget()["modelCalls"], 3)
        self.assertEqual(len(self.p.state["modelComparisons"][0]["shadows"]), 2)
        self.assertEqual(self.p.state["modelComparisons"][0]["shadows"][0]["error"], "TimeoutError")

    def test_completed_comparison_limit_does_not_call_shadows(self):
        self.enable_comparison()
        self.p.state["modelComparisons"] = [{}] * 10
        with patch("hunter_pilot.LocalModel") as factory:
            self.p.tick(force=True)
        factory.assert_not_called()

    def test_stop_between_primary_and_shadow_prevents_more_inference(self):
        self.enable_comparison()
        self.p.stop_requested = True
        with self.assertRaisesRegex(RuntimeError, "STOP_REQUESTED"):
            self.p.tick(force=True)
        self.model.assert_not_called()

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
        self.assertEqual(len(variants), 6)
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
            {"decision": {"action": "search", "purpose": "Test", "args": {"query": "synthetic", "direction": "gta", "company": None}}})
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
        payload = json.loads(call.call_args.args[0].data)
        self.assertTrue(payload["think"])
        self.assertEqual(payload["options"]["num_predict"], 4096)
        self.assertEqual(call.call_args.kwargs["timeout"], 180)


if __name__ == "__main__":
    unittest.main()
