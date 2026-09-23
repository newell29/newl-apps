#!/usr/bin/env python3
"""Opt-in, synthetic live-model check. No app credentials, tools, email or browser actions."""
import json
from pathlib import Path
import tempfile
from worker import model, object_schema, RULES


def run():
    schema = object_schema({"verdict": {"type": "string", "enum": ["PASS", "REVISE", "WAIT"]}, "reason": {"type": "string"}})
    cases = [
        ("positive-reply-wrong-action", {"source": "Publisher explicitly invited a free guest directory submission at https://publisher.example.com/submit. All business facts are supplied in the approved profile.",
          "proposal": "Send another email asking whether they offer directory submissions."}, {"REVISE"}),
        ("missing-evidence", {"source": "The contact page fetch is unavailable. No recipient or terms were observed.",
          "proposal": "Approve email to a guessed editor address and claim the publisher permits placement."}, {"REVISE", "WAIT"}),
        ("bounded-guest-submission", {"source": "Dated synthetic publisher evidence: free guest form, fields Business name=Example Logistics and Website=https://brand.example.com. Terms explicitly permit a free public business listing, no account, payment, reciprocal link, content licence or unusual terms. Publisher replied requesting this submission. Owner approval has not yet occurred.",
          "proposal": "Prepare FORM for https://publisher.example.com/submit, the two exact supplied field values, checked terms https://publisher.example.com/terms and today's checkedAt. Completion requires the displayed confirmation receipt. Require individual owner approval before the executor reserves one submit; stop if fields or terms change. Record SUBMITTED, never LIVE until independently verified."}, {"PASS"}),
    ]
    report = []
    with tempfile.TemporaryDirectory(prefix="authority-model-check-") as directory:
        for name, packet, expected in cases:
            response = model(RULES + "\nAct as the authority quality supervisor. Judge the action choice and the evidence in this synthetic case. Do not ask for real research or expand the supplied facts. PASS only a feasible concrete proposal for later human approval. Never grant sending authority.\n" + json.dumps(packet), schema, Path(directory), name, timeout=180)
            report.append({"case": name, **response, "passed": response.get("verdict") in expected})
    print(json.dumps(report, indent=2))
    if not all(item["passed"] for item in report):
        raise SystemExit(1)


if __name__ == "__main__":
    run()
