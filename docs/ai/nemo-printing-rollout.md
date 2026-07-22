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
- `TEAMSHIP_PRINT_LOCAL_QUEUE=_192_168_1_28`
- `TEAMSHIP_PRINT_LOCAL_DISPLAY_NAME=192.168.1.28`
- `TEAMSHIP_PRINT_BOL_PRINTER_NAME=KONICA MINOLTA bizhub C3350i PCL (192.168.1.28) UPD`
- `TEAMSHIP_PRINT_LABEL_PRINTER_NAME=BIXOLON SRP-770III`
- `TEAMSHIP_APP_BASE_URL=https://members.fulfillit.io`

The OpenClaw runtime requires the same `OPENCLAW_PRINT_TOKEN`, referenced by the plugin through `printTokenEnv`. The local worker requires `NEWL_APPS_BASE_URL`, `TEAMSHIP_PRINT_WORKER_TOKEN`, `TEAMSHIP_PRINT_WORKER_TENANT_SLUG`, `TEAMSHIP_PRINT_WORKER_ID`, and `TEAMSHIP_BROWSER_EXECUTABLE_PATH` in its protected environment file.

The print worker must open the shipping-order detail UI on `members.fulfillit.io`. The worker defaults to the documented detail host, and `TEAMSHIP_APP_BASE_URL` should be set explicitly in the protected local environment. Teamship can omit pallet-edit inputs from the browser page, so the worker re-fetches the exact order through the Teamship API for the initial pallet-count preflight and again immediately before outbound labels.

Every credential must be distinct from the Teamship read token and general assistant token. Do not write secret values to the repository or logs.

## Reviewed rollout order

Each numbered action requires human approval at its normal production boundary.

1. Review and merge the feature pull request.
2. Add the dedicated production environment values without exposing their contents.
3. Apply the `TeamshipPrintJob` migration to production using the repository safety check.
4. Deploy the reviewed Newl Apps commit to production.
5. Build, validate, install, and enable `ops/openclaw/plugins/newl-print`.
6. Install `ops/openclaw/skills/teamship-print` and append the printing section from `ops/openclaw/AGENTS.teamship.md`.
7. Install the local worker with `ops/openclaw/install-teamship-print-worker.sh`.
8. Confirm the worker can poll with no approved jobs. This must print nothing.
9. Run one supervised single-order Teams test. Read the plan, verify the exact order, pallet count, and all three destinations, then approve it.
10. Confirm the physical picking list, BOL, and exact number of pallet labels before treating Phase 1 as live.

## Failure and rollback

Disable or unload `com.newl.teamship-print-worker`, disable the `newl-print` plugin, and preserve all `TeamshipPrintJob` records for audit. Do not replay an approved, claimed, failed, expired, or uncertain job. A new plan requires a new explicit employee approval after physical output is checked.

## Later phases

Phase 2 may propose a complete batch consisting only of saved Nemo-checked orders, but it requires separate design and owner approval. Phase 3 automatic printing requires a new approved policy, batch-level idempotency, stop controls, printer health monitoring, and production evidence from Phase 2. Neither later phase is enabled by the Phase 1 code.
