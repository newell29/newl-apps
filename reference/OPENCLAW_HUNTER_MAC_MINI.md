# Hunter TradeMining Collector on the Mac Mini

Draft operator guide for moving the existing TradeMining CSV collector from the VM to Alex's Mac Mini as the first dedicated sales agent, **Hunter**.

## Current status

- Newl Apps already owns tenant-scoped search profiles, ingestion, candidate review, Pipeline, contacts, cadence selection, job logs, and audit state.
- TradeMining remains the external source and its browser session is human-authenticated.
- The legacy collector source was copied from the VM without credentials, exports, logs, or OpenClaw runtime state and reviewed on July 21, 2026.
- The local Newl Apps database can be migrated and seeded for synthetic end-to-end testing.
- A Mac-compatible Hunter exporter, summary builder, Newl Apps ingestion adapter, run-request worker, `launchd` template, and installer now live under `ops/openclaw/` on the Hunter feature branch.

## Ownership boundary

Hunter is a replaceable collector, not the sales system of record.

1. Hunter reads the current enabled search profiles from Newl Apps through the ingestion API on every worker cycle and rechecks a profile immediately before it starts. Deleted or disabled profiles are not searched.
2. After the profile's configured local daily time, Hunter searches its full profile-level lookback window, downloads the resulting CSV, normalizes rows, and posts a tenant-bound batch. Large lookbacks are split into smaller TradeMining requests without shortening the requested window.
3. Newl Apps validates the ingestion token and tenant slug, stores the raw record and normalized company evidence, and records a job run.
4. Employees review Found Companies and approve accounts into Pipeline.
5. Newl Apps owns Apollo contact selection, cadence mapping, approval, push, verification, and audit history.

Hunter must not store Apollo credentials or enroll contacts directly.

## Safe VM source transfer

Run this from the Mac Mini, not from inside the VM shell:

```bash
mkdir -p /private/tmp/hunter-vm-source
rsync -av \
  --exclude='.env*' \
  --exclude='.secrets/' \
  --exclude='data/' \
  --exclude='logs/' \
  --exclude='openclaw.json' \
  openclaw@100.120.250.105:/home/openclaw/.openclaw/workspace/n8n-workflows/newl-trade-mining-apollo/ \
  /private/tmp/hunter-vm-source/
```

The reviewed VM source contained `trademining_phase0_runner.py`, `trademining_build_summary.py`, `sheet_control_worker.py`, Google Sheets upload helpers, Apollo helpers, and the VM Operations Control Center reporter.

Only the TradeMining exporter and canonical summary logic were carried forward. Hunter does **not** include the legacy Google Sheets control plane, hard-coded spreadsheet ID, hard-coded Apollo cadence IDs, default rep, Apollo credentials, or VM Operations Control Center paths. Newl Apps replaces those responsibilities.

## Mac Mini runtime design

Follow the existing Teamship worker pattern:

- separate OpenClaw identity named `hunter`;
- dedicated workspace and logs, separate from Nemo;
- outbound-only HTTPS to Newl Apps;
- a dedicated ingestion token bound to the Newl Group tenant slug;
- a `launchd` service with `RunAtLoad`, `KeepAlive`, throttling, and persistent sanitized logs;
- TradeMining browser/session material stored outside the repository and never copied into OpenClaw memory;
- CSV exports written to a Hunter runtime directory, deleted or archived according to an owner-approved retention policy;
- no Apollo key and no direct customer communication capability.

Recommended environment names:

```dotenv
NEWL_APPS_BASE_URL=https://the-reviewed-preview.vercel.app
INGESTION_API_TOKEN=<dedicated Hunter token>
INGESTION_TENANT_SLUG=newl-group
HUNTER_WORKER_ID=alex-mac-mini-hunter
HUNTER_COLLECTOR_PATH=/path/to/reviewed/collector
HUNTER_EXPORT_DIRECTORY=/path/to/runtime/exports
HUNTER_HTTP_MAX_ATTEMPTS=4
VERCEL_AUTOMATION_BYPASS_SECRET=<dedicated Preview automation bypass>
HUNTER_DAILY_RUN_TIME=07:00
HUNTER_POLL_MS=60000
```

Do not reuse the Teamship worker token, Nemo's OpenClaw identity, or a production database credential.

The checked-in template is `ops/openclaw/hunter/.env.example`. Store the real file at `~/.openclaw/agents/hunter/.env` with mode `600`; never commit it. `HUNTER_TRADEMINING_PORTS_JSON` contains TradeMining lookup IDs, not passwords, and should map the exact destination-port names returned by Newl Apps to their TradeMining IDs.

## Checked-in runtime

- `ops/openclaw/hunter/trademining_export.py`: login, form search, official XLSX export, CSV conversion, and sanitized manifest.
- `ops/openclaw/hunter/trademining_summary.py`: canonical record conversion and deduplication.
- `ops/openclaw/hunter/hunter_ingest.py`: tenant-bound job creation, batched ingestion, completion/failure reporting.
- `ops/openclaw/hunter/hunter_worker.py`: live active-profile lookup, manual run-request polling, once-daily eligibility, per-profile lookback/port planning, collection, and ingestion coordination.
- Each enabled profile produces one full-lookback TradeMining BOL query. Destination ports use TradeMining's multi-select field; origin countries and foreign ports are resolved through its lookup service; ship-from ports, product keywords, and HS codes use Boolean `OR`; and `minShipmentVolume` is treated as minimum TEUs per BOL.
- `ops/openclaw/run-hunter-worker.sh`: allowlisted environment loader.
- `ops/openclaw/install-hunter-worker.sh`: LaunchAgent renderer and installer.
- `ops/openclaw/launchd/com.newl.hunter-worker.plist.template`: persistent Mac Mini service.

Manual profile planning does not log in or export:

```bash
python3 ops/openclaw/hunter/hunter_worker.py \
  --plan \
  --profile-name "Charlotte Warehouse Leads"
```

For a controlled live validation, `--test-days 1` may be combined with an explicit profile and `--end-date`. The job metadata records both the one-day query and the profile's configured lookback; the stored profile is not changed.

Install only after the reviewed Preview URL, dedicated ingestion token, TradeMining credentials, runtime directories, and port map are in Hunter's local environment file:

```bash
ops/openclaw/install-hunter-worker.sh \
  --base-url https://the-reviewed-preview.vercel.app
```

Verify it:

```bash
launchctl print gui/$(id -u)/com.newl.hunter-worker
tail -n 20 ~/Library/Logs/newl-apps/hunter-worker.out.log
tail -n 20 ~/Library/Logs/newl-apps/hunter-worker.err.log
```

## Cutover checklist

1. Copy and review the VM collector source using the safe transfer above.
2. Inventory Python/Node/browser dependencies and pin their versions.
3. Replace embedded URLs, tenant identifiers, and filesystem paths with allowlisted environment variables.
4. Point Hunter at a reviewed Vercel Preview and a dedicated preview ingestion token.
5. Run one profile with a narrow date range and retain the job ID, record counts, and sanitized log output.
6. Confirm the candidate in Found Companies, approve it into Pipeline, and advance one stage.
7. Stop the VM scheduler but keep its files intact for rollback.
8. Start the Mac `launchd` service and observe at least one daily run. Confirm that every enabled profile uses its own lookback and that a deleted test profile is not picked up on the next cycle.
9. Promote the service to the production Newl Apps URL only after human review.

Do not run the VM and Mac schedulers concurrently against the same profile during cutover; ingestion keys are designed to deduplicate records, but duplicate exports and job noise would make verification ambiguous.

## Validation performed on July 21, 2026

- A live TradeMining keyword search returned current shipment results and exposed the expected Excel export action.
- A synthetic local batch completed through the real ingestion routes, appeared in Found Companies, moved New → Reviewing → Approved, entered Pipeline, and advanced to Researching.
- A human-approved contact push through Newl Apps was accepted by Apollo and independently verified as active in the selected cadence.
- The same run exposed a Newl Apps sequence-status parsing defect for Apollo's `contact_campaign_statuses` response; a regression fix is prepared on the Hunter feature branch.
- Hunter's new ingestion adapter posted a synthetic canonical CSV through the local tenant-bound routes: one record processed and created with no skips.
- Hunter's profile planner resolves all three Charlotte destination ports and both Houston-profile ports. TradeMining identifies the Houston seaport as `1382` and Freeport, Texas as `1385`; the local profile label `Houston, Texas` is an explicit alias for the seaport ID.
- A controlled one-day Charlotte profile run submitted one live TradeMining query containing all three destination ports, configured origin countries/ports, ship-from ports, product keywords, comma-separated HS codes, and `TEU >= 10`. It returned zero matching BOLs and completed the local Newl Apps job successfully with zero records while preserving the profile's configured 120-day lookback.
- The live test confirmed two TradeMining vocabulary/format requirements: canonical profile value `Busan` must resolve to lookup label `Pusan`, and multiple HS codes must be comma-separated rather than joined with Boolean `OR`.
- A controlled one-day Charlotte run exported 1,163 shipment rows from the three configured ports. Hunter quarantined 66 rows that lacked every company identity field, submitted 1,097 valid rows to the local database, created 1,034 records, and counted 63 API-level duplicates/skips. The local job completed successfully.
- The first live batch exposed a mismatch between the legacy summary output and Newl Apps validation: shipment-only rows without an importer, consignee, notify party, or shipper cannot become company candidates. Hunter now rejects and counts those rows before upload instead of failing the whole batch.
- A controlled one-day Houston run exported 716 rows from Houston and zero from Freeport for the selected date. Hunter quarantined 68 identity-free rows, submitted 648 valid rows to the local database, created 627 records, and counted 21 API-level duplicates/skips. The local job completed successfully.
- The production Charlotte Warehouse Leads profile is enabled and saved as daily in `America/Toronto`, with a 120-day lookback, minimum shipment count 2, and Charleston, Wilmington, and Savannah coverage. The existing editor had stored each `City, State` port as two legacy values; the worker now recombines those pairs and the editor preserves canonical comma-bearing locations on future saves.

## Confirmed daily profile rules

- Every enabled profile is eligible once per local calendar day after 07:00 by default. `scheduleMetadata.preferredRunHourLocal` can override the hour for an existing profile, while `HUNTER_DAILY_RUN_TIME` controls the fallback.
- The profile's `lookbackWindowDays` is the actual TradeMining date range, and the normal daily path submits it as one query for the whole profile.
- Found Companies counts shipment evidence from the matched profile inside that profile's lookback and excludes companies below its `minShipmentCount`.
- New and edited profiles persist the legacy database frequency field as `daily` for compatibility, but frequency is no longer an operator option or a worker decision.
- Deleting a profile cancels queued or running manual requests, and Hunter rechecks the live enabled list before a search. An HTTP export already in flight may finish its current request, but it cannot start a later daily run from cached profile data.

## Business questions requiring confirmation

- How long should Hunter retain downloaded TradeMining CSV files?
- Who receives failure alerts when TradeMining login expires or an export returns no records?
