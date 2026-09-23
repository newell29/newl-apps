import subprocess
import unittest
from unittest.mock import Mock
import authority_executor as worker


class AuthorityExecutorWalkthroughs(unittest.TestCase):
    def packet(self, method="FORM"):
        return {"id": "synthetic-action", "lease": "synthetic-lease", "plan": {"method": method}}

    def test_empty_queue_never_starts_browser_or_claims(self):
        call = Mock(return_value={"ready": 0, "reason": "No approved actions."})
        browser = Mock()
        worker.run(call, browser)
        self.assertEqual(call.call_count, 1)
        browser.assert_not_called()

    def test_concurrent_claim_does_not_start_browser(self):
        call = Mock(side_effect=[{"ready": 1}, None])
        browser = Mock()
        worker.run(call, browser)
        browser.assert_not_called()

    def test_email_uses_server_exact_action_without_model(self):
        call = Mock(side_effect=[{"ready": 1}, self.packet("EMAIL"), {"state": "SUBMITTED"}])
        browser = Mock()
        worker.run(call, browser)
        browser.assert_not_called()
        self.assertEqual(call.call_args.args[0]["action"], "execute")

    def test_recovered_agent_error_does_not_override_durable_receipt(self):
        call = Mock(side_effect=[{"ready": 1}, self.packet(), {"state": "SUBMITTED", "finishedAt": "synthetic-date"}])
        browser = Mock(side_effect=subprocess.CalledProcessError(70, "agent"))
        worker.run(call, browser)
        self.assertEqual(call.call_count, 3)
        browser.assert_called_once()

    def test_timeout_after_begin_records_uncertain_and_never_retries(self):
        call = Mock(side_effect=[{"ready": 1}, self.packet(), {"state": "RUNNING", "finishedAt": None, "startedAt": "synthetic-date"}, {"state": "UNCERTAIN"}])
        browser = Mock(side_effect=subprocess.TimeoutExpired("agent", 240))
        worker.run(call, browser)
        self.assertEqual(call.call_args.args[0]["result"]["state"], "UNCERTAIN")
        browser.assert_called_once()

    def test_missing_report_before_begin_is_isolated_blocker(self):
        call = Mock(side_effect=[{"ready": 1}, self.packet(), {"state": "RUNNING", "finishedAt": None, "startedAt": None}, {"state": "BLOCKED"}])
        worker.run(call, Mock())
        self.assertEqual(call.call_args.args[0]["result"]["state"], "BLOCKED")

    def test_uncertain_api_response_stops_without_replaying(self):
        call = Mock(side_effect=[{"ready": 1}, self.packet("EMAIL"), TimeoutError("synthetic")])
        with self.assertRaises(TimeoutError):
            worker.run(call, Mock())
        self.assertEqual(call.call_count, 3)


if __name__ == "__main__":
    unittest.main()

class AuthorityCutoverTests(unittest.TestCase):
    def test_only_declared_legacy_jobs_are_retired_and_duplicates_fail_closed(self):
        from authority_cutover import cutover_plan
        jobs = [{"id": "old", "declarationKey": "newl.website-growth.backlink-outreach.weekday.v1", "enabled": True},
                {"id": "new", "declarationKey": "newl.website-growth.authority.v1", "enabled": False},
                {"id": "marketing", "declarationKey": "newl.website-growth.marketing.v1", "enabled": True}]
        self.assertEqual(cutover_plan(jobs), {"disable": ["old"], "enable": "new"})
        with self.assertRaises(RuntimeError):
            cutover_plan(jobs + [jobs[1]])
        jobs[0]["state"] = {"runningAtMs": 1}
        with self.assertRaises(RuntimeError):
            cutover_plan(jobs)
