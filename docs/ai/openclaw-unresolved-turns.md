# OpenClaw unresolved-turn capture

> Evidence status: Confirmed from code. Retention and issue-resolution workflow remain business decisions requiring approval.

## Purpose

The unresolved-turn capture gives the developer agent a deterministic list of Microsoft Teams prompts that Nemo did not answer successfully. It does not schedule a review, create a cron job, deploy a plugin, or authorize any Teamship write.

The implementation is split between the `newl-unresolved-turns` OpenClaw plugin, the authenticated Newl Apps endpoint at `/api/assistant/openclaw/unresolved-turns`, and the tenant-scoped `OpenClawUnresolvedTurn` table.

## Detection rules

| Condition | Signal | Stored result |
|---|---|---|
| Model/provider call fails | Sanitized `model_call_ended` outcome | `OPEN / MODEL_FAILURE` |
| An OpenClaw tool throws or returns `failed`, `not_configured`, or `unauthorized` | `after_tool_call` | `OPEN / TOOL_FAILURE` after the Teams response is delivered |
| Teams cannot deliver Nemo's response | `message_sent.success = false` | `OPEN / DELIVERY_FAILURE` |
| No outbound Teams result is observed | Inbound record remains pending beyond the review threshold (default five minutes) | Returned to reviewers as `NO_RESPONSE` |
| Teams receives a response without a captured model/tool failure | Successful `message_sent` | Pending record is deleted |

Slash commands such as `/new` are ignored. The plugin only observes `msteams` channel turns with a valid Microsoft Entra sender UUID and OpenClaw run ID.

This mechanism cannot automatically prove that a fluent answer is factually wrong. Those semantic failures still require employee feedback or a deterministic comparison against an authoritative system. Adding a feedback action is intentionally outside this change.

## Storage and privacy

`OpenClawUnresolvedTurn` is scoped by `tenantId` and `userId`, with a tenant-unique OpenClaw `runId`. It stores:

- sanitized prompt and, for failed turns, the visible final response;
- failure category and sanitized model, provider, tool, and error labels;
- timestamps and a SHA-256 prompt fingerprint for grouping repeated failures;
- SHA-256 hashes of external message, conversation, session, and tool-call identifiers.

The capture does not store model reasoning, conversation history, tool parameters, raw tool results, authentication headers, tokens, or plaintext external Teams identifiers. Common bearer tokens, API-key shapes, and password/token/secret assignments are redacted before persistence. Successful turns are deleted instead of becoming a general employee-chat archive.

## How the developer agent finds issues

The separate developer-agent task should use the optional OpenClaw tool `newl_unresolved_turns`. That tool calls the read-only `GET /api/assistant/openclaw/unresolved-turns` endpoint and returns:

1. all records with `status = OPEN`; and
2. `PENDING` records older than `staleAfterSeconds`, presented as `NO_RESPONSE`.

The tool must be enabled only for the developer agent and must not appear in Nemo's employee-facing tool allowlist. Its configured Microsoft Entra object ID must resolve to an Admin membership in the same tenant; Newl Apps enforces that role on every list request and writes an `AuditLog` entry with the returned issue count. Capture writes use the actual authenticated Teams sender identity and require the Assistant module.

A daily developer review should group by `promptFingerprint`, prioritize repeated failures, inspect the sanitized prompt/error/model/tool context, reproduce the problem against Preview with safe credentials, and create code changes only on a feature branch and reviewed PR. Resolving or suppressing records is not implemented yet, so the reviewer must treat the feed as append-only/open evidence for now.

## Installation and migration handoff

The database migration is prepared in `prisma/migrations/20260721153000_add_openclaw_unresolved_turns`. It must be reviewed and applied through the normal approved migration process before enabling the plugin against an environment.

The plugin lives in `ops/openclaw/plugins/newl-unresolved-turns`. Installation into a live OpenClaw runtime, environment-variable changes, and production rollout require separate human approval and validation. No cron configuration is included here.

## Known limitations and decisions required

- Retention and deletion policy for open failures is not yet defined. A bounded retention period such as 30 or 90 days requires owner approval.
- There is no resolved/dismissed workflow yet.
- Concurrent turns in one OpenClaw session are correlated by run ID when available and session key only as a compatibility fallback; the fallback cannot perfectly distinguish simultaneous turns.
- If the capture endpoint itself is unavailable, the plugin logs a local warning and does not interrupt Nemo's reply. That turn may therefore be missing from the Newl Apps feed.
- Correct-but-unhelpful, incorrect, or incomplete answers need an explicit employee feedback path or deterministic evaluation before they can be captured automatically.
