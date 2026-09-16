# Inbound opportunity source map

| Layer | Files |
| --- | --- |
| Queue and detail UI | `src/app/(authenticated)/website-inbound/page.tsx` |
| Editable forms and notes | `src/modules/website-inbound/components/opportunity-editor.tsx` |
| Authenticated server actions | `src/modules/website-inbound/actions.ts` |
| Transactions, duplicates, activity/audit | `src/modules/website-inbound/service.ts` |
| Validation, lifecycle, dates, filters | `src/modules/website-inbound/opportunities.ts` |
| Tenant queries and pagination | `src/modules/website-inbound/queries.ts` |
| Existing form ingestion | `src/app/api/website-inbound/route.ts`, `spam.ts`, `summary.ts`, `types.ts` |
| Schema | `prisma/schema.prisma`, `prisma/migrations/20260916143000_inbound_opportunities/migration.sql` |
| Form analytics boundary | `src/modules/website-growth/queries.ts`, `evidence-refresh.ts` |
| Tests | `tests/website-inbound-*.test.ts`, `tests/website-inbound-ui.test.tsx` |
