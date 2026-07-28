# Lead generation, contacts, TradeMining, Apollo outreach: Testing

> Evidence status: Confirmed from code for file locations and schema references; business workflow details not explicitly encoded are marked Requires employee confirmation.

## Purpose and status

Lead generation, contacts, TradeMining, Apollo outreach is documented because code, routes, schema, or tests were located. Main evidence: `src/app/(authenticated)/lead-gen/*`, `src/modules/lead-gen/*`, `src/modules/trademining/ingestion.ts`, Apollo integration files, lead/contact/company Prisma models.

## Workflow / rules summary

- Entry points are protected authenticated pages and/or API routes for this module.
- Server-side pages and mutating APIs should validate tenant context and module entitlement before data access.
- Data persistence uses tenant-scoped Prisma models where a database model exists.
- External calls use `src/server/integrations/*` or module-specific integration helpers. Secret values are not documented here.
- Approval, printing, posting, and live external writes require human approval unless a code path explicitly enforces a safe dry-run.

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

## TradeMining-to-Apollo smoke path

Use synthetic data for ingestion and pipeline-state testing:

1. run `npm run smoke:trademining` against a local server and local ingestion token;
2. verify the Hunter exporter form test submits multiple ports and every profile filter in one request, including `TEU >= minimum`;
3. confirm the configured profile is returned and the ingestion job reaches `SUCCESS`;
4. move the synthetic company from New to Reviewing to Approved for Pipeline;
5. advance the approved account through at least one Pipeline stage;
6. for a live Apollo test, require a named-contact confirmation that includes contact, cadence, sender, active/paused status, and contact count;
7. after the Newl Apps job completes, verify Apollo membership independently and then sync status back into Newl Apps.

Do not use a contact with active or finished sequence history unless the owner explicitly approves re-enrollment. Do not treat a job-level `SUCCESS` as proof of enrollment; compare enrolled, skipped, and failed counts and verify the contact's campaign status.

For Hunter collector validation, include a canonical export containing both a valid company row and a shipment-only row. Confirm the adapter uploads the valid row, counts the identity-free row under `recordsRejectedBeforeUpload`, and does not fail the complete batch.

For daily profile rules, verify a worker plan reports the profile's exact lookback, not a global collection cap. Test before/after the configured local run time and with a `lastRunAt` on the same local date. Candidate scoring tests must also prove that records outside the profile lookback or belonging to a different profile do not count toward `minShipmentCount`.

Port and consignee-filter regression coverage must also verify:

1. common U.S. port aliases resolve to canonical TradeMining names;
2. Canadian cities are rejected as U.S. arrival ports;
3. an empty U.S. arrival-port selection is valid and omits `USPort` from the TradeMining form;
4. `Ontario | Canada` produces a consignee-state and consignee-country worker plan with no city fallback, while a legacy `Toronto | Canada` value fails closed;
5. Ontario's `State` lookup includes Canada's `countryId`, and the form posts the resolved value through `ConsigneeState`;
6. a city is posted through `ConsigneeCity` only on an exact label match; `Vaughan` must not resolve to `VAUGHAN, MS`, and mixed unresolved cities remain together in one Boolean `ConsigneeAddress` expression;
7. the country, state/city/address, ports, and all other profile filters remain inside one logical BOL query;
8. results over 25,000 split first by date and then by port, while an unsplittable capped leaf reports incomplete coverage;
9. aggregate TEUs use only the matched profile's records inside its lookback;
10. industry-pack identifiers and modes reject unsupported values, and classification labels match the qualification packs; and
11. invalid local configuration creates and fails a tracked run before the worker stops, preventing untracked retry loops.
12. Found Companies queries at most the top 100 human-review candidates, defaults to 25 rendered rows, supports only 25/50/75/100, clamps invalid pages, and limits CSV export to the same bounded review queue.
13. the Hunter installer pins the live service to a clean detached `origin/main` worktree and the runner cannot be redirected to a development checkout through its environment file.

Scoring regression coverage must also verify:

1. TradeMining evidence queries are tenant scoped and use an inclusive UTC-day cutoff;
2. `DO_NOT_CONTACT` and `REJECTED` contacts are unranked with score zero;
3. cadence assignment refuses blocked contacts and Apollo queueing requires `APPROVED` status;
4. default role penalties deprioritize sales-only contacts without suppressing mixed titles that match logistics or operations;
5. invalid windows, contact tier thresholds, company weight totals, and mid-market TEU ranges are rejected before persistence.
6. the default Contacts directory includes unassigned pipeline contacts, the `UNASSIGNED` filter remains tenant scoped, and queueing refuses contacts without a sales rep.
7. identical scoring configuration objects produce the same fingerprint regardless of key order, while a changed setting produces a different fingerprint;
8. score snapshots and outcome events always include `tenantId`, and scoring-history reads filter both tables by the authenticated tenant;
9. ingestion records a company snapshot after its evidence and persisted pipeline score are refreshed;
10. candidate and pipeline mutations record the previous and current values without creating events from read-only page loads.
11. outcome creation selects only the latest applicable snapshot from the same tenant, company, and contact at or before the event time, and persists that snapshot ID;
12. outcomes with no earlier applicable snapshot remain valid with a null snapshot link, rather than linking to a later or unrelated score.
13. scheduled Apollo sync selects due contacts by tenant and Apollo contact ID, clears errors after success, and creates outcomes only for material sequence/reply changes;
14. transient and `429` responses receive no more than three total attempts, and sustained rate limiting defers the rest of the batch;
15. the scheduled route rejects missing or invalid `APOLLO_STATUS_SYNC_SECRET` values before any tenant or Apollo work begins and never falls back to the shared `CRON_SECRET`.
16. the scheduled route returns a non-success HTTP status when any tenant run reports `error`, so the calling GitHub Actions workflow cannot appear green after an internal sync failure.
17. Apollo reply and sequence outcomes link to a score snapshot created before the new Apollo status is persisted, preventing positive engagement from leaking into the score used to evaluate that outcome.
18. the GitHub Actions caller does not retry a failed whole-batch HTTP request; retries remain bounded inside the per-contact Apollo client.
19. organization search sends `q_organization_domains_list` for domains and `q_organization_name` for name-only companies, never internal TradeMining identity-field names.
20. name-only organization discovery is capped at two deterministic queries and stops at the first direct-company match.
21. every confirmed Apollo mapping performs bounded identity lookup, with or without a saved domain, to resolve
    account IDs to Apollo's canonical nested organization ID; when Organization Search omits an already-saved account,
    an exact zero-credit saved-account lookup recovers that relationship after a zero/partial employee result. People
    Search stays constrained to the canonical `organization_ids` value without combining it with a subsidiary-specific
    domain filter or falling back to an unscoped search. The expected domain remains a response guard. Exact Apollo
    account-to-organization relationships may resolve a legal-entity card to its operating parent/brand, while
    unrelated parents, siblings, explicit different organization IDs, and unsafe identities still fail closed.
22. an unresolved latest `ApolloCompanyMatch` makes bulk enrichment skip the company before any Apollo or contact lookup.
23. Apollo company URL parsing rejects non-Apollo hosts, exact mapping validates the organization ID, and manual mapping never authorizes cadence enrollment.
24. People Search parses its `id` as an Apollo person ID, retains obfuscated-name and availability metadata, and does not claim the person is an enriched saved contact.
25. An organization-scoped People Search response may omit the returned organization ID only when its available company identity strictly matches the expected company; a sibling name or explicit different ID is rejected.
26. Saved Contact and People Search records dedupe by Apollo person ID while preserving the saved contact ID, revealed contact data, sequence history, and enrichment state.

The `20260722193000_add_lead_scoring_history` migration must remain additive: it may create the two history tables, indexes, and foreign keys, but must not drop, rename, truncate, update, or backfill existing tables.
The `20260722201500_link_lead_outcomes_to_scores` migration may only add the nullable snapshot foreign key; it must not rewrite existing outcomes.
The `20260722214500_add_apollo_status_sync_tracking` migration may only add nullable timestamps/error text, a defaulted failure counter, and indexes to `Contact`; it must not rewrite existing contact data.
The `20260724170000_add_hunter_profile_coverage_rules` migration may only add industry-pack JSON, the defaulted industry mode, and the nullable aggregate-TEU threshold; it must not delete, rename, update, or backfill existing data.

## Hunter dry-run planning

Regression coverage must prove:

1. a limit of 20 produces 12 warehousing, 6 ocean/air, and 2 trucking positions when every bucket is supplied;
2. an undersupplied service bucket is backfilled with the highest-ranked remaining qualified opportunities;
3. allocations outside 0-100 or not totaling exactly 100 are rejected;
4. every company, signal, suppression, policy, decision, and run query remains tenant scoped;
5. existing pipeline leads, replies, prior sequence history, do-not-contact, do-not-prospect, cashflow customers, and active suppressions are excluded;
6. the scheduled route rejects an absent or invalid `CRON_SECRET`, runs at most once per tenant local calendar date, and records tenant failures without authorizing external writes;
7. the Hunter UI and planner contain no Apollo enrollment or communication action.

Migration `20260725120000_add_hunter_dry_run_control_plane` must remain additive and may not rewrite existing company, contact, lead, TradeMining, Apollo, scoring, or outreach records.

## Hunter external signal scout

Regression coverage must prove:

1. prepare, complete, and fail routes resolve tenant scope through machine ingestion authentication;
2. a completion cannot write without an active tenant-owned run ID;
3. every accepted source URL is HTTPS and every relevant result has an explicit company;
4. model and prompt version, source provider/lens, confidence, rationale, and evidence remain auditable;
5. invalid enums, oversized batches, missing fields, omitted source rows, and confidence below 50 fail closed;
6. GDELT 429/5xx responses receive bounded retry, the RSS fallback remains available, and total source failure makes the run fail visibly;
7. the live runner allows only loopback Ollama endpoints and reads its model settings from the protected Hunter environment;
8. the installed Hunter service remains pinned to the dedicated clean runtime checkout;
9. no scout module or route imports or calls Apollo, cadence enrollment, email, LinkedIn, or customer-communication code; and
10. Python, zsh, TypeScript, and structured-output contract tests pass without a database migration.

## Hunter company deep research

Regression coverage must prove:

1. prepare, complete, and fail routes resolve tenant scope through machine ingestion authentication;
2. an explicit cohort is bounded to 100 keys and still resolves only eligible companies inside the authenticated tenant;
3. the default queue follows the saved daily company limit and excludes recently researched companies for seven days;
4. identity, fresh-event, careers, and distribution-footprint queries are generated for every company;
5. evidence URLs are HTTPS, source domains match their URLs, redirects cannot reach local/private addresses, and query/evidence sizes are bounded;
6. Qwen runs locally with structured output and thinking disabled, while K2.6 and bounded K3 usage, cached-token counts, reasoning effort, status, and cost estimates remain auditable;
7. uncorroborated ambiguous identity, explicit provider-service evidence even when the model misses it, explicitly evidenced stable/exclusive external-provider relationships without displacement evidence, thin evidence, and incomplete pass coverage fail deterministic gates; matching first-party identity can correct unsupported ambiguity; unsupported provider/incumbent labels cannot block; stale/no-opportunity evidence remains Watchlist; an undated/old `FRESH` claim is evaluated as current fit rather than Hot; exact-company recent material expansions, including new production lines at an existing facility and distribution-center establishments, can restore a missed fresh trigger or replace a weaker affiliate or unsupported careers citation before the date gate, replace a contradicted generic summary with saved evidence, and remain typed as expansion rather than facility opening; compact Qwen/K2.6/K3 packets preserve up to two qualifying expansion records in exact-entity-first order plus the strongest specific logistics-management vacancy before pass-diverse backfill; and incidental China text cannot override verified North American identity;
8. five 0-20 K2.6 dimensions must equal the reported total; K3 cannot raise that score, promote a blocked candidate, or create Hot without citing the same recent dated trigger;
9. public identity evidence, never shipment origin, determines company country; verified North American operators do not fail a redundant foreign-division name check, while foreign division evidence tolerates legal-suffix/parenthetical differences but still requires a matching alias, U.S. jurisdiction, and explicit operating relationship; other foreign entities without a verified U.S. division receive a 10-point penalty and Watchlist cap, while mainland-China entities without one are blocked;
10. ambiguous or below-70% identities pivot from candidate-matching domains found in saved evidence to official and legal/about/contact pages, rerun synthesis when first-party evidence is recovered, and never accept an unrelated directory or similar-name domain;
11. completion preloads the prepared tenant-scoped company identity map, uses a bounded 30-second
    interactive transaction, stores tenant-scoped evidence atomically, and refreshes only the dry-run plan; and
12. a retrieval/Qwen checkpoint resumes only against an identical newly prepared tenant cohort;
13. legal-name, regional, and brand aliases cover known false-negative shapes such as Aalberts IPS Americas, AS Colour, 3F North America, Barnhardt Manufacturing, and Atlas Copco Compressors;
14. saturated generic results cannot prevent a known-domain identity or fresh-event query from executing or contributing evidence, including Barnhardt's first-party NCFI expansion;
15. a full evidence ledger executes no follow-up search, a partially full ledger appends only to the remaining capacity, resumed evidence is bounded, and no completion company can exceed 24 evidence records; and
16. no company-research module or route imports or calls Apollo, pipeline-stage mutation, cadence enrollment, email, LinkedIn, or customer-communication code.

## Hunter quality audit and Rivet triage

Regression coverage must prove:

1. the sample selects one Hot, Qualified current account, Watchlist, and Blocked signal before filling the fifth slot;
2. prepare/complete/fail require the authenticated administrator's tenant and mutation access;
3. completion returns exactly one result for every prepared tenant-scoped signal and rejects duplicates or foreign IDs;
4. Codex output accepts only the documented categories, tiers, severities, booleans, and HTTPS evidence URLs;
5. model judgment and data/configuration issues notify but never auto-queue Rivet;
6. reproducible retrieval, handoff, and deterministic-rule defects require the exact owner standing-approval value;
7. a Rivet suggestion forbids reclassification, TradeMining/outreach retry, merge, deploy, production writes, permissions, and customer communication;
8. a second identical seven-day incident trips the circuit breaker and does not create another development job;
9. enabled TradeMining profiles without a due run, removed/disabled profiles that ran, overlap, stuck/failed runs, missing/incomplete coverage, and exported/processed count drift are detected;
10. a zero-result profile is only an anomaly when recent positive history exists;
11. shell/schema tests preserve a read-only Codex audit, the 13:30 America/Toronto schedule, and Teams delivery through `RIVET_TEAMS_TARGET`;
12. Rivet resolves Git state from its dedicated runtime, validates context against the fetched base branch, and stops a failed packet parse before any blank `origin/` worktree reference;
13. the Hunter worker emits one settled daily profile digest, sends immediate sanitized failure alerts, and keeps processing other due profiles;
14. the assisted outreach-handoff machine route bypasses browser-session middleware and continues to enforce tenant-bound ingestion authentication in its route;
15. the Mac worker starts its outreach-handoff poller before the sequential TradeMining loop, so a large profile
    ingestion cannot block an interactive contact-discovery job; and
16. no schema migration is required because audit, incident, feedback, suggestion, and Rivet state use existing tenant-scoped tables.

## Automated sales workspace

Regression coverage must prove:

1. Sales Opportunities contains only engaged, meeting, proposal, won, and lost stages;
2. New, researching, enriched, qualified, and contacted leads remain stored but do not appear in the revenue view unless a saved Apollo positive reply or meeting-booked status supplies the corresponding effective sales stage;
3. Outreach Queue includes approved, drafted, ready, enrolled, paused, and unanswered active work;
4. rejected, do-not-contact, bounced, finished, positive, meeting-booked, and negative contacts are excluded from Outreach Queue;
5. the legacy `/lead-gen/contacts` route redirects to `/lead-gen/outreach`; and
6. Outreach Queue starts with secondary audit columns hidden and links companies back to Found Companies; and
7. every underlying query remains tenant scoped and the redesign requires no database migration.
8. the Apollo reply-sync metric is labeled as an all-status saved-contact monitoring count and is not presented as
   the number of contacts in Outreach Queue.

## Assisted post-research handoff

Regression coverage must prove:

1. only explicit `ASSISTED` mode with the kill switch off can queue or process a handoff;
2. the queued cohort contains only fresh Hot/Qualified companies with the exact tenant-owned `WOULD_PURSUE`
   decision produced by the dedicated researched-outreach plan; unresearched TradeMining candidates cannot consume
   this cohort's daily slots;
3. machine routes ignore caller-supplied tenant identifiers and use ingestion authentication;
4. each request processes at most one company and persisted leases, results, attempts, and retry dates survive worker restart;
5. an unresolved latest Apollo company match blocks repeat discovery and remains review-required;
6. saved contacts, a 100-result organization-scoped employee search, and an always-run multi-title search are merged and deduplicated before ranking; Apollo account IDs are resolved to the nested global organization ID before employee search (with saved-contact recovery as a fallback), an exact saved account omitted by name search is recovered through zero-credit Account View, an exact saved account with no nested organization ID retries by its trusted domain, one partial account result cannot be treated as complete, and sibling/parent organizations remain excluded;
7. deterministic ranking excludes seller-side and unidentifiable contacts, gives the buyer-role model the best 10 candidates, and caps final selection at `maxContactsPerCompany`;
8. buyer-role review uses strict structured output and returns the exact requested contact IDs; model-qualified contacts rank first, while an explicit manager-or-higher physical logistics or facility-operations buyer remains eligible for an unapproved human-review plan; digital/franchise/general back-office operations and explicit geography mismatches do not receive that fallback;
9. the manual current-opportunity handoff requires completed company research, creates a deterministic plan scoped
   to the current researched Hot/Qualified cohort, and queues the same bounded Assisted-mode job without rerunning
   research;
10. the same prompt version and prospecting decision reuse a cached review, while a new decision requires fresh review;
11. imported contacts remain `REVIEWING`, unapproved, unassigned, and unenrolled;
12. plan generation uses the saved Hunter/TradeMining evidence ledger and persists QA failure rather than bypassing it;
13. no assisted-handoff path creates a lead, changes a pipeline stage, approves a plan/contact, writes an Apollo cadence, or sends communication; and
14. the Mac worker drains the queue after research and resumes unfinished jobs during its normal loop.
15. legacy pre-engagement `Lead` rows, old negative/out-of-office contacts, individual do-not-contact records, and
    prior-sequence evidence do not suppress a current Hot/Qualified company. Current customers, generic replies
    requiring review, positive replies, and meetings remain company-level stops; contact-level do-not-contact,
    reply, and bounce safety is enforced on each selected contact.
16. Automation Settings reports the latest handoff's queued companies, processed companies, Apollo people found,
    deterministic buyer-role candidates, evaluated contacts, newly created plans, already-current plans, total actionable plans, QA failures, and per-company terminal
    reason as separate values.
17. same-domain regional brand shortening such as `SALICE AMERICA INC` to Apollo organization `Salice` is accepted,
    while different-domain parents and sibling companies still fail closed.
18. an approved contact with finished prior cadence history can enroll in Hunter; an active or paused different
    cadence is removed before the Hunter add-contact request; replies and bounces remain blocked; and status sync
    may replace stale `FINISHED` state only when Apollo reports the selected Hunter cadence ID.
19. a contact recheck counts a current same-prompt outreach plan as actionable instead of incorrectly reporting zero
    plans and a terminal no-qualifying-contact result.
20. a forced contact recheck archives unapproved plans for contacts that no longer pass buyer-role review, and the
    active queue hides AI drafts linked to superseded prompt versions while preserving manual drafts and approved plans.

## Outreach Plans and grounded sequence generation

Regression coverage must prove:

1. evidence fingerprints are stable regardless of input ordering;
2. a valid sequence contains three emails and, only for a Hot opportunity, one separate call task; it contains no
   LinkedIn task, uses contiguous steps, and has increasing delays;
3. missing/unknown evidence references, generic banned phrasing, unsupported URLs, and unsupported quantified claims
   fail deterministic QA;
4. any blocking model-critic issue fails the combined gate even when deterministic checks pass;
5. OpenAI strategy, sequence, and QA calls use the Responses API with strict JSON Schema;
6. generated drafts are not auto-approved, plan approval requires QA plus contact/company safety, and a current
   unapproved plan blocks Apollo;
7. editing generated copy invalidates QA and approval;
8. every email ends with the routed Apollo mailbox first name, including when Apollo exposes the sender label as an
   email address, while sender placeholders, generic company signatures,
   Hunter/internal references, and evidence IDs fail deterministic QA; and
9. the migration is additive and preserves every existing lead-generation record;
10. legacy/unassessed, Watchlist, Blocked, stale, unselected, or inconsistent Hunter handoffs cannot generate or push;
11. a Hot opportunity requires K3 confirmation while a Qualified current account may retain `NOT_SELECTED`;
12. a current selected handoff exposes Hunter's saved service line, point of attack, score, confidence, and provenance;
13. the strategy request includes that directive and rejects any model response that changes the service line; and
14. the evidence ledger preserves individual Hunter research URLs and excerpts rather than only flattened JSON text.
