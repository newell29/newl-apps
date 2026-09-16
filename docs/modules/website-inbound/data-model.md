# Inbound opportunity data model

`WebsiteInboundSubmission` remains the canonical opportunity. Existing contact and `primaryNeed` fields store the editable working details. The original form `fields` JSON and `pageUrl` remain evidence.

Added fields: `entryMethod` (WEBSITE_FORM/MANUAL), `contactChannel`, `ownerUserId`, date-only `receivedOn`/`followUpOn`, `nextAction`, `closedReason`, `phoneNormalized`, `revision`, `creationKey`, `createdByUserId`, and `lastActivityAt`.

`WebsiteInboundActivity` stores CREATED, UPDATED, and NOTE events with `tenantId`, `submissionId`, author ID/name snapshot, timestamp, optional note body, and field-level before/after changes. A composite `(tenantId, submissionId)` foreign key prevents activities from referring to another tenant's opportunity. Notes have no overwrite/delete operation.

The owner references the tenant's Membership through `(tenantId, ownerUserId)`. An assigned membership cannot be deleted until its opportunities are reassigned or unassigned. Assignment changes do not alter permissions.

Updates use `(tenantId, id, revision)` optimistic concurrency. Creation uses a tenant-scoped unique request key plus a serializable duplicate check. An identical retried request from its creator returns the existing record. Notes, updates and audit entries are written in the same transaction. Author names are snapshots so history remains readable after identity changes.

Migration `20260916143000_inbound_opportunities` adds schema only plus a backfill of historical enquiry dates from creation time (Toronto date), last activity from update time, and digits-only phone matching. Existing status values and original payloads are unchanged; the existing rows default to WEBSITE_FORM. Database application needs explicit approval. No database migration is performed by local Prisma client generation or schema-diff generation.
