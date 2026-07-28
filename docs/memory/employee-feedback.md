# Memory: Employee Feedback

> Evidence status: Confirmed from code unless otherwise marked.


This document records operational guardrails from `AGENTS.md`, `reference/CODEX_PR_WORKFLOW.md`, auth docs, package scripts, and implementation files. Production behaviour must not be changed by documentation-only work.

Feedback lifecycle: reported → investigating → confirmed or rejected → optional approved lesson → development suggestion → separately approved development task → resolved. Employee feedback is not authoritative automatically.

Implementation boundaries:

- `OperationalFeedback` is the durable, tenant-scoped report and evidence record.
- Only confirmed or resolved feedback may be promoted, and only an administrator may create an `ApprovedOperationalLesson`.
- Nemo retrieval uses active approved lessons; it must not retrieve raw reports as business rules.
- `DevelopmentSuggestion` is a focused approval queue. Similar feedback is grouped before review. Selecting **Approve & start Rivet** queues a restricted local Codex branch-and-PR job; it does not authorize merge, deployment, migration execution, Teamship writes, printing, shipping, permission changes, or customer communication.
- An approved suggestion's source packet is immutable. Later reports in the same issue family are attached separately as follow-up evidence, and duplicate awaiting cards are superseded instead of creating another Rivet approval.
- An administrator may record a suggestion as resolved only after confirming that the exact reviewed pull request is merged and deployed. That explicit decision resolves its source and follow-up reports; a later report becomes one linked regression suggestion and requires a new approval.
- The Feedback Review page shows only `REPORTED` and `INVESTIGATING` findings by default. Confirmed, rejected, and resolved findings leave the active list immediately and remain available only through the optional history control.
- `CodexReviewRun` stores the independent exact-commit review. A Rivet job is not successful until the latest reviewed commit receives `PASS` with no unresolved finding, question, missing coverage, or out-of-scope change.
- Every feedback review, approved lesson, suggestion creation, and suggestion decision is recorded in the tenant audit log.
- The daily OpenClaw digest is intentionally not installed by code. The approved plan is 10:00 AM `America/Toronto` to Alex's existing Teams direct conversation using a `user:<aad-object-id>` target. It remains disabled until the production migration, deployment, distinct assistant credential, and OpenClaw reload are separately approved and complete.
