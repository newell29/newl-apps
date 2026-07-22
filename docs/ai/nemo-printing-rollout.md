# Nemo single-order printing rollout

> Status: implementation runbook. It does not authorize a production migration, deployment, plugin installation, worker installation, or live print.

## Phase 1 scope

An authenticated Teams employee supplies one exact numeric Teamship shipping-order number. Nemo creates a plan for one picking list, one BOL, and outbound labels equal to the current pallet count. The same employee approves the returned request ID in a separate message. Batch and automatic printing are absent.

## Required configuration

Newl Apps requires dedicated values for:

- `OPENCLAW_PRINT_TOKEN`
- `OPENCLAW_PRINT_TENANT_SLUG`
- `TEAMSHIP_PRINT_WORKER_TOKEN`
- `TEAMSHIP_PRINT_WORKER_TENANT_SLUG`
- `TEAMSHIP_BROWSER_WORKER_QUEUE_ENABLED=true`
- `TEAMSHIP_BROWSER_WORKER_TOKEN`
- `TEAMSHIP_BROWSER_WORKER_TENANT_SLUG`
- `TEAMSHIP_PRINT_LOCAL_QUEUE=_192_168_1_28`
- `TEAMSHIP_PRINT_LOCAL_DISPLAY_NAME=192.168.1.28`
- `TEAMSHIP_PRINT_BOL_PRINTER_NAME=KONICA MINOLTA bizhub C3350i PCL (192.168.1.28) UPD`
- `TEAMSHIP_PRINT_LABEL_PRINTER_NAME=BIXOLON SRP-770III`
- `TEAMSHIP_APP_BASE_URL=https://members.fulfillit.io`

The OpenClaw runtime requires the same `OPENCLAW_PRINT_TOKEN`, referenced by the plugin through `printTokenEnv`. The local print worker requires `NEWL_APPS_BASE_URL`, `TEAMSHIP_PRINT_WORKER_TOKEN`, `TEAMSHIP_PRINT_WORKER_TENANT_SLUG`, and `TEAMSHIP_PRINT_WORKER_ID`. The local browser-read worker requires `NEWL_APPS_BASE_URL`, `TEAMSHIP_BROWSER_WORKER_TOKEN`, `TEAMSHIP_BROWSER_WORKER_TENANT_SLUG`, and `TEAMSHIP_BROWSER_EXECUTABLE_PATH` in its protected environment file.

The local browser-read and print workers must open the shipping-order detail UI on `members.fulfillit.io`. Both use `TEAMSHIP_APP_BASE_URL`; set it explicitly in their protected local environment instead of deriving the web host from the API host. Newl Apps sends an approval-plan preflight through the existing tenant-bound browser-read queue. The local signed-in worker must see the exact `/ship-inventories/:id` page and the configured customer and warehouse. It uses one valid hidden `pallets_count` when Teamship exposes it, otherwise sums bounded observed pallet-row inputs, and for completed orders reads the bounded static pallet table. It rejects missing, ambiguous, invalid, or default-only rows before Newl Apps creates a print request.

The numeric order supplied by an employee is a display number, not necessarily Teamship's internal record ID. Plan creation must resolve and store the matching internal ID from Teamship's list result. The display number remains the employee-visible identity; the internal ID is used for exact API and `/ship-inventories/:id` navigation. The Teamship page may visibly show only `Ship Inventory #<internal-id>`, so the worker confirms the display/internal mapping through the API and separately requires the exact internal browser URL. A missing or conflicting mapping fails closed.

For approval-plan and print-execution pallet counts, the signed-in shipping-order page is authoritative. API detail and list-summary pallet aliases may resolve the order identity but never substitute for or override the local page count. The print worker reads the page count before any output and again immediately before the irreversible outbound-label action. The initial plan identity lookup must not perform a separate server-side Teamship web login because the local signed-in browser performs the authoritative page preflight.

Every credential must be distinct from the Teamship read token and general assistant token. Do not write secret values to the repository or logs.

## Reviewed rollout order

Each numbered action requires human approval at its normal production boundary.

1. Review and merge the feature pull request.
2. Add the dedicated production environment values without exposing their contents.
3. Apply the `TeamshipPrintJob` migration to production using the repository safety check.
4. Deploy the reviewed Newl Apps commit to production.
5. Build, validate, install, and enable `ops/openclaw/plugins/newl-print`.
6. Install `ops/openclaw/skills/teamship-print` and append the printing section from `ops/openclaw/AGENTS.teamship.md`.
7. Install the local print worker with `ops/openclaw/install-teamship-print-worker.sh` and the existing local Teamship browser-read worker.
8. Confirm both workers can poll with no approved jobs. This must print nothing.
9. Run one supervised single-order Teams test. Read the plan, verify the exact order, pallet count, and all three destinations, then approve it.
10. Confirm the physical picking list, BOL, and exact number of pallet labels before treating Phase 1 as live.

## Failure and rollback

Disable or unload `com.newl.teamship-print-worker`, disable the `newl-print` plugin, and preserve all `TeamshipPrintJob` records for audit. Do not replay an approved, claimed, failed, expired, or uncertain job. A new plan requires a new explicit employee approval after physical output is checked.

## Later phases

Phase 2 may propose a complete batch consisting only of saved Nemo-checked orders, but it requires separate design and owner approval. Phase 3 automatic printing requires a new approved policy, batch-level idempotency, stop controls, printer health monitoring, and production evidence from Phase 2. Neither later phase is enabled by the Phase 1 code.
