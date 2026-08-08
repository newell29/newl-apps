# Customer Intelligence: Testing

> Evidence status: Confirmed from code.

## Test files

- `tests/customer-intelligence-foundation.test.ts` — 39 tests. Prisma is mocked, but the authorization module is REAL (only `@/server/db` is mocked), so the tests prove the true permission boundary. Covers:
  - Entitlement bootstrap: the corrections migration creates the module, the `newl-group` entitlement, and the three operating companies idempotently; `vercel-build.ts` runs `migrate deploy` without the broad seed.
  - Permissions: SALES denied on every exported query (explicit per-function coverage); OPERATIONS and READ_ONLY denied on reads; FINANCE allowed. **Mutations:** a table-driven test invokes all 12 exported mutations (`registerOperatingCompany`, `upsertCompanyOperatingRelationship`, `refreshRelationshipLifecycle`, `upsertSourceAccount`, `proposeIdentityMatch`, `reviewIdentityMatch`, `upsertServiceMappingRule`, `upsertFxRate`, `recordRevenueLine`, `upsertMonthlyFinancial`, `upsertContactPoint`, `upsertContactEvidence`) with SALES and OPERATIONS contexts and asserts rejection before any database write. A second table-driven test proves the same for READ_ONLY and for FINANCE with `canMutate=false`, also asserting no database write occurred. `refreshRelationshipLifecycle` has an explicit mutation-access check; the cashflow resolver is guarded.
  - Lifecycle isolation: revenue scoped by operating company; approved mappings scoped by operating company; zero revenue + positive open AR activates; inactive accounts with no revenue/open AR → FORMER; three-company rollup.
  - Identity integrity: cross-tenant `companyId`/`candidateCompanyId` rejected; `QUICKBOOKS_ACCOUNT` requires an operating company; **a high-scoring proposal with `companyId: null` stays PROPOSED (never APPROVED)**; **manual approval of a `QUICKBOOKS_ACCOUNT` match requires a tenant-valid operating company (missing and cross-tenant references rejected)**; second manual approval rejected; competing proposals keep one approved target; DB unique-violation backstop returns the authoritative approved match; re-running approved/rejected decisions is idempotent.
  - Contact points: email casing and phone formatting deduplicate; display values preserved; empty values rejected.
  - Contact evidence: accepted facts are never overwritten (CONFLICT + `conflictingValue`); same-value re-observations stay stable; pending values replaced; empty extraction rejected.
  - Regression: operating-company audit, one customer across three operating companies, multiple CAD/USD accounts, same-name tenant isolation, cross-tenant relation-ID attacks, cashflow compatibility, and a structural guard that no migration touches `CashflowCustomer`/`CashflowLegalEntity`.
- `tests/customer-intelligence-identity.test.ts` — 17 tests. Pure identity scoring, normalization, free-mail rules, name-alone never auto-links.
- `tests/customer-intelligence-service-lines.test.ts` — 9 tests. The seven service lines and deterministic precedence.
- `tests/customer-intelligence-lifecycle.test.ts` — 12 tests. Per-relationship lifecycle and rollup ordering.
- `tests/customer-intelligence-migrations.test.ts` — structural migration-guard suite (CP-PHASE-02A). Reads the SQL source of the three Customer Intelligence migrations (`20260805120000_add_customer_intelligence_foundation`, `20260805150000_customer_intelligence_corrections`, `20260805160000_customer_intelligence_identity_integrity`) and proves at the source level that each is:
  - **additive** — a statement-level allowlist admits only `CREATE TYPE` / `ALTER TYPE ... ADD VALUE` / `CREATE TABLE` / `ALTER TABLE` restricted to `ADD COLUMN` and `ADD CONSTRAINT` / `CREATE INDEX` (including `CREATE UNIQUE INDEX`) / `INSERT ... ON CONFLICT`; `UPDATE`, `MERGE`, `REPLACE`, and non-additive `ALTER TABLE` forms (`ALTER COLUMN`, `RENAME`, `DROP`) are explicitly rejected;
  - **idempotent where it writes data** — every data `INSERT` carries `ON CONFLICT` (`DO NOTHING` or `DO UPDATE`);
  - **non-destructive** — no `DROP TABLE`, `TRUNCATE`, `DELETE FROM`, or column/index/constraint/type drops, matched case-insensitively so lowercase destructive SQL cannot pass;
  - **never touching legacy finance** — none of the migrations references `CashflowCustomer`, `CashflowLegalEntity`, or any other `Cashflow*` structure; and
  - **tenant-scoped bootstrap** — the `Module`/`TenantModuleAccess`/`OperatingCompany` bootstrap is scoped to the `newl-group` tenant only.
  The statement splitter removes full-line `--` comment lines before splitting on semicolons, so comment prose containing semicolons can never be parsed as a phantom statement (CP-PHASE-02A confirmed regression, pinned by a dedicated test). It also guards the inventory: exactly the three known migrations may reference Customer Intelligence tables, so renaming, removing, or silently adding a Customer Intelligence migration fails the suite. Phase-2 backfill migrations must pass the same statement allowlist and idempotency guards.
- `tests/customer-intelligence-ingestion.test.ts` — CP-PHASE-02B-2 read-only QuickBooks customer ingestion suite. Prisma is mocked; the authorization module is REAL; `fetch` is mocked. Covers:
  - **GET-only transport**: the customer query URL is built against `GET /v3/company/{realmId}/query` (the access token is never embedded in the query URL — it is carried by the request `Authorization` header), every QuickBooks request is asserted to be GET with a Bearer token, and pagination stops on a short page.
  - **Bounded pagination regression**: the full-page mock reads the URL-encoded `query` value through `URL.searchParams` and asserts requests advance from `startposition 1` to `startposition 1001`. This prevents the mock from mistaking form-encoded `+` separators for literal spaces, returning the first 1,000-row page forever, and growing the fetched-customer array without bound.
  - **Partial and completely missing evidence**: `normalizeQuickBooksCustomer` stores missing fields as `null` (never invented); unmatched evidence JSON omits missing fields. Live and dry-run regressions prove an unmatched record carrying only a valid QuickBooks ID remains a reviewable proposal with a null source label and no invented evidence. Available name, contact, address, parent-account, notes, status, currency, and timestamp evidence is retained; reruns clear removed source evidence without changing reviewer-owned fields. Matched records missing schema-required display name, `currency`, or `active` evidence are skipped and reported without changing prior data because no owner-approved fallback exists.
  - **Operating-company credential resolution**: unassociated companies (and companies whose credential is missing / not QuickBooks / not ACTIVE) are `SKIPPED_UNASSOCIATED` with an audited warning and zero customer writes; a cross-tenant operating-company id is rejected.
  - **Idempotency and reviewed-decision preservation**: re-runs keyed by `(tenantId, realmId, quickBooksCustomerId)` refresh `lastSyncedAt`; an `APPROVED` match is authoritative for matching and is never rewritten; a re-run over a `REJECTED` decision leaves the reviewed row unchanged with no writes and reports it separately from proposed changes. Regressions cover both a rejected decision and a still-`PROPOSED` row with non-null reviewer-selected `companyId`: both lookups are independent of canonical target, the proposal is not duplicated, and its human-selected company/candidate/score/reviewer fields survive changed and removed source-evidence refreshes. Concurrent unmatched reruns exercise the transaction-scoped PostgreSQL advisory-lock backstop and prove exactly one proposal is created while the losing rerun reports the authoritative row as unchanged. Cross-operating-company approved matches, rejected proposals, and source accounts cannot be resolved, moved, or updated.
  - **Atomic source ownership**: concurrent source-account upserts for the same tenant/realm/customer key but different operating companies are serialized; exactly one owner is persisted and the losing call is rejected before any update. Connection tests separately prove that a QuickBooks credential or realm cannot be associated with two operating companies in the tenant.
  - **CP-02B-2-Q1 `MATCH_EVIDENCE`**: unmatched customers are persisted as `PROPOSED` `CustomerIdentityMatch` rows (`companyId = null`, `operatingCompanyId` set) with the available evidence; nothing is auto-created or auto-approved (CP-02B-3-Q1 `MANUAL_ONLY`).
  - **Dry-run zero-write contract**: `{ dryRun: true }` computes the full would-be report and asserts no create/update/upsert/delete on any model (no audits either); proposal-resolution regressions distinguish create, evidence-refresh, unchanged, and reviewed-preserved outcomes, including an existing unchanged proposal that is not counted as a new write. An expired token in dry-run is reported as a limitation instead of refreshing.
  - **Token refresh**: expired tokens refresh through `refreshQuickBooksAccessToken` (refresh endpoint asserted) and the rotated tokens use an `(id, tenantId)`-constrained persistence write that must affect exactly one row; foreign-tenant credentials and zero-row updates fail closed. Fresh tokens never trigger a refresh write.
  - **Run/error audit contract**: successful non-dry runs record the authenticated tenant and actor with a terminal summary containing only timestamps, operating-company status counts, and aggregate totals. Detailed warnings remain in the returned ADMIN report but are never copied to the audit. Token-acquisition and QuickBooks-fetch failures use deterministic classifications only. Synthetic upstream token/customer-like content and failed-record identifiers are proven absent from audit writes, alongside bearer tokens, refresh tokens, credential references, and authorization headers. A persistence failure after an earlier successful record increments sanitized `recordErrors`/`skipped` counts, allows deterministic processing to finish, and still writes the terminal summary.
  - **Permissions**: MANAGER, SALES, OPERATIONS, READ_ONLY, and FINANCE are denied for both live and dry-run entry points before any database write or QuickBooks fetch; FINANCE is denied even with `canMutate=true` (ingestion is ADMIN-only).
  - **Association bypass regression**: `registerOperatingCompany` ignores removed QuickBooks association properties from an untyped runtime caller, proving realm/credential references can only be written through the validated, audited `associateQuickBooksCredential` action.
- `tests/customer-intelligence-reconciliation.test.ts` — CP-PHASE-02B-3 deterministic identity reconciliation suite. Prisma is mocked; the authorization module is REAL. Covers:
  - **Scoring matrix (identity.ts rules only)**: pure and complete-service regressions cover 100 exact persisted mapping / approved stable ID, 95 unique domain + name, 92 name + phone/address, and 0 for name alone/free-mail. Persisted evidence reads are tenant- and operating-company-scoped; direct negative regressions prove an exact mapping and approved stable ID owned by another operating company cannot produce score 100. Tenant-wide domain ownership still prevents false uniqueness, but only `Company.domain` and source accounts for the current operating company become candidate evidence; a source-account domain observed only under another operating company cannot produce score 95. Address evidence accepts exact normalized QuickBooks `Line1`-`Line5` values from candidate billing or shipping addresses; shared city, province, postal code, country, and arbitrary JSON fields cannot auto-link, and `Rd.` is not inferred equal to `Road`.
  - **Ambiguity-to-PROPOSED routing**: a tied best score, a below-threshold score, no candidate, or a conflicting approval keeps the record PROPOSED without inventing or overriding a canonical target (CP-02B-3-Q1 `MANUAL_ONLY`); each routing decision has its own `identity-match.deferred` audit. Automatic candidates must already have a relationship to the match's operating company (CP-02B-3-Q2); a direct regression proves a high-confidence company related only to another operating company is excluded and cannot auto-link, while relationship-less companies remain available only to the guarded manual workflow. Partial and completely missing QuickBooks evidence stay PROPOSED. Ingestion refreshes replace source-owned evidence while preserving the guarded review workflow's `reviewNote`; changed, partial, and completely missing source-evidence regressions pin that ownership boundary.
  - **Re-run idempotency and locked snapshots**: reviewed decisions are returned unchanged (`REVIEWED_PRESERVED`, no rewrite, advisory lock taken); a re-run only evaluates records still PROPOSED; the one-approved-per-source index rejection falls back to the authoritative approved row. Concurrency regressions simulate ingestion refreshing high-confidence evidence to partial or completely missing evidence before reconciliation obtains the shared lock and prove the locked authoritative snapshot remains PROPOSED rather than auto-approving from stale evidence.
  - **Cross-tenant rejection**: candidate and manually selected `companyId`/`operatingCompanyId` references from another tenant fail closed before any status update or audit. A foreign or nonexistent reconciliation `operatingCompanyId` is rejected before match queries, writes, or run audit.
  - **Role denial table**: MANAGER, SALES, OPERATIONS, and READ_ONLY are denied on reconciliation, approve, reject, defer, and explicit Company creation before any database write; FINANCE passes the ADMIN/FINANCE mutation gate.
  - **Review decisions**: DEFER returns the match to PROPOSED, clears reviewer fields, preserves the note in evidence, and audits `identity-match.deferred`; APPROVE persists an explicitly selected tenant-valid target; REJECT may record a tenant-valid considered-but-rejected company. The explicit Create-and-Approve path requires ADMIN/FINANCE, confirmation, reviewer-entered identity, and a tenant-valid operating company, then creates Company + relationship + decision + audits atomically. Cross-tenant, no-confirmation, and audit-failure regressions fail closed. Manual review, malformed-record deferral, and reconciliation share advisory locks and authoritative re-reads so concurrent rejection is preserved; two reviewers that initially observe a null operating company cannot move the match after the first reviewer assigns its operating-company ownership.
  - **Review queue queries**: `getIdentityReviewQueue` lists only PROPOSED `QUICKBOOKS_ACCOUNT` matches with tenant filtering; metrics counts are tenant-scoped; SALES/OPERATIONS/READ_ONLY are denied.
- `tests/customer-intelligence-fx.test.ts` — CP-PHASE-02B-5 pure FX helpers suite. Covers: UTC-stable `monthKeyOf`/`currentMonthKey`, `YYYY-MM` validation, closed months classified FINAL and the current month PROVISIONAL (future months also PROVISIONAL), the `fxSource` label embedding the classification, sign-safe two-decimal half-up rounding (including exact negative half-cent and nearby boundaries) shared by FX and monthly totals, and the directional-management-reporting CAD consolidation disclosure.
- `tests/customer-intelligence-materialization.test.ts` — CP-PHASE-02B-5 financial materialization suite. Prisma is mocked; the authorization module is REAL; `fetch` is mocked. Covers:
  - **GET-only report transport**: ProfitAndLossDetail and AgedReceivablesDetail URLs are built against `GET /v3/company/{realmId}/reports/...` with the access token in the `Authorization` header only; every report request is asserted GET with Bearer auth; pagination advances `start_position` 1 → 1001 and stops on a short page; non-OK report responses fail closed with a bounded status error.
   - **Owner-approved sources (CP-02B-5-Q1 `PNL_DETAIL_PLUS_AGING`)**: the 24-month `start_date`/`end_date` window, `accounting_method=Accrual`, the aging `as_of_date`, and transaction-level row normalization are pinned. Representative nested ProfitAndLossDetail and AgedReceivablesDetail sections are traversed; unreadable nested detail fails instead of becoming an empty report. Total/subtotal rows are excluded; partial or completely missing rows normalize to null and never invent values.
   - **No silent substitution**: missing stable customer/transaction-line identifiers or required transaction/account structure stops the section with `LIMITATION` (audited) and performs no financial writes. Name-only resolution is explicitly rejected; stable customer IDs are resolved with tenant, realm, and operating-company scope.
   - **sourceKey idempotency**: the deterministic source key preserves transaction and transaction-line identifiers, so two lines under one transaction remain distinct. An identical re-run preserves and aggregates the authoritative immutable facts; conflicting amount/date/target/classification evidence stops without changing the line or monthly totals. Reruns also prove that a prior immutable line absent from a later response remains included beside a new line in the same bucket and that a wholly absent prior bucket is recomputed from persisted evidence.
  - **Service-line precedence**: existing `QuickBooksServiceMappingRule` rows are applied with `service-lines.ts` precedence (item beats income account); Newell's Express defaults unmatched income to `LOCAL_TRUCKING`; other operating companies default to `OTHER`.
   - **Cost materialization (CP-02B-5-Q2)**: Memo on Statement file evidence is normalized. Newl Worldwide accepts only the finance-documented direct-cost account allowlist, combines multiple customer/vendor invoices by file, requires every file customer to resolve to one tenant/operating-company relationship, and records authoritative CAD home cost in the vendor-bill month under `sourceAccountKey = ALL`. Foreign-cost regressions prove that missing exchange-rate evidence is accepted when authoritative CAD home and native evidence exist and that supplied exchange evidence never replaces the home amount. Arbitrary Expense/Other Expense/COGS accounts are not admitted. USA and Warehousing retain zero cost/gross profit.
   - **Income transaction matrix**: Invoice/Credit Memo behavior is pinned; representative unrecognized income-bearing transaction types return `LIMITATION` with no financial writes instead of being silently omitted.
   - **FX**: CAD and foreign regressions prove report currency overrides the customer-account label. Foreign rows preserve validated native and home amounts before USD revenue converts only with a positive `BANK_OF_CANADA` rate whose status is FINAL for a closed month or PROVISIONAL for the current month. Missing transaction-currency evidence stops with `LIMITATION`; missing, wrong-source, and wrong-status Bank of Canada rates skip conversion and mark the month `INCOMPLETE`.
   - **Aggregation + lifecycle + atomicity**: monthly buckets are written under the existing unique key with `INCOMPLETE`/`UNRECONCILED` status (never RECONCILED); open AR merges under the OTHER service line. Immutable lines, monthly rows, lifecycle refreshes, and commit audit evidence share one operating-company transaction. Failure injection on a later revenue-line insert and on monthly upsert proves rollback/no committed partial state. A valid empty revenue report still materializes positive AR and refreshes lifecycle. An authoritative empty aging rerun zeroes settled prior AR and refreshes the relationship; incomplete aging never clears absent balances. Aging fetch failure writes no financial rows, while missing/unmatched aging evidence makes the as-of month incomplete.
  - **Operating-company isolation**: revenue rows are resolved strictly within the processed operating company's tenant-scoped source accounts; the same row cannot activate another operating company (zero writes for the unrelated company).
  - **Partial/missing evidence**: rows missing identity, date, amount, or a resolvable customer are skipped and counted; the affected month is `INCOMPLETE`; nothing is invented.
  - **Dry-run zero-write contract**: `{ dryRun: true }` computes the full would-be report and asserts no create/update/upsert/delete on any model and no audits; an expired token in dry-run is reported as a limitation instead of refreshing.
  - **Permissions**: MANAGER, SALES, OPERATIONS, READ_ONLY, and FINANCE are denied for both live and dry-run entry points before any database write or QuickBooks fetch; a foreign operating-company id is rejected.
  - **Audit contract**: successful runs write the terminal `customer-intelligence.financial-materialization.run` entry with counts/classifications only — transaction identifiers, customer names, source keys, amounts, bearer tokens, and `secretRef` are proven absent from audit evidence; dry-run writes no audits.
- `tests/customer-intelligence-profile-ui.test.tsx` — CP-PHASE-02B-4 Customer Profile UI suite. Prisma is mocked; the authorization module is REAL; `next/cache`, `next/navigation`, `next/link`, and the `getAuthenticatedContext` session resolver are mocked. Runs in the Node vitest environment (`.test.tsx` is included by the vitest config); Vitest mirrors Next.js with the automatic React JSX runtime when importing `.tsx` modules directly, and server-rendered pages are rendered to static markup with `react-dom/server` (no DOM/browser library is used). Covers:
  - **Stored-evidence potential contacts**: `extractPotentialContactsFromEvidence` reads email/phone values from stored identity-match evidence only, never invents values from missing/empty/malformed evidence, de-duplicates, and skips oversized fields. All examples are synthetic reserved values (`purchasing@example.com`, `+1 416 555 0199`).
  - **Leadership role matrix**: SALES denied on every new query (`listCompanyDirectory`, `getUnmatchedCustomerDirectory`, `getCompanyProfileDetail`); OPERATIONS and READ_ONLY denied on reads; FINANCE and MANAGER granted; the contact-details mutation (`updateContactDetails`) is denied for SALES, OPERATIONS, READ_ONLY, and MANAGER before any database write (contact edits are ADMIN/FINANCE via `requireMatchApproval`), and FINANCE is denied when the tenant mutation gate sets `canMutate=false`.
  - **Directory reads**: matched-company rows assemble lifecycle rollup, operating-company names, source-account counts (active vs total), contact counts, lead stage, opportunity-signal counts, and last activity; the read is tenant-scoped (`tenantWhere` carries `tenantId`) and companies without an operating-company relationship are excluded.
  - **Unmatched view**: all tenant-scoped PROPOSED `QUICKBOOKS_ACCOUNT` rows are listed, including deferred proposals with a non-null reviewer-selected `companyId`; potential contacts come from stored evidence only; rows with no email/phone evidence render an empty list.
  - **Company detail**: unknown/cross-tenant identifiers return null (rendered as not found); a populated profile assembles relationships with per-operating-company approved-match counts derived from stored identity matches, contacts with contact points and evidence counts, match status, the existing `Lead`, stored opportunity signals, and stored TradeMining import-record evidence.
  - **Guarded contact corrections**: `updateContactDetails` row-locks and reads the authoritative tenant-owned contact inside its transaction, derives the required `fullName` there, updates submitted fields only, writes a tenant-scoped `customer-intelligence.contact.details-updated` AuditLog, rejects cross-tenant contacts and clearing both names before any material write, and records submitted email/phone corrections as normalized `ContactPoint` rows — equivalent spellings deduplicate deterministically against the normalized value key, replacement retains a prior direct email even when no `ContactPoint` existed, clearing retains and demotes the prior value and every primary point of that type, and an un-normalizable submitted value is rejected. No correction deletes prior evidence. A concurrency regression proves an omitted concurrently corrected field survives while name derivation, retained contact-point evidence, and audit `before` evidence use the authoritative locked snapshot. The contact row, contact-point corrections, and AuditLog entry commit in one Prisma transaction; a regression proves an audit-write failure rejects the whole mutation so a correction cannot commit unaudited. The `updateContactDetailsAction` wrapper applies the form, rejects a nonempty unrecognized contact-status value with an `error` state and no writes (no false success while silently keeping the old status), and maps errors to an `error` action state.
  - **UI surface compile proof**: the client `ContactEditPanel` component and the shared `EMPTY_PROFILE_ACTION_STATE` contract import cleanly in the Node environment.
  - **Server-rendered pages**: the directory and company-profile pages are invoked and rendered to static markup in the Node environment (`react-dom/server`; `next/link` and the client edit panel are stubbed): matched directory rows with lifecycle/counts/links, the unmatched view with stored-evidence potential contacts only, honest empty states for both directory views, a populated profile (relationships, contacts, lead, opportunity signals, import records) with stored contact/contact-point source attribution and contact-point verification visible together, ADMIN/FINANCE edit visibility, the hidden edit control for MANAGER, honest empty profile sections, the news empty state and TradeMining configuration text, and `notFound()` for unknown/cross-tenant company identifiers.
- `tests/customer-intelligence-reporting.test.tsx` — CP-PHASE-02B-6 financial reporting suite. Prisma is mocked; the authorization module is REAL; `next/cache`, `next/navigation`, `next/link`, the server auth action, and the `getAuthenticatedContext` session resolver are mocked; server-rendered pages are rendered to static markup with `react-dom/server`, and the AppShell client component is rendered to prove the leadership-only Reporting navigation entry. All fixtures are synthetic reserved values. Covers:
  - **Conservative PROVISIONAL FX labeling**: current-month CAD is PROVISIONAL; a regression proves a provisionally materialized month viewed after month-end remains PROVISIONAL (`MATERIALIZED_FX_STATUS_UNPROVEN`) rather than being upgraded from calendar position alone. Empty totals remain unlabeled.
  - **Leadership guard**: SALES, OPERATIONS, and READ_ONLY are denied on every exported reporting query (`getReportingSummary`, `listReportingOperatingCompanies`, `listReportingServiceLines`, `getReportingOperatingCompanyDetail`); FINANCE and MANAGER are granted.
  - **Leadership-only navigation**: the AppShell renders the Reporting link for ADMIN, MANAGER, and FINANCE and hides it for READ_ONLY, SALES, and OPERATIONS even when the module is enabled (other Customer Intelligence entries stay visible), matching `requireReadAccess`.
  - **Read-only contract**: every reporting query performs zero database writes.
  - **Tenant scoping**: every operating-company, monthly-financial, and revenue-line read carries the authenticated `tenantId`; a foreign operating-company filter lands inside the same tenant-scoped `where` and yields no rows (never a cross-tenant leak).
  - **Per-operating-company consolidation**: one INCOMPLETE row excludes that operating company's entire financial month from headline revenue/cost/gross-profit totals. Multi-company regressions prove another operating company's complete period in the same calendar month remains included. Native revenue, cost, and gross profit are grouped and rendered per currency.
  - **Live Open AR snapshots**: multiple monthly AR snapshots are never added. Selection requires the report's current calendar month independently per operating company; absent-current and incomplete-current snapshots make only that company's AR unavailable, with no older fallback, while a mixed-company regression proves another company's complete current snapshot remains reportable and the unavailable-company count discloses partial consolidated scope.
  - **Partial/missing CAD conversion**: a consolidation with one converted and one unconverted CAD revenue row, or two such AR rows within the same current-month snapshot, keeps the converted value, sets `cadRevenuePartial`/`cadOpenArPartial` (and the combined `cadValuesPartial`) and renders "partial" instead of a complete-looking total; completely missing conversions keep the CAD values null.
  - **Per-service-line consolidation**: all seven service lines are always returned; totals aggregate complete operating-company/month periods per service line with per-currency native revenue/cost/gross-profit rendering; an `operatingCompanyId` filter scopes the read. A realistic OCEAN-revenue plus complete OTHER-AR fixture proves company Open AR is not attributed to a revenue service line or mislabeled snapshot-incomplete; AR columns are omitted from this view.
  - **Operating-company detail**: unknown/cross-tenant identifiers return null (rendered as not found); a populated detail assembles monthly rows with company names and conservative CAD labels, native revenue/cost/gross-profit, immutable revenue-line evidence, and a summary that counts but excludes INCOMPLETE evidence. The revenue-line evidence count and pagination metadata are tenant-scoped.
  - **Actual-currency rendering (detail)**: the operating-company detail formats monthly native revenue/AR with the row's `currency` and revenue-line native amounts with the line's `nativeCurrency`, so USD native evidence renders as `US$` figures rather than a CAD fallback while CAD-converted columns keep CAD formatting.
  - **CAD labels on every displayed total**: applicable CAD totals render conservative PROVISIONAL labels unless authoritative final materialization can be proven; stale month-transition coverage prevents an unsupported FINAL claim.
  - **Deterministic revenue-line pagination**: revenue-line evidence is served in deterministic 500-row pages (newest-first by transaction date with the `id` tiebreak) with complete total-count/total-pages and previous/next state; a 501-row record is disclosed ("Revenue-line evidence (501 total)", "Showing rows 1–500 of 501", page 1 of 2) with a Next control, page 2 returns Previous, and the query asserts the `skip`/`take`/`orderBy` arguments.
  - **Summary**: tenant-wide per-operating-company/month atomic metrics, native cost/gross-profit aggregation, incomplete company-period counts, per-company latest-snapshot Open AR, null CAD totals when no materialized evidence exists, and conservative PROVISIONAL labeling.
  - **Server-rendered pages**: the overview and detail render the directional disclosure, month-to-date/provisional explanation, per-currency native revenue/cost/gross-profit, partial/unavailable markers, and honest empty states. Pagination regressions cover malformed, non-finite, negative, fractional, and excessive page parameters.
  - **Structural Cashflow guard**: the reporting queries and page sources never reference any `Cashflow*` structure, complementing the migration-guard suite's proof that no migration modifies the legacy finance tables.
- `tests/customer-intelligence-reconciliation-postgres.test.ts` — opt-in real PostgreSQL regression for the partial unique-index race and PostgreSQL transaction-abort behavior that Prisma mocks cannot emulate. It runs only when the controller sets `CUSTOMER_INTELLIGENCE_POSTGRES_TESTS=1` and supplies `CUSTOMER_INTELLIGENCE_TEST_DATABASE_URL` whose database name is explicitly marked test/preview; it never falls back to the application `DATABASE_URL`. The suite creates and removes one isolated synthetic test table, proves a caught unique violation still aborts the transaction, races two approvals, and performs the authoritative reread only after the loser rolls back.
- `tests/authorization.test.ts` — 27 tests including the leadership-only `CUSTOMER_INTELLIGENCE` matrix assertions (ADMIN/MANAGER/FINANCE allowed; SALES/OPERATIONS denied).

The Customer Intelligence + authorization baseline is **104 targeted tests** = 77 Customer Intelligence tests (`foundation` 39 + `identity` 17 + `service-lines` 9 + `lifecycle` 12) + 27 authorization tests. CP-PHASE-02B-2 adds the read-only ingestion suite in `tests/customer-intelligence-ingestion.test.ts` on top of that baseline.

## Phase 2A adoption baseline

CP-PHASE-02A records the adoption baseline before phase 2. This phase changes no schema, adds no migration, and changes no runtime behaviour; it adds the migration-guard suite above and the documentation below.

### Handoff inventory reconciliation

The handoff inventory was reconciled against this checkout. Every item is present; no discrepancy was found.

| Handoff item | Repository location | Status |
|---|---|---|
| Migration 1: foundation | `prisma/migrations/20260805120000_add_customer_intelligence_foundation/migration.sql` (+ `migration_lock.toml`) | Present |
| Migration 2: corrections | `prisma/migrations/20260805150000_customer_intelligence_corrections/migration.sql` (+ `migration_lock.toml`) | Present |
| Migration 3: identity integrity | `prisma/migrations/20260805160000_customer_intelligence_identity_integrity/migration.sql` (+ `migration_lock.toml`) | Present |
| Module source | `src/modules/customer-intelligence/` — 10 files: `actions.ts`, `audit.ts`, `cashflow-compatibility.ts`, `constants.ts`, `identity-approval.ts`, `identity.ts`, `lifecycle.ts`, `permissions.ts`, `queries.ts`, `service-lines.ts` | Present |
| Customer Intelligence test suites | `tests/customer-intelligence-foundation.test.ts`, `tests/customer-intelligence-identity.test.ts`, `tests/customer-intelligence-service-lines.test.ts`, `tests/customer-intelligence-lifecycle.test.ts` (77 tests) | Present |
| Authorization suite | `tests/authorization.test.ts` (27 tests, including the `CUSTOMER_INTELLIGENCE` leadership matrix) | Present |
| Module documentation | `docs/modules/customer-intelligence/` — `overview.md`, `data-model.md`, `permissions.md`, `business-rules.md`, `integrations.md`, `testing.md`, `open-questions.md` | Present |

### Adoption baseline SHA (controller-owned)

The git-level baseline steps are owned by the controller and recorded at verification time:

- Freshly fetched `origin/main` SHA: _recorded by the controller at verification time_.
- Assertion that the Phase 1 Customer Intelligence merge (the three migrations, `src/modules/customer-intelligence/*`, and the CI test/documentation suites) is contained in `origin/main`: _recorded by the controller at verification time_.
- Overlap check that no open branch changes Customer Intelligence schema or behaviour: _recorded by the controller at verification time_.

### Baseline re-run and baseline debt

- Re-run result of the Customer Intelligence + authorization baseline (104 targeted tests): _recorded by the controller at verification time_.
- Unrelated global failures are recorded separately as baseline debt; they are not introduced by this phase and are listed in "Baseline debt (recorded at CP-PHASE-02A verification time)" below.

## Commands

```bash
npm test
npm run lint
npm run typecheck
npm run build
```

## Verification correction (CP-PHASE-02B-2)

The ingestion suite previously exhausted the worker's approximately 4 GB V8
heap before reporting any of its 28 tests. The failure was deterministic and
local to the pagination test mock, not repository-wide worker concurrency:

- `URLSearchParams` serializes spaces in the QuickBooks `query` parameter as
  `+` characters.
- The mock used `decodeURIComponent(href)` and searched for the space-delimited
  text `startposition 1001`. `decodeURIComponent` does not translate `+` to a
  space, so that condition was never true.
- The mock consequently returned the full first page of 1,000 synthetic
  customers for every request. The production pagination loop correctly kept
  requesting the next page because every mocked page was full, while the test
  accumulated and repeatedly serialized unbounded pages until V8 failed in
  response JSON parsing.

The correction parses `new URL(href).searchParams.get("query")`, which applies
the form-url-encoded `+` decoding and lets the mock return its two-row final
page at `startposition 1001`. The regression assertion pins both requested
positions. The unrelated `vitest.config.ts` heap and worker-concurrency
workaround is fully reverted; no heap increase, concurrency reduction, test
skip, exclusion, or assertion weakening is used. The controller owns the full
suite verification.

## Baseline debt (recorded at CP-PHASE-02A verification time)

- The CP-PHASE-02A run observed **no unrelated global failures**. The three failures previously listed as origin/main baseline debt (the OPERATIONS `accessibleModuleKeys` expectation omitting `WEBSITE_GROWTH`, and one failure each in `assistant-runtime.test.ts` and `settings-queries.test.ts`) were **not reproduced**: `tests/authorization.test.ts` (27 tests), `tests/assistant-runtime.test.ts` (8 tests), and `tests/settings-queries.test.ts` (5 tests) all passed. The OPERATIONS matrix in `tests/authorization.test.ts` now includes `WEBSITE_GROWTH`.
- The only failure in the CP-PHASE-02A verification run was one migration-guard assertion in `tests/customer-intelligence-migrations.test.ts`: the statement-allowlist guard parsed a phantom statement with verb `UNKNOWN` out of the corrections migration's multi-line comment, whose prose contains a semicolon ("well; this index is the database-backed backstop ..."). The splitter split on `;` before stripping `--` comment lines, so the comment fragment `well` was treated as a SQL statement. The migration is additive and was not modified; the guard is fixed to strip full-line comments before splitting and a regression test pins the case. Every Customer Intelligence runtime test passed.
- Any unrelated global failure observed by the controller at verification time is recorded here as baseline debt; this phase introduces none.

## Preview migration validation runbook

> Live execution status: this phase performs no migration run. Executing
> migrations against any preview or production database is owner-approved
> operational work, not engine authority. The engine (Codex/OpenClaw) prepares
> and documents this runbook only; it never executes a migration.

### Safety gate (preview environment label)

Every migration run against an isolated preview PostgreSQL must first pass the database safety gate:

- `npm run db:safety-check -- --require-preview-db` (also invoked automatically by `npm run db:migrate:preview` before `prisma migrate deploy`) fails unless `DATABASE_ENVIRONMENT=preview` and the `DATABASE_URL` is not the production URL.
- `scripts/vercel-build.ts` runs the same `--require-preview-db` safety check for `VERCEL_ENV=preview` builds before `prisma migrate deploy`.
- The gate prints the resolved database signature (`host:port/database`); record it as the evidence anchor for every run.

### Required evidence

Each approved migration validation must record:

1. **Preview identity**: the isolated preview PostgreSQL identity (host, port, database) and the `DATABASE_ENVIRONMENT=preview` label the gate enforced. No other database may be targeted.
2. **Empty-database run**: a fresh preview database with no migrations applied, then `npm run db:migrate:preview` — the full migration history applies cleanly from scratch, including the three Customer Intelligence migrations.
3. **Upgrade-path run**: a preview database advanced to the migration immediately before `20260805120000_add_customer_intelligence_foundation`, then `npm run db:migrate:preview` — the three Customer Intelligence migrations apply on top of the existing schema. The migration-guard suite in `tests/customer-intelligence-migrations.test.ts` is the source-level proof of additivity; the upgrade-path run is the live proof that pre-existing schema/data survive.
4. **Post-run bootstrap verification**: the `Module` catalog row exists, `TenantModuleAccess` is enabled for the `newl-group` tenant only, and exactly the three Newl operating companies exist — no other tenant is enabled or seeded.
5. **Human approval record**: who approved the run, when, and which database identity the approval covered.

### Approval boundary

- Explicit human approval is required **before any migration run**, including preview runs.
- Live execution of a migration is owner-approved operational work, not engine authority; the engine prepares and documents but does not run.
- Production migration requires the separate `db:migrate:production` gate (`DATABASE_ENVIRONMENT=production` plus production database-identity match) and a distinct owner approval per the repository human-approval boundaries.

## Phase exclusions (CP-PHASE-02A)

CP-PHASE-02A confirms the following are excluded and introduces none of them:

- No settings/connection UI.
- No Customer Profile UI, API routes, or navigation.
- No Microsoft 365 mailbox integration.
- No Brave or Hunter research.
- No Apollo.
- No Teamship writes or reads.
- No scheduling.
- No production write of any kind.

At CP-PHASE-02A time, "no QuickBooks ingestion or sync" also held; CP-PHASE-02B-2
implements the read-only QuickBooks **customer** ingestion and CP-PHASE-02B-5
implements the read-only **financial materialization** (revenue detail + AR
aging, see above and `docs/modules/customer-intelligence/integrations.md`).
Webhooks, CDC recovery, reconciliation, and the job ledger remain excluded and
unstarted.

## Phase scope (CP-PHASE-02B-2)

CP-PHASE-02B-2 introduces exactly one new entry point
(`runQuickBooksCustomerIngestion`), one new module file
(`quickbooks-ingestion.ts`), one new guard (`requireIngestionAdmin`), one new
test suite (`tests/customer-intelligence-ingestion.test.ts`), and documentation
updates. It adds **no schema change and no migration** (owner decision
CP-02B-2-Q1 `MATCH_EVIDENCE` chose the existing `CustomerIdentityMatch` staging
model over a new staging table). It performs **no QuickBooks write of any kind**
(GET-only transport, asserted by tests), **no Company creation or approval**
(CP-02B-3-Q1 `MANUAL_ONLY`), **no Teamship access**, **no customer
communication**, and **no production write**. Every shared data path carries
authenticated `tenantId` filtering, and the existing permission and
human-approval boundaries are preserved.

## Phase scope (CP-PHASE-02B-6)

CP-PHASE-02B-6 introduces one new guarded reporting-queries module
(`reporting-queries.ts`), two server-rendered leadership-only reporting pages
under `src/app/(authenticated)/customer-intelligence/reporting/`, one new
Customer Intelligence navigation entry in `src/components/app-shell.tsx`, one
new test suite (`tests/customer-intelligence-reporting.test.tsx`), and
documentation updates (customer-intelligence and customer-cashflow). It adds
**no schema change and no migration**, so the migration-guard suite
(`tests/customer-intelligence-migrations.test.ts`) still proves that no
migration references or modifies any `Cashflow*` structure. The reporting reads
only the tenant-scoped materialized `CustomerMonthlyFinancial` and immutable
`CustomerRevenueLine` evidence (never the `Cashflow*` tables), performs **no
database writes**, **no QuickBooks, Teamship, or external access**, **no
customer communication**, and **no production write**. The legacy Customer
Cashflow UI is treated per owner decision CP-02B-6-Q1 (`RETIRE_NAV`): it is not
removed or redirected before Customer Profile reporting has been validated as
operational.
