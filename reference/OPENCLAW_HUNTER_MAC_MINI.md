# Hunter TradeMining Collector on the Mac Mini

Draft operator guide for moving the existing TradeMining CSV collector from the VM to Alex's Mac Mini as the first dedicated sales agent, **Hunter**.

## Current status

- Newl Apps already owns tenant-scoped search profiles, ingestion, candidate review, Pipeline, contacts, cadence selection, job logs, and audit state.
- TradeMining remains the external source and its browser session is human-authenticated.
- The legacy collector source was copied from the VM without credentials, exports, logs, or OpenClaw runtime state and reviewed on July 21, 2026.
- The local Newl Apps database can be migrated and seeded for synthetic end-to-end testing.
- A Mac-compatible Hunter exporter, summary builder, Newl Apps ingestion adapter, run-request worker, `launchd` template, and installer live under `ops/openclaw/`.

## Ownership boundary

Hunter is a replaceable collector, not the sales system of record.

1. Hunter reads the current enabled search profiles from Newl Apps through the ingestion API on every worker cycle and rechecks a profile immediately before it starts. Deleted or disabled profiles are not searched.
2. After the profile's configured local daily time, Hunter searches its full profile-level lookback window, downloads the resulting CSV, normalizes rows, and posts a tenant-bound batch. The run starts as one logical query and is adaptively split only when TradeMining reports more than 25,000 exportable results.
3. Newl Apps validates the ingestion token and tenant slug, stores the raw record and normalized company evidence, and records a job run.
4. Employees review Found Companies and approve accounts into Pipeline.
5. Newl Apps owns Apollo contact selection, cadence mapping, approval, push, verification, and audit history.

Hunter must not store Apollo credentials or enroll contacts directly.

The opt-in company-research phase may store a dedicated local Brave search key and Kimi key in
Hunter's protected `0600` environment. It never sends either value to Newl Apps or writes the values
to a run ledger. Local Qwen remains on loopback. The optional GPT-5.6 Luna comparison reuses
`OPENAI_API_KEY` only inside Newl Apps; do not add that key or the Luna feature flag to the Mac
environment.

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
- a dedicated clean, detached `origin/main` checkout at `~/Developer/newl-apps-hunter-runtime`, separate from every Codex development branch;
- TradeMining browser/session material stored outside the repository and never copied into OpenClaw memory;
- CSV exports written to a Hunter runtime directory, deleted or archived according to an owner-approved retention policy;
- no Apollo key and no direct customer communication capability.

Recommended environment names:

```dotenv
NEWL_APPS_BASE_URL=https://the-reviewed-preview.vercel.app
INGESTION_API_TOKEN=<dedicated Hunter token>
INGESTION_TENANT_SLUG=newl-group
HUNTER_WORKER_ID=alex-mac-mini-hunter
HUNTER_EXPORT_DIRECTORY=/path/to/runtime/exports
HUNTER_HTTP_MAX_ATTEMPTS=4
HUNTER_TRADEMINING_MAX_EXPORT_ROWS=25000
VERCEL_AUTOMATION_BYPASS_SECRET=<dedicated Preview automation bypass>
HUNTER_DAILY_RUN_TIME=04:00
HUNTER_POLL_MS=60000
```

Do not reuse the Teamship worker token, Nemo's OpenClaw identity, or a production database credential.

The checked-in template is `ops/openclaw/hunter/.env.example`. Store the real file at `~/.openclaw/agents/hunter/.env` with mode `600`; never commit it. `HUNTER_TRADEMINING_PORTS_JSON` contains TradeMining lookup IDs, not passwords. Hunter has a checked-in canonical map for the supported U.S. arrival ports and treats this environment value as an override or extension. Common short aliases resolve to canonical names before lookup.

## Checked-in runtime

- `ops/openclaw/hunter/trademining_export.py`: login, form search, official XLSX export, CSV conversion, and sanitized manifest.
- `ops/openclaw/hunter/trademining_summary.py`: canonical record conversion and deduplication.
- `ops/openclaw/hunter/hunter_ingest.py`: tenant-bound job creation, batched ingestion, completion/failure reporting.
- `ops/openclaw/hunter/hunter_worker.py`: live active-profile lookup, manual run-request polling, once-daily eligibility, per-profile lookback/port planning, collection, and ingestion coordination.
- `ops/openclaw/hunter/hunter_company_research.py`: bounded evidence retrieval, tenant-bound Luna synthesis,
  local Qwen 3.6 availability recovery, Kimi scoring, replay ledger generation, and tenant-bound completion
  reporting. It has no Apollo or outreach integration.
- `ops/openclaw/hunter/hunter_signal_scout.py`: bounded Brave discovery, rotating allowlisted
  topic/geography queries, 180-day canonical-URL suppression, local Qwen first-pass classification, and
  tenant-bound provisional-company reporting. It has no Apollo or outreach integration.
- Each enabled profile begins with one full-lookback TradeMining BOL query. Optional destination ports use TradeMining's U.S.-port multi-select field; leaving them empty omits that field. Origin countries and foreign ports are resolved through its lookup service; ship-from ports and product keywords use Boolean `OR`; HS codes use TradeMining's comma-separated format; and `minShipmentVolume` is treated as minimum TEUs per BOL.
- When the reported count exceeds 25,000, Hunter splits the date range into disjoint halves. A capped one-day query with multiple arrival ports is split into port groups. If a one-day one-port/no-port query is still capped, Hunter retains the available export and reports incomplete coverage instead of silently truncating it.
- `minAggregateTeu` and industry-pack modes are evaluated in Newl Apps over the company's matched-profile evidence. They do not change the TradeMining form post.
- Profile destination markets are hard consignee filters. Canadian profiles must use province values such as `Ontario | Canada`; legacy Canadian city values fail closed. Hunter resolves the province with Canada's TradeMining country ID and posts `ConsigneeCountryOfOrigin` plus `ConsigneeState`, without a Canadian city lookup. Other cities require an exact TradeMining label, and unresolved alternatives remain together in one Boolean consignee-address expression.
- `ops/openclaw/run-hunter-worker.sh`: allowlisted environment loader.
- `ops/openclaw/install-hunter-worker.sh`: LaunchAgent renderer and installer. It fetches `origin/main` into a dedicated detached runtime worktree, refuses local runtime changes, and points both the service runner and working directory at that worktree.
- `ops/openclaw/launchd/com.newl.hunter-worker.plist.template`: persistent Mac Mini service.

`HUNTER_REPO_PATH` is retired. The runner always resolves `hunter_worker.py` from its own dedicated checkout, so changing branches in a development checkout cannot alter the live process. Re-running the installer is the explicit update mechanism: it refreshes the runtime to the latest reviewed `origin/main` revision and restarts the service.

Company research stays disabled until its reviewed code reaches the dedicated runtime checkout and
the following local-only values are configured:

```text
HUNTER_SIGNAL_SCOUT_ENABLED=true
HUNTER_SIGNAL_SCOUT_DAILY_TIME=02:30
HUNTER_SIGNAL_SCOUT_TIMEZONE=America/Toronto
HUNTER_CLASSIFICATION_MODEL=qwen3.6:27b-q4_K_M
HUNTER_CLASSIFICATION_BATCH_SIZE=6
HUNTER_COMPANY_RESEARCH_ENABLED=false
HUNTER_COMPANY_RESEARCH_DAILY_TIME=05:45
HUNTER_COMPANY_RESEARCH_TIMEZONE=America/Toronto
HUNTER_RESEARCH_SEARCH_PROVIDER=BRAVE
HUNTER_BRAVE_SEARCH_API_KEY=<dedicated read-only search key>
HUNTER_RESEARCH_LUNA_MAX_ATTEMPTS=3
HUNTER_RESEARCH_QWEN_MODEL=qwen3.6:27b-q4_K_M
HUNTER_RESEARCH_QWEN_SHADOW_ENABLED=false
HUNTER_RESEARCH_QWEN_FALLBACK_ENABLED=true
HUNTER_KIMI_API_KEY=<dedicated Kimi key>
HUNTER_KIMI_BASE_URL=https://api.moonshot.ai/v1
HUNTER_KIMI_MODEL=kimi-k2.6
HUNTER_KIMI_VALIDATOR_MODEL=kimi-k3
HUNTER_RESEARCH_K3_VALIDATOR_LIMIT=5
HUNTER_RESEARCH_K3_REASONING_EFFORT=LOW
```

Luna primary synthesis is enabled only in the deployed Newl Apps environment:

```text
HUNTER_COMPANY_RESEARCH_LUNA_SHADOW_ENABLED=true
```

It does not trigger a second Brave search. The dependency-safe company
research run sends each completed public-evidence packet to the tenant-scoped Newl Apps synthesis route.
Luna remains primary; Qwen 3.6 processes only still-missing rows after bounded Luna retries unless a comparison shadow is explicitly enabled. Teams reports Luna coverage, Qwen recovery, Kimi omissions, and final cohort counts.

Before enabling the schedule, replay a reviewed cohort:

```bash
python3 ops/openclaw/hunter/hunter_worker.py \
  --company-research-dry-run \
  --company-research-cohort /absolute/path/to/company-cohort.json \
  --company-research-output /absolute/path/to/research-ledger.json
```

If Kimi is unavailable after retrieval/Luna, the output is a redacted `SYNTHESIS_COMPLETE`
checkpoint. Resume only against a newly prepared identical tenant cohort:

```bash
python3 ops/openclaw/hunter/hunter_worker.py \
  --company-research-now \
  --company-research-cohort /absolute/path/to/company-cohort.json \
  --company-research-resume /absolute/path/to/research-ledger.json \
  --company-research-output /absolute/path/to/research-ledger.json
```

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

- Every enabled profile is eligible once per local calendar day after 04:00 by default. `scheduleMetadata.preferredRunHourLocal` can override the hour for an existing profile, while `HUNTER_DAILY_RUN_TIME` controls the fallback. Company research becomes eligible at 05:45 but waits until every enabled profile has finished or failed for that local date.
- The profile's `lookbackWindowDays` is the actual TradeMining date range. It remains one logical daily run even when the 25,000-row export ceiling requires physical subqueries.
- Found Companies counts shipment evidence from the matched profile inside that profile's lookback and excludes companies below `minShipmentCount`, below optional `minAggregateTeu`, or outside a hard/exclude industry rule.
- The Search Profiles screen shows TradeMining matches, exported records, qualifying companies, physical query count, and completeness from the latest run.
- New and edited profiles persist the legacy database frequency field as `daily` for compatibility, but frequency is no longer an operator option or a worker decision.
- Deleting a profile cancels queued or running manual requests, and Hunter rechecks the live enabled list before a search. An HTTP export already in flight may finish its current request, but it cannot start a later daily run from cached profile data.

## Business questions requiring confirmation

- How long should Hunter retain downloaded TradeMining CSV files?
- Who receives failure alerts when TradeMining login expires or an export returns no records?
- Should a capped one-day, one-port/no-port profile be narrowed manually, or should Hunter gain another deterministic split dimension after observing a real occurrence?
