# Agent Operations: Overview

> Evidence status: Confirmed from code unless otherwise marked.

Agent Operations is the read-only control surface at `/agent-operations` and `/agent-operations/run-history`. It shows the declared schedules, latest observed assignment, next run, and tenant-scoped history for Nemo, Hunter, Rivet, Website Scout, Teamship Reader, and Garland Intake.

The module reuses the existing `ASSISTANT` entitlement and introduces no schema migration. It does not start, retry, cancel, approve, print, ship, post, communicate, merge, or deploy anything.

The dashboard refreshes every 15 seconds while the browser tab is visible. The server remains the source of truth; no secret, raw payload, or live customer field is sent to the page.
