# Lead generation, contacts, TradeMining, Apollo outreach: Failure Modes

> Evidence status: Confirmed from code for file locations and schema references; business workflow details not explicitly encoded are marked Requires employee confirmation.

## Purpose and status

Lead generation, contacts, TradeMining, Apollo outreach is documented because code, routes, schema, or tests were located. Main evidence: `src/app/(authenticated)/lead-gen/*`, `src/modules/lead-gen/*`, `src/modules/trademining/ingestion.ts`, Apollo integration files, lead/contact/company Prisma models.

## Workflow / rules summary

- Entry points are protected authenticated pages and/or API routes for this module.
- Server-side pages and mutating APIs should validate tenant context and module entitlement before data access.
- Data persistence uses tenant-scoped Prisma models where a database model exists.
- External calls use `src/server/integrations/*` or module-specific integration helpers. Secret values are not documented here.
- Approval, printing, posting, and live external writes require human approval unless a code path explicitly enforces a safe dry-run.

## Confirmed Apollo account returns zero employees

A saved Apollo account URL can resolve to a canonical global organization ID whose organization-scoped People Search
returns no people even though Apollo's account page visibly lists employees. Newl Apps must carry the reviewer-confirmed
account ID forward from match history, refresh the exact saved account, and retry People Search with the account's
normalized domain. Apollo can also index account-page employees outside both the canonical organization and domain
filters. Apollo's UI may also combine duplicate saved-account or sub-account rosters under **Include Sub Accounts**.
Hunter therefore searches a bounded set of safe same-brand, exact-domain saved-account variants and their distinct
global organization IDs before declaring a provider coverage gap. A final company-keyword candidate search remains
strictly guarded by employer name and domain. Apollo's supported public People API still does not expose every roster
shown by its private Suggested leads UI, and `account_ids[]` is not a documented public filter. Newl Apps then stops
automatic retries and keeps the mapped company in an explicit employee-resolution state instead of asking for daily
remapping. Exact `#/people/<person-id>` URLs and explicitly authorized email-only enrichment remain last-resort
diagnostics. Hunter rejects mismatched or unverifiable employers and never calls private UI endpoints or Apollo's
deprecated legacy People Search.

A second zero-result shape is an exact reviewer-confirmed Apollo account shell with no company details, domain,
contacts, or Suggested leads, while Apollo maintains the real roster under a separate canonical parent account. In
that case Hunter performs one zero-credit saved-account lookup using the shell's distinctive leading brand. It
expands only when exactly one returned canonical parent name is already present in the saved Hunter/Kimi-vetted
identity evidence. Unmentioned parents, ambiguous candidates, logistics providers, and automatic/unreviewed matches
still fail closed. Apollo Exceptions shows links to both the originally confirmed account and the resolved
organization, and allows an authenticated reviewer to replace an empty shell mapping with the canonical account.

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

Hunter retries transient TradeMining network failures and HTTP 429/5xx responses with bounded exponential backoff. Authentication errors, invalid profile filters, and ambiguous lookup values fail immediately and remain visible on the tracked job run. A failed daily run is recovered with the explicit **Run now** action; it is not silently repeated throughout the day.

## Found Companies returns an application error

- Symptom: `/lead-gen/candidates` fails server-side as the company corpus grows.
- Confirmed cause: the prior query loaded every matching company and every matching TradeMining relation before applying browser pagination. PostgreSQL could terminate the generated relation query with `54001: stack depth limit exceeded`.
- Prevention: the human screen and CSV export request only the top 100 review candidates. Background Hunter paths that need exact corpus coverage read tenant-scoped companies in bounded batches.
- Limitation: company, score, and shipment filters on Found Companies operate inside the bounded human review queue. Hunter remains the complete-corpus workflow.

## Outreach Plan generation or QA fails

- Missing OpenAI configuration, an unranked contact, missing selected cadence, missing active Apollo sender routing, no saved evidence, invalid structured
  model output, or strategy/drafting transport failure stops generation and creates no partial active plan.
- Plan and sequence-step persistence uses two ordered writes inside the same transaction. Prisma nested relation input
  cannot safely mix the plan's tenant foreign-key scalars with nested tenant-scoped step creation; a failure rolls back
  both records rather than leaving a partial plan.
- Lead-generation AI runtime enablement is saved independently from scoring weights. An unrelated invalid scoring total
  cannot block the runtime toggle or silently rewrite scoring configuration.
- The model critic retries transient HTTP 408/409/429/5xx and transport failures after bounded 2-second,
  5-second, and 15-second delays. Strategy and drafting calls are not automatically replayed, avoiding duplicate
  copy-generation cost.
- If drafting succeeds but all model-critic attempts remain unavailable, Newl Apps saves the version as `QA_FAILED`
  with a `MODEL_QA_UNAVAILABLE` error. It cannot be approved or pushed, but is labeled as a temporary QA retry rather
  than an evidence failure.
- Unknown evidence citations, unsupported quantified claims, unsupported URLs, invalid sequence structure, sender
  placeholders, generic company signatures, Hunter/internal references, an incorrect mailbox-first-name signature, or semantic
  grounding errors fail closed and remain visible on the plan.
- **Repair failed QA plans** rechecks a saved `MODEL_QA_UNAVAILABLE` sequence directly with the critic and does not
  regenerate its strategy or email copy. A passing retry promotes the existing plan to `QA_PASSED`; genuine semantic
  findings remain failed and continue through the established model-regeneration path.
- Exact evidence-ledger annotations and whitespace-only corruption of a known evidence ID are repaired
  deterministically before QA and do not spend another model call. The bulk repair action applies that same safe
  correction to existing failed plans. Unsupported claims use bounded model regeneration; missing evidence, sender
  routing, or model QA availability remains a human-review failure.
- Editing the first email changes the plan to `QA_FAILED`, clears approval, and blocks Apollo. Regenerate to produce a
  new immutable version and rerun every check.
- A current unapproved plan blocks Apollo even when the contact's legacy cadence tier would not normally require a
  Newl draft. Correct or regenerate and approve the plan instead of bypassing the gate.
- Bulk approval reports the first saved QA finding for a genuinely failed plan. An already-approved plan is reported
  separately and directs the operator to **Retry approved in Apollo** or **Sync Apollo status** instead of incorrectly
  claiming that grounded QA failed.
- Contacts without a concrete usable email stay in tenant-scoped storage for audit and later Apollo recovery, but are
  hidden from Needs Attention and Active Cadences because they cannot be actioned.

## Apollo enrollment is active externally but missing from Active Cadences

- Active Cadences is driven by the tenant-scoped contact's confirmed `ENROLLED` state for the exact selected Apollo
  cadence; an accepted API request alone is not treated as enrollment.
- A pending push normally stores a durable cadence-confirmation marker. If that temporary marker is missing, the
  reconciler falls back only to the contact's saved exact selected cadence ID, checks live Apollo membership, and
  repairs Newl Apps when that exact membership is active. It never sends a second enrollment request during recovery.
- The hourly Apollo status sync also removes a stale push blocker when the exact selected cadence is confirmed active.
  A missing selected cadence ID or a different live cadence still fails closed and remains in Needs Attention.

## Apollo shows a bounced or permanently undeliverable Hunter contact that remains actionable

- Apollo can show an exact cadence as `Bounced` or `Not sent` while its contact-detail response omits both campaign
  membership and delivery status. Permanent `Not sent` cases include explicit invalid-MX, bad-data,
  recipient-domain, spam-blocked, hard-bounce, and provider delivery-failure reasons. Newl Apps therefore checks
  Apollo's zero-credit outreach-email search for every due contact with an exact selected cadence.
- The fallback is bounded to ten 100-record pages per cadence and reused across contacts in the same sync. It matches
  exact Apollo contact ID first and normalized email second. A confirmed terminal match persists the existing
  `BOUNCED` enum, records Apollo's exact reason and evidence in the contact audit payload, removes the contact from
  Needs Attention and Active Cadences, and displays it in the read-only Delivery Failures view.
- A failed or rate-limited fallback fails the affected sync visibly. The reconciler never guesses from Apollo's
  user-configurable `Bad Data` contact stage. A successful sync reports unmatched Apollo delivery failures instead
  of silently ignoring them.
- Contact discovery and rechecks preserve terminal sequence state and the existing nested Apollo audit metadata.

## External signal discovery or classification fails

- A GDELT 429/5xx response receives bounded retries and is recorded before the worker tries the RSS fallback.
- If every configured discovery transport fails, the tracked run becomes `ERROR`; it must not be recorded as a successful zero-result day.
- If Ollama is unavailable, returns non-JSON output, omits source rows, invents an unsupported enum, or emits a confidence below 50, the affected classifications fail closed.
- A failed daily attempt is not retried every minute. The operator can diagnose the run and use `--signal-scout-now` for one explicit rerun.
- Turning off `HUNTER_SIGNAL_SCOUT_ENABLED`, the Hunter policy, or the Hunter kill switch prevents the automatic scout from creating new signals.
- Discovery-source licensing and acceptable-use review remains an enablement prerequisite. The code and example environment default the scout to off.

## Company deep research fails

- A missing search or Kimi credential, unavailable local Qwen, total search-provider failure,
  incomplete structured output, company outside the prepared tenant cohort, forged URL/domain pair,
  or invalid score arithmetic closes the tracked run as `ERROR`.
- Ollama schema-constrained output can still be truncated by an output limit, wrapped in prose by a
  model, omit a requested company, or violate a required field. Hunter extracts a recoverable JSON
  object, reports safe parse coordinates and completion metadata instead of a generic error, splits a
  failed multi-company batch into individual companies, and gives each affected company bounded repair
  attempts. A company that still fails is omitted from that completion and remains eligible for later
  research; it does not prevent valid companies from reaching Kimi.
- Paid retrieval is atomically checkpointed before Luna runs. The checkpoint contains no provider key,
  is written with mode `0600`, is fingerprinted to the local date, prompt version, and ordered tenant
  cohort, and is reused only for an exact same-day match. Transient preparation, provider, database,
  rate-limit, connection, and timeout failures receive no more than three worker attempts. Once a run
  exists, each retry references that tenant-owned failed run and the server reconstructs the exact cohort;
  therefore a Luna or Kimi failure does not repeat Brave searches. Invalid schemas, identity failures,
  and configuration errors do not enter an automatic retry loop.
- The optional Luna comparison runs only after Qwen has a valid final row and consumes the same bounded
  evidence; it never repeats Brave retrieval. Missing server OpenAI configuration disables the shadow
  visibly. A Luna refusal, timeout, malformed Structured Output, partial batch, or provider failure is
  stored as `PARTIAL`/`ERROR`, reported in the Teams comparison summary, and cannot fail or change the
  normal Luna/Kimi completion. Successful batch fingerprints are reused on a same-run retry.
- With a Teams target configured, a transient company-research failure sends a sanitized recovery notice,
  an exhausted or permanent failure sends one final sanitized alert, and a
  completion reports researched, accepted, blocked, and model-output-omission counts. Provider response
  bodies, search excerpts, credentials, local paths, and raw exceptions are not sent to Teams. Control Tower
  exposes the current attempt and safe checkpoint stage without exposing checkpoint contents.
- The completion API accepts at most 24 evidence records per company and validates the cohort atomically.
  Follow-up queries therefore stop before a full evidence ledger, append only into remaining capacity,
  and the worker bounds both resumed checkpoints and the final completion payload. A legacy over-cap
  synthesis checkpoint is resynthesized against its bounded evidence so saved indices remain valid.
- A failed completion is not partially persisted and does not refresh the prospecting plan. The
  operator may use the exact-cohort dry run and local replay ledger to diagnose it.
- A 30-company completion can exceed Prisma's default five-second interactive-transaction timeout
  when tenant identity is re-read one company at a time before each evidence upsert. Completion
  preloads the complete tenant-scoped company identity map in one query and uses an explicit
  30-second transaction timeout, still below the route's 60-second execution limit. A timeout rolls
  back every signal and the run update; the saved synthesis checkpoint can then be resumed.
- Individual query failures remain visible in a valid completion, but deterministic evidence-count,
  pass-coverage, identity, logistics-provider, stable/exclusive external-provider, and geography gates fail closed. Transport success
  with weak evidence cannot become a high-priority opportunity.
- Legal-name-only retrieval can miss first-party material for regional subsidiaries. Hunter therefore
  queries bounded legal-name, brand, and regional aliases and adds official-domain queries when a
  domain is known. Matching first-party identity evidence can correct an unsupported ambiguous
  synthesis label.
- A full generic result set can otherwise consume the bounded evidence ledger before a later
  official-domain event query runs. Hunter executes every enabled query first and samples their
  results in rounds, preserving targeted first-party evidence without increasing the 24-record cap.
- A model's provider or incumbent label cannot block an account without explicit supporting language
  in the saved evidence. An undated claimed trigger is treated as current fit. Stale/no-opportunity
  research is retained on Watchlist for later research instead of becoming a permanent block.
- Long identity pages can mention unrelated Chinese operations or suppliers. Text-based China
  inference is applied only when the company's operating country remains unknown, so it cannot
  override a verified U.S. or Canadian identity.
- Qwen can overlook a strong result even when retrieval succeeded. Hunter deterministically restores
  a fresh trigger only when a non-directory result names the exact company, has a verifiable date
  inside 18 months, and contains strict material expansion language. That language includes new
  manufacturing or production lines at an existing facility; the repaired summary is grounded in the
  saved event instead of preserving a contradictory generic conclusion. The result must still pass
  Kimi scoring and K3 validation before becoming Hot.
- Qwen can label a company `FRESH` while citing an undated careers record even though the same evidence
  bundle contains a qualifying expansion article. Hunter repairs the trigger citations before applying
  the recent-date downgrade and pins the repaired evidence into both Kimi packets; otherwise the valid
  expansion could be silently demoted or omitted from hosted validation.
- Compact packet selection can otherwise favor a generic first-party page over later, more material
  records from the same pass. Hunter deterministically pins up to two exact-company dated expansion
  records and the strongest specific logistics-management vacancy before filling the remaining packet
  by pass diversity. Production-line investment/expansion language is included in the strict trigger
  repair; generic growth claims, directories, and undated pages still cannot create a fresh trigger.
- A salary or compensation page can mention a logistics-management title without representing an
  opening, while Qwen can cite a generic footprint page even when the ledger contains a real vacancy.
  Hunter requires explicit current-vacancy language and exact-company evidence, rejects salary records
  and expired postings, and deterministically hands the qualifying vacancy to the saved current-account
  citation. Generic responsibilities or qualifications, role taxonomies, job-description references,
  employee profiles, malformed careers rows, generic “Join our team” invitations, general applications,
  talent communities, and future-opportunity pages also fail closed. Opening or application language must
  be tied to the specific currently available role. When no qualifying vacancy exists, Hunter replaces the
  non-vacancy careers citation and removes unsupported hiring wording instead of turning a role reference
  into a claimed opening.
- A parent or affiliate expansion can otherwise win merely because it appeared earlier in the ledger,
  while wording such as “establishing a distribution center” can evade a manufacturing-focused trigger
  pattern. Hunter recognizes that facility language, orders material events by the most specific
  candidate-name match, and replaces the saved summary/citation when the model selected a weaker
  related-company event.
- A K3 validation outage does not discard completed retrieval, Luna synthesis, or K2.6 scoring.
  Selected fresh-event candidates are retained as Watchlist and cannot become Hot until a later
  successful validation. Current-account qualifications and deterministic blockers continue normally.
- Automatic research remains disabled unless `HUNTER_COMPANY_RESEARCH_ENABLED=true`. The Hunter kill
  switch or `OFF` mode prevents the server from preparing a cohort.

## Hunter quality control finds or misses a defect

- The auditor returns exactly one structured finding for each sampled signal. A missing, duplicate, or
  out-of-cohort signal fails the whole audit instead of partially recording a misleading result.
- A worker/Codex/schema failure marks the audit failed and sends a safe Teams alert. It does not
  reclassify a lead or queue a Rivet job from an incomplete audit.
- Evidence URLs use an HTTPS pattern in the Codex output schema. Do not add JSON Schema's `uri`
  format: the Codex structured-output endpoint rejects that format before research begins.
- Model-judgment, credential, runtime, and configuration findings are recorded and reported but do not
  auto-create code work.
- Reproducible retrieval, handoff, rule, or TradeMining code defects create Rivet work only when the
  exact standing-approval value is present. Without it, the Teams message says the defect was recorded
  but not queued.
- Related reproducible findings from one workflow are combined into one incident and one development
  packet. A queued, running, or review-blocked scope refuses sibling Rivet jobs. Review the existing
  branch and add evidence there before another development attempt.
- A second incident for the same reproducible workflow scope trips the seven-day circuit breaker.
- The auditor is a bounded daily sample, not proof that every classification is correct. The tiered
  sample, independent web research, deterministic TradeMining checks, and stored evidence make misses
  more likely to surface without pretending to eliminate all model or search-index risk.
- If Rivet fails while preparing or reviewing its branch, inspect the one consolidated worker diagnostic
  before treating the underlying Hunter findings as separate implementation failures. Rivet uses its
  dedicated runtime as the trusted Git source, validates required context against the fetched base
  branch, and exits immediately on an invalid packet. It never falls through with a blank base branch.
  Independent review occurs before PR creation: a blocked result preserves the branch and job evidence,
  sends the protected Teams notice, and opens no PR.
- Absence of a routine TradeMining Teams digest does not prove that the searches failed. Health & Logs
  remains authoritative. With `HUNTER_TEAMS_TARGET` configured, the current worker sends one settled
  daily digest and an immediate generic alert for each failed profile without exposing raw errors.

## A profile uses an unsupported arrival port

- Symptom: the profile cannot be saved, or a legacy profile run fails with a port-mapping error.
- Cause: TradeMining BOL Import Search accepts U.S. arrival ports. Canadian cities such as Toronto, Montreal, and Vancouver are not valid values for that field.
- Safe recovery: remove the unsupported value or select a supported U.S. port, move Canadian locations to **Consignee cities / destination markets**, save, and use **Run now**. The arrival-port field may remain blank.
- Prevention: the profile editor accepts an empty port list but validates every supplied value and normalizes common short aliases.

## TradeMining reports more records than it can export

- Symptom: coverage is marked **Retrieval incomplete**, or the run finishes `PARTIAL`.
- Safe behavior: Hunter first splits the lookback into disjoint date ranges, then splits a capped one-day multi-port query into port groups. It exports only leaf queries and records both the matched and exported totals.
- Remaining limitation: a one-day query with one or no arrival port cannot be divided further with the supported filters. Hunter ingests the available export, marks it incomplete, and requires an operator to narrow the profile rather than claiming full coverage.

## A search profile cannot be saved

- Symptom: the profile editor shows an inline error.
- Safe recovery: correct the named field and submit again. Validation errors, including duplicate profile names, remain on the form and no partial profile mutation is written.
- Regression guard: server-action failures are converted to explicit form state instead of surfacing as a generic Next.js application error.

## A Canadian destination is configured as a city instead of a province

- Symptom: a Canadian profile unexpectedly returns zero or the manifest shows a U.S. city with the same name.
- Cause: TradeMining's `ConsigneeCity` autocomplete is U.S.-only. Its `ConsigneeState` lookup requires the selected country ID; resolving `Ontario` without Canada's ID returns no option.
- Safe recovery: configure `Ontario | Canada` rather than individual GTA cities. Hunter submits Canada and Ontario through their dedicated TradeMining fields and records their resolved IDs in the manifest.
- Regression guard: a sole fuzzy result such as `VAUGHAN, MS` is never accepted for `Vaughan`; province lookup must include `countryId=37` and resolve Ontario exactly.
- Limitation: BOLs whose visible consignee is a U.S. intermediary instead of the Canadian buyer may still be outside a Canada/Ontario consignee search.

TradeMining's HS-code field uses comma-separated codes rather than Boolean syntax. Hunter checks the result count before export and treats zero matching BOLs as a successful zero-record run because TradeMining's Excel endpoint returns an error for empty result sets.

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

## Apollo accepted but enrollment is not immediately visible

- Symptom: an Apollo push job shows `Pending confirmation` after Apollo returns success, but the contact is not yet
  visible in the requested cadence.
- Cause: Apollo sequence membership can propagate after the push response. A second failure mode was sending legacy
  body fields instead of Apollo's documented add-contact query parameters, which omitted the active/finished prior
  cadence overrides and could leave a no-reply contact with earlier sequence history unenrolled.
- Safe recovery: do not immediately re-push. Newl Apps rechecks with bounded backoff and the scheduled saved-contact
  sync. It promotes the result only when the exact requested cadence ID is visible. After ten minutes without that
  membership, it marks the job failed and exposes a blocker for review.
- Code guard: `src/server/integrations/apollo.ts` sends the documented query contract and parses current campaign
  statuses. `src/modules/lead-gen/actions.ts` and `apollo-status-sync.ts` reconcile the durable pending marker.
- Regression coverage: `tests/apollo-integration.test.ts`, `tests/apollo-push-jobs.test.ts`, and
  `tests/apollo-status-sync.test.ts`.

## Apollo person was selected but no saved contact ID exists

- Symptom: an otherwise approved contact is skipped with “Apollo contact ID is missing.”
- Cause: Apollo People Search identifies people, but only contacts explicitly saved in the team's Apollo database can
  be enrolled in a sequence. Earlier Newl Apps code treated the People Search record as enrollment-ready.
- Safe recovery: the enrollment worker now recovers an existing saved contact or creates/deduplicates one through
  Apollo's zero-credit Create Contact endpoint, then persists the returned contact ID before continuing. A missing
  concrete email, conflicting dedupe email, unreadable response, or absent returned ID still fails closed.
- Regression coverage: `tests/apollo-contact-preparation.test.ts` and `tests/apollo-integration.test.ts`.

## Apollo rejects a Hunter cadence key as an invalid ID

- Symptom: Apollo enrollment fails with a message such as
  `hunter-executive-referral is not a valid ID`.
- Cause: a plan created while the synced Apollo cadence directory was unavailable retained Hunter's internal catalog
  key. The enrollment worker previously passed that planning key directly to Apollo, which requires the live sequence
  record ID.
- Safe recovery: after the fix is deployed, retry the already-approved contact. The worker refreshes Apollo's live
  cadence directory and maps the exact managed cadence name to its unique active Apollo ID before any write.
- Prevention: unresolved, inactive, duplicate-name, or unavailable cadence data is a safe skip, and the low-level
  Apollo client rejects every known Newl Apps catalog key without making a request.
- Regression coverage: `tests/apollo-sequence-resolution.test.ts` and `tests/apollo-integration.test.ts`.

## Outreach is blocked by Hunter eligibility

- Symptom: Outreach Queue shows **Needs Hunter assessment**, **Hunter watchlist**, **Blocked by Hunter**,
  **Refresh Hunter research**, **Not selected by Hunter**, or **Hunter handoff incomplete**.
- Cause: the company has no current deep-research result, is not Hot/Qualified, is older than the configured freshness
  window, lacks a current `WOULD_PURSUE` decision, lacks K3 confirmation for a Hot opportunity, or has inconsistent
  service lines between research and planning.
- Safe recovery: do not reuse a legacy draft or force Apollo. Run Hunter company research and its dry-plan refresh,
  then review the resulting Daily Opportunity. Watchlist and Blocked records require new evidence or an explicit
  research replay; editing contact score or cadence cannot override the company gate.
- Prevention: the manual generation action, automatic generation path, Apollo queue action, and Apollo worker all
  evaluate the same tenant-scoped handoff. A model cannot override the required service line.

## Valid North American companies are blocked for unverified U.S. divisions

- Symptom: a U.S. or Canadian operating company is marked Blocked with `The claimed U.S. division is not verified by the cited public identity evidence`, even though first-party evidence confirms the local operator.
- Cause: the legacy deterministic check required the complete model-returned legal division name to appear literally on one identity page. Brand-only sites, omitted legal suffixes, and explanatory parentheticals produced false negatives.
- Prevention: apply the foreign U.S.-division proof only outside an already corroborated North American identity. For foreign/China entities, compare bounded aliases without legal suffixes or parenthetical annotations and still require explicit U.S. jurisdiction plus operating-relationship language.

## An unrelated similarly named logistics provider blocks a prospect

- Symptom: a manufacturer or retailer is marked Blocked because a search result for a different company with a similar short name describes freight, warehousing, or 3PL services.
- Cause: the provider-service gate evaluated explicit logistics language without first tying a non-first-party result back to the researched company identity.
- Prevention: first-party evidence may establish provider status directly. Non-first-party evidence must also contain a normalized alias of the researched company before it can trigger the provider block.
- Recovery: after deployment, force a tenant-scoped exact-cohort company-research replay for affected companies. The run reuses normal safety gates, refreshes the prospecting plan, and queues a handoff only when the tenant is explicitly in Assisted mode.

## Hunter reports no first-party site for an obvious consumer brand

- Symptom: a legitimate importer is blocked as ambiguous although a public brand site exists and another saved result may even mention its domain.
- Cause: legal-name search results were dominated by directories and the worker did not pivot from a candidate-matching discovered domain into the brand's legal/about/contact pages before scoring.
- Prevention: low-confidence, ambiguous, or uncorroborated identities receive a bounded identity-discovery pass.
  Candidate-matching domains found in saved evidence are searched for first-party legal, privacy, terms, contact,
  and about pages; added evidence forces a second Luna synthesis.
- Recovery: rerun only the exact affected company cohort after the worker and server fixes are deployed. Do not manually promote the account without saved first-party evidence.

## Assisted handoff stops after research

- Symptom: research and the Daily Opportunity are complete, but no contact or Outreach Plan appears.
- If a manual contact-discovery run stays `QUEUED` with zero processed companies while TradeMining is running, confirm
  the dedicated runtime contains `run_outreach_handoff_poller` and reinstall the launch service. The handoff poller
  must run independently of sequential TradeMining collection and ingestion. Verify that the original job records
  a per-company terminal result; do not queue a duplicate while it remains unfinished.
- Check Automation Settings first. `DRY_RUN`, `OFF`, or the kill switch intentionally prevents automatic handoff.
- Inspect the latest `HUNTER_OUTREACH_HANDOFF` job. `REVIEW_REQUIRED` means the immutable Apollo match must be
  resolved manually. `NO_CONTACTS` is also persisted in Apollo Exceptions: open the correct Apollo company,
  select its People page, and paste that URL rather than rerunning the same automatic search. `NO_QUALIFYING_CONTACTS`
  remains terminal for that saved run because employees were found but none met the buyer-role rules.
- Transient Apollo/model failures receive at most three server-owned attempts. The Mac worker resumes queued jobs
  during its normal loop, so research should not be rerun merely to retry the handoff.
- A QA-failed plan is preserved for inspection and cannot advance. It must not be silently regenerated until its
  evidence or generation defect is understood.
- `CONTACT_REVIEW_REQUIRED` means Apollo contacts were found but none cleared the buyer-role threshold. Inspect the
  saved `hunterContactFit` rationale and risks; do not lower the deterministic safety filter to force generation.
- If Apollo visibly contains stronger role-aligned employees than Hunter reviewed, verify that the handoff ran both
  the 100-result organization-scoped employee request and the always-run multi-title request. Finding an acceptable
  person on the generic first page must not short-circuit relevant-title retrieval. The buyer-role model receives the
  best 10 merged candidates; the configured `maxContactsPerCompany` limits final selection, not discovery.
- A saved Apollo account ID must be resolved to Apollo's nested global organization ID before every employee search,
  including when the Newl company has no stored domain. One partial account result must not be treated as the complete
  employee list.
  Compare the separate **Apollo people found**, **Buyer-role candidates**, and **Contacts evaluated** counters; a
  large drop identifies whether discovery, deterministic ranking, or model review caused it.
- Also verify that `organization_ids` contains Apollo's nested global organization ID rather than the saved account
  record ID. A legacy account ID that returns no employees may be recovered only from one exact organization identity;
  when Account View omits its nested organization object, retry the global organization ID already stored with the
  same reviewer-confirmed account mapping. When that exact query returns people, do not reject them merely because
  the embedded employer ID is a different saved Account ID or the employer label is an operating brand; Apollo uses
  separate identifier namespaces for saved Accounts and global organizations. The same rule applies when an
  authenticated reviewer supplied the canonical organization URL directly, but only when the manual mapping audit
  record's organization ID still exactly equals the company's current stored organization ID. This exception applies
  only to the exact reviewer-confirmed organization scope. Parent/sibling evidence from automatic, domain, or keyword
  recovery must still produce `MATCH_QUALITY_REVIEW` and an empty contact set.
- An HTTP 307 from the Mac-mini handoff worker means session middleware intercepted the machine route before
  ingestion authentication. `/api/lead-gen/hunter/outreach-handoff/*` is exempt from session middleware and must
  enforce its own tenant-bound ingestion token; regression coverage preserves that boundary.
- If the manual contact action says company research is missing despite completed runs, verify that every producer
  and consumer imports the shared `HUNTER_COMPANY_DEEP_RESEARCH` job-type constant instead of duplicating a string.
- If the handoff reports imported contacts and generated plans but Outreach Queue is empty, verify that the contact
  audience accepts a current non-archived Outreach Plan without requiring a Sales Lead, and that queue visibility
  treats the complete Outreach Plan as actionable work rather than requiring a legacy single-message draft.

## Apollo exception autopilot fails or repeats

- **Disabled/idle:** the environment flag is off, Hunter is not in Assisted mode, the kill switch is active, the daily cap is reached, or no new/materially changed eligible exception exists. This consumes no Brave, Luna, or Apollo work.
- **Same company appears again:** a new Apollo match or qualified research signal changed the identity fingerprint. An unchanged fingerprint is never searched twice, including after an ambiguous result or worker restart.
- **Worker dies mid-run:** the tenant-scoped 15-minute lease expires into an error. A later materially changed fingerprint may run; the failed packet and safe error remain visible for audit.
- **Public evidence is weak:** Luna must return `AMBIGUOUS` or `NO_MATCH`; the record stays in human review with candidate/source context and no automatic mapping.
- **Luna or Apollo is unavailable:** the worker calls the fail callback. No partial direct mapping is written before validated Luna output and deterministic Apollo selection complete.
- **Company changes while research runs:** completion revalidates that the source match is still latest/unreviewed and that the exact qualified Hunter research handoff is still eligible. Stale work fails before mapping.
- **Mapping succeeds but contact handoff cannot queue:** the direct identity remains preserved and the job records `queue_failed` in its handoff result. No outreach is sent; operations can retry contact discovery from the mapped company without rerunning public identity research.
- **Too many exceptions remain manual:** review the candidate margins and evidence. Do not lower the exact-domain or unique-direct-company gates merely to improve the automatic match rate.

## Apollo cannot safely match a company

- Symptom: Pipeline shows **Resolve Apollo match**, or bulk enrichment reports a company as protected from retry.
- Cause: Apollo returned no organization, a weak/ambiguous candidate, or a logistics provider rather than the TradeMining company. The previous implementation also sent internal identity-field names instead of Apollo's documented company-name filter, which could produce effectively unfiltered results.
- Safe recovery: open **Apollo Match Review**. Paste the correct Apollo company Overview or People URL when known,
  retry automatically only after correcting the company name/domain, or choose **Confirm no Apollo match**. Apollo
  `/accounts/{id}` links are resolved to the nested global organization ID when Apollo supplies it. A valid sparse
  shell retains its exact account ID for bounded recovery. Explicit reviewer confirmation is authoritative for
  company identity and overrides automated facility, legal-entity, parent, regional-brand, and provider-name
  similarity objections; the override and warning signals remain in the audit. Contact and outreach safety is still
  enforced independently.
- Credit guard: URL validation requires explicit acknowledgement of one Apollo credit. Automatic retry requires explicit acknowledgement of up to two returned organization-search pages.
- Prevention: once the latest match is unresolved, bulk enrichment performs no Apollo lookup for that company. Confirmed-no-match rows remain visible and blocked until explicitly reopened.
- Limitation: duplicate organization mapping is checked within the tenant in application code. A future additive unique database constraint could provide stronger protection against two simultaneous manual mappings, but requires separate migration approval.

## Apollo has the company but Hunter finds only saved contacts or no employees

- Symptom: Apollo visibly contains relevant employees, but Hunter repeatedly imports only one previously saved
  contact or reports no contacts after an organization-scoped search.
- Protocol check: Apollo's current People Search contract documents employee filters as URL query parameters. A
  body-only request can yield an unscoped/default result set that is then correctly rejected by Hunter's
  company-identity safety filter, producing a misleading zero-employee result. Hunter supplies the same bounded
  filters in the documented query string and keeps the existing response validation.
- Cause: an Apollo account ID was stored in `Company.apolloOrganizationId` and then submitted to People API Search,
  which requires Apollo's nested global organization ID. Apollo can expose both identifiers in the same account or
  saved-contact payload.
- Safe recovery: Hunter performs bounded Organization Search for unsaved companies, but Apollo intentionally omits
  already-saved accounts from that endpoint. When a mapped account produces at most one employee and Organization
  Search cannot resolve it, Hunter uses Apollo's zero-credit saved-account search to require the exact account ID and
  legal-company identity. If that name-filtered search omits the confirmed mapping, Hunter uses Apollo's zero-credit
  Account View endpoint with the exact saved ID. It reads the nested canonical organization ID and repeats both employee requests against
  that ID alone. When Apollo exposes no nested ID, the exact saved account's trusted domain is used for the retry
  instead of repeating the stale account ID. The expected domain validates the returned people instead of being combined with
  `organization_ids`, which could over-constrain a legal subsidiary mapped to an operating parent/brand. Saved-contact
  and People Search organization metadata remain a fallback for older records. Hunter filters every candidate back
  to the resolved organization and lets the existing direct-match transaction replace the stale identifier. If an
  explicitly confirmed saved account still returns zero through both organization and domain indexes, Hunter does
  not reinterpret the account ID as a supported People Search filter. It records the mapped-with-no-employees state
  and accepts at most three reviewer-selected Apollo person URLs through separately authorized email-only enrichment.
  This covers account pages such as YAT USA whose visible Suggested leads roster is not returned by Apollo's public
  global-organization or domain indexes.
- Domainless shell recovery: when the exact reviewer-confirmed account has no usable domain or roster, Hunter may
  search saved accounts by its distinctive leading brand. It accepts one canonical parent only when that exact
  parent name is present in the already-vetted Hunter/Kimi identity context. For example, the sparse
  `PRATT (ROCK HILL CORRUGATING)` account can resolve to `Pratt Industries` because the saved identity evidence
  explicitly states that operating relationship. A same-prefix but unmentioned company such as `Pratt & Whitney`
  is rejected.
- Ambiguity rule: a parent, subsidiary, sibling, or multiple exact organization candidate becomes
  `MATCH_QUALITY_REVIEW`; no contacts are imported and the AI buyer-role review is not run. Domain-wide employee
  results alone cannot authorize a match.
- Regression coverage: `tests/apollo-integration.test.ts` covers an Atlas Copco account omitted from Organization
  Search but present in the saved-account directory, domainless Stabilus and Salice account IDs, a Silfab legal-entity
  account resolving through its explicit Apollo parent relationship, a Dansons saved account with only a trusted
  domain, an exact Dansons account omitted by name search but recovered by Account View, YAT's explicit-person recovery
  after both organization and domain scopes return zero, wrong-employer rejection for a reviewer-selected person, and
  an unrelated Hyosung parent-company result failing closed.

### A mapped company stays in Apollo Exceptions or a visible employee is missed

- Symptom: the company URL maps successfully, but the row remains under **Needs review**, reports zero employees, or
  misses a role that is visible on a later Apollo page.
- Cause: the older path read only the first 25 saved contacts and did not reconcile a masked People Search identity
  back to the saved contact's concrete email. A second state bug could display **Recheck employees** for a persisted
  zero-employee mapping while the handoff worker rejected the same company because its latest immutable attempt had a
  review classification. In that case no Apollo employee request ran at all. A later queue-state bug did the inverse:
  contact discovery correctly persisted a verified `DIRECT_COMPANY` result with the zero-employee marker, but the
  exception eligibility filter discarded ordinary direct matches before honoring that marker. The failed company
  disappeared immediately after the lookup instead of remaining available for deliberate recheck. A separate identity
  risk allowed a manually supplied account to broaden into parent, sibling, domain, or keyword searches after an empty
  response, even though the reviewer had already selected the authoritative Apollo company.
- Safe recovery: map/recheck again after this release. Hunter reads up to 20 relevant saved-contact pages of 100,
  targets each shortlisted masked person by name/title/confirmed company, backfills saved identity, and reports the
  recovery counts in the immutable match reason. **Recheck employees** now uses the same persisted-mapping state as
  the exception queue and can repeat the read-only organization employee lookup. A reviewer-confirmed account is now
  opened directly by its immutable account ID, and only that account's linked organization ID is sent to Apollo People
  Search. No parent, sibling, domain, or company-keyword recovery runs for a manual mapping. An import/export specialist is
  evaluated as a relevant employee, but an individual-contributor title is still not automatically selected unless
  the buyer-role gate clears it.
- Credit boundary: saved-contact and People Search recovery is zero-credit. Paid email-only enrichment remains off
  unless the operator explicitly checks the separate authorization, is limited to three people, and disables phone
  and waterfall requests.
- Queue behavior: a direct company with at least one recovered employee leaves Apollo Exceptions. A direct company
  with no employees remains visible with the completed-search reason so it cannot spin silently. Queue eligibility
  still requires a current Luna/Kimi-vetted Hunter opportunity (or an approved legacy Qwen run); the zero-employee marker is the only direct-match
  exception. Unapproved plans attached to contacts that still have no concrete email are archived.

### Apollo People Search returns employees but Hunter still keeps the same saved contacts

- Symptom: an organization-scoped Apollo employee search visibly returns relevant operations or logistics people,
  but a Hunter rerun keeps only the previously saved contacts.
- Confirmed cause: People API Search uses `id` as the person ID and may return only the organization name, while the
  former shared parser treated `id` as a saved-contact ID and required the response to repeat the exact organization
  ID. The records were discarded before buyer-role AI review.
- Prevention: Apollo response parsing is source-aware. Organization-scoped People Search records may omit the
  returned organization ID, but any returned company identity must strictly match the expected company. Explicit
  sibling-company identities remain rejected.
- Data safety: a zero-credit People Search record remains not enriched and cannot overwrite a saved contact's
  revealed email, phone, LinkedIn URL, Apollo contact ID, or enrichment state. Records merge by Apollo person ID.
- Credit boundary: this fix finds and ranks employees without revealing email or phone data. A later enrichment
  operation can consume Apollo credits and remains a separate approved workflow.
- Regression coverage: `tests/apollo-integration.test.ts` uses Apollo's obfuscated People Search response shape,
  verifies person/contact ID separation, rejects a sibling name, and preserves saved-contact data during deduplication.
- Partial mapped-account recovery: when the mapped account ID returns at most one person and Apollo does not expose
  the nested organization ID, Hunter may repeat zero-credit People Search against the one unique organization domain
  carried by an exact-identity saved contact. Multiple domains, unrelated names, explicit organization-ID mismatches,
  and sibling identities still fail closed.

### Generated Hunter plans repeatedly fail QA for correctable formatting or provenance wording

- Hunter treats the saved cadence schedule as authoritative instead of accepting model-invented days.
- A repairable deterministic or model finding receives up to two automatic full-sequence regenerations in the same job.
  The repair prompt includes the exact findings, required channels/days, sender signature, valid evidence-reference
  rule, and a prohibition on customer-visible phrases such as “saved shipment activity.”
- Each repaired sequence reruns deterministic and model QA using the latest exact findings. Hunter never loops beyond two retries; a remaining
  failure is persisted with its final reason for human review.
- `MODEL_QA_UNAVAILABLE` is not retried as a copy repair. Transient provider retry belongs to the integration layer
  and must not create repeated drafting spend.

## Hunter queues fewer companies or shows fewer contacts than the page counters suggest

- “Saved Apollo contacts monitored” is the all-status population with a saved Apollo contact ID that the hourly
  reply synchronizer can poll. It is not the current handoff size or Outreach Queue size.
- “Contacts evaluated” is the bounded employee cohort submitted to buyer-role review. Only selected contacts with a
  generated Outreach Plan become actionable rows in Outreach Queue.
- The latest contact-discovery panel on Automation Settings records queued and processed companies, evaluated
  contacts, newly generated plans, already-current plans, total actionable plans, QA failures, and each company's terminal reason. Use that panel instead of inferring a
  run result from unrelated counters.
- A historical `Lead` row from the retired workflow must not suppress a researched account. Current-customer,
  blocked-company, do-not-contact, reply, and prior-sequence evidence still prevent duplicate outreach.

## Automatic Apollo status sync is stale or failing

- Symptom: the Contacts health panel shows **Setup required**, due contacts that are not draining, or contacts with sync errors.
- A contact that Apollo shows as bounced must not remain in Needs Attention. The parser treats both bounced campaign membership and a direct bounced email-delivery status as terminal; manual sync reads the exact saved-contact endpoint so the corrected state is persisted immediately.
- A batch with one failed contact is a partial sync, not proof that all contacts failed. Outreach Queue shows the exact failed contact, normalized error, failure count, and next bounded retry.
- Apollo's generic `PAUSED` status is not interpreted by itself. The sync reads the selected cadence's zero-credit message evidence: out-of-office replies remain monitored in Active Cadences, while no-longer-employed replies close that contact and queue replacement-contact review. An unexplained pause remains in Needs Attention.
- Setup recovery: confirm the dedicated `APOLLO_STATUS_SYNC_SECRET` and `APOLLO_MASTER_API` are configured in the deployment and that the tenant's Apollo integration is active. The Apollo scheduler deliberately does not use the shared `CRON_SECRET`.
- Rate-limit recovery: no manual replay is required. The failed contact receives exponential backoff and the unprocessed remainder stays due for the next hourly run.
- Non-transient recovery: inspect the latest run message and contact-level error. Deleted or unauthorized Apollo contact IDs continue to retry at the bounded failure interval until the local contact is corrected or removed.
- Concurrency guard: a tenant run younger than 30 minutes blocks overlap; an older running record is closed as an error before recovery starts.
- Scheduler visibility: any tenant-level `error` makes the scheduled HTTP request fail. GitHub Actions must therefore show a failed run rather than a green run with an error hidden only in the JSON response.
- Retry visibility: GitHub Actions does not retry the entire scheduled request. Retrying after failed contacts have been deferred could produce an empty 200 response and mask the original failed batch; only the service's bounded per-contact retries are allowed.

## A confirmed Apollo company repeatedly shows zero employees

- Symptom: Apollo's UI shows employees for a confirmed saved account, while Newl Apps reports zero and asks for
  individual people.
- Cause: Apollo saved-account IDs, global organization IDs, and saved-contact IDs are separate identities. A global
  organization search can be empty even when the same confirmed company is indexed through its domain. Apollo can
  also store duplicate same-brand accounts and combine their rosters in the UI while each public API organization
  scope remains separate. The `/people/<id>` UI route can carry a saved-contact ID rather than a global person ID.
  Repeated rechecks also create immutable match rows; the original reviewer confirmation must be queried directly
  instead of searched for only inside a bounded newest-attempt list.
- Recovery: use **Search company employees and build plans** first. It searches the global organization and trusted
  domain, expands verified same-domain duplicate account organizations, runs one strict company-keyword candidate
  fallback, and can resolve one identity-evidence-backed parent for a reviewer-confirmed domainless shell. It reads
  the bounded complete roster and merges saved contacts. Individual person URLs are a last-resort
  diagnostic only; their IDs are checked against Contact View before any separately authorized People Enrichment.
- Queue behavior: another complete zero result stays parked as **Mapped, no employees** and does not become a daily
  remapping task. Retry only after the Apollo identity changes or a deliberate operator recheck is requested.
- Safety: all recovered people still pass exact employer validation, deterministic role ranking, AI buyer-role
  review, concrete-email validation, and grounded outreach QA. A company mapping never authorizes communication.

## A TradeMining batch contains rows without a company identity

- Symptom: the ingestion batch returns `Validation failed` even though the TradeMining export and canonical summary completed.
- Cause: TradeMining can emit shipment rows with no importer, consignee, notify party, shipper, or master-party identity. Newl Apps intentionally rejects these because they cannot become company candidates.
- Safe recovery: Hunter quarantines and counts the rows as `recordsRejectedBeforeUpload`, then uploads the valid remainder. It must not invent a company identity from other shipment fields.
- Regression coverage: `tests/hunter-ingestion-adapter.test.ts` covers a mixed valid/identity-free export.

## A deleted or disabled profile is still queued

- Symptom: a manual run request exists after an operator removes or disables its search profile.
- Safe behavior: the worker resolves profiles only from the current enabled-profile API and rechecks the profile immediately before collection. Profile deletion cancels queued and running manual requests. A request already being handled may finish its current external HTTP call, but no later daily search starts from cached profile data.
- Regression coverage: search-profile action tests cover cancellation on deletion, and Hunter worker tests cover live profile resolution and once-daily eligibility.
