# Memory: Memory Source Priority

> Evidence status: Confirmed from code unless otherwise marked.


This document records operational guardrails from `AGENTS.md`, `reference/CODEX_PR_WORKFLOW.md`, auth docs, package scripts, and implementation files. Production behaviour must not be changed by documentation-only work.

Priority order: 1. Current live application data 2. Approved repository business rules 3. Approved customer procedures 4. Confirmed lessons 5. Existing architecture documentation 6. Reported employee feedback 7. General model knowledge. OpenClaw must never use memory as the source for current order values, statuses, invoice amounts, permissions, or Teamship data.
