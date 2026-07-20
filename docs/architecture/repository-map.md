# Repository map

> Evidence status: Confirmed from code.

| Path | Contents | Status |
|---|---|---|
| `src/app` | Next.js routes, layouts, authenticated pages, public pages, API routes. | Active |
| `src/modules` | Feature services, actions, queries, parsers, UI components, AI workflows. | Active |
| `src/server` | Auth, tenant context, database client, integration clients. | Active |
| `src/components` | Shared app shell, cards, buttons, tables, badges. | Active |
| `prisma` | Prisma schema, migrations, seed data. | Active |
| `tests` | Vitest unit/integration/route tests. | Active |
| `scripts` | Build, verification, smoke, worker, Teamship, and safety scripts. | Active; some are manual/live guarded |
| `reference` | Product, auth, lead-gen, ingestion, Garland Teamship, PR workflow reference docs. | Active reference |
| `docs` | This knowledge base plus earlier plans. | Active / mixed historical plans |
| `ops` | VM/service operational files for Teamship Phase 2. | Active operations support |
| `public/pdfjs` | PDF worker assets. | Generated/static asset |

## Where to look

| Task | Start with |
|---|---|
| Change a chat tool | `src/modules/assistant/runtime.ts`, `rate-tools.ts`, `apollo-workflow.ts`, `shipment-documents-workflow.ts` |
| Change the chat system prompt/provider | `src/server/integrations/assistant-provider.ts`, `src/modules/assistant/queries.ts` |
| Add a new AI tool | `src/modules/assistant/runtime.ts` and a dedicated workflow file plus tests in `tests/assistant-*.test.ts` |
| Modify email parsing | `src/modules/shipment-documents/garland-email-intake.ts` |
| Modify Garland parsing | `src/modules/shipment-documents/teamship-review.ts`, `garland-pdf-server-extraction.ts` |
| Add a customer parser | Create isolated module files under `src/modules/shipment-documents` or a new module; add tenant/customer docs. |
| Inspect customer alias resolution | `src/modules/customer-cashflow/queries.ts`, `entity-aliases.ts` for invoice automation aliases |
| Modify shipping-order queries | `src/server/integrations/teamship.ts`, `src/modules/shipment-documents/teamship-*.ts` |
| Inspect invoice ingestion | `src/modules/invoice-automation/*`, finance API routes |
| Modify profitability calculations | `src/modules/customer-cashflow/calculations.ts` |
| Add a database migration | `prisma/schema.prisma`, `prisma/migrations`, package Prisma scripts |
| Change roles or permissions | `src/server/auth/role-policy.ts`, `src/server/auth/authorization.ts`, settings pages/actions |
| Update Teamship automation | `src/modules/shipment-documents/teamship-phase2-*`, `teamship-browser-update-execution.ts`, scripts beginning `teamship-` |
| Change printing behaviour | Search `print` in `src/modules/shipment-documents`, `docs/wms/printing.md`; no broad printer subsystem was located. |
| Update Search Console ingestion | `src/modules/website-growth/integrations.ts`, `weekly-plan.ts`, website growth API route |
| Update Google Analytics reporting | `src/modules/website-growth/integrations.ts`, `queries.ts`; GA4 appears limited/status-oriented. |
| Modify website page generation | `src/modules/website-growth/build-package.ts`, `content-drafts.ts`, `github-pr.ts` |
| Add a Vercel Preview test | No dedicated Playwright config located; use package scripts and Vercel preview workflow docs. |
| Add an OpenClaw tool | Document first under `docs/ai/openclaw-integration.md`; implement through authenticated APIs, not arbitrary browser clicks. |
| Create a Codex task | Use `reference/CODEX_PR_WORKFLOW.md` and this `AGENTS.md`. |
| Investigate a production error | `src/modules/operations/queries.ts`, `AuditLog`, `AutomationJobRun`, Vercel logs. |
