# Agent Operations: Testing

> Evidence status: Confirmed from code.

`tests/agent-operations.test.ts` verifies:

- the default 15-record window and 15-record expansion;
- search-before-pagination behavior;
- failure-reason redaction;
- overdue database-backed Nemo schedules producing `MISSED` evidence; and
- `tenantId` filtering on every merged source query;
- current hourly Website Scout and evidence-refresh schedule descriptions; and
- distinct Website Scout wake/step history plus fail-closed backlink schedule reporting.

Required release checks are the focused Vitest suite, repository lint, production build, and Vercel Preview browser validation.
