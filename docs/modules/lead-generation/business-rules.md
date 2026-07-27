# Lead generation, contacts, TradeMining, Apollo outreach: Business Rules

> Evidence status: Confirmed from code for file locations and schema references; business workflow details not explicitly encoded are marked Requires employee confirmation.

## Purpose and status

Lead generation, contacts, TradeMining, Apollo outreach is documented because code, routes, schema, or tests were located. Main evidence: `src/app/(authenticated)/lead-gen/*`, `src/modules/lead-gen/*`, `src/modules/trademining/ingestion.ts`, Apollo integration files, lead/contact/company Prisma models.

## Workflow / rules summary

- Entry points are protected authenticated pages and/or API routes for this module.
- Server-side pages and mutating APIs should validate tenant context and module entitlement before data access.
- Data persistence uses tenant-scoped Prisma models where a database model exists.
- External calls use `src/server/integrations/*` or module-specific integration helpers. Secret values are not documented here.
- Approval, printing, posting, and live external writes require human approval unless a code path explicitly enforces a safe dry-run.

## TradeMining search profile execution

- Every enabled TradeMining search profile is run once daily by Hunter after its configured local run time.
- `lookbackWindowDays` controls the full trailing TradeMining query window for that individual profile.
- Each daily profile run begins as one logical BOL search containing every configured destination port, origin country, origin port, ship-from port, product keyword, HS code, and minimum-TEU rule. If TradeMining reports more than 25,000 matches, Hunter adaptively divides the date range and, for a capped one-day range, the arrival-port set. The profile still represents one daily run and the complete configured lookback.
- U.S. arrival ports are optional. When supplied, every value must be a supported TradeMining U.S. arrival port; common short names such as `Charleston`, `Savannah`, and `Wilmington` are executed as canonical TradeMining port names. Canadian cities belong in consignee markets, not arrival ports.
- `destinationMarkets` accepts canonical city or province destinations. Canada requires a province value such as `Ontario | Canada`; legacy Canadian city values fail validation and are excluded from suggestions. Hunter submits Canadian profiles through TradeMining's consignee-country and consignee-state/province fields and supplies Canada's lookup ID when resolving the province. Canadian province profiles do not submit a city or address fallback. Non-Canadian city values require an exact TradeMining city match. If any configured city is unresolved, every configured city stays inside one Boolean consignee-address expression so the alternatives remain OR rather than becoming contradictory fields.
- The legacy database field `minShipmentVolume` represents minimum TEUs per BOL and is posted to TradeMining as `TEU >= value`.
- A company qualifies for Found Companies only when its shipment evidence for the matched profile, within that profile's lookback window, meets both `minShipmentCount` and the optional `minAggregateTeu`.
- Industry packs maintain reusable keyword and HS-code families. `PREFER` increases the industry-fit score but does not remove companies; `HARD` requires the persisted primary or secondary classification to match a selected pack; `EXCLUDE` removes companies whose persisted classification matches a selected pack. Hard and exclude modes are deterministic post-ingestion qualification rules, not additional TradeMining form fields.
- Each completed run records the count reported by TradeMining, exported row count, number of physical queries, qualifying-company count, and whether retrieval was complete. A one-day, one-port (or no-port) query still above the export limit is `PARTIAL`, never silently complete.
- Search profile frequency is a legacy database compatibility field fixed to `daily`; it is not editable and does not control the worker.
- Newl Apps is the source of truth for enabled profiles. Deleting a profile cancels its pending immediate-run requests, and Hunter reloads the enabled profile list before execution so deleted or disabled profiles do not receive future searches.
- Hunter creates the tracked ingestion run before validating local execution configuration. A configuration failure therefore updates the profile to `FAILED`, appears on the Search Profiles screen, and counts as that day's attempt. Recovery is an explicit profile correction followed by **Run now**, rather than continuous automatic retries.

## Scoring and outreach safety

- Hunter's owner-approved target mix is 60% warehousing, 30% ocean/air, and 10% trucking. The planner may backfill a weak or empty bucket from the strongest remaining service line; it must not lower score or confidence thresholds merely to fill the daily limit.
- TradeMining is one Hunter evidence source, not a prerequisite. A sufficiently confident tenant-scoped external signal can create a dry-run decision without an existing Company row.
- Phase 1 planning excludes active customers, any existing pipeline lead, replies, prior sequence history, do-not-contact/do-not-prospect records, rejected/disqualified companies, and active suppression entries.
- `OFF` and the kill switch both prevent planning. `ASSISTED` and `AUTOMATIC` are reserved schema states and cannot be selected through the Phase 1 policy action.
- Company scoring uses only tenant-scoped TradeMining evidence inside the matched search profile's own `lookbackWindowDays`. The scoring-level lookback is a fallback for unmatched or legacy imports and must cover the recent plus comparison windows.
- Shipment evidence queries are date bounded but not row capped. This prevents arbitrary 25-, 100-, or 250-record limits from changing a score for high-volume companies.
- The matched profile's `minShipmentCount` is a qualification gate for Found Companies; it is not replaced by the fallback scoring lookback.
- The matched profile's `minAggregateTeu` is a second qualification gate. It sums the record-level `teu` values for that company, profile, and lookback window; it is distinct from minimum TEUs per BOL.
- Contacts marked `DO_NOT_CONTACT` or `REJECTED` receive score `0`, remain `UNRANKED`, and cannot be assigned a cadence.
- Only contacts explicitly marked `APPROVED` can be queued for Apollo. The queue worker rechecks the contact and blocks companies marked `doNotProspect`, `REJECTED`, or `DISQUALIFIED` before any external write.
- Apollo organization discovery must use documented Apollo filters. A known domain uses `q_organization_domains_list`; a name-only search uses `q_organization_name` and no more than two deterministic variants.
- Only `DIRECT_COMPANY` matches can proceed automatically. If the latest match is ambiguous, a logistics provider, or no match, bulk enrichment must skip the company until a rep resolves it in **Apollo Match Review**.
- A manually supplied Apollo URL must resolve to a strong company-name match, must not already belong to another company in the same tenant, and requires explicit acknowledgement of the one-credit organization validation.
- Confirming no Apollo match keeps the latest attempt and reviewer metadata. Automatic and bulk retry remain blocked until a rep explicitly reopens the review.
- Resolving the company mapping can import contacts, but it never authorizes cadence enrollment; the existing contact approval and push controls still apply.
- The Contacts directory includes both assigned and unassigned contacts attached to pipeline accounts. Unassigned contacts remain filterable and reviewable, but Apollo queueing is blocked until a sales rep is assigned.
- Contact title and department matching uses normalized phrase boundaries. Sales, business-development, and customer-service roles are deprioritized by default, while a preferred logistics/operations match takes precedence for mixed-function titles.
- Scoring settings reject invalid window combinations, company weights that do not total exactly 100 points, non-descending contact tiers, and incomplete or inverted mid-market TEU ranges.
- Score history is immutable and event-driven. Company opportunity scores are captured after TradeMining ingestion and pipeline approval; contact relevance scores are captured when Apollo status is synchronized or a push is attempted. Opening a page does not create history.
- Every score snapshot records the scoring model version, a deterministic fingerprint of the full scoring configuration, the matched search profile when available, an explanation, and the evidence date. This allows later outcomes to be compared against the score that was actually used.
- Candidate decisions, pipeline stage changes, Apollo cadence enrollment, sequence status changes, and reply status changes are stored as tenant-scoped outcome events.
- Each new outcome links to the latest applicable score snapshot for the same tenant and subject at or before the outcome time. Contact outcomes use contact-relevance snapshots; company and pipeline outcomes use company-opportunity snapshots. Outcomes remain unlinked when no earlier snapshot exists.
- Apollo sequence and reply outcomes link to a snapshot created before the new Apollo state is persisted. A positive reply or meeting therefore cannot increase the score used to evaluate that same outcome.
- Apollo reply data is refreshed when a user selects contacts and runs **Sync Apollo status**, during the immediate Apollo lookup used to verify a push, and by the scheduled saved-contact sync. The scheduler runs hourly and treats each successful contact as fresh for four hours by default. Push-job polling only rechecks pending cadence enrollment and is not a general reply refresh.
- Scheduled Apollo sync only runs for tenants with Lead Generation enabled and an active Apollo integration. It reads saved contacts by Apollo contact ID, uses bounded batches and retries, stops the current batch after sustained rate limiting, and records contact-level failures plus an `AutomationJobRun` and audit entry.
- The scoring-history migration is additive and performs no score backfill. Historical reporting begins after the migration is deployed; current Company, Contact, Lead, and TradeMining records are not rewritten.

## External signal classification

- Public-news discovery is opt-in and disabled by default. Enabling a source is a business/compliance decision, not a model decision.
- Discovery is bounded to a recent window and at most 40 unique, previously unseen source URLs per daily run.
- A source outage cannot become a false successful zero-result run. If every configured query transport fails, the job is `ERROR`.
- Model output is advisory evidence. Deterministic validation controls enums, HTTPS URLs, dates, field sizes, source mapping, dedupe, tenant scope, and the minimum confidence gate.
- `relevant=true` requires an explicit company and confidence of at least 50. The tenant's `minimumSignalConfidence` remains the final activation threshold.
- Local Qwen is the bulk classifier. A hosted model is not required for this phase and cannot independently authorize Apollo or outreach.
- The prompt/model/provider/version, classification rationale, source lens, and supporting headline statements are retained with accepted signals.
- The local classifier receives public headline metadata only. It does not receive contacts, emails, Apollo payloads, TradeMining raw rows, tenant credentials, or customer records.

## Hunter company deep research

- Company deep research is opt-in and disabled by default. It processes the tenant policy's `dailyCompanyLimit`, which defaults to 30 for a new, unsaved policy and remains editable from 1 to 100.
- The default queue excludes do-not-prospect, rejected/disqualified, cashflow-customer, existing-pipeline, replied, previously sequenced, do-not-contact, and recently researched companies. An explicit operator replay may name at most 100 company keys, and every key is still resolved inside the authenticated tenant and through the same exclusion rules.
- Every company receives identity/parent, fresh-event, first-party-careers, and distribution-footprint queries. Local Qwen may request at most two evidence-gap follow-ups. Search results, queries, source URLs/domains, excerpts, pass labels, Brave publication dates, retrieval counts, and failures remain auditable.
- Local Qwen 3.5 35B synthesizes evidence with thinking disabled and structured output, including the exact evidence indices supporting each trigger and the public-evidence basis for company country/U.S.-division identity. Kimi K2.6 scores five 0-20 dimensions only after synthesis. Kimi K3 with low reasoning validates at most the five strongest provisional fresh-event candidates. Any trigger evidence restored by deterministic review is guaranteed into both compact Kimi packets instead of being displaced by a generic page chosen for pass diversity. Token counts, cached tokens, durations, model names, prompt version, and non-authoritative cost estimates are retained.
- Deterministic server code, not either model alone, blocks an uncorroborated ambiguous identity, explicit language showing that the company provides logistics services to other customers or members, an explicitly evidenced stable/exclusive external-provider relationship without displacement evidence, fewer than two evidence records, missing identity evidence, coverage of fewer than two passes, and mainland-China identity without a verified U.S. division. Provider and incumbent labels require explicit saved evidence; unsupported model labels are cleared before scoring. Matching first-party identity evidence can correct an unsupported ambiguous label. A strict evidence check restores `FRESH` when Qwen overlooks an exact-company, recent, dated material expansion in a non-directory source, including when Qwen selected `FRESH` but cited an unsupported careers or directory record instead of the qualifying event. A `FRESH` claim whose cited trigger lacks a publication date inside the trailing 18 months is evaluated as current fit instead of being blocked, and stale/no-opportunity results remain on Watchlist for later research. Hunter prefers the page's original `datePublished` metadata over Brave's later page-update age. A current year in the search query, a generic recently updated company profile, or a crawl timestamp is not event-date evidence. Ordinary manufacturers, retailers, importers, or distributors with internal logistics staff are prospects and do not trip the provider gate.
- Kimi's five dimension scores must sum exactly to its total. K3 may confirm or downgrade a candidate and may never raise the K2.6 score or override a deterministic blocker. A fresh event becomes **Hot opportunity** only when K3 confirms the same recent dated evidence. A strong fit with current evidence but no discrete recent trigger becomes **Qualified current account**. Lower-accessibility, uncertain-timing, below-threshold, stale/no-opportunity, foreign-without-U.S.-division, or unvalidated fresh candidates become **Watchlist**. Explicit logistics providers, uncorroborated ambiguous identities, explicitly stable/exclusive incumbent relationships without displacement evidence, and mainland-China entities without a verified U.S. division become **Blocked**.
- Company-country rules use public identity evidence only. TradeMining origin countries, foreign ports, and shipment routing are never treated as the company's country. A verified U.S. or Canadian identity cannot be reversed by an incidental China reference elsewhere in a long identity page; text-based China inference is used only while operating country remains unknown. U.S. and Canadian companies are prioritized normally. Other foreign companies without a verified U.S. division remain eligible evidence but receive a fixed 10-point penalty and cannot rise above Watchlist. A mainland-China company is Blocked unless exact cited evidence verifies a named U.S. operating division.
- Completion refreshes the dry-run prospecting plan. It cannot search Apollo, change a company or lead stage, enroll a cadence, draft/send email, or perform LinkedIn activity.
- Research data reuses the additive Hunter signal and `AutomationJobRun` JSON ledgers. Phase 3 requires no database migration and does not rewrite existing company, contact, lead, TradeMining, Apollo, scoring, or outreach records.

## Hunter quality and TradeMining run assurance

- The daily quality audit samples at most five recent classifications and deliberately covers Hot, Qualified current account, Watchlist, and Blocked before filling any remaining slot.
- Codex auditing is read-only. Its output cannot directly change a signal, company, score, pipeline stage, contact, cadence, or outreach record.
- A missing source is a retrieval defect only when independent public research verifies a material source that existed for the audited run. Evidence already present in the saved ledger but absent from a downstream model decision is a handoff defect. A disagreement after the evidence reached the model is model judgment and is not auto-fixed.
- Every enabled TradeMining profile must have a tracked ingestion attempt once per local day after the monitoring grace hour. A run for a removed or disabled profile, overlapping active runs, missing coverage metrics, incomplete adaptive retrieval, or exported/processed count mismatch is a deterministic alert.
- Zero TradeMining matches are not automatically an error. They become a review anomaly only when the same profile has recent positive run history.
- Only reproducible code defects may use the owner-enabled Hunter Rivet standing approval. Credentials, authorization, transient runtime failures, configuration issues, and subjective scoring always require review.
- The second identical incident within seven days trips the incident circuit breaker. It reuses the existing Rivet job when present and does not create another automatic draft-PR job.
- Teams notifications always state that no lead was reclassified, no search/outreach was retried, and nothing was merged or deployed.

## Automated sales workspace boundaries

- Daily Opportunities is the researched decision surface; Found Companies remains a bounded source-data review screen.
- Outreach Queue includes an active contact when it is approved, ready/enrolled/paused/replied in a sequence, or has a Newl outreach draft.
- Outreach Queue excludes rejected and do-not-contact records, bounced or finished sequences, and positive, meeting-booked, or negative reply outcomes.
- Sales Opportunities is a revenue view over existing lead stages, limited to `REPLIED`, `MEETING_BOOKED`, `QUOTED`, `WON`, and `LOST`. A saved Apollo positive reply infers `REPLIED` for the view, while meeting-booked infers `MEETING_BOOKED`, so engagement cannot disappear between queues before a human confirms the lead stage. This layout rule does not change the Prisma enum or delete earlier-stage leads.
- Apollo/customer communication approval boundaries are unchanged by this presentation redesign.

## Assisted outreach planning and grounding

- Outreach generation requires both a ranked contact and a current company-level Hunter handoff. The latest Hunter
  company-research signal must be Hot or Qualified current account, pass the deterministic research gate, and have a
  newer `WOULD_PURSUE` planner decision with the same service line. Watchlist, Blocked, unassessed, stale, unselected,
  or inconsistent handoffs cannot generate or push outreach.
- Hot opportunities additionally require a saved Kimi K3 `CONFIRM` validation. Qualified current accounts may use
  the normal `NOT_SELECTED` validator state because K3 is reserved for the strongest fresh-event candidates.
- Research freshness defaults to 30 days through `HUNTER_OUTREACH_RESEARCH_MAX_AGE_DAYS`. The duration is inferred
  operating policy and still requires business-owner confirmation; changing it does not rewrite saved research.
- Strategy uses the configured Terra-class model; drafting and model QA use the configured Luna-class model. Model
  names remain server environment configuration and every saved plan records the actual names and prompt version.
- Hunter's selected service line is authoritative. The strategy model receives the saved opportunity tier, point of
  attack, service line, score, confidence, persona, sender, cadence, and research time. It may refine messaging but
  cannot substitute another service line; a mismatch fails before persistence.
- Every plan freezes a bounded evidence ledger and SHA-256 fingerprint. Company/contact identity, each exact Hunter
  research article URL/excerpt, the selected Hunter decision, and TradeMining summaries have stable evidence IDs.
- A complete Phase 1 sequence is exactly five touches: email day 0, LinkedIn task day 2, email day 4, call task day 7,
  and email day 10. LinkedIn and call steps are manual instructions; the agent does not perform those actions.
- Every strategy and step must cite a saved evidence ID. Deterministic QA validates citations, ordering, channel mix,
  lengths, unsupported URLs, banned generic phrases, and unsupported quantified shipment/TEU/store/facility/location
  claims. A conservative model critic separately checks semantic grounding and buyer-responsibility assumptions.
- Any deterministic or model error fails closed. A failed plan remains reviewable but cannot be approved or pushed.
- Generation never marks a draft approved. Human approval requires QA `PASSED`, an approved contact, and a company
  that is not rejected, disqualified, or do-not-prospect.
- Editing the first email after QA invalidates the plan and Apollo readiness. Regeneration creates a new plan version,
  archives the previous active version, and reruns strategy, drafting, and QA.
- Both Apollo queueing and the worker re-evaluate the same current Hunter handoff. When a current Outreach Plan
  exists, Apollo push is also blocked until that exact plan is approved. Approval alone does not enroll or send; the
  existing explicit Apollo push action remains a separate human-controlled external write.

## Data model

Relevant tables and enums are in `prisma/schema.prisma`. Operationally important fields include primary `id`, `tenantId` where present, status enums, foreign keys to tenant/user/module, timestamps, metadata JSON, and unique/index constraints declared in Prisma.

```mermaid
flowchart LR
  UI[Authenticated UI/API] --> Auth[Auth + module guard]
  Auth --> Service[Module service]
  Service --> DB[(Tenant-scoped Prisma tables)]
  Service --> Ext[External services when configured]
```

## Permissions

Roles and defaults are in `src/server/auth/role-policy.ts`. Runtime checks are in `src/server/auth/authorization.ts`; gaps should be treated as requiring code review before enabling production writes.

## Failure modes

Expected failures include missing tenant entitlement, read-only mutation attempts, validation errors, missing integration credentials, duplicate records, empty parser results, external API errors, timeouts, and partial job completion. Recovery should use module UI review screens, audit/job records, and documented dry-run scripts before live writes.

## Testing

Relevant tests are under `tests/` and generally named after the module. Recommended checks: `npm test`, `npm run lint`, `npm run typecheck`, and targeted route/service tests. Live integration scripts must not be run without explicit approval and safe credentials.

## Source map

| Responsibility | Main files | Supporting files | Tests |
|---|---|---|---|
| UI and routes | See evidence paths above | `src/components/app-shell.tsx` | module-named tests under `tests/` |
| Services/actions/queries | `src/modules/lead*` or evidence paths above | `src/server/*` | module-named tests |
| Schema | `prisma/schema.prisma` | `prisma/migrations/*` | schema-dependent unit tests |

## Open questions

- Which status values map to employee-approved business language? Requires employee confirmation.
- Which write actions should require two-person approval? Requires owner confirmation.
- Which external integration credentials should be moved from env fallback to tenant-scoped settings first? Requires owner confirmation.
