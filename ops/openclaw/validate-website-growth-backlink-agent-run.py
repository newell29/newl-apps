#!/usr/bin/env python3
"""Fail closed when a Website Growth outreach turn did not execute its required tools."""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path


REQUIRED_TOOL_ORDER = [
    "newl_backlink_business_profile",
    "newl_backlink_sync_replies",
    "newl_backlink_sync_directory_verifications",
    "newl_backlink_follow_ups",
    "newl_backlink_verification",
    "newl_backlink_claim",
]
SESSION_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]{8,100}$")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--agent-output", required=True)
    parser.add_argument("--sessions-directory", required=True)
    return parser.parse_args()


def read_record(value: object) -> dict[str, object]:
    return value if isinstance(value, dict) else {}


def main() -> int:
    args = parse_args()
    output = json.loads(Path(args.agent_output).read_text(encoding="utf-8"))
    result = read_record(output.get("result"))
    meta = read_record(result.get("meta"))
    prompt_report = read_record(meta.get("systemPromptReport"))
    tools = read_record(prompt_report.get("tools"))
    tool_entries = tools.get("entries")
    exposed = {
        entry.get("name")
        for entry in tool_entries
        if isinstance(entry, dict)
    } if isinstance(tool_entries, list) else set()
    missing = [name for name in REQUIRED_TOOL_ORDER if name not in exposed]
    if missing:
        raise SystemExit(
            "Scout outreach failed closed because required executor tools were not exposed: "
            + ", ".join(missing)
        )

    agent_meta = read_record(meta.get("agentMeta"))
    session_id = agent_meta.get("sessionId") or prompt_report.get("sessionId")
    if not isinstance(session_id, str) or not SESSION_ID_PATTERN.fullmatch(session_id):
        raise SystemExit("Scout outreach failed closed because its session ID was unavailable.")

    transcript_path = Path(args.sessions_directory) / f"{session_id}.jsonl"
    if not transcript_path.is_file():
        raise SystemExit("Scout outreach failed closed because its session transcript was unavailable.")

    called: list[str] = []
    for line in transcript_path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        record = json.loads(line)
        message = read_record(record.get("message"))
        content = message.get("content")
        if not isinstance(content, list):
            continue
        for block in content:
            if (
                isinstance(block, dict)
                and block.get("type") == "toolCall"
                and isinstance(block.get("name"), str)
            ):
                called.append(block["name"])

    positions: list[int] = []
    cursor = 0
    for required in REQUIRED_TOOL_ORDER:
        try:
            position = called.index(required, cursor)
        except ValueError:
            raise SystemExit(
                "Scout outreach failed closed because the required executor sequence was incomplete; "
                f"missing {required}."
            ) from None
        positions.append(position)
        cursor = position + 1

    if "browser" in called[:positions[-1]]:
        raise SystemExit("Scout outreach failed closed because browser work started before an approved claim.")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
