# Finance F/S Groupings Reference

This note captures the account grouping structure from the 2025 year-end financial statement grouping PDFs provided on June 26, 2026 so future finance reporting and QuickBooks import work can reuse a stable mapping.

## Source Files

- `F_S Groupings.pdf`
  - Entity: `Newell's Express Worldwide Logistics Ltd.`
  - Created: June 26, 2026 at 5:12 AM EDT
  - Pages: 6
- `F_S Groupings (001).pdf`
  - Entity: `Newell's Express Worldwide Logistics USA Inc.`
  - Created: June 26, 2026 at 5:13 AM EDT
  - Pages: 4

## Why This Matters

- Reporting logic should align to the accounting groupings already used by finance.
- QuickBooks import mapping should preserve raw account detail while also classifying rows into reporting buckets consistent with these grouped statements.
- Newl Worldwide and Newl USA do not use the same account numbering or grouping codes, so reporting should normalize by business meaning rather than by raw account code alone.

## Entity: Newell's Express Worldwide Logistics Ltd.

### Revenue / Income Groupings

- `21.02 Sales`
  - `4000 Storage`
  - `4001 Air Freight`
  - `4002 Ocean Freight`
  - `4003 Trucking`
  - `4004 Warehouse`
  - `4006 Miscellaneous Income`
  - `5315 Exchange Gain or Loss`
  - `5550 Foreign Exchange Gain/Loss`
  - `8000 Income Tax Refund`
- `21.10 Interest income`
  - `70200 Interest Income`

### Cost of Goods Sold / Direct Cost Groupings

- `22.01 Cost of Sales (inventory/purcha...)`
  - `5014 Warehouse Rate`
  - `5015 Trucking Rate`
  - `5020 Ocean Freight Rate`
  - `5030 Delivery Rate`
  - `5115 Warehouse Expense`
  - `5205 Travel Expense`
  - `5300 Air Freight Rate`
  - `5400 Automobile Expense`
  - `5401 Auto Repairs`
  - `5590 Shipping Expense`

### Key Reporting Notes

- Worldwide currently groups transport and warehousing revenue together under `21.02 Sales`, so business-line reporting must be derived from the account or file prefix rather than from the parent grouping alone.
- The direct-cost grouping `22.01` already contains the core business-line rates needed for air, ocean, trucking, and warehousing margin reporting.
- `4000 Storage` and `4004 Warehouse` both point to warehousing-oriented revenue and should be treated as `WAREHOUSING`.
- `4001/5300` support `AIR`, `4002/5020` support `OCEAN`, `4003/5015` support `TRUCKING`, and `4004/5014` support `WAREHOUSING`.
- `5030 Delivery Rate` should roll into `TRUCKING` unless finance later wants a separate last-mile bucket.
- `5315` and `5550` are exchange-related income lines inside the sales grouping. Keep them source-visible and auditable, but do not force them into shipment file matching unless a file number is actually present.

## Entity: Newell's Express Worldwide Logistics USA Inc.

### Revenue / Income Groupings

- `21.01 Air freight income`
  - `4000 Air Freight`
- `21.02 Ocean freight income`
  - `4010 Ocean Freight Income`
- `21.03 Services income`
  - `4020 Services`
- `21.04 Trucking income`
  - `4030 Trucking Income`
- `21.05 Warehousing income`
  - `4040 Warehousing Income`
  - `4041 Warehousing Income:Inbound`
  - `4042 Warehousing Income:Inbound/Outbound`
  - `4043 Warehousing Income:Outbound`
  - `4044 Warehousing Income:Storage`
- `4050 Interest earned`

### Cost of Goods Sold / Direct Cost Groupings

- `22.03 Air freight rate`
  - `6100 Air Freight Rate`
- `22.07 Equipment rentals`
  - `6250 Cost of goods sold:Equipment rental`
- `22.08 Freight`
  - `6245 Freight & Logistics`
- `22.12 Ocean freight rate`
  - `6101 Ocean Freight Rate`
- `22.25 Trucking rate`
  - `6102 Trucking Rate`
- `22.27 Warehouse rate`
  - `6103 WAREHOUSE RATE`

### Key Reporting Notes

- USA already has cleaner business-line segmentation in the grouped statements than Worldwide does.
- Warehousing revenue is materially more detailed in USA and includes inbound, outbound, inbound/outbound, and storage variants under `21.05`.
- USA warehousing operations in Charlotte will often have revenue with no shipment file number and may not have a one-to-one direct COGS match per revenue row.
- `22.07 Equipment rentals` and `22.08 Freight` can support warehousing or handling operations, but should remain source-visible until finance confirms whether they belong in `WAREHOUSING`, `OTHER`, or a more specific operational sub-bucket.

## Cross-Entity Mapping For Newl Apps

Use these normalized business lines for finance module reporting:

- `AIR`
  - Worldwide: `4001`, `5300`
  - USA: `4000`, `6100`
- `OCEAN`
  - Worldwide: `4002`, `5020`
  - USA: `4010`, `6101`
- `TRUCKING`
  - Worldwide: `4003`, `5015`, `5030`
  - USA: `4030`, `6102`
- `WAREHOUSING`
  - Worldwide: `4000`, `4004`, `5014`, `5115`
  - USA: `4040`, `4041`, `4042`, `4043`, `4044`, `6103`
- `OTHER`
  - Service, interest, exchange, tax-refund, and uncategorized support accounts that do not map cleanly to shipment cashflow

## Reporting Rules To Carry Forward

- Preserve raw QuickBooks account names, account numbers, parent grouping codes, and source entity for auditability.
- Normalize reporting by legal entity plus business line, not by raw account number alone.
- File-based exception workflows should focus on transport lines first: air, ocean, and trucking.
- Warehousing should support both file-linked and non-file-linked revenue/cost analysis.
- Interest, FX, refunds, and other non-operating or non-shipment lines should be excluded from shipment matching by default.

## Follow-Up Needed Before Final Production Mapping

- Confirm whether Worldwide `4000 Storage` should always map to `WAREHOUSING`.
- Confirm whether Worldwide `5030 Delivery Rate` should stay inside `TRUCKING` or become a separate delivery/last-mile subtype.
- Confirm whether USA `4020 Services`, `6250 Equipment rental`, and `6245 Freight & Logistics` should map to `OTHER` or into warehousing support reporting.
- Confirm whether finance wants grouped-code reporting such as `21.02`, `22.01`, and `23.xx` surfaced directly in the UI alongside normalized business lines.
