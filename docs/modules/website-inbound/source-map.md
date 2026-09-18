# Inbound opportunity source map

| Layer | Files |
| --- | --- |
| Queue and detail UI | `src/app/(authenticated)/website-inbound/page.tsx` |
| Editable forms and notes | `src/modules/website-inbound/components/opportunity-editor.tsx` |
| Correspondence, matching and approval UI | `src/modules/website-inbound/components/correspondence-panel.tsx` |
| Authenticated server actions | `src/modules/website-inbound/actions.ts` |
| Transactions, duplicates, activity/audit | `src/modules/website-inbound/service.ts` |
| Mailbox configuration, sync, drafts, handoff and send gates | `src/modules/website-inbound/correspondence.ts` |
| Validation, lifecycle, dates, filters | `src/modules/website-inbound/opportunities.ts` |
| Tenant queries and pagination | `src/modules/website-inbound/queries.ts` |
| Existing form ingestion | `src/app/api/website-inbound/route.ts`, `spam.ts`, `summary.ts`, `types.ts` |
| Scheduled correspondence sync | `src/app/api/website-inbound/correspondence/scheduled/route.ts`, `vercel.json` |
| Microsoft Graph mail transport | `src/server/integrations/microsoft-graph-mail.ts`, `microsoft-graph-application.ts` |
| Schema | `prisma/schema.prisma`, `prisma/migrations/20260916143000_inbound_opportunities/migration.sql`, `prisma/migrations/20260918143000_inbound_correspondence/migration.sql` |
| Form analytics boundary | `src/modules/website-growth/queries.ts`, `evidence-refresh.ts` |
| Tests | `tests/website-inbound-*.test.ts`, `tests/website-inbound-ui.test.tsx` |
