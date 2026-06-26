# Customer Cashflow & Credit Exposure Notes

## Scope

This module is the first internal Finance workspace for customer cashflow visibility. It is tenant-scoped from the database layer up and uses the platform module entitlement key `CUSTOMER_CASHFLOW`.

## Shared Customer Identity Rules

This finance module must not become a second customer system beside Assistant, Lead Gen, QuickBooks, TMS, WMS, or email ingestion.

The platform direction is:

- one canonical tenant-scoped customer identity
- many source aliases underneath it
- finance is a consumer of that identity, not the owner of a separate one

That means the long-term source model should be:

- canonical customer
- customer aliases / source identities
- canonical contacts
- contact aliases / source identities
- finance profile / credit profile attached to the canonical customer

Finance-specific records such as receivables, invoices, vendor bills, credit settings, and collections workflow should remain finance-owned. Customer identity, duplicate resolution, alias mapping, and contact-role mapping should be shared platform concerns.

## Data Assumptions

- `CashflowCustomer` represents a finance/customer credit profile, not the canonical customer identity for the tenant.
- `CashflowFile` represents an operational shipment/file in the cash conversion cycle.
- `CashflowCustomerInvoice` and `CashflowVendorBill` are import-ready accounting records. They can be linked to files when a file number is available.
- Cashflow records carry a legal entity: `NEWL_WORLDWIDE` or `NEWL_USA`.
- Cashflow records carry a business line: `OCEAN`, `AIR`, `TRUCKING`, `WAREHOUSING`, or `OTHER`.
- Ocean, air, and trucking revenue/COGS should normally be matched by file number.
- Newl USA Charlotte warehousing can have revenue without shipment file numbers and without directly paired COGS per revenue item. These lines should be analyzed as warehouse/customer/period activity instead of file exceptions.
- Newl Worldwide can also have Canadian customer warehousing through third-party warehouses. Those warehouse lines may have vendor COGS, but they should not be forced into shipment-file matching unless a file number is present.
- `CashflowCustomerSnapshot` is reserved for persisted period snapshots. Current dashboard queries calculate from imported/seeded transactional rows so the UI works before a scheduled snapshot job exists.
- Alerts are internal app records only. Email/Slack notifications are intentionally not built yet.

## Identity Alignment Requirements

Before this module is merged, keep these constraints in place:

1. Do not assume `CashflowCustomer.customerName` is globally unique in the real business sense.
2. QuickBooks customer names are source labels, not canonical identities.
3. USD and CAD receivables variants for the same customer must be able to map to one canonical customer.
4. Email names, TMS names, WMS names, and QuickBooks names must all be treated as alias candidates under the same customer.
5. Finance ownership fields such as collections owner are not substitutes for customer contacts.
6. Accounting contacts, AP contacts, AR contacts, operations contacts, warehouse contacts, and sales contacts should all roll up to shared canonical contacts with role classification.

Examples:

- `Acme Inc`
- `Acme Inc - USD`
- `Acme Inc - CAD`
- `ACME USA`
- `Acme Logistics LLC`

may all need to map to one canonical customer if business review confirms they are the same account.

## Merge Guidance For Finance Work

When continuing finance-module implementation, prefer this model:

- shared canonical customer table or shared company/customer identity layer (`Company` today)
- finance profile linked to the canonical customer (`CashflowCustomer.companyId`)
- alias table for QuickBooks/accounting names (`CashflowCustomerAlias`)
- optional finance-specific customer settings attached to the finance profile

Avoid this model:

- treating `CashflowCustomer` as the master customer table for the whole app
- duplicating contact records inside finance
- using raw QuickBooks customer names as the only key for customer matching
- letting one customer become multiple finance customers only because of currency-specific A/R labels

## Contact Mapping Requirements

The memory system and finance workflows should both be able to understand contacts by function. At minimum, contact mapping should support:

- accounting
- accounts payable
- accounts receivable
- collections
- operations
- logistics
- warehousing
- sales
- leadership / executive

If contact data arrives from finance notes, QuickBooks, email, TMS, WMS, or lead-gen enrichment, the target should still be the shared canonical contact graph rather than a finance-only contact list.

## Tenant Safety

- Every cashflow table includes `tenantId`.
- Cross-table relations use tenant-scoped composite keys where business records reference another cashflow record.
- Server pages call `getAuthenticatedContext()` and `requireModule(context, ModuleKey.CUSTOMER_CASHFLOW)`.
- Mutating actions also call `requireMutationAccess()` and then restrict credit settings to `ADMIN`, `MANAGER`, or `FINANCE`.

## Future Accounting Integration

Recommended import sequence:

1. Import or resolve QuickBooks customer names into the shared canonical customer identity layer first.
2. Persist QuickBooks/customer-name variants as aliases or source identities, not as separate canonical customers by default.
3. Link or create the finance profile for the canonical customer.
4. Import Profit & Loss detail rows into `CashflowAccountingLine`, preserving QuickBooks transaction metadata and the raw row payload.
5. Parse file numbers from the QuickBooks description field. Examples observed in the P&L export include `AI532N2`, `AE180N5`, `OI1765N97`, `OE1765N71`, and `TR102N276`.
6. Classify P&L rows by parent section:
   - `Income` rows are customer revenue/customer invoice activity.
   - `Cost of Goods Sold` rows are vendor cost/vendor bill activity.
   - Expense and other sections are kept out of file cashflow rollups unless explicitly mapped later.
7. Assign legal entity from the connected QuickBooks company:
   - Newl Worldwide / Canada transport company -> `NEWL_WORLDWIDE`.
   - Newl USA / Charlotte warehouse company -> `NEWL_USA`.
8. Assign business line:
   - `OI`/`OE` file numbers or ocean freight accounts -> `OCEAN`.
   - `AI`/`AE` file numbers or air freight accounts -> `AIR`.
   - `TR` file numbers, trucking, delivery, drayage, or truck accounts -> `TRUCKING`.
   - Warehouse/storage accounts, class names, or descriptions with no file number -> `WAREHOUSING`.
9. Import customer invoices into `CashflowCustomerInvoice`.
10. Import vendor bills into `CashflowVendorBill`.
11. Link invoices, vendor bills, and accounting lines to `CashflowFile` by parsed file number when the line is ocean, air, or trucking.
12. Create or update file-level status so ocean/air/trucking vendor-cost files with no matching customer revenue/invoice line are visible in the work queue.
13. Keep warehouse lines available for customer/period cashflow reporting without creating false missing-file exceptions.
14. Persist periodic `CashflowCustomerSnapshot` rows for week-over-week exposure trend alerts.

## F/S Groupings Reference

Finance provided grouped financial statement source docs for both Newl Worldwide and Newl USA on June 26, 2026. Use [reference/FINANCE_FS_GROUPINGS_REFERENCE.md](/Users/alexnewell/Developer/newl-apps/reference/FINANCE_FS_GROUPINGS_REFERENCE.md) as the working reference for:

- grouped income and direct-cost account mappings by legal entity
- cross-entity normalization into `AIR`, `OCEAN`, `TRUCKING`, `WAREHOUSING`, and `OTHER`
- reporting treatment for warehousing, interest, FX, service, and support accounts

This reference should inform future QuickBooks import classification and finance reporting work, but raw source account metadata must still be preserved on imported records for auditability.

Do not use global QuickBooks credentials for production. Store credentials through tenant-scoped encrypted integration configuration before enabling live imports.

## Implementation Reminder For Future Codex Work

If you are extending the finance module:

- check whether the customer/contact data should live in shared platform identity instead of finance tables
- reuse shared customer aliases rather than adding another name-variant field unless there is a finance-only reason
- prefer linking finance records to canonical customers and canonical contacts
- keep QuickBooks import logic source-aware and auditable
- do not introduce a second dedupe engine only for finance

## QuickBooks API Onboarding Checklist

When live QuickBooks import work starts, collect these items through a secure channel or app configuration flow. Do not paste secrets into source code or commit them.

- QuickBooks company ID / Realm ID.
- Which Newl entity the QuickBooks connection represents: Newl Worldwide or Newl USA.
- Intuit app Client ID.
- Intuit app Client Secret.
- OAuth redirect URI approved in the Intuit developer app.
- Environment: sandbox or production.
- Initial OAuth authorization code or connected-account authorization flow access.
- Refresh token storage location, preferably tenant-scoped encrypted credential storage.
- Accounting basis/report settings for P&L detail: accrual vs cash, date range, currency/home currency handling.
- Account mapping confirmation for income and COGS accounts by business line, especially:
  - Air: `4001 Air Freight`, `5300 Air Freight Rate`.
  - Ocean: `4002 Ocean Freight`, `5020 Ocean Freight Rate`.
  - Trucking: `4003 Trucking`, `5015 Trucking Rate`, `5030 Delivery Rate`.
  - Warehousing: `4004 Warehouse`, `5014 Warehouse Rate`, storage/warehouse accounts.
- Warehouse account/class mapping for Newl USA Charlotte warehousing and Newl Worldwide third-party warehouse activity.
- Confirmation of all active file prefixes beyond `AI`, `AE`, `OI`, `OE`, `TR`, and `WH`.

## Current Mock Data

The local seed creates Detroit Axle as the primary example of a profitable account with high working-capital usage:

- vendor payment trigger: port arrival
- customer billing trigger: delivery
- payment terms: 45 days
- alert threshold: 80%
- management review over credit limit

The seed also includes a healthy customer and a mapping-review customer to exercise the risk-tier and data-cleanup paths.
