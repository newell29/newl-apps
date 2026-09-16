# Scout marketing specialist

Evidence status: implemented on the redesign branch; production activation requires the reviewed merge, runtime update, and owner configuration. Business priorities and success thresholds are not inferred approval.

## Ownership and architecture

Newl Apps owns the marketing objective, priorities, qualified-enquiry definition, rolling research budget, work history, approvals, and measurement evidence. The external Scout worker selects one due item, investigates it with public web search and a bounded context packet, then saves its result through the tenant-bound `/api/website-growth/scout/work-items` API. It cannot send, approve, publish, change priorities, or change permissions.

The default `/website-growth` view is the marketing workboard. `/website-growth/pages` retains the complete page brief/build workspace, `/website-growth/backlinks` retains publisher approval/execution, and `/website-growth/signals` retains raw evidence. `/website-growth/marketing` is a stable direct workboard link.

One wake handles one research step. The model chooses the item and explains its selection; there is no prescribed sequence of marketing tactics. The application enforces 1–20 steps per rolling 24 hours and 1–10 items concurrently being researched or awaiting review. Defaults are six steps and three active items, with research paused. These are proposed operating defaults, not production activation or approved business targets.

## Durable work

Typed version-1 records reuse `AutomationJobRun`: `WEBSITE_GROWTH_SCOUT_MISSION`, `WEBSITE_GROWTH_SCOUT_WORK`, and `WEBSITE_GROWTH_SCOUT_STEP`. No database migration is needed. Tenant-derived deterministic IDs prevent duplicate reconciliation records; source records and every read/mutation retain `tenantId`. Serializable transactions enforce budgets and ownership, and revision comparisons reject concurrent/stale edits. Each claim gets a 30-minute lease. A lost completion acknowledgement is idempotent for that lease.

Work states are Ready, Working, Needs review, Waiting, Done, and Dismissed. Waiting includes a dated next action. Build/uncertain-send waits are excluded from research claims. Owner feedback uses an explicit decision field, preserving the choice even when submission omits the clicked button. Recoverable review errors remain beside the form, and entered feedback survives a retry. The bounded event history retains recent decisions; immutable step jobs retain the rolling budget independently of history trimming.

Reconciliation finds existing page candidates, unanswered publisher replies, published page drafts, and one open-ended research item. A completed research brief makes room for the next one without a weekly quota; dated waits and unresolved reviews remain respected. The worker carries recent completed and dismissed decisions into its next investigation, excluding private publisher conversations from public-search turns. A rejected/deferred research item is remembered instead of being selected repeatedly. New research or an outcome review can propose a new page: Scout then receives a page task and prepares the full brief before seeking owner publishing approval. Researched publisher prospects go through the existing relevance, quality, spam, dedupe, retention, and human-approval controls. No prospect promotion authorizes outreach.

Page results use the existing complete draft contract and claims/approval/build path. Approval/build/publication status is reconciled back onto the workboard. Published pages receive a separate outcome task. Raw analytics can still be refreshed independently through the existing weekday check-in.

## Publisher conversations

Reply sync covers contacted and replied opportunities with recent outreach history, ignores already-recorded replies, prioritizes opt-outs, and continues tracking new replies after an owner-approved response. Scout prepares an exact subject and body. An Admin/Manager with mutation access sees the recipient and text and explicitly approves sending.

The server refreshes replies before sending, rechecks the recorded latest reply, original opportunity approval, consent evidence, country, suppression, and the shared daily follow-up/response cap. It stores human approval and reserves a unique message ID before calling Microsoft Graph. It adds the standard business/legal footer. Microsoft Graph acceptance is recorded as acceptance, not proof of delivery or placement. An uncertain result remains held for mailbox reconciliation and cannot be restarted through ordinary work review. This worker has no sending tool; sending occurs only through the authenticated human action.

## Outcome measurement

The baseline is the 28 complete days before publication. The comparison is days 1–28 after publication, excluding publication day and allowing four days for data availability. Search Console clicks/impressions, GA4 sessions/engaged sessions, and aggregate first-party enquiries are fetched independently for the exact route. A failed source is unavailable, an empty analytics result is no matching rows, and neither becomes an invented zero. Successful empty first-party enquiry counts are zero.

The server saves the raw aggregate measurement separately from the model's interpretation. Scout must report evidence limitations, insufficient volume, seasonality, and concurrent changes. Before/after movement is association, not causal lift. Form submissions are enquiries; they are not qualified leads until an owner definition and qualification mapping exist.

## Research dedupe and recovery

The legacy discovery ledger now suppresses only successfully reviewed URL hashes from successful runs for 30 days. Fetch failures, incomplete review, and old ledgers without per-URL completion evidence are eligible for another attempt. Curated prospects remain independently deduplicated regardless of age. Research failure never authorizes repeating an external send.

## Runtime and cutover

1. Review the draft PR and authenticated Vercel Preview, including paused setup, work states, and exact-response approval.
2. Merge through the normal owner-controlled process. There are no schema migrations in this change.
3. Update the dedicated runtime checkout to the reviewed commit. Run `ops/openclaw/install-scout-marketing.sh`; it creates a disabled weekday hourly wake from 09:00–16:00 America/Toronto. It does not enable or modify live schedules automatically.
4. Confirm services/markets, qualified-enquiry definition, and budgets in Newl Apps. Enable research and the reviewed runtime wake. Keep the independent evidence check-in, approved backlink executor, and build notifier.
5. When the mission is enabled, legacy deep content/backlink preparation returns `managed` and the legacy machine producer returns no draft. Existing approvals and builds remain valid. Disable the redundant legacy deep schedules after confirming the new wake. An in-flight legacy run must finish before cutover.
6. Run one research-only item and review the saved artifact. Run a separately approved controlled outreach test only after reviewing recipient scope. Verify a measurement task against known synthetic preview records.

The worker uses the existing protected Scout environment and subscription-backed Codex resolver. Application credentials remain in the Python wrapper. The model subprocess receives an allowlisted environment, ignores user/project execution rules and user configuration, runs outside a repository in read-only mode, and disables shell tools, apps, plugins, and multi-agent execution. Public search is enabled only for page and open-ended research. No live worker or send is run by unit tests.

Rollback: pause the research mission and disable the new wake. Saved work remains available. Resume legacy schedules only after any new research lease finishes/expires. Never retry an uncertain external message as part of rollback.

## Validation and limitations

Tests cover tenant-bound route authorization, read-only UI, budgets, concurrency rejection, expired/wrong leases, idempotent completion, draft approval isolation, stale conversation checks, exact-message reservations, uncertain sends, partially/completely missing analytics, and interrupted worker recovery. Existing Website Growth regression suites remain required.

The first release bounds work history reads at 1,000 items and source reconciliation at 60 page candidates, 40 replied opportunities, and 60 published drafts per wake. Worker selection receives compact summaries of at most 50 due items and 20 previous decisions; saved artifacts are loaded only for the claimed item. History archival/pagination and broader CRM qualification attribution remain future work. The separate website developer workflow, optional model-comparison configuration, and production runtime are not changed automatically. Authentication and vendor outages are surfaced; uncertain sends require human mailbox reconciliation. No SEO or lead-volume outcome is guaranteed.

Owner decisions: priority services/markets, definition of qualified enquiry, ongoing budget, and whether future campaign-scoped communication authority should replace individual response approvals. Current code grants no such expanded authority.

Codex runtime reference: [official non-interactive documentation](https://learn.chatgpt.com/docs/non-interactive-mode), [CLI commands](https://learn.chatgpt.com/docs/developer-commands?surface=cli).
