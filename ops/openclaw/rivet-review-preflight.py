#!/usr/bin/env python3

"""Deterministic, local-only preflight for a Rivet pull-request diff."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path


SECRET_PATTERN = re.compile(
    r"(?:github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|"
    r"\bsk-[A-Za-z0-9_-]{16,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|"
    r"\bBearer\s+[A-Za-z0-9._~+/-]{20,})"
)
REFERENCE_PATTERN = re.compile(r"\b(?:PS|SR)\d{6,}\b", re.IGNORECASE)
EMAIL_PATTERN = re.compile(
    r"\b[A-Z0-9._%+-]+@([A-Z0-9.-]+\.[A-Z]{2,})\b",
    re.IGNORECASE,
)
ALLOWED_REFERENCES = {"PS123456", "SR812345"}
ALLOWED_DOMAINS = {"example.com", "example.test", "test.invalid"}


def build_report(diff_text: str, mergeable_with_main: bool) -> dict[str, object]:
    findings: list[dict[str, object]] = []
    current_file: str | None = None
    new_line: int | None = None

    for raw_line in diff_text.splitlines():
        if raw_line.startswith("+++ b/"):
            current_file = raw_line[6:].strip()
            continue
        if raw_line.startswith("@@ "):
            match = re.search(r"\+(\d+)", raw_line)
            new_line = int(match.group(1)) if match else None
            continue
        if not raw_line.startswith("+") or raw_line.startswith("+++"):
            continue

        content = raw_line[1:]
        if SECRET_PATTERN.search(content):
            findings.append(
                finding(
                    "CRITICAL",
                    "SECRETS",
                    current_file,
                    new_line,
                    "A high-confidence credential pattern was added.",
                    "Remove the credential and replace it with a non-secret placeholder.",
                    auto_fixable=False,
                )
            )

        for reference in REFERENCE_PATTERN.findall(content):
            if reference.upper() not in ALLOWED_REFERENCES:
                findings.append(
                    finding(
                        "HIGH",
                        "PRIVACY",
                        current_file,
                        new_line,
                        "A production-looking PS/SR reference was added.",
                        "Replace it with the reserved synthetic PS123456 or SR812345 example.",
                        auto_fixable=True,
                    )
                )

        for domain in EMAIL_PATTERN.findall(content):
            if domain.lower() not in ALLOWED_DOMAINS:
                findings.append(
                    finding(
                        "HIGH",
                        "PRIVACY",
                        current_file,
                        new_line,
                        "A non-example email address was added.",
                        "Replace it with an address under example.com or another reserved example domain.",
                        auto_fixable=True,
                    )
                )

        if new_line is not None:
            new_line += 1

    if not mergeable_with_main:
        findings.append(
            finding(
                "HIGH",
                "MERGEABILITY",
                None,
                None,
                "The exact commit does not merge cleanly with current main.",
                "Rebase or merge current main into the Rivet branch and resolve only in-scope conflicts.",
                auto_fixable=True,
            )
        )

    status = "PASS"
    if findings:
        status = (
            "NEEDS_CHANGES"
            if all(
                item["autoFixable"] and not item["businessDecisionRequired"]
                for item in findings
            )
            else "BLOCKED"
        )
    return {
        "status": status,
        "mergeableWithCurrentMain": mergeable_with_main,
        "findings": findings,
    }


def finding(
    severity: str,
    category: str,
    file_path: str | None,
    line: int | None,
    summary: str,
    required_fix: str,
    *,
    auto_fixable: bool,
) -> dict[str, object]:
    return {
        "severity": severity,
        "category": category,
        "file": file_path,
        "line": line,
        "summary": summary,
        "requiredFix": required_fix,
        "autoFixable": auto_fixable,
        "businessDecisionRequired": False,
    }


def main() -> int:
    if len(sys.argv) != 4 or sys.argv[3] not in {"0", "1"}:
        print(
            "usage: rivet-review-preflight.py <diff-path> <output-path> <mergeable-0-or-1>",
            file=sys.stderr,
        )
        return 2
    diff_path = Path(sys.argv[1])
    output_path = Path(sys.argv[2])
    report = build_report(
        diff_path.read_text(encoding="utf-8", errors="replace"),
        sys.argv[3] == "1",
    )
    output_path.write_text(
        json.dumps(report, ensure_ascii=False),
        encoding="utf-8",
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
