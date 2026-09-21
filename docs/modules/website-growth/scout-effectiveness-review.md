# Scout effectiveness review

Evidence status: implemented on the feature branch. Activation requires reviewed merge and the existing runtime cutover; no production deployment, migration, communication, or schedule change is performed by this change.

## Purpose and user flow

`/website-growth` and `/website-growth/effectiveness` show Page performance, Opportunities, and Work & impact. The existing `/website-growth/marketing` workboard remains the execution and decision surface. Admin/Manager with mutation access can refresh eligible saved evidence. The action reads Search Console, Analytics, aggregate enquiry, and page-inventory sources under the normal cooldown; it does not run the AI worker or consume a research step. Read-only roles see the evidence without a mutation button; server actions recheck module, mutation and role access. Pages read saved evidence and never call Google merely because someone opens or refreshes the browser.

The review compares two adjacent 28-day periods ending three days before the current UTC date. It covers routes observed in Google reports, first-party forms, and the existing repository/static inventory, including pages Scout did not create. The inventory source/date and reporting caps remain visible. It is not an exhaustive crawl, index-health check, Search Console query segmentation report, or proof every site page has been examined.

Traffic changes of at least ten clicks/sessions, at least 25%, and a baseline of at least twenty are investigation hints. Each page reports separate Search visibility, Visits, Engagement, and Enquiries/outcomes facets before assigning an overall direction. A page can therefore be Mixed when visits decline while engagement or enquiries improve. Position movement is interpreted inversely, so a lower average position number is an improvement. Small counts show Insufficient evidence. Exposure with at least one hundred impressions, CTR below 2% and position at most twenty prompts intent/query/competition investigation. These deterministic triage defaults are distinct from the editable mission's pilot success guidance; neither is statistical significance or authorization to rewrite a page.

Opportunities combine these hints with existing research/proposals, independent competitive context, and the supervisor's public research. Topics without current Search Console exposure remain eligible. Current page work is linked and reused; proposals for the same exact normalized route reuse an active opportunity regardless of title. Website publication, publisher approval, and actual sending retain their existing boundaries.

Work & impact distinguishes prepared briefs, approval/build handoffs, published pages awaiting data, and available post-change measurements. It includes hypothesis, publication date when recorded, measurement windows, before/after observations, source gaps, interpretation and a link to the original brief. Before/after movement is association, not causal lift. A brief or build does not prove publication or marketing success. Page research without a saved brief is excluded from Work & impact even if marked Done or Dismissed. Rejected/dismissed briefs remain visible as Closed — not published, preserving the delivery record without implying a live change.

## Persistence, refresh and failure recovery

One tenant-scoped `AutomationJobRun` of type `WEBSITE_GROWTH_SCOUT_EFFECTIVENESS` stores the versioned snapshot. No schema migration is needed. Every access uses authenticated/machine-derived tenantId. Deployment Google credentials and the Newl inventory are read only for the configured `OPENCLAW_WEBSITE_GROWTH_TENANT_SLUG`; other tenants get explicit UNBOUND sources and only their own form aggregates. This is not per-tenant Google account configuration.

An enabled worker prepare attempts refresh before research selection. A snapshot is reused for 24 hours, or six hours after incomplete reads. The owner freshness action respects the same cooldown and cannot exhaust provider reads by repeated clicking. Source failures do not prevent other sources or unrelated research. The endpoint falls back to saved evidence if refresh fails. A database outage can still prevent work; there is no promise of operation without persistence.

A two-minute refresh lease and compare-and-swap prevent simultaneous provider reads. An expired lease is recoverable; an old worker cannot overwrite a newer lease. Google requests share a 22-second abort deadline, including credential exchange. Read-only database operations use normal application database limits. No automated external write is retried here.

Each source collects both periods as one comparable pair. A failed read retains that source's last successful pair with its original observation date/windows and an UNAVAILABLE status. Old or failed evidence is excluded from current change detection; missing Google rows are never zero-filled. Successful empty first-party counts are zero only when the report is complete. Capped enquiry reports do not invent zeros for omitted routes. Failed refreshes do not erase prior evidence or completed work. Raw provider error text and secrets are not persisted or returned.

Google provider caps remain 25,000 Search Console rows and 10,000 GA4 rows. Each source keeps at most 500 aggregated routes per period; enquiries read at most 5,001 page/status groups and mark the result capped at the limit. The review shows at most 500 combined routes and 200 public work summaries; source and view caps are disclosed. The selection packet contains at most twelve current findings. These bounds require pagination/expanded reporting before use on a substantially larger site.

## Supervision and learning

One reusable RESEARCH record (`research:site-effectiveness`) receives saved site evidence and previous outcomes. It is independent of the open-ended research item, ordinary page work, and per-publication MEASUREMENT tasks. A due site review appears before raw candidate signals, but the supervisor chooses the actual next task. It investigates declines, gains, missing questions and the named competitor watchlist, weighs customer fit and the mission's pilot success guidance, and records a concise briefing and next action. Existing public-web capabilities and research-step budgets apply.

A PASS-reviewed informational site briefing is DONE without an owner acknowledgement queue. A proposed page enters the existing complete-brief workflow. Publisher prospects retain their human-review path. The worker chooses a review interval of 1–90 days (seven days is guidance, not a fixed weekly job). At that date the same DONE review becomes READY with attempts reset. A dated WAIT or an owner dismissal remains respected. The record retains up to five dated briefings and their bounded site evidence; no per-page alert queue or additional cron is created. Interrupted quality review keeps its artifact and existing retry/escalation behaviour.

## Inbound qualification and limitations

The report counts only tenant WEBSITE_FORM submissions, excluding account_setup, records marked Test, and durable internal marketing exclusions such as `codex_weekly_diagnostic`. It aggregates pageUrl and current status, never contact names, email, original payloads, or notes. Qualified, Quote sent, Won and Not a fit / Spam are separate existing human-recorded statuses, shown alongside total enquiries. We do not reinterpret legacy Reviewed/Converted/Closed, infer qualification from model text, sum statuses into a historical funnel, or post revenue.

These are current statuses of submission cohorts, so older cohorts have had longer to mature. Attribution is to submitted page URL, not original landing session; no page conversion rate, causal lift or revenue is inferred. Untagged tests/spam may remain in total enquiries. Accurate original-landing/CRM/revenue attribution needs separately reviewed capture and business mappings. The mission stores a named competitor watchlist for task-level research, not a continuous crawl. Full-site crawl/index diagnostics, year-on-year segmentation, and agent cost accounting are not implemented by this slice.

Owner review questions: confirm that existing human status labels are used consistently with the mission's qualified-enquiry definition; recalibrate the pilot guidance after enough real site volume accumulates; and define a future landing-to-enquiry attribution contract. These do not block research from available evidence.

## Validation and rollback

Regression coverage includes partial/all-missing data, stale/mismatched windows, low volume, contradictory facet signals, inverse position movement, diagnostic exclusion, capped reports, route normalization, tenant source binding, refresh cooldown/concurrency/expired leases, old-lease rejection, recurring review reuse, exact-route proposal reuse, no informational approval burden, safe UI escaping, read-only controls, and paused research. Existing Website Growth and worker regressions remain required.

Rollback: return the default route to the workboard and pause/dismiss the recurring site research if needed. Existing work, approvals and saved evidence remain intact. No migration, external write rollback, or duplicate scheduler is required.
