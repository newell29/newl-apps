# Customer Intelligence: Business Rules

> Evidence status: Confirmed from code for implemented foundation logic. Values and ordering marked Requires employee confirmation are not approved business rules.

## Canonical identity

- The canonical `Company` remains the identity shared by sales, TradeMining, Hunter, contacts, and finance. Customer Intelligence never merges companies by name alone.
- One canonical company may relate to any combination of operating companies (Newl Worldwide, Newl USA, Newell's Express and Warehousing Ltd.).
- Multiple QuickBooks customer records per operating company, including separate CAD/USD accounts, roll up to one canonical profile through `CompanyOperatingRelationship` + `CustomerSourceAccount`.

## Lifecycle

Per operating-company relationship (deterministic in `lifecycle.ts`):

- `PROSPECT`: no approved QuickBooks customer mapping.
- `ACTIVE_CUSTOMER`: recognized revenue or open AR within the trailing 12 months.
- `DORMANT_CUSTOMER`: linked QuickBooks account but no revenue/open AR in 12 months.
- `FORMER_CUSTOMER`: all linked source accounts inactive and no open AR.

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

## Service-line mapping

Seven service lines: Ocean, Air, Trucking/drayage, Local trucking, Warehousing/fulfillment, Customs brokerage, Other.

Mapping precedence (`service-lines.ts`): QuickBooks item, then class/department, then income account, then shipment/file prefix, then the operating-company default. Newell's Express defaults unmapped income to `LOCAL_TRUCKING`; every other operating company defaults to `OTHER`. Explicit rules override the default. Higher `priority` wins within a dimension.

## Financial rules

- CAD consolidation is directional management reporting, not a statutory accounting entry.
- Closed months use Bank of Canada monthly average rates; the current month uses an available-to-date average marked `PROVISIONAL`.
- `CustomerRevenueLine` is immutable: re-inserting the same `sourceKey` returns the existing row rather than rewriting it.
- `CustomerMonthlyFinancial` carries a `reconciliationStatus`; unreconciled periods remain visible as `INCOMPLETE`/`UNRECONCILED` and must not silently update headline totals (computation is a later phase).
- No QuickBooks posting or mutation is performed.

## Data-retention and privacy

- Extraction observations are retained for 24 months; approved contact facts remain until manually removed (retention scheduling is a later phase).
- Full email bodies, attachments, and unrelated subjects are not stored by Customer Intelligence; only field-level evidence fragments (capped at 240 characters) are retained.
- Signature-derived values may fill missing fields automatically but never overwrite manually entered or approved values; conflicts enter the review queue (enforcement is in the mailbox-sync phase).

## Inferred rules requiring confirmation

- Lifecycle rollup ordering.
- `PROSPECT` precedence when a relationship has no approved mapping even if source accounts exist.
- The exact definition of "compatible normalized name" (token-contained subset is the current implementation).
