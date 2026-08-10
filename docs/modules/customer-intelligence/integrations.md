# Customer Intelligence: Integrations

> Evidence status: CP-PHASE-02B-1 adds the connection model for all three
> operating companies (code and tests only; no OAuth initiation and no live
> connection). CP-PHASE-02B-2 adds the read-only, idempotent QuickBooks customer
> ingestion. CP-PHASE-02B-5 adds the read-only QuickBooks financial
> materialization (revenue detail + AR aging). CP-PHASE-02B-8 adds the
> owner-controlled live-sync enablement gate (default-off, recorded approval,
> ADMIN-only audited enablement). The final design is read-only toward Microsoft
> 365 and QuickBooks; no QuickBooks write is ever performed.

## Connection model (CP-PHASE-02B-1)

- The QuickBooks OAuth app is **shared** by all three operating companies (owner decision
  CP-02B-1-Q2, `SAME_APP`): Newl Worldwide, Newl USA, and Newell's Express and Warehousing
  Ltd. each connect through the same OAuth app but keep their own QuickBooks realm/company
  connection. The approved production redirect URL is
  `https://newl-apps.vercel.app/api/integrations/quickbooks/callback`; it is the default in
  `src/server/integrations/quickbooks.ts` and the `QUICKBOOKS_REDIRECT_URI` env override is
  only for preview/sandbox runs.
- Connections are **operating-company-keyed** (owner decision CP-02B-1-Q1,
  `OPERATING_COMPANY_KEYED`): the connect API and the signed OAuth state carry the stable
  operating-company slug (`newl-worldwide`, `newl-usa`, `newells-express`). The legacy
  `NEWL_WORLDWIDE`/`NEWL_USA` legal-entity keys are preserved in stored credential
  `publicConfig.legalEntity` so the existing two connections keep working; the callback
  bridges slug -> legacy key on write (`quickBooksSlugToLegalEntity`).
- The connect route requires `entity` to be one of the three slugs and rejects legacy keys
  and unknown values with 400. The callback derives the connection name and stored legal
  entity from the slug, so all three operating companies write distinct
  `IntegrationCredential` rows (e.g. `QuickBooks - Newell's Express and Warehousing Ltd.`).

## Operating-company credential association

- `associateQuickBooksCredential` (in `src/modules/customer-intelligence/actions.ts`) writes
  the loose `quickBooksRealmId` / `quickBooksCredentialId` references on `OperatingCompany`.
  It is **ADMIN-only** (`requireAdminSettings` + `requireWrite`) and every successful
  association writes an `AuditLog` (`customer-intelligence.operating-company.quickbooks-associated`).
- Validation is deterministic and tenant-scoped: the operating company and the credential
  must belong to the caller's tenant; the credential must be `provider = QUICKBOOKS` and
  `status = ACTIVE`; and the supplied `quickBooksRealmId` must equal the realm stored in the
  credential's `publicConfig`. The credential's stored legal entity must also map exactly to
  the selected operating-company slug. Transaction-scoped advisory locks serialize claims on both
  the credential ID and realm ID; a connection already associated with another operating
  company in the tenant is rejected before any update. Cross-tenant, duplicate, or
  mismatched references are rejected before any write.
- `registerOperatingCompany` does not accept or persist either QuickBooks association field,
  including when an untyped runtime caller supplies them. All association writes must pass
  through the validated and audited `associateQuickBooksCredential` action; operating-company
  registration cannot bypass the tenant/provider/ACTIVE-status/realm checks.
- Connecting a QuickBooks company never auto-enables live synchronization (owner decision
  CP-02B-8-Q1 `FEATURE_ENABLEMENT_RECORD`): live sync requires the separate tenant- and
  operating-company-scoped `CustomerIntelligenceEnablement` record implemented in
  CP-PHASE-02B-8, which defaults to disabled and requires explicit owner approval recorded
  for audit. The live ingestion and materialization entry points refuse to run for an
  operating company without an enabled, approval-carrying enablement record; dry-run
  verification remains available as the owner's zero-write preview tool.
- **Existing-connection compatibility repair:** the ADMIN Settings page discovers active,
  secret-backed QuickBooks credentials for the three approved legal-entity keys and compares
  them with their tenant-owned operating-company records. Exactly one unclaimed match can be
  associated one company at a time after explicit confirmation. Missing, ambiguous, conflicting,
  cross-company, inactive, or unsupported records fail closed. The browser submits only the
  operating-company ID; the server re-resolves the credential and realm immediately before the
  audited association. This path never reads a token into the UI, updates an
  `IntegrationCredential`, performs OAuth, enables live sync, or calls QuickBooks. It is intended
  to preserve pre-existing invoice-posting connections while adding the Customer Intelligence
  references those read-only engines require.

## Read-only QuickBooks customer ingestion (CP-PHASE-02B-2)

- **Entry point**: `runQuickBooksCustomerIngestion` in
  `src/modules/customer-intelligence/actions.ts` — an ADMIN-triggered, tenant-scoped,
  audited action (guard `requireIngestionAdmin` in `permissions.ts`). MANAGER, SALES,
  OPERATIONS, READ_ONLY, and FINANCE are denied even for a dry run. Every live run writes an
  `AuditLog` (`customer-intelligence.quickbooks-ingestion.run`); skipped companies and
  errors write their own audited warnings.
- **Live-sync enablement gate (CP-PHASE-02B-8)**: a live run refuses to sync an operating
  company without an enabled, approval-carrying `CustomerIntelligenceEnablement` record for
  that operating company. Explicitly scoped live runs throw before any QuickBooks access;
  unscoped live runs skip unenabled companies with an audited `SKIPPED_NOT_ENABLED` section.
  Dry-run (`dryRun: true`) performs zero writes and remains available for unenabled
  companies as the owner's preview tool.
- **Transport is GET-only**: customer records are fetched from
  `GET /v3/company/{realmId}/query` with `select * from Customer startposition N maxresults 1000`
  pagination (`src/modules/customer-intelligence/quickbooks-ingestion.ts`). The access token is
  carried by the request `Authorization` header and is never embedded in the query URL. No
  QuickBooks POST/PUT is ever issued. Tests mock `fetch`; pagination mocks parse the encoded
  `query` parameter with the URL API and assert the exact `startposition` progression.
- **Operating-company resolution**: each operating company resolves its associated
  tenant-scoped credential through `quickBooksCredentialId`/`quickBooksRealmId`. Companies
  without an associated credential, or whose credential is missing / not
  `QUICKBOOKS` / not `ACTIVE`, are **skipped with an audited warning** — never guessed.
- **Token refresh**: `getUsableQuickBooksAccessToken` reuses `refreshQuickBooksAccessToken`
  when the stored access token is expired (2-minute freshness buffer). The rotated tokens
  are persisted with an `(id, tenantId)`-constrained update that must affect exactly one
  credential; a foreign or missing tenant-owned credential fails closed. In `dryRun` mode a
  refresh would be a write, so an expired token is reported as a limitation instead of
  being refreshed.
- **Owner-approved staging model (CP-02B-2-Q1, `MATCH_EVIDENCE`)**: no staging table and no
  new migration were needed. New unmatched customers are persisted as `PROPOSED`
  `CustomerIdentityMatch` rows (`QUICKBOOKS_ACCOUNT`, initially `companyId = null`) with the
  available evidence (display/company/given/family names, email, phone, addresses, currency,
  parent account, active status, notes, and last-updated timestamp). A valid QuickBooks customer
  ID remains reviewable even when every descriptive field is absent: its source label is null
  and its evidence contains only the deterministic source marker. No `Company` is created or
  approved (CP-02B-3-Q1, `MANUAL_ONLY`) until a person makes that decision.
- **Idempotency**: matched customers upsert the `CustomerSourceAccount` keyed by
  `(tenantId, realmId, quickBooksCustomerId)` and refresh `lastSyncedAt`. Re-runs never
  overwrite reviewed identity decisions: an existing `APPROVED` match is authoritative for
  matching, and an existing `APPROVED`/`REJECTED` match is returned unchanged. Match,
  proposal, and source-account resolution also require the current `operatingCompanyId`;
  evidence owned by another operating company is never resolved, moved, or refreshed.
  Reviewed `APPROVED`/`REJECTED` decisions are detected by tenant, kind, source key, and
  operating company independently of `companyId`, so a rejection remains authoritative even
  when a reviewer selected a canonical company before rejecting it. Under the same
  transaction-scoped PostgreSQL advisory lock, an existing `PROPOSED` row is also resolved by
  that source ownership key independently of `companyId`. Fresh source label/evidence replaces
  only those unreviewed source fields (including removal of evidence QuickBooks no longer
  supplies), advancing Prisma's `updatedAt`; human-selected `companyId`, `candidateCompanyId`,
  score, reviewer, and review timestamp are preserved. An identical rerun performs no proposal
  update. After waiting, a concurrent losing rerun therefore refreshes or returns the single
  authoritative proposal/reviewed decision and never creates a second null-company proposal.
  This is a migration-free backstop for PostgreSQL's nullable-unique semantics; no schema
  change is introduced. Source-account ownership uses a separate transaction-scoped lock
  over the complete tenant/realm/customer key. Its ownership check and upsert therefore run
  atomically: a concurrent loser for another operating company observes the winner and fails
  closed instead of moving the source account.
- **Missing fields are never invented**: partial or completely missing QuickBooks fields are
  stored as `null` (or omitted from proposed-match evidence). Nullable source-account email,
  phone, address, and parent-account evidence is explicitly cleared when it disappears on a
  refresh. `CustomerSourceAccount.currency` and `active` are required; because no
  owner-approved fallback exists, a matched customer missing either source field or the
  schema-required source-account display name is skipped and reported without changing prior
  data. An unmatched valid ID with no descriptive fields still remains a `PROPOSED` review
  record; only a source record with no QuickBooks `Id` is discarded entirely.
- **Safe error evidence**: reports and audit entries use bounded deterministic failure
  classifications. Arbitrary QuickBooks/OAuth response bodies and thrown provider text are not
  copied into a report or `AuditLog`, preventing upstream tokens or customer content from being
  persisted as diagnostic text. The detailed ADMIN result may contain record-level warnings,
  but the terminal `AuditLog` stores only timestamps, status/count summaries, and aggregate
  totals—never customer IDs, names, contact evidence, or warning text. A per-record processing
  failure increments sanitized `recordErrors`/`skipped` counts and does not prevent remaining
  records or the terminal run audit from completing.
- **Dry-run**: `{ dryRun: true }` performs zero database writes (no source-account upserts,
  no match proposals/refreshes, no audits) and performs the same tenant- and
  operating-company-scoped proposal reads and structural evidence comparison as the live path.
  Per-company and total counts distinguish new proposals (`unmatchedProposed`), evidence
  refreshes (`unmatchedRefreshed`), unchanged proposals (`unmatchedUnchanged`), and preserved
  reviewed decisions; unchanged/reviewed rows are never described as would-change writes.
- **Matched-customer relationship guard**: a matched customer whose
  `(companyId, operatingCompanyId)` relationship does not yet exist is skipped and reported
  as a warning rather than inventing a relationship.

## Read-only QuickBooks financial materialization (CP-PHASE-02B-5)

- **Entry point**: `runFinancialMaterialization` in
  `src/modules/customer-intelligence/actions.ts` — an ADMIN-triggered,
  tenant-scoped, audited action (guard `requireIngestionAdmin` in
  `permissions.ts`, the same guard as customer ingestion). MANAGER, SALES,
  OPERATIONS, READ_ONLY, and FINANCE are denied even for a dry run. The core
  lives in `src/modules/customer-intelligence/financial-materialization.ts`;
  deterministic FX helpers live in `src/modules/customer-intelligence/fx.ts`.
  A live run also requires the same CP-PHASE-02B-8 enablement gate as customer
  ingestion: unenabled operating companies are refused (scoped runs throw,
  unscoped runs skip with an audited `SKIPPED_NOT_ENABLED` section), while
  dry-run verification stays available as the owner's preview tool.
- **Owner-approved report sources (CP-02B-5-Q1, `PNL_DETAIL_PLUS_AGING`)**:
  `GET /v3/company/{realmId}/reports/ProfitAndLossDetail` supplies customer
  revenue transaction detail over the confirmed 24-month window
  (`start_date`/`end_date`, `accounting_method=Accrual`), and
  `GET /v3/company/{realmId}/reports/AgedReceivablesDetail` supplies open
  accounts receivable (`as_of_date`, `aging_method=AgeByDueDate`). Both use the
  `start_position`/`max_results` pagination pattern. Transport is GET-only with
  the access token in the `Authorization` header; no QuickBooks POST/PUT is
  ever issued.
- **No silent substitution**: nested QuickBooks report sections are traversed;
  unsupported nested detail cannot silently become an empty report. If the revenue report cannot provide stable
  customer and transaction-line identifiers or explicit transaction/account
  classifications, the
  operating-company section stops with `LIMITATION` and reports the limitation
  instead of substituting less accurate data.
- **Immutable idempotency**: the deterministic `sourceKey` contains only the
  report/realm and stable transaction and transaction-line identifiers. Account
  names, classifications, transaction types, and other mutable evidence are not
  identity inputs, so repeated identical imports return the existing immutable
  `CustomerRevenueLine`, while changed evidence under that identity stops before
  monthly totals are changed instead of creating a duplicate. Bank of Canada
  CAD conversion fields are derived management materialization rather than
  QuickBooks source evidence: after a PROVISIONAL month closes, a rerun rebuilds
  the monthly CAD aggregate with the applicable FINAL rate without rewriting or
  duplicating the immutable source line.
- **Window enforcement**: every dated ProfitAndLossDetail response row is
  checked against the same inclusive requested 24-month start/end dates before
  classification, identity resolution, persistence, aggregation, or lifecycle
  refresh. Pre-window and post-window/future rows are skipped and their periods
  are reported incomplete; both exact boundary dates are eligible.
- **Service lines**: the existing `service-lines.ts` precedence is applied with
  the tenant-scoped, active `QuickBooksServiceMappingRule` rows; Newell's
  Express defaults unmapped income to `LOCAL_TRUCKING`, every other operating
  company to `OTHER`.
- **Cost scope (CP-02B-5-Q2, `COGS_PLUS_OPERATING_COST`)**: nativeCost and
  nativeGrossProfit are calculated only for Newl Worldwide. Customer and vendor
  invoices are identified by their shared file number using only customer
  `Description` + `Memo on Statement` and vendor `Description` + `Memo` (e.g.
  `TR0121N1` or `OE123456N1`). Combined `Memo/Description` and the opposite
  transaction-type memo fields are not association evidence; conflicting file
  numbers in approved fields fail closed. The
  finance-provided account source is
  `reference/FINANCE_FS_GROUPINGS_REFERENCE.md`; only Worldwide direct-cost
  accounts 5014, 5015, 5020, 5030, 5115, 5205, 5300, 5400, 5401, and 5590 are
  eligible. A vendor bill is associated only when every customer invoice on the
  file resolves to one tenant/operating-company relationship. Its authoritative
  QuickBooks CAD home amount is persisted in the vendor-bill month under the
  `ALL` source-account key and file/account-resolved service line, without
  proportional allocation or independent foreign-currency conversion.
  Worldwide revenue and eligible costs contribute their authoritative
  QuickBooks CAD home amounts to `ALL`/CAD gross-profit buckets, while native
  revenue remains in its transaction-currency source-account bucket. This keeps
  mixed-currency gross profit on one CAD basis without using the directional
  Bank of Canada management rate for booked gross profit.
  Newl USA and Newell's Express and Warehousing Ltd. keep zero
  cost/gross profit.
  Classification uses explicit transaction and account fields, never sign.
  Expense and Other Expense are not globally accepted without an approved
  account scope. Income-bearing transaction types outside the currently
  recognized Invoice/Credit Memo matrix return `LIMITATION` rather than being
  silently excluded.
- **FX**: transaction currency is taken from report evidence, never the customer
  account. Foreign customer-revenue rows preserve and arithmetically validate
  report-native amount, home amount, currency, and exchange rate before Bank of
  Canada CAD management conversion. Foreign vendor costs instead use
  QuickBooks's authoritative CAD home amount without requiring, validating, or
  deriving an exchange rate; supplied native evidence is preserved but never
  replaces that home amount. Closed months use FINAL Bank of Canada monthly average rates stored in
  `CustomerFxRate`; the current month uses an available-to-date average marked
  PROVISIONAL. Source must be `BANK_OF_CANADA` and status must match the month.
  Missing, invalid, wrong-source, or wrong-status evidence never invents a conversion: the row is
  skipped, its month is marked `INCOMPLETE`, and the limitation is reported.
  CAD consolidation is labeled directional management reporting.
- **Aggregation**: monthly totals are written under the existing unique key
  through `upsertMonthlyFinancial`; unreconciled periods stay
  `INCOMPLETE`/`UNRECONCILED`. Lifecycle refresh reuses the existing guarded
  `refreshRelationshipLifecycle` action for the affected relationships. Under
  the operating-company lock, financial totals are recomputed from the complete
  persisted immutable evidence set in the approved window plus pending inserts,
  so prior lines and whole buckets absent from a later response are not silently
  dropped or mixed with replacement totals.
  A valid empty revenue result still processes aging. Aging fetch failure stops
  before partial financial writes; missing/unmatched aging evidence makes the
  as-of period incomplete. A complete authoritative aging snapshot zeroes prior
  positive AR buckets that are now absent and refreshes those relationships;
  partial/unmatched snapshots never clear absent balances. Customer resolution uses only a tenant-, realm-, and
  operating-company-scoped stable QuickBooks customer ID, never a display name.
- **Atomic persistence**: immutable lines, monthly aggregates, lifecycle
  refreshes, and required commit audit evidence for one operating company share
  one transaction. Any persistence or audit failure rolls back that complete
  operating-company financial result.
- **Dry-run and audit**: `{ dryRun: true }` performs zero database writes and
  returns the would-be report. Live runs write a terminal
  `customer-intelligence.financial-materialization.run` audit with counts and
  classifications only — never customer/transaction identifiers, amounts,
  warnings, or provider content.

## Phase 1 (foundation)

The foundation records (`CustomerSourceAccount`, `CustomerRevenueLine`,
`CustomerMonthlyFinancial`, `CustomerFxRate`, `ContactPoint`, `ContactEvidence`,
`CustomerIdentityMatch`) are the storage and identity contract that later integration phases
write into.

## Final design intent (not yet implemented)

- **Microsoft 365**: app-only `Mail.Read` via `client_credentials` (see `src/server/integrations/microsoft-graph-application.ts`). Read-only; no mail-write or send permission. Excludes archive mailboxes in v1.
- **QuickBooks**: GET-only customer sync is implemented in CP-PHASE-02B-2
  (`quickbooks-ingestion.ts`). GET-only financial materialization (revenue from
  ProfitAndLossDetail and open AR from AgedReceivablesDetail) is implemented in
  CP-PHASE-02B-5 (`financial-materialization.ts`). Webhooks, CDC recovery,
  reconciliation, and the job ledger are later phases. No posting.
- **Brave / Hunter cross-sell**: a later `CUSTOMER_CROSS_SELL` research mode. Research may create a reviewable opportunity only; no outreach.
- **Identity matching**: a later phase persists auto-linked matches into `CustomerIdentityMatch` with score >= 90 and no conflicting company.

## Secrets

QuickBooks realm and credential relationships are stored as `quickBooksRealmId` /
`quickBooksCredentialId` on `OperatingCompany` (loose references validated in
`associateQuickBooksCredential`). No secrets are stored in Customer Intelligence records;
real OAuth tokens remain in `IntegrationCredential.secretRef` (encrypted) and environment
variables. The settings page renders realm, company, and environment metadata only and never
renders `secretRef` or token values.
