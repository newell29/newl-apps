# TMG shipping-order intake

> Status: initial CSR-approval phase. This workflow is separate from Garland and must not use Garland review runs, parsing rules, update jobs, or browser workers.

## Confirmed business rules

- Microsoft Graph reads the tenant-configured mailbox. A message is eligible only when its sender is on the exact allowlist, at least one exact tenant-configured employee address appears in To or CC, its normalized subject starts with the configured prefix, it has attachments, and at least one attachment is a PDF. Standard `RE:`, `FW:`, and `FWD:` prefixes are ignored; other subject text is not rewritten.
- The packing slip is the primary order source. Ship-to, customer reference, date, SKU, and quantity come from the packing slip.
- The picklist is a validation source. Warehouse-only instructions from it are included in the internal completion summary.
- The BOL supplies the PRO number. The BOL and label must reference the same exact customer reference as the packing slip.
- Carrier delivery notes are intentionally excluded from Teamship.
- Each order gets one consolidated PDF in packing-slip, BOL, label order. The exact file is uploaded to the Teamship Document control after order creation.
- A CSR must approve the immutable batch plan before any Teamship create or document upload. Removing this approval later is a separate owner decision and code change.
- The completion summary is sent only to tenant-configured internal recipients. This workflow does not automatically reply to the customer.

## Safety boundaries

- Every database read and write is tenant-scoped. Message identity is unique within tenant and mailbox scope.
- Source PDFs are deduplicated by SHA-256. The frozen Teamship payload and consolidated PDF hash are included in approval evidence.
- Only fully validated orders are selected for approval. Orders with missing or conflicting evidence remain in `NEEDS_REVIEW`.
- Teamship is checked for an exact customer reference during planning, again immediately before approval, and again before the create request.
- The worker checkpoints `CREATE_STARTED` before the API write and `UPLOAD_STARTED` before browser upload. An interruption after either checkpoint is not retried automatically.
- The worker never clicks Teamship Print, Delete, or order Save controls. It uses only the exact Document file input and verifies the filename after reload.
- No migration is applied by feature code. The migration must be reviewed and run through the repository preview migration process.

## Configuration and operation

The `TMG Order Intake` tenant integration record stores non-secret mailbox rules, exact required To/CC recipients, internal summary recipients, and Teamship scope identifiers. Microsoft Graph and Teamship credentials continue to use the existing tenant integration mechanisms. Required employee recipients and internal summary recipients must share the configured mailbox domain. Live customer and employee addresses remain tenant configuration and must not be committed to source code, tests, or documentation.

The authenticated Operations Tools page is `/operations/tmg-order-intake`. Vercel calls `GET /api/operations/tmg-order-intake/scheduled` every five minutes and authenticates it with the existing `CRON_SECRET`; the existing machine-triggered `POST` remains available under ingestion authentication. Both paths bind the run to the configured ingestion tenant. A disabled or incomplete TMG configuration is a successful no-op.

The external worker is started with `npm run worker:tmg-order-intake` and polls continuously by default. `TMG_WORKER_POLL_INTERVAL_MS` can set a bounded 5-second to 5-minute interval; `TMG_WORKER_RUN_ONCE=true` is reserved for supervised one-shot diagnostics. Live operation additionally requires the ingestion credential, worker base URL, explicit `TMG_ALLOW_LIVE_WRITES=true` flag, and a configured browser executable. It only claims CSR-approved jobs and must run under an approved process supervisor on the browser-worker host.

## Data and status flow

1. Store the tenant-scoped email batch and source PDFs.
2. Parse and validate packing slips, picklist, BOLs, and labels.
3. Build one immutable Teamship plan and consolidated PDF per valid order.
4. Create a `PENDING_APPROVAL` job containing only valid order IDs.
5. CSR reviews the mapping and approves the batch.
6. The separate worker creates each Teamship order, checkpoints verified evidence, uploads the consolidated PDF, and verifies the filename.
7. Newl Apps sends the internal summary for completed orders and leaves failures visible for review.

## Failure recovery

- Missing or ambiguous documents, products, inventory, or ship-to fields: correct the source/configuration and ingest a new message; do not force the row through.
- Exact Teamship duplicate: reconcile the existing Teamship order manually.
- Create request without confirmed response/readback: inspect Teamship for the exact customer reference; do not retry automatically.
- Upload without exact filename confirmation after reload: inspect the order documents manually; do not retry automatically.
- Summary failure: the batch records `summaryStatus=NEEDS_REVIEW`; check recipients before any manual resend.
- Interrupted claimed worker: the job remains claimed/in progress for manual recovery. Automatic claim expiry is intentionally not implemented initially.

## Test coverage

- PDF classification, parsing, packet order, deduplication, and warehouse-note extraction.
- Teamship mapping, exact stock selection, immutable approval hash, duplicate protection, single create, and exact readback.
- Tenant-scoped CSR approval, stale-plan rejection, valid-only partial-batch selection, and exact-reference recheck.
- Tenant settings validation and internal summary content.

## Business questions requiring review

- In a partially invalid email, the implementation approves and creates only fully valid orders while invalid rows remain blocked. This follows the requested no-manual-row-approval direction but remains an inferred batch policy requiring owner confirmation.
- The browser-worker hosting location and process supervisor require an operations decision before live activation.
- Removing CSR approval after the observation period requires a separate explicit owner decision; it is not a configuration toggle in this version.
