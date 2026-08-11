# Agent Operations: Business rules

> Evidence status: Confirmed from code unless otherwise marked.

- The feature is read-only and must never imply that viewing a run authorizes a retry or operational action.
- Search and filters are applied before the default newest-15 window.
- Expansion preserves the active search and increases the visible result set by 15.
- `CANCELLED` source jobs are displayed as `SKIPPED`; error-like statuses are displayed as `FAILED`.
- A reason is mandatory in the presentation for `FAILED`, `SKIPPED`, and `MISSED`. When a source gives no cause, the page states that no specific reason was reported.
- Error text must be redacted before rendering and raw payloads must remain hidden.
- All shared reads must carry authenticated `tenantId` filtering.
