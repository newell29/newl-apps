# Newl OpenClaw unresolved-turn plugin

This plugin records only Microsoft Teams turns that Nemo could not complete. It does not create a cron job, run a developer review, deploy itself, or write to Teamship.

## What it records

- An inbound employee prompt begins a short-lived `PENDING` record.
- A successful Teams delivery deletes that record.
- Model, tool, or Teams delivery failures retain an `OPEN` record.
- A `PENDING` record older than five minutes is returned to reviewers as `NO_RESPONSE`.

Newl Apps redacts common secret shapes before storage. External Teams message, conversation, session, and tool-call identifiers are stored only as SHA-256 hashes. The plugin does not send reasoning, model history, tool parameters, or raw tool results to Newl Apps.

## Configuration

The plugin entry requires `baseUrl`, the Teams `tenantId`, and a `developerObjectId` for a Newl Apps administrator. `assistantTokenEnv` defaults to `OPENCLAW_ASSISTANT_TOKEN`. Newl Apps requires this assistant credential to be present and rejects configurations where its value matches `OPENCLAW_TEAMSHIP_READ_TOKEN`; there is no read-token fallback.

The optional `newl_unresolved_turns` tool loads only for `developerAgentId` (default `developer`) and must be enabled only for that developer agent. Do not add it to Nemo's employee-facing tool allowlist. The configured developer object ID is checked again by Newl Apps against the tenant membership and Admin role.

For Preview, `vercelProtectionBypassEnv` may name the environment variable containing the Preview protection bypass secret.

## Developer-agent handoff

The separate scheduled developer task can call `newl_unresolved_turns` with a limit and stale threshold. The tool returns only `OPEN` records and stale `PENDING` records. The definitive detection and storage contract is documented in `docs/ai/openclaw-unresolved-turns.md`.

No scheduler is included in this package.
