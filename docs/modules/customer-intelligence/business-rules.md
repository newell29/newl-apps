# Customer Intelligence: Business Rules

> Evidence status: Confirmed from code for implemented foundation logic. Values and ordering marked Requires employee confirmation are not approved business rules.

## Canonical identity

- The canonical `Company` remains the identity shared by sales, TradeMining, Hunter, contacts, and finance. Customer Intelligence never merges companies by name alone.
- One canonical company may relate to any combination of operating companies (Newl Worldwide, Newl USA, Newell's Express and Warehousing Ltd.).
- Multiple QuickBooks customer records per operating company, including separate CAD/USD accounts, roll up to one canonical profile through `CompanyOperatingRelationship` + `CustomerSourceAccount`.

## Lifecycle

Per operating-company relationship (deterministic in `lifecycle.ts`, evidence gathered in `refreshRelationshipLifecycle`):

- `PROSPECT`: no approved QuickBooks customer mapping.
- `ACTIVE_CUSTOMER`: recognized revenue or open AR within the trailing 12 months.
- `DORMANT_CUSTOMER`: linked QuickBooks account but no revenue/open AR in 12 months.
- `FORMER_CUSTOMER`: all linked source accounts inactive and no open AR.

Isolation: revenue evidence is scoped to `(companyId, operatingCompanyId)` and approved QuickBooks mappings are scoped to `(companyId, operatingCompanyId)`, so activity under one operating company can never activate another operating-company relationship. Open AR is read from relationship-scoped `CustomerMonthlyFinancial.nativeOpenAr > 0` in a trailing 12-month window, so a relationship can be active with zero revenue but positive open AR.

Rollup to the canonical company: ACTIVE beats DORMANT beats FORMER beats PROSPECT. (Ordering inferred; Requires employee confirmation.)

## Identity matching

Auto-link only when score >= 90 and there is no conflicting canonical company (`identity.ts`):

- 100: previously approved stable QuickBooks ID or alias.
- 100: exact persisted realm/customer mapping.
- 95: unique domain plus compatible normalized name.
- 92: compatible normalized name plus matching phone or address.
- Below 90: human review.

Hard rules:

- Exact normalized name alone never auto-links.
- Free-mail domains never establish company identity.
- Contacts are never merged by name alone. Identity priority is Apollo person/contact ID, LinkedIn URL, exact normalized email, then reviewed phone-plus-name evidence (evidence priority is enforced in later phases that implement Apollo/mailbox ingestion).
- Every approval, rejection, merge, and unmerge writes an `AuditLog`.
- Re-running ingestion preserves reviewed decisions and is idempotent: existing `APPROVED`/`REJECTED` matches are returned unchanged.
- Every referenced company ID is validated within the authenticated tenant before a match is proposed or approved (shared `identity-approval.ts` invariant validator used by both automatic and manual approval).
- No match enters `APPROVED` without a non-null, tenant-valid canonical `companyId`. A high-scoring automatic proposal without a canonical company stays `PROPOSED` so a reviewer can assign the target; manual approval of such a match is rejected.
- Manual approval of a `QUICKBOOKS_ACCOUNT` match requires a non-null `operatingCompanyId` belonging to the authenticated tenant; missing or cross-tenant references fail before the status update.
- One `(tenantId, kind, sourceRecordKey)` can be `APPROVED` to at most one canonical company. Automatic approval defers a conflicting proposal to `PROPOSED`; manual approval rejects it. A partial unique index (`CustomerIdentityMatch_one_approved_per_source_key`) backstops concurrent or repeated processing.
- `QUICKBOOKS_ACCOUNT` matches require an `operatingCompanyId` so mappings stay operating-company-scoped.
- The database enforces these invariants directly (`20260805160000_customer_intelligence_identity_integrity`): CHECK constraints require `companyId` on every `APPROVED` row and `operatingCompanyId` on every `APPROVED` `QUICKBOOKS_ACCOUNT` row, and tenant-scoped foreign keys on `companyId`/`candidateCompanyId` (`ON DELETE NO ACTION`) block cross-tenant references and prevent deletion of a company still referenced by an identity match.

## Deterministic reconciliation (CP-PHASE-02B-3)

The leadership-triggered reconciliation service (`reconciliation.ts`) re-scores the tenant's PROPOSED `QUICKBOOKS_ACCOUNT` matches against canonical companies. It introduces **no new scoring heuristics**: every score comes from `identity.ts` (`computeIdentityMatchScore`), and the routing rules are the merged approved matrix:

- Auto-link only at score >= 90 to a **unique** best candidate that is a tenant-valid canonical company (`AUTO_LINK`). Exact normalized name alone (score 0) never links; free-mail domains never establish company identity; a tied best score (`AMBIGUOUS`), a below-threshold score, or no candidate at all routes the record to the leadership review queue as `PROPOSED`.
- Candidate canonical companies are tenant companies that already have a `CompanyOperatingRelationship` with the match's operating company (owner decision CP-02B-3-Q2, operating-company-scoped and matching the `QUICKBOOKS_ACCOUNT` scoping rule). A company with no relationship to that operating company is not auto-linked — a missing canonical target stays `PROPOSED` and requires a person to select an existing Company or explicitly approve creating one (owner decision CP-02B-3-Q1, `MANUAL_ONLY`).
- Candidate evidence (domain, phone, approved street lines) comes from `Company.domain` and tenant-scoped `CustomerSourceAccount` rows. `uniqueDomain` means the customer's email domain belongs to exactly one canonical company across the entire tenant, including companies with no operating-company relationship; candidate eligibility itself remains operating-company-scoped. Address evidence is limited to exact normalized QuickBooks `Line1`-`Line5` street-line comparisons from billing and shipping addresses. City, province, postal code, country, and arbitrary JSON string fields never establish address evidence by themselves. Street-suffix equivalence (for example, `Rd` == `Road`) is not inferred.
- Score-100 evidence is loaded rather than hardcoded: an exact `(tenantId, operatingCompanyId, realmId, quickBooksCustomerId)` `CustomerSourceAccount` mapping sets `exactPersistedMapping`, and an existing tenant- and operating-company-scoped approved QuickBooks stable source key sets `previouslyApprovedStableId`. Evidence from another tenant or operating company is never considered.
- Reconciliation reuses the shared `identity-approval.ts` invariants: automatic approval requires a non-null tenant-valid `companyId` and an `operatingCompanyId` for `QUICKBOOKS_ACCOUNT`, and a conflicting approval keeps the record `PROPOSED` instead of overriding the existing decision. The partial unique index `CustomerIdentityMatch_one_approved_per_source_key` backstops one `APPROVED` target per `(tenantId, kind, sourceRecordKey)`; a rejected second approve falls back to the authoritative approved row.
- Re-running reconciliation is idempotent: only records still `PROPOSED` are re-evaluated, and an existing `APPROVED`/`REJECTED` decision for the same `(tenantId, kind, operatingCompanyId, sourceRecordKey)` is returned unchanged (`REVIEWED_PRESERVED`).
- Every reconciliation auto-approval and every ambiguity, below-threshold, no-candidate, or approved-conflict deferral writes a decision `AuditLog` entry (`customer-intelligence.identity-match.approved` / `deferred`). Every manual approval/rejection/deferral writes one (`approved` / `rejected` / `deferred`). Each state change and its decision audit are committed in one transaction, and manual review takes the same source advisory lock as ingestion/reconciliation before re-reading the authoritative state. Reconciliation derives its score only after that lock is held and rereads the authoritative PROPOSED evidence, candidate source accounts, approved mappings, and operating-company relationship eligibility inside the locked transaction; a queued run cannot approve from a stale pre-lock snapshot. Every run also writes a sanitized terminal summary (`customer-intelligence.identity-reconciliation.run`) containing counts only.
- A supplied reconciliation `operatingCompanyId` must resolve inside the authenticated tenant before match queries or audit writes; foreign and nonexistent identifiers are rejected rather than treated as empty runs.
- The review page (`/customer-intelligence/review`) exposes the PROPOSED queue with source evidence, the suggested company (if any), the deterministic score, and approve/reject/defer controls. A reviewer may select an existing tenant company or use the separate explicit **Create company and approve** control. Creation requires ADMIN/FINANCE authorization, a reviewer-entered canonical name, an explicit confirmation checkbox, and a tenant-valid operating company; it atomically creates the `Company`, its operating-company relationship, the approved identity decision, and audit evidence. The QuickBooks source name is never used as a fallback. Reject records a reviewed decision that re-runs never overwrite; defer returns the record to PROPOSED with its note preserved for a later decision.

## Contact points

- `upsertContactPoint` stores a normalized value (emails lowercased, phones digits-only, others lowercased) as the unique key and keeps a human `displayValue`, so equivalent emails and phone formatting deduplicate deterministically.
- `updateContactDetails` (CP-PHASE-02B-4) routes submitted email/phone corrections through the same normalized `ContactPoint` model: a corrected value becomes the primary point while the replaced point is retained as evidence (demoted, never deleted — a replacement is a reviewed correction, not a silent rewrite). The contact row, contact-point corrections, and the `customer-intelligence.contact.details-updated` AuditLog entry commit in one Prisma transaction, so a manual correction can never persist unaudited; a nonempty unrecognized contact-status value submitted through the profile server action is rejected with an error state and no writes.

## Contact evidence

- `upsertContactEvidence` rejects empty field values: extraction never invents a value.
- A later extraction cannot silently overwrite an accepted or manually approved fact. A differing value for an `ACCEPTED`/`REJECTED` evidence row sets `reviewStatus = CONFLICT`, preserves `fieldValue` (the reviewed fact) and its source `evidenceFragment`, and records the new value in `conflictingValue` for review.
- Re-observing the same value for an accepted/rejected fact leaves the reviewed decision stable.
- `UNREVIEWED` pending values are replaced by fresh extraction (nothing reviewed is overwritten).
- Partial and completely missing signature evidence is safe: no invented values are created.

## Service-line mapping

Seven service lines: Ocean, Air, Trucking/drayage, Local trucking, Warehousing/fulfillment, Customs brokerage, Other.

Mapping precedence (`service-lines.ts`): QuickBooks item, then class/department, then income account, then shipment/file prefix, then the operating-company default. Newell's Express defaults unmapped income to `LOCAL_TRUCKING`; every other operating company defaults to `OTHER`. Explicit rules override the default. Higher `priority` wins within a dimension.

## Financial rules

- CAD consolidation is directional management reporting, not a statutory accounting entry.
- Closed months use Bank of Canada monthly average rates; the current month uses an available-to-date average marked `PROVISIONAL`.
- `CustomerRevenueLine` is the immutable transaction-evidence model for both customer-revenue and eligible Newl Worldwide vendor-cost report lines in this phase: each `sourceKey` is based only on the report/realm and stable QuickBooks transaction and transaction-line identifiers. Mutable account names, classifications, and transaction types are evidence, not identity. Re-inserting identical source evidence returns the existing row; changed source evidence under the stable identity stops materialization rather than creating a duplicate or changing either the immutable line or monthly totals. The Bank of Canada CAD management conversion is derived materialization evidence, so a PROVISIONAL-to-FINAL month rollover may rebuild monthly CAD without treating the changed rate/label as changed QuickBooks source evidence or rewriting the line. Vendor evidence has no customer source account and preserves its native amount plus QuickBooks's authoritative CAD home amount before monthly cost aggregation.
- `CustomerMonthlyFinancial` carries a `reconciliationStatus` and open-AR balances (`nativeOpenAr`, `cadOpenAr`); unreconciled periods remain visible as `INCOMPLETE`/`UNRECONCILED` and must not silently update headline totals (computation is a later phase).
- No QuickBooks posting or mutation is performed.

## Financial materialization (CP-PHASE-02B-5)

ADMIN-triggered, GET-only QuickBooks report materialization
(`runFinancialMaterialization` in `actions.ts`, core in
`financial-materialization.ts`, FX helpers in `fx.ts`). The owner-approved
report sources (CP-02B-5-Q1, `PNL_DETAIL_PLUS_AGING`) are the
ProfitAndLossDetail report (customer revenue transaction detail over the
confirmed 24-month window) and the AgedReceivablesDetail report (open accounts
receivable). Source transaction identifiers are preserved in a deterministic
`sourceKey`; re-inserting the same `sourceKey` returns the existing immutable
`CustomerRevenueLine` row rather than rewriting it.

- QuickBooks report sections are traversed recursively (`Rows.Row` under account/customer sections); unreadable or unsupported nested detail stops with `LIMITATION` rather than being treated as an empty report.
- Report pagination is bounded to 100 pages per source and rejects a repeated full page as `LIMITATION`, preventing a provider that ignores paging parameters from looping or accumulating rows indefinitely.
- If the QuickBooks API cannot provide stable customer IDs, stable transaction-line IDs, or the explicit transaction/account classification needed for a
  reliable result, the operating-company section stops with `LIMITATION` and
  reports the limitation instead of silently substituting less accurate data.
- Service lines use the existing `service-lines.ts` precedence and the
  tenant-scoped, active `QuickBooksServiceMappingRule` rows (ITEM, CLASS,
  DEPARTMENT, INCOME_ACCOUNT, FILE_PREFIX). Newell's Express defaults unmapped
  income to `LOCAL_TRUCKING`; every other operating company defaults to
  `OTHER`. The report's `Account`/`Item`/`Class` columns feed the mapping; the
  file number extracted from the transaction-type-specific approved fields
  feeds the `FILE_PREFIX` dimension.
- Transaction currency comes only from the report row, never from `CustomerSourceAccount.currency`. A home-currency row preserves the report `Amount` as both native and home evidence. Foreign **customer revenue** must provide `Currency`, `Foreign Amount`, `Amount` (home/report currency), and `Exchange Rate`; the native-to-home arithmetic is validated before both amounts are preserved. Foreign **vendor cost** follows the separate owner-approved booked-cost path: QuickBooks's `Amount` is authoritative CAD home cost, native evidence is preserved only when supplied, and an exchange rate is neither required nor used to derive or replace the CAD amount. Missing required evidence stops the section with `LIMITATION` instead of inventing values.
- FX follows `fx.ts`: closed months (strictly before the current month) use
  FINAL Bank of Canada monthly average rates; the current month uses an
  available-to-date average marked PROVISIONAL. CAD consolidation is labeled
  directional management reporting, not a statutory accounting entry. A missing
  stored rate, non-Bank-of-Canada source, invalid rate, or status mismatch never invents a conversion: the row is skipped, the month is
  marked `INCOMPLETE`, and the limitation is reported.
- Cost scope follows owner decision CP-02B-5-Q2 and the repository's
  finance-provided account source,
  `reference/FINANCE_FS_GROUPINGS_REFERENCE.md`. nativeCost/nativeGrossProfit
  are limited to Newl Worldwide (legal company Newell's Express Worldwide
  Logistics Ltd). Only documented direct-cost accounts `5014`, `5015`, `5020`,
  `5030`, `5115`, `5205`, `5300`, `5400`, `5401`, and `5590` are eligible;
  arbitrary Expense, Other Expense, and COGS accounts are not admitted.
  The allowlist is matched only to an explicit report account-number field or a
  chart-of-accounts code at the start of the verified Account display name.
  QuickBooks Account ID is an opaque entity identifier and is never interpreted
  as an account number, even when it happens to equal an allowlisted code.
  Customer and vendor invoices are grouped by the shared file number using only
  the owner-approved transaction fields: customer invoices use `Description`
  and `Memo on Statement`; vendor bills use `Description` and `Memo`.
  `Memo/Description`, customer `Memo`, and vendor `Memo on Statement` are not
  association evidence. The approved fields are inspected independently, and a
  row with conflicting file numbers across them fails closed rather than taking
  the first value. All customer invoices on a file must resolve to the same tenant/operating-company
  relationship before any vendor bill is associated. Each vendor cost uses
  QuickBooks's authoritative CAD home amount and authoritative vendor-bill
  month, under `sourceAccountKey = ALL` and the file/account-resolved service
  line. Costs are not proportionally reallocated across customer invoices and
  foreign costs are never independently converted. Newl USA and Newell's
  Express and Warehousing Ltd. keep zero nativeCost/nativeGrossProfit.
- Newl Worldwide gross-profit contributions use one authoritative CAD basis:
  customer revenue contributes QuickBooks's CAD home amount and eligible vendor
  costs subtract QuickBooks's CAD home amount in `ALL`/CAD monthly buckets. The
  native transaction-currency revenue remains in its source-account bucket, so
  USD or other native amounts are never mixed with CAD costs. Vendor costs still
  remain in their authoritative bill month and are not proportionally
  reallocated.
- Revenue/cost classification never uses amount sign. Invoice and Credit Memo
  are the currently recognized income transaction types. An income-bearing row
  with any other transaction type stops with `LIMITATION`; it is never silently
  excluded. `Expense` and `Other Expense` are not treated as globally eligible
  operating costs without an owner-approved account scope.
- Aggregation reuses the existing monthly unique key
  `(tenantId, companyOperatingRelationshipId, sourceAccountKey, serviceLine,
  currency, monthKey)` through `upsertMonthlyFinancial`. Unreconciled periods
  remain `INCOMPLETE` (when any report row for the month was skipped or a
  conversion was unavailable) or `UNRECONCILED`; they are never marked
  `RECONCILED` (reconciliation is a later phase).
- Monthly revenue, cost, and gross profit are rebuilt from all tenant- and
  operating-company-scoped immutable `CustomerRevenueLine` evidence in the
  approved window plus pending inserts while the operating-company lock is
  held. A prior immutable line omitted from a later QuickBooks response remains
  in its authoritative bucket; a wholly omitted prior bucket is recomputed too.
  The rolling fetch window is not a financial-retention or historical-retirement
  rule. Periods outside the requested interval, including an older boundary
  month, are not queried or destructively zeroed merely because the window
  advances. Replacing or retiring those historical totals requires authoritative
  period evidence or a separate explicit owner decision.
  Monthly cent rounding uses the same sign-safe decimal half-up rule as FX, so
  negative half-cent credits round symmetrically. Immutable native, home, and
  CAD amounts are canonicalized to the `CustomerRevenueLine` `Decimal(14,2)`
  precision before persistence, conflict comparison, and aggregation, so a
  repeated higher-precision source amount remains idempotent.
- Finance-reference production follow-ups remain open honestly: confirm whether
  Worldwide `4000` always maps to warehousing, whether `5030` remains trucking,
  and whether grouped-code reporting should be surfaced. These do not expand
  the approved direct-cost account allowlist.
- Open AR from the aging detail snapshot merges into the monthly bucket under
  the `OTHER` service line (open AR is not service-line revenue). The aging
  snapshot's as-of date comes from the report request. A bucket without open AR
  reports `nativeOpenAr`/`cadOpenAr` of zero; only a bucket with native open AR
  and no stored FX rate keeps `cadOpenAr` null. Only the explicit supported
  monetary columns (`Open Balance`, `Total`, `Current`, `1-30`, `31-60`,
  `61-90`, `91+`, and their supported QuickBooks spacing/title variants) are
  accepted; dates, transaction numbers, due dates, and unknown descriptive
  columns are never parsed as money. A layout with no supported monetary column
  stops with `LIMITATION`. A row with neither an open balance nor any supported
  bucket amount has no open-AR evidence and is skipped (an empty bucket sum
  would invent a zero balance).
- A resolved foreign-currency revenue row with no approved FX rate still creates
  or preserves its deterministic monthly-key row as `INCOMPLETE` without
  materializing revenue or a CAD amount. Existing monthly keys for that resolved
  relationship and affected month are also preserved and marked `INCOMPLETE`, so
  an omitted aggregate cannot remain `UNRECONCILED`. A current foreign AR balance lacking an
  approved rate explicitly clears any prior `cadOpenAr` conversion rather than
  presenting stale CAD beside current native AR.
- A foreign revenue line first materialized in the current month keeps its
  immutable QuickBooks source evidence when that month later closes. On a rerun,
  the monthly CAD aggregate is rebuilt with the applicable FINAL Bank of Canada
  rate; the existing `sourceKey` is preserved, no duplicate line is created, and
  the immutable source row is not rewritten merely to replace its prior
  PROVISIONAL management conversion metadata.
- A structurally valid empty revenue report means zero revenue and does not block
  the independent aging snapshot. An aging fetch failure stops the section before
  financial writes. Missing or unmatched aging-row evidence marks the snapshot's
  as-of month `INCOMPLETE`.
- Lifecycle refresh reuses the existing guarded `refreshRelationshipLifecycle`
  action for every affected relationship of the processed operating company, so
  activity under one operating company can never activate another company's
  relationship.
- Each operating company's immutable lines, monthly rows, lifecycle refreshes,
  and required commit audit are written in one transaction under an
  operating-company advisory lock. After acquiring the lock, every pending
  `sourceKey` is re-read and its authoritative immutable fields are compared
  before any revenue-line or monthly write. Concurrent conflicting evidence
  aborts the transaction; identical evidence is preserved, and commit-audit
  created counts come from actual inserts. A later line, monthly, lifecycle, or
  audit failure rolls the whole operating-company result back rather than
  exposing partial totals.
- Customer resolution is tenant-, realm-, and operating-company-scoped and uses
  only an exact stable QuickBooks customer ID tied to a reconciled
  `CustomerSourceAccount`. Display names never resolve identity. A revenue report
  row with only a name stops with `LIMITATION`; missing or unmatched aging IDs
  are not guessed and make the as-of month incomplete.
- A fully parsed and matched aging response is an authoritative replacement
  snapshot for its tenant, operating company, and as-of month. Previously
  positive AR buckets absent from that snapshot are written to zero and their
  relationships are refreshed. If any aging row is partial, unmatched, or fails
  processing, absent balances are not cleared. Every existing tenant- and
  operating-company-scoped financial row for the as-of month is retained with
  its existing revenue and AR values and marked `INCOMPLETE`, including when no
  valid new aging or revenue bucket was produced.
  When a prior row collides with freshly aggregated current-run financial
  evidence, only the prior AR fields are preserved; fresh revenue, cost, gross
  profit, and CAD revenue are retained. A valid matched current aging row keeps
  its newly reported native AR; missing FX leaves its CAD AR explicitly null
  rather than restoring a stale prior conversion.
- Partial or completely missing report rows never invent values; `dryRun`
  performs zero database writes (no revenue lines, no monthly rows, no lifecycle
  refresh, no audits) and returns the would-be report. Every live run writes a
  terminal `AuditLog` (`customer-intelligence.financial-materialization.run`)
  containing counts and classifications only — never customer or transaction
  identifiers, amounts, or provider content. The per-line
  `customer-intelligence.revenue-line.created` audit is sanitized the same way
  (service line, native/home currency, and FX source only). No QuickBooks
  posting or mutation is performed.
- Returned ProfitAndLossDetail rows are independently checked against the same
  inclusive approved 24-month request window. A dated row before the start or
  after the end (including a future provider row) is skipped before identity
  resolution, persistence, monthly aggregation, or lifecycle refresh, and its
  period is reported incomplete. Rows exactly on either boundary are eligible.

## Management reporting (CP-PHASE-02B-6)

Leadership-only (ADMIN/MANAGER/FINANCE via `requireReadAccess`) reporting over
the materialized financials (`reporting-queries.ts`,
`/customer-intelligence/reporting`):

- Every view carries the directional-management-reporting disclosure: CAD
  consolidation is not a statutory accounting entry.
- Current-month reliable activity is displayed month-to-date through the report
  date; applicable current-month CAD conversion is PROVISIONAL. Because
  `CustomerMonthlyFinancial` has no stored materialization FX-status field, a
  closed stored value remains conservatively PROVISIONAL instead of being
  relabeled FINAL from calendar position alone. This phase adds no migration.
- Every displayed non-empty stored CAD **total** carries a conservative
  `PROVISIONAL` aggregate label; an empty total has no label. The current schema
  cannot authoritatively produce `FINAL` or `MIXED` reporting labels, so those
  claims are withheld. The label is rendered on every displayed CAD revenue total: the overview
  headline metric, the operating-company and service-line CAD revenue totals,
  and the operating-company detail CAD revenue metric. Live CAD Open AR uses the
  same conservative evidence rule. Affected totals
  also render the "partial" marker from `cadRevenuePartial`/`cadOpenArPartial`,
  including the overview headline revenue metric.
- Native revenue/cost/gross-profit/open-AR are grouped by transaction currency
  (`nativeByCurrency`) and never summed across unlike currencies; every native
  amount is rendered with its actual currency code. The operating-company detail
  formats monthly native values with the row's `currency` and revenue-line
  native values with the line's `nativeCurrency`, never a CAD fallback. CAD
  columns are the only cross-currency basis and remain consolidated totals.
  Cost and gross profit are exposed in stored native currencies; no CAD cost or
  CAD gross-profit amount is invented because the monthly model has no such fields.
- Revenue-line evidence in the operating-company detail is served in
  deterministic 500-row pages (newest-first by transaction date with the unique
  `id` tiebreak). The query returns the complete tenant-scoped count and page
  metadata, and the page renders the page window plus Previous/Next controls, so
  truncation is always disclosed and a partial evidence set is never mistaken
  for the complete materialized record.
- Headline revenue, cost, and gross-profit totals are period-atomic per operating
  company and month: if any row for one company-period is `INCOMPLETE`, that
  operating company's entire month is excluded while another operating
  company's complete data for the same month remains included. Its rows stay visible
  in detail and the incomplete month/row counts remain explicit, so a
  superficially complete row from a partial period can never silently enter a
  headline figure. Rows with a missing CAD
  conversion keep their CAD value null (never invented); `cadRevenuePartial`
  and `cadOpenArPartial` expose the exact gap on the affected CAD totals (the
  combined `cadValuesPartial` covers either gap), and the pages render a
  "partial" marker instead of presenting a complete-looking total.
- Open AR is the live point-in-time set of invoices still unpaid when the report
  is produced. It is never historical AR and is never summed across months.
  Headline Open AR uses only a snapshot for the report's current calendar month,
  independently for each operating company. That snapshot contributes only if
  it exists and that operating company's whole current snapshot month is
  complete; when it is absent or any row is `INCOMPLETE`, that company's Open AR
  fails closed and is unavailable rather than substituting an older complete
  month. Complete current company snapshots
  remain included and unavailable companies are identified. Its CAD label is
  conservative and never claims final rematerialization from calendar position.
- All seven service lines are always returned by the service-line view so an
  unpopulated line renders an honest zero state. Open AR is materialized under
  `OTHER` and is not attributable to revenue service lines, so service-line AR
  columns are omitted rather than mislabeling a complete company snapshot as an
  incomplete service-line snapshot.
- Reporting is strictly read-only and tenant-scoped; it reads only
  `CustomerMonthlyFinancial`/`CustomerRevenueLine` and never the legacy
  `Cashflow*` tables.
- The "Reporting" navigation entry in `src/components/app-shell.tsx` is
  restricted to ADMIN/MANAGER/FINANCE in the shell (matching
  `requireReadAccess`), so READ_ONLY and other roles that receive the module
  entitlement are never shown a leadership-only route they cannot open.
- The legacy Customer Cashflow UI is superseded per owner decision CP-02B-6-Q1
  (`RETIRE_NAV`) once this reporting is validated as operational; before that
  validation the legacy page and navigation remain in place and are never
  modified.

## Data-retention and privacy

- Extraction observations are retained for 24 months; approved contact facts remain until manually removed (retention scheduling is a later phase).
- Full email bodies, attachments, and unrelated subjects are not stored by Customer Intelligence; only field-level evidence fragments (capped at 240 characters) are retained.
- Signature-derived values may fill missing fields automatically but never overwrite manually entered or approved values; conflicts enter the review queue (enforcement is in the mailbox-sync phase).

## Inferred rules requiring confirmation

- Lifecycle rollup ordering.
- `PROSPECT` precedence when a relationship has no approved mapping even if source accounts exist.
- The exact definition of "compatible normalized name" (token-contained subset is the current implementation).
