import importlib.util
from pathlib import Path
import subprocess
import tempfile
import unittest
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
        with patch.object(worker, "api", side_effect=[self.workspace(), claimed, {}, {}]) as api, patch.object(worker, "model", side_effect=[{"id": "work", "reason": "Useful work"}, {"decision": "DELIVER"}]) as model:
            worker.run()
            self.assertEqual(api.call_args_list[-1].args[0]["action"], "complete")
            self.assertEqual(api.call_args_list[-1].args[0]["lease"], "opaque-lease")
            self.assertNotIn("opaque-lease", model.call_args_list[-1].args[0])

    def test_model_failure_defers_only_claimed_research(self):
        claimed = {"id": "work", "lease": "lease", "kind": "RESEARCH"}
        with patch.object(worker, "api", side_effect=[self.workspace(), claimed, {}, {}]) as api, patch.object(worker, "model", side_effect=[{"id": "work", "reason": "Useful"}, subprocess.TimeoutExpired("codex", 1100)]):
            with self.assertRaises(RuntimeError): worker.run()
            self.assertEqual(api.call_args_list[-1].args[0]["result"]["decision"], "WAIT")

    def test_uncertain_completion_is_not_overwritten(self):
        claimed = {"id": "work", "lease": "lease", "kind": "RESEARCH"}
        with patch.object(worker, "api", side_effect=[self.workspace(), claimed, {}, TimeoutError()]) as api, patch.object(worker, "model", side_effect=[{"id": "work", "reason": "Useful"}, {"decision": "DELIVER"}]):
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
        with patch.object(worker, "api", side_effect=[workspace, claimed, {}, {}]), patch.object(worker, "model", side_effect=[{"id": "work", "reason": "Useful"}, {"decision": "DELIVER"}]) as model:
            worker.run()
            prompt = model.call_args_list[-1].args[0]
            self.assertIn("Already answered on the service page", prompt)
            self.assertNotIn("Private publisher correspondence", prompt)

    def test_every_kind_has_a_complete_output_schema(self):
        for kind in ["PAGE", "RESEARCH", "RELATIONSHIP", "MEASUREMENT"]:
            schema = worker.result_schema(kind)
            self.assertIn("artifact", schema["required"])
            self.assertFalse(schema["additionalProperties"])


if __name__ == "__main__": unittest.main()
