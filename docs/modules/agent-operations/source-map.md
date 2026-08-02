# Agent Operations: Source map

> Evidence status: Confirmed from code.

| Responsibility | Files |
|---|---|
| Dashboard route | `src/app/(authenticated)/agent-operations/page.tsx` |
| Run-history route | `src/app/(authenticated)/agent-operations/run-history/page.tsx` |
| Tenant-scoped aggregation | `src/modules/agent-operations/queries.ts` |
| Filters, redaction, status normalization | `src/modules/agent-operations/presentation.ts` |
| Shared types and UI | `src/modules/agent-operations/types.ts`, `src/modules/agent-operations/components/*` |
| Navigation | `src/components/app-shell.tsx` |
| Regression tests | `tests/agent-operations.test.ts` |
