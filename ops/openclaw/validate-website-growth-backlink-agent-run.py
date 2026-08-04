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
REQUIRED_EXPOSED_TOOLS = [
    *REQUIRED_TOOL_ORDER,
    "newl_backlink_send_email",
    "newl_backlink_send_follow_up",
    "newl_backlink_fill_directory_credentials",
    "newl_backlink_report",
]
PARAMETER_REQUIREMENTS = {
    "newl_backlink_send_email": [
        "opportunityId",
        "kind",
        "recipientEmail",
        "recipientCountry",
        "contactSourceUrl",
        "consentBasis",
        "subject",
        "body",
    ],
    "newl_backlink_send_follow_up": ["opportunityId", "subject", "body"],
    "newl_backlink_fill_directory_credentials": [
        "opportunityId",
        "targetId",
        "usernameRef",
        "passwordRef",
        "confirmPasswordRef",
    ],
    "newl_backlink_report": ["opportunityId", "status", "notes"],
}
SESSION_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]{8,100}$")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--agent-output", required=True)
    parser.add_argument("--sessions-directory", required=True)
    return parser.parse_args()


def read_record(value: object) -> dict[str, object]:
    return value if isinstance(value, dict) else {}


def read_tool_input(block: dict[str, object]) -> dict[str, object]:
    for key in ("arguments", "input"):
        value = block.get(key)
        if isinstance(value, dict) and value:
            return value
        if isinstance(value, str) and value.strip():
            try:
                parsed = json.loads(value)
            except ValueError:
                continue
            if isinstance(parsed, dict) and parsed:
                return parsed
    return {}


def require_successful_tool_result(
    call: dict[str, object],
    results_by_id: dict[str, dict[str, object]],
) -> None:
    name = str(call.get("name") or "")
    call_id = str(call.get("id") or call.get("toolCallId") or "")
    result = results_by_id.get(call_id)
    if not result:
        raise SystemExit(
            f"Scout outreach failed closed because {name} did not return a recorded result."
        )
    content = result.get("content") or result.get("text")
    if not isinstance(content, str) or not content.strip():
        raise SystemExit(
            f"Scout outreach failed closed because {name} returned an empty result."
        )
    try:
        parsed = json.loads(content)
    except ValueError:
        raise SystemExit(
            f"Scout outreach failed closed because {name} returned an unsuccessful result."
        ) from None
    if not isinstance(parsed, dict):
        raise SystemExit(
            f"Scout outreach failed closed because {name} returned an invalid result."
        )


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
    missing = [name for name in REQUIRED_EXPOSED_TOOLS if name not in exposed]
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

    calls: list[dict[str, object]] = []
    results_by_id: dict[str, dict[str, object]] = {}
    for line in transcript_path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        record = json.loads(line)
        message = read_record(record.get("message"))
        content = message.get("content")
        if not isinstance(content, list):
            continue
        for block in content:
            if not isinstance(block, dict):
                continue
            if block.get("type") == "toolCall" and isinstance(block.get("name"), str):
                calls.append(block)
            if block.get("type") == "toolResult":
                call_id = block.get("toolCallId") or block.get("id")
                if isinstance(call_id, str) and call_id:
                    results_by_id[call_id] = block

    called = [str(call["name"]) for call in calls]
    for call in calls:
        name = str(call["name"])
        if name.startswith("newl_backlink_"):
            require_successful_tool_result(call, results_by_id)
        required_fields = PARAMETER_REQUIREMENTS.get(name)
        if not required_fields:
            continue
        tool_input = read_tool_input(call)
        missing_fields = [
            field
            for field in required_fields
            if not isinstance(tool_input.get(field), str) or not str(tool_input[field]).strip()
        ]
        if missing_fields:
            raise SystemExit(
                f"Scout outreach failed closed because {name} omitted required fields: "
                + ", ".join(missing_fields)
            )

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
