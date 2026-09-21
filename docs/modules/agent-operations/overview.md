# Agent Operations: Overview

> Evidence status: Confirmed from code unless otherwise marked.

Agent Operations is the read-only control surface at `/agent-operations` and `/agent-operations/run-history`. It shows the declared schedules, latest observed assignment, next run, and tenant-scoped history for Nemo, Hunter, Rivet, Website Scout, Teamship Reader, and Garland Intake.

The module reuses the existing `ASSISTANT` entitlement and introduces no schema migration. It does not start, retry, cancel, approve, print, ship, post, communicate, merge, or deploy anything.

The dashboard refreshes every 15 seconds while the browser tab is visible. The server remains the source of truth; no secret, raw payload, or live customer field is sent to the page.

Website Scout shows the current marketing-specialist cadence: hourly due-work checks from 09:00–16:00 on weekdays, Tuesday/Thursday/Friday evidence refresh, the two-minute build-notification poll, and weekday backlink outreach only after supervised enablement. Tenant-scoped `WEBSITE_GROWTH_SCOUT_WAKE` and `WEBSITE_GROWTH_SCOUT_STEP` records show whether each actual wake was idle or gated and whether claimed research completed. Backlink outreach remains Not configured until a successful execution is observed; the page does not infer that a disabled production cron is active. Protected runtime overrides remain outside this read-only view.
