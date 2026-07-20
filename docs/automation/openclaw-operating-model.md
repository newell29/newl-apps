# Automation: Openclaw Operating Model

> Evidence status: Confirmed from code unless otherwise marked.


This document records operational guardrails from `AGENTS.md`, `reference/CODEX_PR_WORKFLOW.md`, auth docs, package scripts, and implementation files. Production behaviour must not be changed by documentation-only work.

OpenClaw coordinates workflows and interprets employee intent. Newl Apps performs authentication, permission checks, validation, approvals, and audit logging. Deterministic code performs exact comparisons, calculations, Teamship field updates, and printing. Codex changes code only through branches and reviewed pull requests. OpenClaw must not freely improvise production actions through arbitrary browser clicking.
