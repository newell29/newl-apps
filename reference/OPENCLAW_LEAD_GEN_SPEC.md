# OpenClaw Lead Generation Workflow Rebuild Specification

Generated: 2026-06-10

Security note: this document intentionally redacts secrets and sensitive external identifiers. Environment variable names, tab names, column names, workflow names, and local file paths are preserved because they are required for implementation. Values such as API keys, tokens, service account private keys, Google Sheet IDs, Apollo sequence IDs, Apollo custom field IDs, passwords, and webhook tokens are represented with placeholders.

## 1. Executive Summary

The current OpenClaw lead generation workflow sources ocean import Bill of Lading data from TradeMining, normalizes it into company-level opportunity signals for NEWL Group, publishes a filtered candidate feed into Google Sheets, lets sales/ops users approve companies and contacts through Sheet controls, uses Apollo for company/contact search and sequence enrollment, and uses OpenClaw/Codex for orchestration, review, reporting, and selected automation tasks.

The production Newl Apps rebuild should replace Google Sheets as the system of record with a Prisma/PostgreSQL-backed, multi-tenant application. TradeMining BOL records, company identities, lane summaries, pipeline lifecycle, Apollo matches, contacts, scoring, sequence approvals, sequence pushes, and run logs should become database entities with explicit audit trails. Google Sheets can remain an optional export/review surface during migration, but not the canonical state layer.

The current implementation is a hybrid:

- Local Python scripts under `/home/openclaw/.openclaw/workspace/n8n-workflows/newl-trade-mining-apollo/scripts/`.
- Google Sheets as the operational UI and lifecycle store.
- Apollo API for company search, people search, enrichment/match, contact creation/update, custom fields, and sequence enrollment.
- TradeMining website form posts and Excel export, not a public API.
- OpenClaw cron/system crontab for automation triggers.
- n8n workflow JSON and Markdown docs as earlier design artifacts; current behavior is mostly in Python.

## 2. What The Current Workflow Does End-To-End

1. A scheduled TradeMining job logs into TradeMining using `TRADEMINING_USER` and `TRADEMINING_PASSWORD`.
2. It runs BOL import searches for five Southeast ports:
   - Charleston, South Carolina
   - Savannah, Georgia
   - Area Port of Jacksonville, Florida
   - Wilmington, North Carolina
   - Norfolk-Newport News, Virginia
3. It pulls a trailing seven-day BOL window daily, exports official TradeMining Excel files, converts them to CSV, and archives both formats under `data/trademining/raw/YYYY-MM-DD/`.
4. A summary builder reads the rolling raw archive, filters to a 90-day lookback, deduplicates overlapping daily pulls by `raw_record_key`, writes canonical raw BOL rows, role/lane summaries, and company identity summaries under `data/trademining/processed/YYYY-MM-DD/`.
5. A Sheet control worker pushes a filtered `company_identity_summary` feed into Google Sheets using `overall_priority_score >= 35` and a control-defined row limit.
6. The worker refreshes existing `company_pipeline` rows with current TradeMining metrics while preserving lifecycle fields.
7. Sales/ops users interact with Google Sheets:
   - approve companies for Apollo,
   - choose sequence owners,
   - approve contacts for sequence push,
   - toggle `pipeline_controls` flags.
8. Every five minutes, `sheet_control_worker.py` reads `pipeline_controls`.
9. If requested, it:
   - refreshes the identity feed from CSV,
   - adds or refreshes `company_pipeline`,
   - runs Apollo company/contact search for approved companies,
   - writes contacts to `apollo_contacts`,
   - creates/updates Apollo contacts,
   - maps NEWL custom fields,
   - enrolls approved contacts in Apollo sequences.
10. Tier 1 contacts receive locally generated draft subject/body copy. Tier 2 and Tier 3 rely more on Apollo-side templates/personalization.
11. Logs are written to local log files and best-effort Operations Control Center reporting is attempted.

## 3. Files/Configs Involved And What Each Appears To Do

Primary implementation paths:

- `/home/openclaw/.openclaw/workspace/n8n-workflows/newl-trade-mining-apollo/README.md`: module overview, guardrails, recommended Sheet tabs.
- `/home/openclaw/.openclaw/workspace/n8n-workflows/newl-trade-mining-apollo/phase-0-runner.md`: documents TradeMining runner commands, daily schedule, storage layout, and scoring output.
- `/home/openclaw/.openclaw/workspace/n8n-workflows/newl-trade-mining-apollo/phase-0-trademining-reporting.md`: detailed BOL intake/reporting strategy and data layers.
- `/home/openclaw/.openclaw/workspace/n8n-workflows/newl-trade-mining-apollo/phase-0-sheet-schemas.md`: tab schemas for raw BOL, shipment summary, identity summary, and company pipeline.
- `/home/openclaw/.openclaw/workspace/n8n-workflows/newl-trade-mining-apollo/company-pipeline-lifecycle.md`: lifecycle states, active queue rules, refresh/requeue logic.
- `/home/openclaw/.openclaw/workspace/n8n-workflows/newl-trade-mining-apollo/module-1-intake-normalization.md`: early n8n design for CSV/Sheet normalization.
- `/home/openclaw/.openclaw/workspace/n8n-workflows/newl-trade-mining-apollo/module-2-apollo-company-contact-search.md`: early Apollo search design.
- `/home/openclaw/.openclaw/workspace/n8n-workflows/newl-trade-mining-apollo/module-3-openai-fit-personalization.md`: early OpenAI scoring design.
- `/home/openclaw/.openclaw/workspace/n8n-workflows/newl-trade-mining-apollo/apollo-sequence-setup.md`: Apollo sequence tiers, Sheet approval flow, custom fields, and sequence setup notes.
- `/home/openclaw/.openclaw/workspace/n8n-workflows/newl-trade-mining-apollo/newl-apollo-cadence-copy.md`: Apollo email/task cadence copy and personalization tags.
- `/home/openclaw/.openclaw/workspace/n8n-workflows/newl-trade-mining-apollo/implementation-checklist.md`: original n8n build checklist and guardrails.
- `/home/openclaw/.openclaw/workspace/n8n-workflows/newl-trade-mining-apollo/*.workflow.json`: n8n workflow designs/dry runs, including initializer, queue refresh, Sheets updater, Apollo search, and opportunity scoring dry run.

Current Python scripts:

- `trademining_phase0_runner.py`: TradeMining login, search, Excel export, XLSX-to-CSV conversion, raw manifest writing.
- `trademining_build_summary.py`: canonical raw BOL conversion, dedupe, role/lane summary, identity summary, scoring.
- `push_phase0_identity_preview_to_sheets.py`: older direct Google Sheets publisher that clears/writes `company_identity_summary`.
- `run_apollo_preview_to_sheets.py`: older capped Apollo preview that writes `apollo_contacts`; useful for logic reference, but superseded by `sheet_control_worker.py`.
- `sheet_control_worker.py`: current Sheet-controlled operational worker for identity refresh, pipeline refresh, Apollo batch, contact scoring, sequence mapping, contact creation/update, and sequence enrollment.
- `apollo_master_setup_check.py`: Apollo setup validation utility.
- `occ_reporter.py`: best-effort Operations Control Center reporting wrapper.

Local data:

- `/home/openclaw/.openclaw/workspace/data/trademining/raw/YYYY-MM-DD/`: archived official TradeMining XLSX exports, converted CSVs, and manifest.
- `/home/openclaw/.openclaw/workspace/data/trademining/processed/YYYY-MM-DD/`: generated `trade_mining_raw_bol_canonical.csv`, `company_shipment_summary.csv`, `company_identity_summary.csv`, and manifest.

Logs:

- `/home/openclaw/.openclaw/workspace/logs/newl_morning_trademining_refresh.log`: daily TradeMining refresh output.
- `/home/openclaw/.openclaw/workspace/logs/newl_sheet_control_worker.log`: five-minute Sheet control worker output.

Secrets/config:

- `/home/openclaw/.env`: env var source. Do not copy values.
- `/home/openclaw/.secrets/google-sheets-service-account.json`: Google service account JSON. Required keys include `type`, `project_id`, `private_key_id`, `private_key`, `client_email`, `client_id`, auth/token cert URLs, and `universe_domain`.
- `/home/openclaw/.openclaw/openclaw.json`: OpenClaw local gateway, agents, plugins, Teams channel, browser, and model defaults. Contains sensitive tokens/passwords; do not reuse raw values.
- `/home/openclaw/.codex/config.toml`: Codex trust/model UI config for `/home/openclaw`.

## 4. OpenClaw Automation/Config Structure

OpenClaw is installed under `/home/openclaw/.openclaw/` with workspace `/home/openclaw/.openclaw/workspace`.

Important structure:

- Agents default workspace: `/home/openclaw/.openclaw/workspace`.
- Primary OpenClaw model default: `openai/gpt-5.4-mini`.
- Additional configured alias: `openai/gpt-5.5`.
- Gateway mode: local loopback.
- Gateway port: `18789`.
- Gateway auth in config currently shows local/no-auth style settings with token fields present; for production, require authenticated, least-privilege access and do not run unauthenticated even on loopback if exposed through a proxy.
- Enabled plugins include OpenAI, Codex, Microsoft Teams, and DuckDuckGo.
- Browser automation exists but TradeMining runner intentionally avoids browser automation by using form posts/cookies.
- OpenClaw cron contains a disabled TradeMining job. Active TradeMining execution has moved to system crontab.

OpenClaw cron jobs discovered:

- `NEWL TradeMining Phase 0 Southeast reports`: disabled. Its description says it was disabled on 2026-06-02 because production morning refresh now runs from system crontab with `sheet_control_worker.py --morning-refresh`.
- SEO and weekly Apollo review jobs are present but not core to the ingestion/pipeline flow.

System crontab discovered:

```text
*/5 * * * * cd /home/openclaw/.openclaw/workspace && flock sheet_control_worker.py
30 11 * * * cd /home/openclaw/.openclaw/workspace && flock trademining_phase0_runner.py && trademining_build_summary.py && sheet_control_worker.py --morning-refresh
```

The exact commands use `/usr/bin/flock` lock files under `/tmp` and append output to the two log files listed above.

## 5. Google Sheets Integration Details

Current Sheets integration uses the Google Sheets v4 REST API directly, not a Google client library.

Auth:

- Service account JSON loaded from `GOOGLE_APPLICATION_CREDENTIALS`.
- JWT assertion signed with `private_key`.
- OAuth scope: `https://www.googleapis.com/auth/spreadsheets`.
- Token endpoint from service account JSON.

Workbook:

- Spreadsheet ID is configured by `NEWL_TRADE_MINING_SPREADSHEET_ID`.
- Actual value is redacted as `GOOGLE_SHEETS_ID`.
- Older docs also refer to `NEWL_PROSPECTING_SHEET_ID`; current scripts use `NEWL_TRADE_MINING_SPREADSHEET_ID`.

Read/write patterns:

- `read_sheet()` reads a range with `majorDimension=ROWS`, `valueRenderOption=UNFORMATTED_VALUE`, and `dateTimeRenderOption=FORMATTED_STRING`.
- `write_values()` uses `values:batchUpdate` with `valueInputOption=RAW`.
- Some publisher scripts clear whole ranges (`A:ZZ`) and rewrite entire tabs.
- `sheet_control_worker.py` rewrites `company_pipeline!A2:BN...` and `apollo_contacts!A2:AR...` after processing.
- `push_phase0_identity_preview_to_sheets.py` clears and rewrites `company_identity_summary`.

Production rebuild implications:

- Replace whole-sheet rewrites with transactional DB updates.
- Keep Sheet import/export as a compatibility layer only.
- Use database constraints for uniqueness and lifecycle immutability instead of relying on row order/ranges.

## 6. Google Sheets IDs, Sheet Names, Tabs, Columns

Sensitive IDs:

- Google Sheet ID: `GOOGLE_SHEETS_ID`.
- Google service account client email/project ID/private key values: `GOOGLE_SERVICE_ACCOUNT_JSON`.

Core tabs:

- `company_identity_summary`
- `company_pipeline`
- `apollo_contacts`
- `pipeline_controls`
- `apollo_user_mapping`
- `apollo_sequence_mapping`
- `opportunity_scoring`
- `outreach_assets`
- `exclusion_list`
- `run_log`
- Earlier docs also mention `trade_mining_raw`, `trade_mining_raw_bol`, `company_shipment_summary`, `company_review`, and `company_approved`.

`trade_mining_raw_bol` columns:

```text
raw_record_key, source_system, source_report_name, source_saved_search_id,
source_port, source_file_name, source_file_date, ingested_at, arrival_date,
house_bol_number, master_bol_number, container_number, bill_type,
importer_name, consignee_name, master_consignee_name, notify_party,
shipper_name, master_shipper_name, arrival_port, foreign_port,
place_of_receipt, destination_city, destination_state, destination_zip,
origin_country, product_description, hs_code, container_count, teu, weight,
quantity, carrier, vessel, voyage, raw_json
```

`company_shipment_summary` columns:

```text
company_identity_key, company_summary_key, company_match_name, source_role,
latest_company_name, arrival_port, arrival_ports_seen, foreign_ports_seen,
places_of_receipt_seen, origin_countries_seen, destination_state,
destination_city_latest, destination_cities_seen, destination_states_seen,
first_seen_date, last_seen_date, seen_count, shipment_count_7d,
shipment_count_30d, shipment_count_prev_30d, shipment_count_90d, teu_30d,
teu_prev_30d, weight_30d, weight_prev_30d, mom_shipment_growth_pct,
mom_teu_growth_pct, latest_products, latest_hs_codes, latest_origin_countries,
raw_evidence_count, trend_score, fit_score, overall_priority_score,
score_reason, apollo_status, apollo_last_checked_at, apollo_next_check_at,
apollo_organization_id, apollo_domain, apollo_contact_count, updated_at
```

`company_identity_summary` columns:

```text
company_identity_key, company_match_name, best_company_name,
best_company_summary_key, best_source_role, best_arrival_port,
best_destination_state, best_destination_city, first_seen_date,
last_seen_date, role_count, roles_seen, ports_seen, arrival_ports_seen,
foreign_ports_seen, places_of_receipt_seen, origin_countries_seen,
destination_cities_seen, destination_states_seen, summary_row_count,
shipment_count_7d, shipment_count_30d, shipment_count_prev_30d,
shipment_count_90d, teu_30d, teu_prev_30d, mom_shipment_growth_pct,
mom_teu_growth_pct, best_trend_score, best_fit_score,
overall_priority_score, score_reason, apollo_status, apollo_last_checked_at,
apollo_next_check_at, apollo_organization_id, apollo_domain,
apollo_contact_count, updated_at
```

`company_pipeline` base columns:

```text
company_identity_key, company_match_name, best_company_name,
best_company_summary_key, best_source_role, best_arrival_port,
best_destination_state, best_destination_city, first_seen_date,
last_seen_date, role_count, roles_seen, ports_seen, arrival_ports_seen,
foreign_ports_seen, places_of_receipt_seen, origin_countries_seen,
destination_cities_seen, destination_states_seen, summary_row_count,
shipment_count_7d, shipment_count_30d, shipment_count_prev_30d,
shipment_count_90d, teu_30d, teu_prev_30d, mom_shipment_growth_pct,
mom_teu_growth_pct, best_trend_score, best_fit_score,
overall_priority_score, score_reason, pipeline_status, review_status,
active_queue_status, active_queue_entered_at, active_queue_exited_at,
approved_for_apollo, apollo_status, apollo_last_checked_at,
apollo_next_check_at, apollo_organization_id, apollo_domain,
apollo_contact_count, opportunity_status, last_opportunity_fit_score,
outreach_status, sequence_status, owner, priority_override, manual_hold,
do_not_prospect, do_not_prospect_reason, last_material_change_at,
last_processed_at, next_action_at, notes, created_at, updated_at
```

The worker also expects additional company classification columns such as:

```text
company_type, company_type_confidence, company_type_source, classification_notes
```

`apollo_contacts` columns:

```text
record_key, company_match_key, apollo_organization_id, apollo_company_name,
apollo_domain, match_confidence, first_name, last_name, full_name, title,
linkedin_url, city, state, country, email_status, contact_relevance_score,
contact_relevance_reason, recommended_next_step, enrollment_status,
created_at, updated_at, contact_record_status, contact_record_status_reason,
company_opportunity_score, sequence_tier, cadence_recommendation,
sequence_reason, rep_approved_for_sequence, email_draft_status,
email_subject_draft, email_body_draft, apollo_sequence_push_status,
sequence_owner_name, sequence_owner_user_id, sequence_send_from_email,
sequence_send_from_email_account_id, apollo_sequence_id,
apollo_sequence_name, apollo_contact_id, apollo_sequence_enrolled_at,
apollo_sequence_status, apollo_sequence_push_message, email, apollo_person_id
```

`pipeline_controls` appears to use at least:

```text
control, value, request_more_identity_companies, refresh_company_pipeline,
run_apollo_batch, run_sequence_push, refresh_status,
last_refresh_requested_at, last_refresh_completed_at, last_refresh_message,
identity_summary_target_limit, companies_to_add_limit, min_priority_score,
apollo_min_match_quality, sequence_push_initial_status,
openai_bulk_classifier_model, openai_opportunity_scoring_model,
openai_tier2_personalization_model, openai_tier1_draft_model,
openai_weekly_review_model, openai_strategy_model, openai_transcription_model,
openai_diarized_transcription_model, openai_use_batch_for_bulk,
openai_prompt_cache_policy
```

`apollo_user_mapping` appears to use:

```text
sequence_owner_name, active, apollo_user_id, send_from_email,
send_from_email_account_id
```

## 7. Apollo Integration Details

Environment:

- Search/basic key: `APOLLO_API_KEY`.
- Master/setup key: `APOLLO_MASTER_API`.
- Login credentials for browser/UI work: `APOLLO_USERNAME`, `APOLLO_PASSWORD`.

Current code chooses `APOLLO_MASTER_API` first, then falls back to `APOLLO_API_KEY` for worker actions.

Apollo endpoints used:

```text
POST https://api.apollo.io/api/v1/mixed_companies/search
POST https://api.apollo.io/api/v1/mixed_people/api_search
POST https://api.apollo.io/api/v1/people/match
GET/PATCH/POST https://api.apollo.io/api/v1/contacts
POST https://api.apollo.io/api/v1/contacts/search
GET https://api.apollo.io/api/v1/typed_custom_fields
POST https://api.apollo.io/api/v1/emailer_campaigns/{APOLLO_SEQUENCE_ID}/add_contact_ids
```

Apollo headers:

```text
Content-Type: application/json
accept: application/json
x-api-key: APOLLO_API_KEY or APOLLO_MASTER_API
```

Company search:

- Uses domain when available: `q_organization_domains`.
- Also searches by `best_company_name`, `company_match_name`, and `company_identity_key`.
- Collects `accounts`, `organizations`, and `companies` response arrays.
- Dedupes organizations by organization ID, name, and domain.
- Scores by token name similarity, domain presence, organization ID presence, logistics-provider penalty, and branch/location penalty.
- Classifies matches as `direct_company`, `match_quality_review`, `logistics_provider`, or `no_match`.

People search:

- Primary search by organization/domain plus supply-chain/logistics titles.
- If no primary contacts, fallback search by executive/operations leadership titles.
- Enriches each search result with `people/match`.
- Rejects enriched people whose current organization no longer matches the expected Apollo organization.
- Requires first and last name or a full name with at least two tokens.
- Dedupes people by LinkedIn URL, Apollo ID, or name/title.

Contact create/update:

- Searches existing Apollo contacts before creating new ones.
- Dedupe signals: email, Apollo person ID, LinkedIn URL, name/company/title similarity.
- Refuses to create a new Apollo contact if the Sheet row lacks email.
- Updates typed custom fields and labels contacts as `NEWL TradeMining Apollo`.

Sequence enrollment:

- Requires `rep_approved_for_sequence = yes`.
- Requires `apollo_sequence_id`, `sequence_send_from_email_account_id`, and `sequence_owner_user_id`.
- Tier 1 additionally requires `email_subject_draft` and `email_body_draft`.
- Uses Apollo campaign add-contact endpoint with initial status from `pipeline_controls.sequence_push_initial_status`, defaulting to `active`.
- Sets flags to allow no-email/unverified-email/ownership/same-company cases, but local worker still blocks missing email before create/push.

Sensitive Apollo IDs:

- Sequence IDs are present in local docs/code but should be treated as `APOLLO_SEQUENCE_ID_TIER_1`, `APOLLO_SEQUENCE_ID_TIER_2`, and `APOLLO_SEQUENCE_ID_TIER_3`.
- Apollo custom field IDs are present in local docs but should be treated as `APOLLO_CUSTOM_FIELD_ID_*`.

## 8. TradeMining/Import Data Flow

TradeMining has no direct API in the current setup. The runner uses website form posts:

- Base URL: `https://www.trademining.com`.
- Login page: `/Account/LogIn`.
- Login POST: `/Account/Login`.
- Import search page: `/ImportSearch`.
- Import search POST: `/ImportSearch/Data`.
- Excel export: `/ImportSearch/ExportToExcel/{search_log_id}`.

Search options:

- BOL Import Search.
- Bill types: House and Straight included.
- Container load/flag: All.
- Destination: all destinations; Southeast fit is applied after ingestion.
- Rollup type: None, because BOL detail is required.
- US port selected per port lookup ID.

Initial ports:

```text
charleston -> Charleston, South Carolina -> TRADEMINING_PORT_ID_CHARLESTON
savannah -> Savannah, Georgia -> TRADEMINING_PORT_ID_SAVANNAH
jacksonville -> Area Port of Jacksonville, Florida -> TRADEMINING_PORT_ID_JACKSONVILLE
wilmington-nc -> Wilmington, North Carolina -> TRADEMINING_PORT_ID_WILMINGTON_NC
norfolk -> Norfolk-Newport News, Virginia -> TRADEMINING_PORT_ID_NORFOLK
```

Later expansion ports documented:

- Miami Seaport, Florida
- Port Everglades/Fort Lauderdale, Florida
- Area Port of Tampa, Florida
- Port Manatee, Florida

Raw archive:

- Official XLSX preserved.
- Converted CSV preserved.
- Manifest preserves run date, date window, port keys/names, redacted saved search/search log IDs, file paths, and row counts.

## 9. Data Import/Export Process

Raw import:

1. Pull XLSX per port/window.
2. Convert first worksheet to CSV.
3. Detect header row containing `Country Of Origin` and `Consignee Name`.
4. Normalize Excel date serials in `Arrival Date`.
5. Archive XLSX and CSV.

Canonical conversion:

1. Read each run manifest.
2. Iterate raw CSV rows.
3. Map TradeMining export headers into canonical BOL fields.
4. Build `raw_record_key`.
5. For rolling summaries, scan all raw run directories within the 90-day window.
6. Filter rows by arrival date.
7. Deduplicate by `raw_record_key`.
8. Build `company_shipment_summary`.
9. Build `company_identity_summary`.
10. Write processed CSVs and a processed manifest.

Google Sheets export:

- `company_identity_summary` is cleared and rewritten from processed CSV.
- `company_pipeline` is refreshed/rewritten from existing Sheet state plus identity rows.
- `apollo_contacts` is rewritten after merge.
- Full raw BOL and shipment summaries are currently kept local; docs describe pushing them to Sheets eventually, but the operational worker primarily handles identity/pipeline/contact tabs.

Recent observed 2026-06-10 processed counts:

```text
raw_rows_before_dedupe: 212190
duplicate_raw_rows_removed: 150366
raw_rows: 61824
summary_rows: 78881
identity_rows: 43353
qualified_identity_rows_available at score >= 35: 17469
identity_rows_written to Sheet by morning refresh: 575
pipeline rows observed before/after refresh: 544
```

## 10. Company Normalization Logic

Company normalization is implemented in both early n8n snippets and Python scripts.

Core normalization:

- Trim and collapse whitespace.
- Lowercase.
- Replace `&` with `and`.
- Remove punctuation and non-alphanumeric characters except spaces/hyphens.
- Remove legal suffixes:
  - incorporated
  - inc
  - llc
  - ltd
  - limited
  - corp
  - corporation
  - co
  - company
  - plc
  - sa / s a
  - gmbh
  - ag
  - bv
  - usa / u s a
  - us / u s
  - dba in the worker
- Remove filler words such as `the` and `and`.
- Collapse whitespace again.

Roles considered from canonical BOL rows:

- `consignee_name`
- `notify_party`
- `master_consignee_name`
- `shipper_name`
- `master_shipper_name`

The early docs also mention `importer_name`, but in the canonical builder `importer_name` is currently populated from Consignee Name and the role summary uses the role fields above.

Company identity:

- `company_identity_key` is currently the normalized company match name.
- This is simple and explainable but can merge unrelated companies with identical normalized names and does not distinguish parent/subsidiary/domain/location.

## 11. Company Deduplication Logic

Raw BOL dedupe:

- `raw_record_key = sha1(arrival_date, house_bol_number, master_bol_number, container_number, consignee_name, shipper_name, product_description)[:16]`.
- Overlapping daily seven-day pulls are expected.
- The builder keeps the first row per `raw_record_key` within the 90-day scoring window.

Role/lane summary dedupe:

- `company_summary_key = company_match_name | source_role | arrival_port | destination_state`.
- One summary row per normalized company/role/arrival-port/destination-state.

Company identity dedupe:

- Buckets all summaries by `company_identity_key`.
- Picks the best summary by `overall_priority_score` then `shipment_count_30d`.
- Aggregates roles, ports, foreign ports, places of receipt, origin countries, destination cities/states, shipment counts, TEU, and growth.

Pipeline dedupe:

- `company_identity_key` is the primary pipeline key.
- Existing pipeline rows are keyed by lowercase `company_identity_key`.
- The refresh process preserves lifecycle fields for existing rows and only updates mutable feed fields.
- Duplicate identity keys are counted and skipped.

Contact dedupe:

- Sheet contact merge key:
  - `linkedin:{linkedin_url}` when present.
  - otherwise `name:{full_name}|company:{company_match_key}`.
- Apollo contact dedupe:
  - exact email,
  - Apollo person ID,
  - LinkedIn URL,
  - name/company/title similarity.

## 12. Lead Scoring / ICP Qualification Logic

There are three scoring layers: TradeMining priority, company opportunity score, and contact/sequence tier.

### TradeMining trend score

For each company role/lane summary:

```text
40 if current 30d shipments >= previous 30d * 2 and current 30d >= 3
25 if current 30d shipments >= previous 30d * 1.5 and current 30d >= 3
10 if current 30d shipments > previous 30d
5 if current 30d > 0 and first_seen_date within 30 days
0 otherwise
+5 if TEU current 30d > TEU previous 30d and current TEU > 0
```

### TradeMining fit score

Role base scores:

```text
consignee_name: 20
notify_party: 18
master_consignee_name: 14
shipper_name: 5
master_shipper_name: 3
```

Geographic boosts:

```text
+10 for destination state in North Carolina, South Carolina, Georgia, Tennessee, Virginia
+10 for destination city in Charlotte, Concord, Gastonia, Huntersville, Rock Hill, Fort Mill
```

`overall_priority_score = trend_score + fit_score`.

Candidate gate:

```text
overall_priority_score >= 35
```

### Company opportunity score

`sheet_control_worker.py` calculates a 0-100 score:

- Activity: up to 30 points based on `shipment_count_30d`, `shipment_count_90d`, and `teu_30d`.
- Growth: up to 15 points based on month-over-month shipment growth.
- Fit: up to 25 points based on `best_fit_score`, consignee role, Southeast state, and non-logistics-company status.
- Confidence: up to 20 points based on Apollo match quality, domain, direct-company classification, with penalties for logistics/no-match/branch indicators.
- Priority: up to 10 points from `overall_priority_score` or priority override.

### Module 3 dry-run opportunity scoring

An n8n dry-run workflow has an alternative weighted score:

```text
import_volume_score * 0.22
growth_signal_score * 0.12
southeast_relevance_score * 0.16
charlotte_relevance_score * 0.14
commodity_fit_score * 0.10
apollo_match_score * 0.10
contact_coverage_score * 0.08
decision_maker_score * 0.08
- risk_penalty
```

Fit bands:

```text
>= 90 high_value
>= 70 good_fit
>= 50 nurture
< 50 hold
```

This dry-run did not write to Sheets and should be treated as design reference, not the active production path.

## 13. Contact Enrichment Logic

Search flow:

1. Search Apollo company/org by domain if present.
2. Search by `best_company_name`, `company_match_name`, and `company_identity_key`.
3. Score/select best organization.
4. Search people by domain and/or organization ID with primary title keywords.
5. If no primary results, search fallback executive/ops titles.
6. Enrich people with `people/match`.
7. Reject enriched person if current organization does not match expected Apollo org by ID or high name similarity.
8. Require first and last name.
9. Build contact rows with score, recommended sequence tier, owner mapping, and sequence fields.
10. For sequence push, find existing Apollo contact or create/update contact.
11. Apply NEWL typed custom fields.
12. Enroll approved contact into the mapped Apollo sequence.

Email handling:

- People search may return email; if missing, contact rows can be created in Sheets but sequence push blocks.
- Existing Apollo contact lookup may recover email from an existing Apollo contact.
- New contact creation is refused when no email is present to avoid no-email duplicates.

## 14. Contact Title/Seniority Filters

Primary accepted title keywords:

```text
logistics, supply chain, operations, warehouse, fulfillment, transportation,
distribution, import, procurement, purchasing, sourcing, materials, inventory,
demand planning
```

Fallback accepted title keywords:

```text
ceo, chief executive officer, president, owner, founder, coo,
chief operating officer, vp operations, vp of operations,
vice president operations, vice president of operations,
director operations, director of operations, head of operations,
general manager
```

Excluded title keywords:

```text
accounting, customer service, finance, human resources, hr,
information technology, it, legal, marketing, sales, software
```

Exception:

- Titles containing `sales and operations` or `operations and sales` are not excluded just because they include sales.

Contact relevance scoring:

- Primary role title hit: +38.
- Fallback executive/ops hit: +30.
- Seniority:
  - chief/CEO/COO/owner/founder/president: +20
  - VP/vice president: +18
  - director/head: +16
  - manager: +11
- Functional confirmation:
  - operations/supply chain/logistics/procurement/purchasing/distribution: +15
  - fallback hit only: +8
- LinkedIn URL: +5.
- Title and name: +3.
- Location present: +2.
- Apollo org ID: +5.
- Apollo domain: +5.
- Excluded title: score forced to 0.

## 15. Email/Outreach/Campaign Logic

Sequence tiers:

- `tier_1_strong_fit_custom`
  - Cadence: `strong_fit_custom_email_cadence`.
  - Requires company score >= 75, match quality >= 75, contact score >= 75, and primary supply-chain/logistics role.
  - Requires custom draft subject/body before push.
  - Includes custom email, LinkedIn task, calls, follow-up, and breakup/value email.
- `tier_2_ai_personalized`
  - Cadence: `apollo_ai_personalized_cadence`.
  - Requires company score >= 60, match quality >= 70, contact score >= 55.
  - Uses Apollo AI personalization with NEWL custom fields.
- `tier_3_email_only`
  - Cadence: `email_only_light_touch_cadence`.
  - Requires company score >= 40, match quality >= 60, contact score >= 40.
  - Email-only/light-touch sequence.
- `manual_review` or `no_sequence`
  - Used when scores/classification block automated cadence recommendation.

Current Apollo sequence IDs are redacted:

```text
tier_1_strong_fit_custom -> APOLLO_SEQUENCE_ID_TIER_1
tier_2_ai_personalized -> APOLLO_SEQUENCE_ID_TIER_2
tier_3_email_only -> APOLLO_SEQUENCE_ID_TIER_3
```

Tier 1 draft generation:

- Subject: `{Company} import activity`.
- Body references:
  - recent import shipment count,
  - arrival port,
  - destination city/state,
  - contact role,
  - NEWL support for international freight, port moves, warehousing, and final-mile delivery.
- HTML uses compact `<br><br>` formatting.

Apollo custom fields:

- `NEWL Company Opportunity Score`
- `NEWL Contact Relevance Score`
- `NEWL Sequence Tier`
- `NEWL Cadence Recommendation`
- `NEWL Sequence Reason`
- `NEWL TradeMining Score Reason`
- `NEWL Shipment Count 30d`
- `NEWL Shipment Count 90d`
- `NEWL TEU 30d`
- `NEWL Arrival Port`
- `NEWL Destination City`
- `NEWL Destination State`
- `NEWL Origin Countries`
- `NEWL Apollo Match Confidence`
- `NEWL Apollo Domain`
- `NEWL Email Subject Draft`
- `NEWL Email Body Draft`

Email signature behavior:

- Apollo-side `include_signature` is disabled in sequence emails.
- CodeTwo may add server-side signatures after send.
- If no delivered signature is desired, a CodeTwo suppression keyword/exception must be configured before adding a suppression keyword to Apollo copy.

## 16. Sales Pipeline/Status Fields

Pipeline statuses documented/used:

```text
qualified
active_queue
needs_review
approved_for_apollo
apollo_lookup_in_progress
apollo_complete
apollo_no_match
apollo_no_contacts
apollo_no_relevant_contacts
opportunity_scoring_ready
scored
outreach_copy_ready
outreach_ready_for_review
approved_for_sequence
in_sequence
active_calling
meeting_booked
opportunity_created
customer
nurture
disqualified
do_not_prospect
```

New row defaults:

```text
pipeline_status = active_queue
review_status = needs_review
active_queue_status = active
approved_for_apollo = no
apollo_status = not_started
opportunity_status = not_started
outreach_status = not_started
sequence_status = not_started
manual_hold = no
do_not_prospect = no, unless logistics provider classification
```

Statuses excluded from active queue:

```text
apollo_complete, apollo_no_match, apollo_no_contacts,
apollo_no_relevant_contacts, opportunity_scoring_ready, scored,
outreach_copy_ready, outreach_ready_for_review, approved_for_sequence,
in_sequence, active_calling, meeting_booked, opportunity_created, customer,
nurture, disqualified, do_not_prospect
```

Apollo status outcomes:

- `apollo_complete`: exits active queue, contacts found, ready for review/sequence workflow.
- `apollo_no_match`: exits active queue, needs manual match review.
- `apollo_no_relevant_contacts`: exits active queue, no acceptable complete contacts.
- `match_quality_review`: stays needs review when Apollo match quality is below threshold.
- `do_not_prospect`: logistics provider or otherwise excluded.
- `error`: processing error retained in notes.

Contact statuses:

- `ready_for_rep_review`
- `manual_review`
- `blocked_missing_full_name`
- `blocked_missing_email`
- `ready_for_rep_approval`
- `not_ready`
- `pushed`
- `error`

## 17. Environment Variable Names Required

Names only:

```text
SEMRUSH_USER
SEMRUSH_PASSWORD
TRADEMINING_USER
TRADEMINING_PASSWORD
N8N_API_KEY
N8N_API_URL
APOLLO_API_KEY
APOLLO_MASTER_API
APOLLO_USERNAME
APOLLO_PASSWORD
GOOGLE_APPLICATION_CREDENTIALS
NEWL_TRADE_MINING_SPREADSHEET_ID
NEWL_PROSPECTING_SHEET_ID
OPENAI_API_KEY
WORDPRESS_USER
WORDPRESS_PASSWORD
OPENCLAW_AGENT_RUN_TOKEN
```

`NEWL_PROSPECTING_SHEET_ID` appears in early n8n docs; current scripts use `NEWL_TRADE_MINING_SPREADSHEET_ID`.

## 18. Background Jobs, Scheduled Tasks, Automation Triggers

Active system crontab:

- Every five minutes:
  - Run `sheet_control_worker.py`.
  - Reads `pipeline_controls`.
  - Executes requested identity refresh, pipeline refresh, Apollo batch, or sequence push.
  - Uses `flock` to prevent overlap.
  - Logs to `logs/newl_sheet_control_worker.log`.

- Daily at 11:30 UTC:
  - Run `trademining_phase0_runner.py --ports all --days 7`.
  - Run `trademining_build_summary.py --raw-root data/trademining/raw --lookback-days 90`.
  - Run `sheet_control_worker.py --morning-refresh`.
  - Uses `flock` to prevent overlap.
  - Logs to `logs/newl_morning_trademining_refresh.log`.

OpenClaw cron:

- Contains a disabled TradeMining Phase 0 job with the older flow.
- Contains a weekly Apollo cadence/cold-call performance review job.
- Contains unrelated SEO jobs.

Control triggers:

- `pipeline_controls.request_more_identity_companies = yes`.
- `pipeline_controls.refresh_company_pipeline = yes`.
- `pipeline_controls.run_apollo_batch = yes`.
- `pipeline_controls.run_sequence_push = yes`.
- `--morning-refresh` forces identity refresh and pipeline refresh but does not add new pipeline rows and does not run Apollo/sequence actions.

## 19. Hardcoded Assumptions

- TradeMining website form structure remains stable.
- TradeMining XLSX export stays a ZIP/XLSX with a first worksheet and recognizable header row.
- Header detection depends on `Country Of Origin` and `Consignee Name`.
- Search log ID can be parsed from the result page with `value=(digits) id="Id"`.
- The active ports and TradeMining port lookup IDs are hardcoded in `trademining_phase0_runner.py`.
- The raw archive path is local filesystem state.
- The processed latest CSV is selected by lexicographic sort of `data/trademining/processed/*/company_identity_summary.csv`.
- Company identity key is the normalized company name.
- `company_identity_summary` and `company_pipeline` live in a specific Google Sheet.
- Sheet ranges are hardcoded:
  - `company_pipeline!A1:BN`
  - `apollo_contacts!A1:AR`
  - `pipeline_controls!A1:F`
  - `company_identity_summary!A1:AM`
  - `apollo_user_mapping!A1:Z`
- Some scripts include a default spreadsheet ID in code; production should remove this.
- Apollo sequence IDs are hardcoded in the worker.
- Default sequence owner is `Zalan Riaz`.
- Tier 1 threshold was lowered from 80 to 75 on 2026-06-02.
- Logistics provider exclusion is keyword based.
- Branch/location review is keyword based.
- Morning refresh refreshes existing rows only and does not add new pipeline rows.
- Apollo search is run for approved rows where `approved_for_apollo = yes` and `apollo_status` is empty or `not_started`.
- Apollo sequence push can be triggered from Sheets and is capable of enrolling contacts when approvals and mappings are present.

## 20. Bugs, Risks, Or Messy Areas

Security risks:

- Secrets exist in local config files. Production should move secrets to a managed secret store.
- OpenClaw config includes local gateway settings and sensitive channel credentials. Do not reuse raw values.
- Some scripts contain default sensitive IDs directly in source; replace with env-only config.
- Apollo sequence IDs and custom field IDs are hardcoded.
- Service account has broad spreadsheet scope; restrict to exact workbook/service needs where possible.

Data integrity risks:

- Google Sheets is the lifecycle database; whole-range writes can race with manual edits.
- Worker rewrites large ranges and may overwrite concurrent user edits.
- No row-level transaction or optimistic locking.
- `company_identity_key` as normalized name can over-merge or under-merge companies.
- Branches, warehouses, parent/subsidiaries, freight forwarders, and distributors can be misclassified by keyword logic.
- `raw_record_key` hash may collide in edge cases or fail to distinguish split/partial shipments if the selected fields are identical.
- Local archive is the source of truth; no managed backup/retention policy is evident from inspected files.
- Morning refresh currently wrote 575 identity rows despite docs mentioning historical 500-row caps; the limit is Sheet-control driven and may drift.

Operational risks:

- TradeMining form scraping can break if site markup changes.
- TradeMining credentials/cookie flow can fail and block daily import.
- `crontab -l` initially required elevated access, indicating environment permission quirks.
- OCC reporter logs connection refused warnings when local OCC is down.
- Sequence push logs showed recent errors for approved records; root cause should be investigated before migrating live push behavior.
- Apollo APIs may have rate limits; current worker processes all eligible rows in one run without robust backoff beyond exceptions.
- Contact enrichment can consume Apollo credits or trigger paid enrichment depending on Apollo plan behavior; the code calls `people/match`.
- Docs say no paid enrichment unless approved, while worker does enrichment/match for contact completeness. Clarify cost semantics.

Product/design risks:

- n8n docs are partly stale relative to `sheet_control_worker.py`.
- Opportunity scoring docs mention OpenAI structured scoring, but active worker uses deterministic scoring and Tier 1 local template drafting.
- `run_log` is documented but current Python logs mostly write local files/control messages, not necessarily a robust run-log tab.
- Sheet user controls are flexible but not strongly validated.

## 21. What Should Be Reused In The New App

Reuse the following logic, with tests:

- TradeMining field mapping into canonical BOL rows.
- XLSX-to-CSV conversion approach, unless replaced with a better XLSX parser.
- Raw BOL dedupe concept by stable shipment/BOL identity.
- Company normalization as a baseline, but enhance it.
- Role/lane summary concept.
- Identity summary concept.
- Trend score and fit score as initial explainable signals.
- Company opportunity score components.
- Primary/fallback/excluded contact title filters.
- Apollo company match quality scoring, with improvements.
- Apollo typed custom field payload mapping.
- Sequence tier definitions and approval gates.
- Tier 1 draft variable structure and compact HTML rule.
- Pipeline lifecycle fields and state transition concepts.
- `pipeline_controls` model policy controls, but implement as typed admin settings.
- Local run manifests and log summaries as migration/audit evidence.

## 22. What Should Be Rebuilt Cleanly With A Database-Backed Implementation

Rebuild these areas:

- Google Sheets as system of record -> PostgreSQL.
- Whole-Sheet range rewrites -> transactional upserts with audit logs.
- `company_identity_key` as normalized name only -> stable company identity with aliases, domains, Apollo org IDs, and merge history.
- Hardcoded sequence/custom field IDs -> tenant-scoped integration configuration.
- Crontab-only orchestration -> application job scheduler with retries, locks, observability, and idempotency.
- Local-only raw archive -> object storage plus DB metadata, or DB-native raw row storage with backup.
- Manual Sheet controls -> app UI with role-based access, validation, approvals, and audit trail.
- Free-text lifecycle/status fields -> enums.
- Notes-only error handling -> structured job/error records.
- Apollo rate-limit handling -> resilient client with retry/backoff/circuit breaker.
- OpenAI model policy in Sheet cells -> tenant/admin settings with versioned prompt/model config.
- n8n design artifacts -> first-class service layer modules.

## 23. Recommended Database Schema For The New App Using Prisma/PostgreSQL

Use tenant isolation on every business table.

Recommended Prisma model outline:

```prisma
model Tenant {
  id        String   @id @default(cuid())
  name      String
  slug      String   @unique
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  integrations IntegrationAccount[]
  imports      TradeMiningImportRun[]
  companies    Company[]
}

model IntegrationAccount {
  id          String   @id @default(cuid())
  tenantId    String
  provider    IntegrationProvider
  name        String
  status      IntegrationStatus @default(ACTIVE)
  config      Json
  secretRef   String?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  tenant Tenant @relation(fields: [tenantId], references: [id])
  @@index([tenantId, provider])
}

enum IntegrationProvider {
  TRADEMINING
  GOOGLE_SHEETS
  APOLLO
  OPENAI
  OPENCLAW
}

enum IntegrationStatus {
  ACTIVE
  DISABLED
  ERROR
}

model TradeMiningImportRun {
  id                  String   @id @default(cuid())
  tenantId            String
  startedAt           DateTime
  completedAt         DateTime?
  status              JobStatus
  windowStartDate     DateTime
  windowEndDate       DateTime
  lookbackDays        Int?
  rawRowsBeforeDedupe Int?
  duplicateRowsRemoved Int?
  rawRows             Int?
  summaryRows         Int?
  identityRows        Int?
  manifest            Json?
  errorMessage        String?
  createdAt           DateTime @default(now())

  tenant Tenant @relation(fields: [tenantId], references: [id])
  files  TradeMiningImportFile[]
  bolRows TradeMiningBolRecord[]
  @@index([tenantId, startedAt])
}

model TradeMiningImportFile {
  id          String @id @default(cuid())
  tenantId    String
  importRunId String
  portKey     String
  portName    String
  portId      String?
  fileType    TradeMiningFileType
  storageUrl  String
  sourceFileName String
  rowCount    Int?
  metadata    Json?

  importRun TradeMiningImportRun @relation(fields: [importRunId], references: [id])
  @@index([tenantId, importRunId])
}

enum TradeMiningFileType {
  XLSX
  CSV
}

model TradeMiningBolRecord {
  id                 String @id @default(cuid())
  tenantId           String
  importRunId         String
  rawRecordKey        String
  sourceSystem        String
  sourceReportName    String?
  sourceSavedSearchId String?
  sourcePort          String?
  sourceFileName      String?
  sourceFileDate      DateTime?
  ingestedAt          DateTime
  arrivalDate         DateTime?
  houseBolNumber      String?
  masterBolNumber     String?
  containerNumber     String?
  billType            String?
  importerName        String?
  consigneeName       String?
  masterConsigneeName String?
  notifyParty         String?
  shipperName         String?
  masterShipperName   String?
  arrivalPort         String?
  foreignPort         String?
  placeOfReceipt      String?
  destinationCity     String?
  destinationState    String?
  destinationZip      String?
  originCountry       String?
  productDescription  String?
  hsCode              String?
  containerCount      Decimal?
  teu                 Decimal?
  weight              Decimal?
  quantity            Decimal?
  carrier             String?
  vessel              String?
  voyage              String?
  rawJson             Json

  importRun TradeMiningImportRun @relation(fields: [importRunId], references: [id])
  @@unique([tenantId, rawRecordKey])
  @@index([tenantId, arrivalDate])
  @@index([tenantId, consigneeName])
}

model Company {
  id             String @id @default(cuid())
  tenantId       String
  identityKey    String
  matchName      String
  bestName       String?
  companyType    CompanyType @default(DIRECT_COMPANY_CANDIDATE)
  typeConfidence String?
  typeSource     String?
  domain         String?
  apolloOrganizationId String?
  doNotProspect  Boolean @default(false)
  doNotProspectReason String?
  manualHold     Boolean @default(false)
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  tenant Tenant @relation(fields: [tenantId], references: [id])
  aliases CompanyAlias[]
  summaries CompanyShipmentSummary[]
  pipeline CompanyPipeline?
  contacts Contact[]
  @@unique([tenantId, identityKey])
  @@index([tenantId, matchName])
  @@index([tenantId, domain])
  @@index([tenantId, apolloOrganizationId])
}

enum CompanyType {
  DIRECT_COMPANY_CANDIDATE
  LOGISTICS_PROVIDER
  BRANCH_LOCATION_REVIEW
  PARENT_COMPANY
  UNKNOWN
}

model CompanyAlias {
  id        String @id @default(cuid())
  tenantId  String
  companyId String
  rawName   String
  normalizedName String
  source    String
  createdAt DateTime @default(now())

  company Company @relation(fields: [companyId], references: [id])
  @@unique([tenantId, companyId, normalizedName, source])
}

model CompanyShipmentSummary {
  id                 String @id @default(cuid())
  tenantId            String
  companyId           String
  companySummaryKey   String
  sourceRole          String
  latestCompanyName   String?
  arrivalPort         String?
  destinationState    String?
  destinationCityLatest String?
  firstSeenDate       DateTime?
  lastSeenDate        DateTime?
  seenCount           Int @default(0)
  shipmentCount7d     Int @default(0)
  shipmentCount30d    Int @default(0)
  shipmentCountPrev30d Int @default(0)
  shipmentCount90d    Int @default(0)
  teu30d              Decimal?
  teuPrev30d          Decimal?
  weight30d           Decimal?
  weightPrev30d       Decimal?
  momShipmentGrowthPct Decimal?
  momTeuGrowthPct     Decimal?
  trendScore          Int @default(0)
  fitScore            Int @default(0)
  overallPriorityScore Int @default(0)
  scoreReason         String?
  evidence            Json?
  updatedAt           DateTime @updatedAt

  company Company @relation(fields: [companyId], references: [id])
  @@unique([tenantId, companySummaryKey])
  @@index([tenantId, overallPriorityScore])
}

model CompanyPipeline {
  id                String @id @default(cuid())
  tenantId          String
  companyId         String @unique
  pipelineStatus    PipelineStatus
  reviewStatus      ReviewStatus
  activeQueueStatus ActiveQueueStatus
  approvedForApollo Boolean @default(false)
  apolloStatus      ApolloStatus @default(NOT_STARTED)
  apolloLastCheckedAt DateTime?
  apolloNextCheckAt DateTime?
  apolloContactCount Int?
  opportunityStatus OpportunityStatus @default(NOT_STARTED)
  lastOpportunityFitScore Int?
  outreachStatus    OutreachStatus @default(NOT_STARTED)
  sequenceStatus    SequenceStatus @default(NOT_STARTED)
  ownerUserId        String?
  priorityOverride   String?
  notes              String?
  lastMaterialChangeAt DateTime?
  lastProcessedAt    DateTime?
  nextActionAt       DateTime?
  createdAt          DateTime @default(now())
  updatedAt          DateTime @updatedAt

  company Company @relation(fields: [companyId], references: [id])
  @@index([tenantId, pipelineStatus])
  @@index([tenantId, activeQueueStatus])
  @@index([tenantId, apolloStatus])
}

enum PipelineStatus {
  QUALIFIED
  ACTIVE_QUEUE
  NEEDS_REVIEW
  APPROVED_FOR_APOLLO
  APOLLO_LOOKUP_IN_PROGRESS
  APOLLO_COMPLETE
  APOLLO_NO_MATCH
  APOLLO_NO_CONTACTS
  APOLLO_NO_RELEVANT_CONTACTS
  OPPORTUNITY_SCORING_READY
  SCORED
  OUTREACH_COPY_READY
  OUTREACH_READY_FOR_REVIEW
  APPROVED_FOR_SEQUENCE
  IN_SEQUENCE
  ACTIVE_CALLING
  MEETING_BOOKED
  OPPORTUNITY_CREATED
  CUSTOMER
  NURTURE
  DISQUALIFIED
  DO_NOT_PROSPECT
}

enum ReviewStatus {
  NEEDS_REVIEW
  APPROVED
  NEEDS_MANUAL_MATCH_REVIEW
  REJECTED
}

enum ActiveQueueStatus {
  ACTIVE
  INACTIVE
  EXITED
}

enum ApolloStatus {
  NOT_STARTED
  IN_PROGRESS
  APOLLO_COMPLETE
  APOLLO_NO_MATCH
  APOLLO_NO_CONTACTS
  APOLLO_NO_RELEVANT_CONTACTS
  MATCH_QUALITY_REVIEW
  DO_NOT_PROSPECT
  ERROR
}

enum OpportunityStatus {
  NOT_STARTED
  READY_FOR_SCORING
  SCORED
  NURTURE
  HOLD
}

enum OutreachStatus {
  NOT_STARTED
  ASSET_GENERATION_READY
  HUMAN_REVIEW_REQUIRED
  READY_FOR_REVIEW
}

enum SequenceStatus {
  NOT_STARTED
  READY_FOR_APPROVAL
  APPROVED
  IN_SEQUENCE
  ERROR
}

model ApolloOrganizationMatch {
  id          String @id @default(cuid())
  tenantId    String
  companyId   String
  apolloOrganizationId String?
  apolloCompanyName String?
  apolloDomain String?
  matchQuality Int
  similarity   Int?
  classification String
  rawResponse  Json?
  createdAt    DateTime @default(now())

  company Company @relation(fields: [companyId], references: [id])
  @@index([tenantId, companyId])
}

model Contact {
  id              String @id @default(cuid())
  tenantId        String
  companyId       String
  recordKey       String
  apolloContactId String?
  apolloPersonId  String?
  firstName       String?
  lastName        String?
  fullName        String
  title           String?
  email           String?
  linkedinUrl     String?
  city            String?
  state           String?
  country         String?
  emailStatus     String?
  relevanceScore  Int?
  relevanceReason String?
  status          ContactStatus
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  company Company @relation(fields: [companyId], references: [id])
  sequenceApprovals SequenceApproval[]
  @@unique([tenantId, recordKey])
  @@index([tenantId, email])
  @@index([tenantId, linkedinUrl])
}

enum ContactStatus {
  READY_FOR_REP_REVIEW
  MANUAL_REVIEW
  BLOCKED_MISSING_FULL_NAME
  BLOCKED_MISSING_EMAIL
  APPROVED_FOR_SEQUENCE
  IN_SEQUENCE
  ERROR
}

model OpportunityScore {
  id          String @id @default(cuid())
  tenantId    String
  companyId   String
  contactId   String?
  scoreVersion String
  score       Int
  fitBand     String?
  componentScores Json
  recommendedHandling String?
  recommendedNextAction String?
  scoreReason String?
  createdAt   DateTime @default(now())

  @@index([tenantId, companyId])
}

model SequenceConfig {
  id          String @id @default(cuid())
  tenantId    String
  tier        String
  cadenceRecommendation String
  apolloSequenceIdSecretRef String
  apolloSequenceName String
  active      Boolean @default(true)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  @@unique([tenantId, tier])
}

model SequenceApproval {
  id          String @id @default(cuid())
  tenantId    String
  contactId   String
  sequenceTier String
  approvedByUserId String
  approvedAt  DateTime
  status      SequenceApprovalStatus
  subjectDraft String?
  bodyDraft    String?
  notes        String?

  contact Contact @relation(fields: [contactId], references: [id])
  pushes SequencePush[]
}

enum SequenceApprovalStatus {
  APPROVED
  REVOKED
  PUSHED
  ERROR
}

model SequencePush {
  id          String @id @default(cuid())
  tenantId    String
  approvalId  String
  apolloSequenceId String?
  apolloContactId String?
  status      SequencePushStatus
  pushedAt    DateTime?
  message     String?
  rawResponse Json?

  approval SequenceApproval @relation(fields: [approvalId], references: [id])
}

enum SequencePushStatus {
  READY
  PUSHED
  ERROR
}

model AutomationJobRun {
  id          String @id @default(cuid())
  tenantId    String
  jobType     String
  status      JobStatus
  startedAt   DateTime
  finishedAt  DateTime?
  input       Json?
  output      Json?
  errorMessage String?
  createdAt   DateTime @default(now())
  @@index([tenantId, jobType, startedAt])
}

enum JobStatus {
  QUEUED
  RUNNING
  SUCCESS
  ERROR
  CANCELLED
}

model AuditLog {
  id        String @id @default(cuid())
  tenantId  String
  actorUserId String?
  action    String
  entityType String
  entityId  String?
  before    Json?
  after     Json?
  createdAt DateTime @default(now())
  @@index([tenantId, entityType, entityId])
}
```

## 24. Recommended App Pages/Modules For Newl Apps

Core pages:

- Dashboard: import health, candidate counts, Apollo queue, approval queue, sequence push health, error alerts.
- TradeMining Imports: run history, source files, row counts, dedupe counts, port/date filters.
- Raw BOL Explorer: searchable BOL records with company, port, lane, product, and date filters.
- Company Intelligence: company profile, aliases, domains, Apollo match history, shipment trends, role/lane summaries.
- Candidate Feed: scored companies from TradeMining, sortable by priority, growth, destination, volume, and fit.
- Pipeline Queue: active queue, review states, owner, manual hold, do-not-prospect, approve for Apollo.
- Apollo Review: company match candidates, contact candidates, title relevance, blocked/missing data.
- Contact Review: contact scoring, sequence recommendation, approval workflow, owner assignment.
- Sequence Approvals: Tier 1 drafts, Tier 2/Tier 3 approvals, pending pushes, push errors.
- Sequence Performance: Apollo enrollment status, replies/opens/calls when available.
- Exclusions & Dedupe: known large companies, competitors, vendors, customers, blocked domains, merge tools.
- Settings: integrations, ports, score thresholds, title filters, sequence mappings, model policy.
- Job Runs & Logs: scheduler history, retries, errors, payload summaries.
- Migration Tools: import from current CSV archive and Google Sheets, reconciliation reports.

## 25. Recommended Service Layer Structure

```text
src/server/services/trademining/
  trademining-client.ts
  xlsx-export-parser.ts
  bol-normalizer.ts
  import-runner.ts
  import-manifest.ts

src/server/services/leadgen/
  company-normalizer.ts
  raw-bol-dedupe.ts
  shipment-summary-builder.ts
  identity-summary-builder.ts
  scoring.ts
  pipeline-refresh.ts
  requeue-policy.ts
  exclusion-service.ts

src/server/services/apollo/
  apollo-client.ts
  organization-match-service.ts
  people-search-service.ts
  contact-enrichment-service.ts
  apollo-contact-service.ts
  apollo-custom-field-service.ts
  sequence-push-service.ts
  rate-limit-policy.ts

src/server/services/outreach/
  sequence-tier-service.ts
  tier1-draft-service.ts
  approval-service.ts
  personalization-fields.ts

src/server/services/google-sheets/
  sheets-client.ts
  legacy-sheet-importer.ts
  legacy-sheet-exporter.ts

src/server/jobs/
  daily-trademining-refresh.job.ts
  pipeline-refresh.job.ts
  apollo-batch.job.ts
  sequence-push.job.ts
  weekly-performance-review.job.ts

src/server/audit/
  audit-log-service.ts

src/server/config/
  tenant-integration-config.ts
  model-policy.ts
  leadgen-thresholds.ts
```

Service requirements:

- Every service takes `tenantId`.
- Every external API call emits structured logs and job events.
- Every state transition is audited.
- Every job is idempotent.
- Apollo writes must support dry run.
- TradeMining import should be resumable per port/window.
- Sequence push must be approval-driven and require a final confirmation state.

## 26. Migration Plan From Google Sheets/OpenClaw To The New App

Phase 1: Inventory and freeze

- Snapshot current Google Sheet to CSV/XLSX.
- Snapshot local processed CSVs and manifests.
- Record active crontab and disable duplicate legacy automation only after new jobs are ready.
- Store current Apollo sequence/custom field mappings as redacted config records.

Phase 2: Database bootstrap

- Create tenant for NEWL.
- Import processed `trade_mining_raw_bol_canonical.csv` history into `TradeMiningBolRecord`.
- Import `company_shipment_summary.csv` into `CompanyShipmentSummary`.
- Import `company_identity_summary.csv` into `Company` plus latest metrics.
- Import current `company_pipeline` into `CompanyPipeline`.
- Import `apollo_contacts` into `Contact`, `OpportunityScore`, and sequence approval/push records where applicable.
- Import exclusions and user mappings.

Phase 3: Reconciliation

- Compare DB counts against latest processed manifest and Sheet row counts.
- Validate duplicate raw BOL removal.
- Validate top candidates and scores match current CSV/Sheet output.
- Validate Apollo contact rows match by record key/contact key.
- Validate blocked/missing-email/missing-name statuses.

Phase 4: Parallel run

- Run new TradeMining import in dry-run/parallel mode for at least one week.
- Compare raw row counts, dedupe counts, summary counts, identity counts, and top scored candidates.
- Run Apollo company/contact matching in dry-run against a small approved set and compare matches.
- Do not push sequences from the new app until approval workflows are validated.

Phase 5: Cutover

- Disable current crontab entries or switch them to read-only/export mode.
- Enable Newl Apps scheduler for daily TradeMining refresh and pipeline refresh.
- Keep Google Sheets export read-only for users during transition.
- Move approvals into Newl Apps.
- Enable Apollo sequence push behind explicit admin gate.

Phase 6: Decommission/cleanup

- Archive local scripts and n8n workflows as reference.
- Rotate any secrets that existed in local files.
- Remove hardcoded IDs from source.
- Document operational runbooks.

## 27. Unresolved Questions And Missing Information

- What is the exact current Google Sheet schema for `pipeline_controls`, `apollo_user_mapping`, and `apollo_sequence_mapping` beyond ranges and fields inferred from code?
- Which Apollo sequence push errors occurred recently, and are they due to missing email, missing owner/email account mapping, API permission, sequence state, duplicate contact rules, or Apollo account limits?
- Does `people/match` consume paid enrichment credits in the current Apollo plan?
- Should the production platform continue to use TradeMining website form posts, or is a formal export/API arrangement available?
- Should full raw BOL rows be stored in PostgreSQL, object storage plus metadata, or both?
- What is the required retention policy for raw BOLs and prospect/contact data?
- What are the exact multi-tenant requirements for Newl Apps: one NEWL tenant only initially, or multiple client tenants with isolated Apollo/TradeMining/Sheets credentials?
- Which users/roles can approve Apollo lookup, approve sequence enrollment, edit exclusions, and override scoring?
- Which CRM, if any, should be deduped against before Apollo or sequence push?
- Should Google Sheets remain as a bidirectional UI after launch, or become export-only?
- What are the official ICP exclusions beyond logistics providers, large brands, customers, competitors, and vendors?
- Should branch/location indicators reduce score or create a parent-company matching workflow?
- Should company identity incorporate domain, Apollo org ID, address, or parent-child hierarchy instead of normalized name?
- Should OpenAI opportunity scoring be enabled in production, or should deterministic scoring remain the default?
- Which OpenAI models are actually available in the production Newl Apps environment?
- Should Tier 1 drafts be generated by deterministic template, OpenAI, or a hybrid?
- What performance metrics can Apollo expose for the weekly cadence review through API versus manual export?
- Should sequence push default status be `active` or `paused` in production?
- What are the target SLAs for daily import completion, Apollo batch size, and sequence push retry behavior?
