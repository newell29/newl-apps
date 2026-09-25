import importlib.util
from pathlib import Path
import subprocess
import shutil
import tempfile
import unittest
import urllib.error
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("scout_worker", Path(__file__).with_name("worker.py"))
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)


class WorkerTests(unittest.TestCase):
    def workspace(self):
        return {"mission": {"enabled": True}, "due": ["work"], "items": [{"id": "work", "kind": "RESEARCH"}]}

    def test_paused_worker_uses_no_model(self):
        with patch.object(worker, "api", return_value={"mission": {"enabled": False}, "due": []}), patch.object(worker, "model") as model:
            worker.run()
            model.assert_not_called()

    def test_success_saves_one_scoped_completion(self):
        claimed = {"id": "work", "lease": "opaque-lease", "kind": "RESEARCH"}
        with patch.object(worker, "api", side_effect=[self.workspace(), claimed, {}, {}]) as api, patch.object(worker, "model", side_effect=[{"id": "work", "reason": "Useful work"}, {"decision": "DELIVER"}, {"verdict": "PASS", "reason": "Evidence supports the proposal"}]) as model:
            worker.run()
            claim = api.call_args_list[1].args[0]
            self.assertEqual(claim["action"], "claim")
            self.assertTrue(claim["claimId"])
            self.assertEqual(api.call_args_list[-1].args[0]["action"], "complete")
            self.assertEqual(api.call_args_list[-1].args[0]["lease"], "opaque-lease")
            self.assertNotIn("opaque-lease", model.call_args_list[-1].args[0])
            self.assertEqual(api.call_args_list[-1].args[0]["result"]["supervisor"]["verdict"], "PASS")

    def test_uncertain_claim_retries_with_the_same_idempotency_key(self):
        payload = {"action": "claim", "claimId": "claim-synthetic", "id": "work", "reason": "Useful work"}
        failures = [urllib.error.HTTPError("https://example.com", 503, "Unavailable", {}, None),
                    ConnectionResetError("response acknowledgement was lost")]
        for failure in failures:
            with self.subTest(failure=type(failure).__name__), \
                 patch.object(worker, "api", side_effect=[failure, {"id": "work", "lease": "original-lease"}]) as api, \
                 patch.object(worker.time, "sleep") as sleep:
                claimed = worker.claim_with_retry(payload)
                self.assertEqual(claimed["lease"], "original-lease")
                self.assertEqual(api.call_args_list[0].args[0], payload)
                self.assertEqual(api.call_args_list[1].args[0], payload)
                sleep.assert_called_once_with(1)

    def test_model_failure_defers_only_claimed_research(self):
        claimed = {"id": "work", "lease": "lease", "kind": "RESEARCH"}
        with patch.object(worker, "api", side_effect=[self.workspace(), claimed, {}, {}]) as api, patch.object(worker, "model", side_effect=[{"id": "work", "reason": "Useful"}, subprocess.TimeoutExpired("codex", 1100)]):
            with self.assertRaises(RuntimeError): worker.run()
            self.assertEqual(api.call_args_list[-1].args[0]["result"]["decision"], "WAIT")

    def test_uncertain_completion_is_not_overwritten(self):
        claimed = {"id": "work", "lease": "lease", "kind": "RESEARCH"}
        with patch.object(worker, "api", side_effect=[self.workspace(), claimed, {}, TimeoutError()]) as api, patch.object(worker, "model", side_effect=[{"id": "work", "reason": "Useful"}, {"decision": "DELIVER"}, {"verdict": "PASS", "reason": "Complete"}]):
            with self.assertRaises(TimeoutError): worker.run()
            self.assertEqual(len(api.call_args_list), 4)

    def test_model_process_has_no_application_secrets_or_mutable_tools(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            (directory / "result.json").write_text('{}')
            with patch.dict(worker.os.environ, {"WEBSITE_GROWTH_CODEX_BIN": "/synthetic/codex", "OPENCLAW_WEBSITE_GROWTH_TOKEN": "synthetic-secret", "OPENAI_API_KEY": "synthetic-key"}), patch.object(worker.subprocess, "run") as run:
                worker.model("Research", {}, directory, "result")
                args = run.call_args.args[0]
                self.assertIn("--ignore-user-config", args)
                self.assertIn("--ignore-rules", args)
                for feature in ["shell_tool", "unified_exec", "apps", "plugins", "multi_agent"]:
                    self.assertEqual(args[args.index(feature) - 1], "--disable")
                self.assertNotIn("OPENCLAW_WEBSITE_GROWTH_TOKEN", run.call_args.kwargs["env"])
                self.assertNotIn("OPENAI_API_KEY", run.call_args.kwargs["env"])

    def test_prior_decisions_inform_new_work_without_publisher_correspondence(self):
        workspace = self.workspace()
        workspace["items"].extend([
            {"id": "old", "kind": "RESEARCH", "state": "DISMISSED", "nextAction": "Already answered on the service page"},
            {"id": "private", "kind": "RELATIONSHIP", "state": "DONE", "nextAction": "Private publisher correspondence"}
        ])
        claimed = {"id": "work", "lease": "lease", "kind": "RESEARCH"}
        with patch.object(worker, "api", side_effect=[workspace, claimed, {}, {}]), patch.object(worker, "model", side_effect=[{"id": "work", "reason": "Useful"}, {"decision": "WAIT"}]) as model:
            worker.run()
            prompt = model.call_args_list[-1].args[0]
            self.assertIn("Already answered on the service page", prompt)
            self.assertNotIn("Private publisher correspondence", prompt)

    def test_quality_failure_or_interruption_preserves_artifact_without_delivery(self):
        for review in [{"verdict": "REVISE", "reason": "Verify the public source"},
                       {"verdict": "WAIT", "reason": "The measurement window is not complete"}, TimeoutError(), {}]:
            claimed = {"id": "work", "lease": "private-lease", "kind": "RESEARCH"}
            artifact = {"recommendation": "Saved investigation"}
            with patch.object(worker, "api", side_effect=[self.workspace(), claimed, {}, {}]) as api, patch.object(worker, "model", side_effect=[{"id": "work", "reason": "Useful"}, {"decision": "DELIVER", "artifact": artifact}, review]):
                worker.run()
                result = api.call_args_list[-1].args[0]["result"]
                self.assertEqual(result["decision"], "WAIT")
                self.assertEqual(result["artifact"], artifact)
                self.assertEqual(result["reviewInDays"], 1)
                # The server chooses eligibility; the worker must finish this wake without a retry loop.
                self.assertEqual(len(api.call_args_list), 4)
                if isinstance(review, dict) and review.get("verdict"):
                    self.assertEqual(result["supervisor"], review)
                    self.assertEqual(result["nextAction"], review["reason"])

    def test_supervisor_receives_measured_outcomes_and_dated_competitor_evidence(self):
        workspace = self.workspace()
        workspace["learning"] = {"outcomes": [{"measurement": {"clicks": 42}}], "competitors": {"observedAt": "2026-06-15", "fresh": False}}
        claimed = {"id": "work", "lease": "private-lease", "kind": "RESEARCH"}
        with patch.object(worker, "api", side_effect=[workspace, claimed, {}, {}]), patch.object(worker, "model", side_effect=[{"id": "work", "reason": "Test the conversion hypothesis"}, {"decision": "WAIT"}]) as model:
            worker.run()
            self.assertIn('"clicks": 42', model.call_args_list[0].args[0])
            self.assertIn('"fresh": false', model.call_args_list[0].args[0])
            self.assertIn("Test the conversion hypothesis", model.call_args_list[1].args[0])
            self.assertEqual(model.call_args_list[0].kwargs["timeout"], 180)

    def test_page_policy_prefers_focused_updates_for_known_routes(self):
        self.assertIn("website route inventory and current-page evidence as authoritative", worker.RULES)
        self.assertIn("pageChangePreview", worker.RULES)
        self.assertIn("Set newPage false", worker.RULES)
        self.assertIn("pageEvidence.searchQueries.totals as the deterministic aggregate", worker.RULES)
        self.assertIn("New conversion or qualification fields are optional by default", worker.RULES)
        self.assertIn("newly required conversion or qualification field", Path(worker.__file__).read_text())

    @unittest.skipUnless(shutil.which("zsh"), "Installer requires zsh")
    def test_installer_does_not_attempt_an_unconfigured_message_delivery(self):
        installer = Path(__file__).resolve().parent.parent / "install-scout-marketing.sh"
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            runner = directory / "ops/openclaw/run-scout-marketing.sh"
            runner.parent.mkdir(parents=True)
            runner.write_text("# synthetic readable runner\n")
            executable = directory / "openclaw"
            executable.write_text('#!/bin/sh\nprintf "%s\\n" "$@" > "$SCOUT_TEST_ARGS"\n')
            executable.chmod(0o700)
            output = directory / "args.txt"
            environment = {**worker.os.environ, "PATH": str(directory) + ":" + worker.os.environ["PATH"],
                           "NEWL_APPS_SCOUT_RUNTIME_REPO_PATH": str(directory), "SCOUT_TEST_ARGS": str(output)}
            subprocess.run([shutil.which("zsh"), str(installer)], env=environment, check=True, capture_output=True)
            arguments = output.read_text().splitlines()
            self.assertEqual(arguments[:2], ["cron", "add"])
            self.assertIn("--no-deliver", arguments)
            self.assertIn("--disabled", arguments)

    def test_embedded_page_contract_retains_all_referenced_definitions(self):
        schema = worker.result_schema("PAGE")
        references = []
        def visit(value):
            if isinstance(value, dict):
                if "$ref" in value:
                    references.append(value["$ref"])
                for child in value.values(): visit(child)
            elif isinstance(value, list):
                for child in value: visit(child)
        visit(schema)
        self.assertGreater(len(references), 0)
        for reference in references:
            self.assertTrue(reference.startswith("#/"))
            target = schema
            for part in reference[2:].split("/"):
                target = target[part]
            self.assertIsInstance(target, dict)

    def test_every_kind_has_a_complete_output_schema(self):
        for kind in ["PAGE", "RESEARCH", "RELATIONSHIP", "MEASUREMENT"]:
            schema = worker.result_schema(kind)
            self.assertIn("artifact", schema["required"])
            self.assertFalse(schema["additionalProperties"])


if __name__ == "__main__": unittest.main()
