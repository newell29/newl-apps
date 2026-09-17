# Hunter autonomous research pilot

Evidence status: pilot and machine-route correction merged in PRs #553/#554. The owner deployed the
Production flag and the connected read-only pilot was validated on 2026-09-16. The research-continuity
correction described below is a separate reviewed rollout; implementation is not proof of live adoption.
Owner authorization: build the pilot, 2026-09-16. The owner-supplied location, company-size, service
and lane preferences are in `ops/openclaw/hunter/pilot-mission.md`.

## Scope

One Python loop chooses search, fetch, open-company, dismiss-clue, people-search, decide or wait actions. These are
choices, not mandatory stages. It reuses Hunter's public retrieval helpers, local Ollama or the existing
ChatGPT-authenticated Codex CLI, and Newl's
tenant/identity conventions. No framework migration, extra agents, database migration, dashboard,
outreach generation, approval or enrollment is included. Company research does not require TradeMining.

Two explicit modes exist:

* **Public discovery evaluation:** the existing ingestion-authenticated read of tenant search profiles
  binds the journal to the configured tenant. Profiles do NOT become its lead queue. That interface
  exposes no suppression/customer facts or Apollo data. People search is disabled. Recommendations
  become `needs_clearance`, never qualified or outreach-ready. Production's policy/kill switch cannot
  be read in this mode; local STOP and expiry govern this isolated evaluator. It cannot enter a live
  queue. This mode cannot validate the complete pilot.
* **Connected read-only pilot:** `/api/lead-gen/hunter/pilot/read` is an ingestion-authenticated,
  disabled-by-default endpoint using server-held credentials. It checks ingestion tenant, Lead Gen entitlement, stored
  Hunter policy/kill switch, suppression, current/former customers, source-account relationships,
  existing leads, replies, bounces, DNC and active/paused contacts. It calls only Apollo's documented
  zero-credit people-search endpoint. It never calls organization/person enrichment, contact creation,
  CRM writes, approvals, enrollment or messaging. The Mac never receives database or Apollo secrets.
  Activation requires reviewed deployment and `HUNTER_PILOT_ENABLED=true` on the server.

Deployment alone does not activate the pilot. The connected bridge requires an approved runtime
connection before live validation. Public-only results remain explicitly uncleared; this is not an
alternative way to pass suppression. Switching modes requires deliberate deployment/connection review,
not editing a note or marking a prospect accepted.

The exact `/api/lead-gen/hunter/pilot/read` path must bypass browser-session middleware so its own
ingestion authentication can run. Neighbouring pilot paths and the Hunter UI remain browser protected.
Missing/invalid machine credentials still return 401; an authenticated request with the server flag
disabled returns `PILOT_DISABLED`. A login redirect is an integration failure, not successful token
authentication. PR #553 initially omitted this exact middleware exemption; regression coverage now
routes requests through Next's matcher, middleware and the real ingestion authentication boundary.

No database migration is introduced by this pilot or its middleware correction. After the corrected
deployment is ready, activation requires the server flag on the intended environment and a separate
review of the worker's connected configuration. Preserve/rebind the existing private journal to the
authenticated tenant without resetting budgets or silently clearing prior holds. Validate context,
company clearance and a small zero-credit people lookup before enabling unattended connected work.

## Research and memory

The mission prioritizes Charlotte case picking, retail/Amazon replenishment and pallets; GTA case/pallet
work with a separately evaluated Vaughan partner; smaller/midsized hands-on ocean accounts on the
established lanes; and a Latin America experiment. Headcount is a soft hint. Larger warehouse
opportunities are welcome. Referral commercial roles and foreign market-entry prospects are allowed.
No universal provider or US-division ban is applied to public investigation.

Owner clarification, 2026-09-17: Newl's own GTA local trucking is also in scope. Discover local
manufacturers/distributors and logistics companies buying local carrier services, including airport
import collections, export deliveries and other GTA runs. A logistics provider can be a direct trucking
buyer as well as a referral partner. Missing fleet information is uncertainty, not proof of outsourcing
or buying intent. Equipment, payload, airport/secure/bonded access, service hours, rates and handling
fit need account-specific confirmation. The mission uses the existing `gta` direction, with the service
named in the hypothesis; coverage totals therefore combine GTA warehouse and trucking research. No
new workflow, quota, model, tool or budget is introduced. The mission is read at process startup, so a
running isolated pilot needs a controlled restart to adopt this brief; changing Git alone is not adoption.

Sources can include official announcements, retailers, trade/exhibitor directories, official websites,
operational changes and referral relationships. Trade data is optional. Recommendations need an actual
saved quote from a fetched official-domain page; snippets alone fail. This checks provenance, not every
commercial inference. Buying intent stays UNCONFIRMED and outreachReady stays false. Apollo results
are candidates with unverified employment; email availability is not a revealed/verified address.

Data lives outside the checkout in a private directory. An atomic, fsynced journal persists evidence,
companies, attempted searches, decisions, feedback and usage before external calls. One worker holds
the file lock. Do not initialize another journal to reset a pilot's budget. Query fingerprints ignore
case and word order; queries and people searches have a seven-day cooldown, pages one day. Interrupted
and failed attempts remain remembered. Semantic paraphrase detection is not claimed. Feedback enters
a separate atomic inbox so it can arrive while the worker is active; acceptance never authorizes outreach.

## Bounds and operation

Normal hours: weekdays 09:00–17:00 America/Toronto. Due wakes are at least thirty minutes apart, with
three model calls by default (hard maximum six for a supervised override) and ten minutes
of work per wake. An investigation continues from its journal across wakes; one wake is not a complete
market scan. Three actions per half hour spread the existing 40-call daily allowance over roughly
fourteen wakes when productive, rather than consuming it in seven large batches. These are ceilings,
not a required activity or lead quota; waits, model time and other budgets can reduce actual work.

Two unproductive actions yield to the next half-hour wake. A model-requested global wait is capped at
thirty minutes, even when an older proposal requests a day. Known companies use `decide/parked` with
their own revisit condition; one unavailable property page must not pause other research. Three
consecutive unproductive wakes expose `needs_review` and `researchNeedsReview=true`, then stop until
09:00 the next business day. This is a visible quality failure, not a claim that the market is exhausted.
The review flag remains visible outside business hours. No additional notifications or agents are added.
Parked/rejected companies retain a revisit date and condition. STOP is checked between
actions and during sleep; an in-flight call can finish within its timeout. Expiry ends the process.

The model receives per-direction search coverage and up to eight saved, unattempted public clues.
Coverage is derived from persisted attempts, including failed/empty calls; cached repeats do not inflate
it. Old completed attempts recover direction from their saved result; interrupted attempts missing
direction remain explicitly unknown. These hints do not force a rotation or mandatory research stages.
Previously attempted URLs and parked/rejected/blocked company domains do not become new unread clues.
A `dismiss_clue` action records why evidence for an unsaved company does not justify more work and
removes that evidence/domain from unread clues. It is local research memory, not a company rejection
or suppression decision. After an official named-company page is fetched for a stated uncertainty, the
mission asks the model to open it, dismiss it, or fetch one decision-relevant source before returning
to broad discovery. This continuity rule was added after an accelerated live trial completed twelve
useful Terra actions but repeatedly switched companies without saving a disposition.
Instructions distinguish businesses moving goods from available warehouse property or competing
service providers, and do not invent product-category exclusions or require explicit buying intent.

On first v2 wake, an inherited v1 `waiting`/`waiting_no_progress` timer longer than thirty minutes is
shortened and audited as `schedule_recovered`. A gracefully stopped worker also requires a recorded
model wait/yield cause; an unknown stopped schedule is preserved. Budget/error/review waits are preserved. STOP, expiry,
tenant and server-policy guards still run before model/tool I/O. Budgets, evidence, holds and feedback
are not reset. Do not initialize a fresh journal or reset allowances to make trial results look better.

Daily limits: 40 searches, 60 fetched pages, 20 free people searches, 40 model calls and 60 minutes of
model time. A call reserves its full timeout before execution; a crash does not refund unknown usage.
Paid search, when explicitly configured, reserves a conservative per-call price. New configurations
cap cash spending at US$5/day and US$10 total; existing configuration limits are not silently replaced.
An unknown/zero Brave price is refused. Default initialization uses DuckDuckGo and local
Qwen, with no paid API calls. No enrichment allowance exists. Initialize an expiry covering five business
dates, never an indefinite run. Q4 is an evaluation model, not a replacement for production research.

```sh
npm run test:hunter-pilot

# Example private path; choose the approved pilot end timestamp.
npm run hunter:pilot -- init --public-only \
  --state-dir "$HOME/.openclaw/agents/hunter/pilot-evaluation" \
  --env-file "$HOME/.openclaw/agents/hunter/.env" --expires-at 2026-09-22T21:00:00Z

npm run hunter:pilot -- once --state-dir "$HOME/.openclaw/agents/hunter/pilot-evaluation" \
  --env-file "$HOME/.openclaw/agents/hunter/.env"

# Foreground process for the existing supervisor; does not install a schedule.
npm run hunter:pilot -- serve --state-dir "$HOME/.openclaw/agents/hunter/pilot-evaluation" \
  --env-file "$HOME/.openclaw/agents/hunter/.env"

npm run hunter:pilot -- status --state-dir "$HOME/.openclaw/agents/hunter/pilot-evaluation"
npm run hunter:pilot -- report --state-dir "$HOME/.openclaw/agents/hunter/pilot-evaluation"
npm run hunter:pilot -- feedback --state-dir "$HOME/.openclaw/agents/hunter/pilot-evaluation" \
  --env-file "$HOME/.openclaw/agents/hunter/.env" \
  --company supply.example --verdict poor_fit --note "Synthetic example: unsuitable operating profile"
npm run hunter:pilot -- stop --state-dir "$HOME/.openclaw/agents/hunter/pilot-evaluation"
```

`once --force` permits a supervised wake outside hours but cannot bypass safety, budgets or expiry.
On the approved local Mac, `python3 ops/openclaw/install-hunter-pilot.py --state-dir <private-path>
--env-file <existing-private-Hunter-env>` installs a separate `com.newl.hunter-pilot-evaluation`
LaunchAgent. It requires a clean committed worktree, permits ONLY public-only DuckDuckGo/zero-spend
configuration, refuses an existing service/STOP file, and restarts crashes without restarting successful
expiry/shutdown. It never modifies `com.newl.hunter-worker`. Keep the worktree until the trial ends.
`status` shows aggregate health, process liveness, heartbeat freshness, completed/next wake, expiry,
dispositions, errors and usage. Liveness alone is not success. The private `review.md` contains public
company evidence, uncertainty and next actions; it excludes blocked-company records and raw contact
rosters. Do not attach live journal/credential files to Git or PRs.

## Validation

1. Hermetic cases use synthetic records for observed failure shapes: tenant injection/drift, missing
   access/policy, kill switch, suppression, customer/contact holds, domain conflicts, empty/partial/masked
   Apollo responses, referral roles and tracked contacts. This is not twenty replayed historical accounts.
2. Worker tests check forbidden tools, missing/invented evidence, redirects, budget reservation before
   failure, local day rollover, restart dedupe, waits/hours, expiry, STOP, feedback and public-mode limits.
3. Run real Qwen/public retrieval, inspect its actions and a completed investigation, restart, and verify
   remembered attempts/cost. Report model/retrieval failures; startup alone is not acceptance.
4. After the connected bridge has approved access, validate a small company/contact sample against
   actual suppression and official employer evidence. No enrichment or record writes during this check.
5. Five-day target: ten worthwhile recommendations without padding, at least eight commercially accepted
   without contact repair, zero wrong-company/suppression breaches, under ten minutes/day of owner work.
   Review source diversity, rejection reasons, accuracy and spend. Public-only mode leaves contact
   accuracy and suppression clearance UNVERIFIED and therefore cannot pass the full acceptance gate.
6. Outbound effectiveness requires a separately approved sending batch through existing Newl Apps controls,
   then reply/conversation/quote tracking. This pilot neither enables nor simulates sending.
7. Before promoting a model, compare Q4 and Q8 on the same saved evidence and ten owner-labelled decisions.
   Measure commercial fit, unsupported inferences, buyer accuracy and elapsed time. Quantization is not
   a quality guarantee; the initial small comparison did not establish a Q8 advantage. A stronger model
   comparison requires an approved existing model budget, not automatic paid fallback.
8. For the continuity correction, first reproduce the long global wait and missing alternatives with
   synthetic tests. Verify repeated half-hour wakes, preserved budgets after restart/upgrade, a pivot
   after a blocked clue, and a visible stop after repeated failure. A small supervised local-model
   trial may use the remaining existing daily allowance; setup and validation usage must remain
   distinguishable from unattended business results. Do not call masked contact candidates verified
   buyers, or count a search result as a qualified opportunity.
9. Review at least two normal business days after the revised worker is deliberately adopted. Inspect
   multiple completed research sessions, source/service diversity when initial clues stall, completed
   company decisions, supported Newl fit and contact gaps. Keep the five-day commercial acceptance
   target above; neither a test pass nor more searches proves effectiveness. If the model still cannot
   pivot, classify this as a failed model/control trial before increasing spend or adding machinery.

## Implementation verification, 2026-09-16

Focused route/service tests and the Python regression suite passed, along with typecheck, lint and a
local Next build. The repository suite reported 2,557 passing tests, two skipped and three failures
caused by sandbox denial of a localhost test server. All eight tests in that affected file passed when
rerun with permission to bind locally. No production or Preview database operations were run.

The supervised public evaluation used real local Q4 inference, public search and page retrieval. It
persisted across process restarts and parked an independently discovered company when its own new
warehouse weakened the outsourcing hypothesis. Live testing exposed incomplete tool arguments,
navigation-heavy extraction, a missing page, display-name/domain confusion and cache outcomes missing
from the model's feedback; the model also repeated proposals after receiving cache feedback. The final
context supplies observations rather than its own proposal/token logs, and stalled wakes back off for
a day. Regression cases cover
the resulting fixes. This establishes a working research loop, not sales effectiveness, validated
contacts or a qualified opportunity. Private run history retains the failures and charged usage.

The existing Vercel Preview build invokes migrations and Teamship-user provisioning. Publishing a
branch/Preview therefore needs separate approval for that existing setup; a local build does not do
those operations. That was the deployment limitation at the initial public evaluation; subsequent
connected integration checks are recorded below. Commercial/contact acceptance remains unproven.

### Continuity correction validation, 2026-09-16

The connected bridge passed a real tenant/context check, one company-clearance check and a zero-credit
Apollo lookup returning two masked candidates. These were supervised integration checks, not verified
buyers or proof of unattended research quality. No outreach or CRM/Apollo record writes occurred.

Eight initial synthetic regressions reproduced the existing long-wait, session-size and context gaps.
The expanded Python suite now has 55 passing cases; the route/service/middleware/worker Vitest command
passes 47 checks, including the Python suite wrapper. Lint, typecheck and the local build pass. The first
typecheck/build encountered an out-of-date generated Prisma client; `prisma generate` from the existing
unchanged schema repaired the local generated types. No migration or database operation was run.

Using the original journal and remaining daily allowance, a supervised three-action trial with local
`qwen3:30b-instruct` chose a different clue, searched and fetched an official company page, then tried
to decide an unsaved company and was rejected. The company was another logistics provider; it did not
establish a useful buyer. Tool instructions were clarified to permit abandoning unsaved clues without
creating a company merely to reject it. One subsequent call with installed
`qwen3.8-rvn:q8_0-multilingual` shifted its stated aim toward actual shippers, but still searched the
same Charlotte facility-expansion theme. Neither test produced a qualified recommendation. The
contexts differed, so this is diagnostic evidence, not a controlled model ranking or Q8 promotion.

All four model calls were charged to the existing 40-call daily limit. Total recorded paid API spend
remained zero. The unchanged v1 background runtime was resumed; its own exhausted-budget path schedules
the next wake for 09:00 on September 17. No budget/history reset, model promotion, new schedule, paid
fallback or unattended v2 rollout was performed. The correction removes a demonstrated control failure;
local-model commercial judgment remains an open acceptance risk.

## Compatibility and rollback

Open PR #476 changes the legacy research/scout workers and schedules. The pilot adds separate files and
reuses public retrieval helpers; review those contracts if #476 merges, and do not fund overlapping
research cohorts. PR #64 changes the legacy Apollo/outreach flow; this adapter does not use its enrollment
logic. Current main was fetched for the isolated worktree. Existing flags/schedules remain unchanged.

Rollback: STOP and terminate only the pilot process/supervisor; retain the private journal for audit.
For the optional LaunchAgent, `launchctl bootout gui/$(id -u)/com.newl.hunter-pilot-evaluation`
unloads only the evaluator. Its plist can then be removed after confirming that exact label.
No database rollback or existing Hunter restart is needed. Production deployment, connection approval,
paid enrichment and sending remain separate decisions.

The continuity correction changes only the local worker, its instructions, synthetic tests and this
runbook. UI, API route, server action/service, schema, tenant permissions and Apollo adapter are unchanged;
the existing route/service/middleware tests remain required. It requires no database migration or new
Vercel setting. Merging the PR does not update the Mac LaunchAgent automatically: after review, stop only
the isolated pilot, retain a private state/config backup, select the reviewed runtime source, and resume
the same journal with its original expiry and remaining budgets. Keep the old runtime worktree until
the service no longer references it. Never repoint or restart the legacy Hunter worker for this change.

## Subscription Terra / Brave comparison, owner-approved 2026-09-16

The owner approved this setup and explicitly selected GPT-5.6 Terra through the existing ChatGPT plan.
This supersedes the earlier zero-paid-search trial only for bounded Brave retrieval. It does **not**
authorize OpenAI API-key billing, paid enrichment, outreach, production deployment, or a budget reset.

The existing OpenClaw worker scripts use Codex CLI for subscription inference. OpenClaw's ordinary
`openai/...` provider is separately API-key authenticated on the inspected host. The pilot therefore
reuses the subscription CLI path, not that API provider or a newly created OpenClaw agent. Authentication
is checked through `codex login status`; credentials are never copied, extracted or passed in a prompt.

`pilot_subscription_model.py` permits only `gpt-5.6-terra`, checks ChatGPT login before every call, strips
business/API credentials from the child environment, ignores user configuration, and runs in an empty
temporary directory with a read-only sandbox. Shell, apps, plugins, hooks, subagents, computer/browser
tools and built-in web search are disabled. The model returns one structured proposed decision; Hunter
alone performs retrieval and business actions through the existing deterministic executor. Unexpected
tool events, incomplete output, missing usage, failed authentication and timeout fail closed. A completed
non-tool `error` item emitted by the CLI is counted as a passive diagnostic when the same turn has exactly
one valid structured result and `turn.completed`; actual command/tool items and unknown item types remain
rejected. Top-level errors and failed turns still fail closed. The process
group is killed on timeout. No alternate model, API key, hidden web search or paid fallback is attempted.
Subscription failure pauses until the next business morning, with a visible error. Plan usage remains
shared with other ChatGPT/Codex work; zero API fees do not mean unlimited subscription capacity.

Approved runtime configuration (private file; preserve tenant, expiry, evidence and all counters):

```json
{
  "modelProvider": "CHATGPT_SUBSCRIPTION",
  "model": "gpt-5.6-terra",
  "reasoningEffort": "medium",
  "searchProvider": "BRAVE",
  "searchCostMicros": 5000,
  "comparisonCases": 10
}
```

The approved cash caps are US$5/day and US$10 **total**, including evaluation searches. Keep the existing
40 calls / 3,600 model seconds / 40 searches / 60 pages / 20 zero-credit people searches daily limits.
There is no automatic increase because a comparison needs more calls. The current expiry stays unchanged.
Set `codexBinary` only when the supervisor PATH does not expose the existing CLI; it must be a trusted,
already installed executable. The basic installer intentionally still refuses replacing a running service
or enabling paid/connected operation. Apply the authorized runtime update with a private backup and the
worker lock, then repoint only `com.newl.hunter-pilot-evaluation` to the exact tested commit.

### Matched evaluation without another production workflow

For up to ten eligible wakes, capture the exact same context for Terra, local Qwen 3.8 Q4 and local Qwen
3.8 Q8. Only Terra's action is executed. Both local alternatives use thinking with a 4,096 generated-token
ceiling and 180-second timeout. They are recorded for human comparison and never score, approve, overrule
or execute a lead action. Each inference charges the same durable daily counters before starting. A
comparison wake therefore normally uses all three model calls for one real action and two shadow
proposals; after ten cases the normal three-action wakes resume automatically. Partial/failed comparisons
remain visible and are not silently repeated. Local connection and socket timeouts are contained in the
shadow record and cannot stop the primary Terra wake. STOP, tenant policy and expiry apply before shadow calls too.

This evaluates decisions on identical packets. It is not a randomized end-to-end model ranking or ten
owner-labelled companies. Assess buyer/provider classification, supported Newl fit, sensible next action,
repetition, correct abandonment, latency and incomplete outputs. Allow two subsequent business days of
Terra research to evaluate completed investigations and owner intervention before declaring success.
Preserve the business acceptance criteria above; research activity is not sales effectiveness.

`compare-search --query-file <private-json-path>` compares up to ten identical query strings through
DuckDuckGo and Brave, five results per provider, using the same journal, lock, policy checks and cash/
search limits. This explicit experiment is the only intentional paired duplicate lookup; completed or
interrupted provider attempts are never silently rerun. Results stay in `searchComparisons`; they do not
create companies or recommendations. Review relevant shipper/partner results, first-party evidence,
duplicate domains, empty/error rates and latency. URLs alone do not establish an opportunity.

`preflight` verifies the live tenant read boundary and subscription login without making an inference.
It is not evidence that Terra has completed a research decision. `status` reports the model provider,
comparison counts, remaining operating state and spend; `review.md` includes the proposed alternatives.

### Verification and scope

The expanded synthetic suite covers subscription-vs-API authentication, environment isolation, strict
output normalization, missing/partial outputs, usage requirements, unexpected tools, process timeout,
Qwen thinking limits, identical comparison packets, partial-budget recovery, stopped inference, paired
search cost accounting and restart deduplication. Runtime observations must be reported separately from
these tests. Today's original 40 model calls are exhausted: the next model run must wait for the existing
next-business-day budget, not use a fresh journal or a synthetic date.

This addition changes only local worker code, tests and documentation. UI, API routes, services, schema,
tenant/suppression rules, contact permissions and Vercel settings do not change. No migration is required.
Existing Preview build automation can still run its established Preview-only database preparation when
the PR is updated; it is not a Hunter schema change or production deployment. Open PR #476 modifies the
retrieval helper reused here but has no direct file overlap; revalidate that contract if it merges.

### Setup observations, 2026-09-16

The authenticated tenant read and existing ChatGPT login passed preflight; no model inference was made.
Ten manually chosen public research queries were submitted to both retrieval providers using the original
journal: all twenty requests completed, returning 50 DuckDuckGo and 48 Brave result rows. The conservative
Brave reservation was US$0.05. This was supervised retrieval validation, not autonomous lead generation.
No company/contact records or recommendations were created by the comparison. The original daily model
usage remained 40/40, so Terra and matched Qwen inference must begin at the next permitted business wake.

Manual review found mixed relevance: Brave surfaced useful company/market-entry results; DuckDuckGo had
more directly relevant importer and explicit partner pages for some briefs. Both providers returned poor
results for ambiguous pallet and regional-expansion queries. This does not establish either provider as
commercially superior; query selection and follow-up judgment remain the primary evaluation questions.
Public result titles/URLs remain private evaluation material, not source-controlled customer fixtures.

Validation: 72 Python cases and 47 focused Vitest checks passed (the latter includes the Python wrapper).
`prisma:generate`, `typecheck`, `lint`, `build` and `git diff --check` passed. Client generation used the
unchanged Hunter schema; no production migration, credential change, enrollment or communication occurred.
The local-worker PR has no browser behavior changes; Vercel Preview remains a build compatibility check.
