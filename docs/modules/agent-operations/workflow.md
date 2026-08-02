# Agent Operations: Workflow

> Evidence status: Confirmed from code unless otherwise marked.

1. The authenticated route requires the tenant's `ASSISTANT` module entitlement.
2. `src/modules/agent-operations/queries.ts` issues a separate `tenantId`-scoped read for each supported run source.
3. Source-specific statuses are normalized to `SCHEDULED`, `RUNNING`, `SUCCESS`, `FAILED`, `SKIPPED`, or `MISSED`.
4. Failure and skip text is normalized, redacted, and truncated before it reaches the UI.
5. Run-history filters are applied to the merged result set before the newest 15 records are selected.
6. **Show 15 more** increases the visible limit in 15-record increments while preserving the date range, agent, status, attention-only state, and search query.
7. Selecting a row opens a tenant-safe detail panel with the reason, impact summary, next-step guidance, timestamps, source type, and identifier.

The merged reader currently loads at most 500 recent rows from each source and exposes at most 150 matching rows in one page. Requires owner confirmation: whether a larger retained history or cursor-based export is needed.
