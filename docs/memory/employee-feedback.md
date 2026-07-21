# Memory: Employee Feedback

> Evidence status: Confirmed from code unless otherwise marked.


This document records operational guardrails from `AGENTS.md`, `reference/CODEX_PR_WORKFLOW.md`, auth docs, package scripts, and implementation files. Production behaviour must not be changed by documentation-only work.

Feedback lifecycle: reported → investigating → confirmed or rejected → optional approved lesson → development suggestion → separately approved development task → resolved. Employee feedback is not authoritative automatically.

Implementation boundaries:

- `OperationalFeedback` is the durable, tenant-scoped report and evidence record.
- Only confirmed or resolved feedback may be promoted, and only an administrator may create an `ApprovedOperationalLesson`.
- Nemo retrieval uses active approved lessons; it must not retrieve raw reports as business rules.
- `DevelopmentSuggestion` is an approval queue. Approval does not itself start Codex or authorize merge, deployment, Teamship writes, printing, customer communication, or database migration.
- The daily OpenClaw digest is intentionally not installed by code. Its schedule, destination, and administrator must be approved before runtime configuration changes.
