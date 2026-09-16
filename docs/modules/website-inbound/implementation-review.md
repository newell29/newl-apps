# Inbound opportunity implementation review

## Requested outcome and root cause

The module only stored website form submissions and exposed status changes. It lacked manual intake, editable working contacts/services, notes, ownership and follow-up tracking. The owner approved one shared inbound queue and explicitly requested the same editing capabilities for website-originated leads.

## Delivered change

- Manual Phone/Email/Referral/Other entries with initial notes, a same-tenant duplicate warning, and idempotent creation requests.
- Editable company/contact/phone/email/services/source/enquiry date, owner, lifecycle, next action, follow-up date and outcome reason for both manual and website entries.
- Preserved original form payloads/page URLs and retained legacy status values.
- Append-only notes and field-change history with authors/timestamps, transactional audit records, tenant constraints and optimistic conflict checks.
- Open/New/Mine/Today/Overdue/All views; status, channel, owner, source, service, form-type, search and enquiry-date filters; queue and history pagination.
- Explicit form-origin analytics filtering so manual leads do not inflate Website Growth form counts.

Primary changed files are the inbound page, `components/opportunity-editor.tsx`, `actions.ts`, `service.ts`, `opportunities.ts`, `queries.ts`, the existing ingestion route, navigation label, Website Growth's two inbound queries, Prisma schema/migration, module documentation and five new regression suites.

## Validation

- `npm run prisma:generate` — passed using an isolated worktree dependency copy.
- `prisma migrate diff --from-schema-datamodel ... --to-schema-datamodel prisma/schema.prisma --script` — generated the additive SQL without applying it.
- `npm test -- tests/website-inbound-*.test.ts tests/website-inbound-ui.test.tsx tests/website-growth*.test.ts` — 183 tests across 20 suites passed, including 41 new inbound tests.
- `npm run typecheck` — passed.
- `npm run lint` — passed.
- `npm run build` — passed. The existing nested-worktree lockfile warning remains informational.
- `git diff --check` — passed.

Unit tests mock database access. Actual migration execution and browser/database persistence checks are pending approval for Vercel Preview. No production action has been performed.

## Preview and migration review

Preview URL: pending publication and validation.

Prepared migration: `prisma/migrations/20260916143000_inbound_opportunities/migration.sql`. It adds lifecycle enum choices, opportunity tracking columns, the activity table, tenant-constrained foreign keys and indexes, then derives historical enquiry dates, last activity timestamps and normalized phone keys from existing records. It does not rewrite existing statuses or original form payloads.

Vercel Preview marks both database URL variables as sensitive; the CLI downloads blank placeholders, so local `db:safety-check`/`prisma migrate status` cannot inspect that database. The Preview database label is `preview`. Vercel's build runs the database safety check and migration runner inside its protected environment. Approval is required before triggering that migration-capable build. No database connection was made by the local status attempt.

## Compatibility

Started from freshly fetched main `48423a73`. Open PRs inspected: #550 (Website Growth integration documentation edits separate from the appended attribution section), #322/#64 (schema changes outside inbound models), and #515/#102/#64 (navigation additions separate from the inbound label). None changes the inbound workflow being implemented. The publication helper must fetch/incorporate current main again before pushing.

## Limits and business review

One primary contact and owner per opportunity; service interests are free text. No automatic mailbox imports, messages, reminder sending, attachments or duplicate merges. Matching uses exact case-insensitive company/email and digits-only phone; country codes are not inferred. Follow-up dates use Toronto time. Removing an assigned membership requires reassignment first.

Won is manually recorded and triggers no revenue/customer operation. Its precise commercial definition and any future mapping of legacy Converted/Closed records require owner review.
