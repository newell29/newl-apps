# Migration Plan

This plan migrates the current OpenClaw, Google Sheets, Apollo, and TradeMining workflow into Newl Apps.

## Phase 1: Inventory And Freeze

- Snapshot the current Google Sheet to CSV/XLSX.
- Snapshot local processed CSVs and manifests from the TradeMining archive.
- Record active crontab and OpenClaw cron state.
- Store Apollo sequence and custom field mappings as tenant-scoped integration configuration with secret values redacted.
- Do not disable legacy automation until the new jobs are ready to run in parallel.

## Phase 2: Database Bootstrap

- Create the first tenant record for Newl Group.
- Import processed `trade_mining_raw_bol_canonical.csv` history.
- Import `company_shipment_summary.csv`.
- Import `company_identity_summary.csv`.
- Import current `company_pipeline`.
- Import `apollo_contacts`.
- Import exclusions, sequence mappings, user mappings, and pipeline controls.

## Phase 3: Reconciliation

- Compare database counts against latest processed manifests and Sheet row counts.
- Validate raw BOL duplicate removal.
- Validate top candidates and scores against current CSV/Sheet output.
- Validate Apollo contact rows by record key and contact key.
- Validate blocked statuses such as missing email and missing full name.

## Phase 4: Parallel Run

- Run the new TradeMining import in dry-run or parallel mode for at least one week.
- Compare raw row counts, dedupe counts, summary counts, identity counts, and top scored candidates.
- Run Apollo company/contact matching in dry-run against a small approved set.
- Keep sequence push disabled until approval workflows and tenant-safe writes are validated.

## Phase 5: Cutover

- Disable current crontab entries or switch them to read-only/export mode.
- Enable the Newl Apps scheduler for daily TradeMining refresh and pipeline refresh.
- Move approvals from Google Sheets into Newl Apps.
- Keep Google Sheets export read-only during transition if needed.
- Enable Apollo sequence push behind an explicit admin gate.

## Phase 6: Decommission And Cleanup

- Archive local scripts and n8n workflows as reference.
- Rotate secrets that existed in local files.
- Remove hardcoded external IDs from source code.
- Document operational runbooks.

## Non-Negotiables

- Preserve tenant isolation in all migrated tables.
- Keep Newl Group as seeded tenant data, not hardcoded application logic.
- Keep legacy identifiers as external references, not primary domain IDs.
- Maintain audit trails for approvals, external API writes, sequence pushes, and data imports.
