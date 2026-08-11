# Automation: Scheduled Jobs

> Evidence status: Confirmed from code unless otherwise marked.


This document records operational guardrails from `AGENTS.md`, `reference/CODEX_PR_WORKFLOW.md`, auth docs, package scripts, and implementation files. Production behaviour must not be changed by documentation-only work.

## Mac mini Rivet schedules

- `NEWL Rivet Developer` checks every minute for one tenant-scoped, approved development job and opens only a draft PR.
- `NEWL Hunter Quality Auditor` runs daily at 13:30 America/Toronto, after Hunter's normal TradeMining and research windows. It performs a read-only five-company Codex audit and deterministic TradeMining profile-run checks, then sends the result through the existing Rivet Teams target.
- Re-running `ops/openclaw/install-rivet-development-worker.sh` refreshes the dedicated detached runtime and declares both schedules. Installation must wait until the reviewed application route is merged and deployed.

## Agent Operations visibility

- `/agent-operations` presents the schedules declared by tenant-owned assistant automations and the repository's OpenClaw/local-worker defaults. It does not read protected local environment files, so an environment override can differ from the displayed repository default.
- `/agent-operations/run-history` merges tenant-scoped run evidence already stored in `AutomationJobRun`, `AssistantAutomationRun`, `GarlandEmailSyncRun`, `TeamshipDailySyncRun`, and `TeamshipBrowserReadJob`.
- Website Scout is presented with its current repository defaults: deep research Monday/Wednesday at 09:15, evidence check-ins Tuesday/Thursday/Friday at 09:15, approved backlink outreach weekdays at 11:00, and build-notification polling every two minutes in `America/Toronto`.
- Run history applies the selected date, agent, status, attention, and text search before showing the 15 most recent matching results. **Show 15 more** expands the same result set, up to 150 displayed records.
- A database-backed Nemo automation whose `nextRunAt` is more than five minutes overdue without a corresponding `lastRunAt` is shown as `MISSED`. Repository-declared local schedules do not fabricate missed records because local environment overrides and machine health are not available to the web application.
- Failure and skip explanations are redacted and truncated before display. Raw job input/output, customer data, credentials, tokens, email addresses, and source URLs are not rendered by Agent Operations.
