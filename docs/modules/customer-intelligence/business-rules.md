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
- `CustomerRevenueLine` is immutable: re-inserting the same `sourceKey` returns the existing row rather than rewriting it.
- `CustomerMonthlyFinancial` carries a `reconciliationStatus` and open-AR balances (`nativeOpenAr`, `cadOpenAr`); unreconciled periods remain visible as `INCOMPLETE`/`UNRECONCILED` and must not silently update headline totals (computation is a later phase).
- No QuickBooks posting or mutation is performed.

## Data-retention and privacy

- Extraction observations are retained for 24 months; approved contact facts remain until manually removed (retention scheduling is a later phase).
- Full email bodies, attachments, and unrelated subjects are not stored by Customer Intelligence; only field-level evidence fragments (capped at 240 characters) are retained.
- Signature-derived values may fill missing fields automatically but never overwrite manually entered or approved values; conflicts enter the review queue (enforcement is in the mailbox-sync phase).

## Inferred rules requiring confirmation

- Lifecycle rollup ordering.
- `PROSPECT` precedence when a relationship has no approved mapping even if source accounts exist.
- The exact definition of "compatible normalized name" (token-contained subset is the current implementation).
