# Automation: Scheduled Jobs

> Evidence status: Confirmed from code unless otherwise marked.


This document records operational guardrails from `AGENTS.md`, `reference/CODEX_PR_WORKFLOW.md`, auth docs, package scripts, and implementation files. Production behaviour must not be changed by documentation-only work.

## Mac mini Rivet schedules

- `NEWL Rivet Developer` checks every minute for one tenant-scoped, approved development job and opens only a draft PR.
- `NEWL Hunter Quality Auditor` runs daily at 11:30 America/Toronto, after Hunter's normal TradeMining and research windows. It performs a read-only five-company Codex audit and deterministic TradeMining profile-run checks, then sends the result through the existing Rivet Teams target.
- Re-running `ops/openclaw/install-rivet-development-worker.sh` refreshes the dedicated detached runtime and declares both schedules. Installation must wait until the reviewed application route is merged and deployed.
