# Inbound opportunity data model

`WebsiteInboundSubmission` remains the canonical opportunity. Existing contact and `primaryNeed` fields store the editable working details. The original form `fields` JSON and `pageUrl` remain evidence.

Added fields: `entryMethod` (WEBSITE_FORM/MANUAL), `contactChannel`, `ownerUserId`, date-only `receivedOn`/`followUpOn`, `nextAction`, `closedReason`, `phoneNormalized`, `revision`, `creationKey`, `createdByUserId`, and `lastActivityAt`.

Opportunity fields also include `communicationMailbox`, `lastInboundEmailAt`, and `lastOutboundEmailAt`. The mailbox remains null until the first confirmed outbound send or an explicit owner handoff.

`WebsiteInboundActivity` stores CREATED, UPDATED, and NOTE events with `tenantId`, `submissionId`, author ID/name snapshot, timestamp, optional note body, and field-level before/after changes. A composite `(tenantId, submissionId)` foreign key prevents activities from referring to another tenant's opportunity. Notes have no overwrite/delete operation.

The owner references the tenant's Membership through `(tenantId, ownerUserId)`. An assigned membership cannot be deleted until its opportunities are reassigned or unassigned. Assignment changes do not alter permissions.

`WebsiteInboundEmailMessage` stores tenant-scoped inbound, sent, draft, uncertain-send, and cancelled correspondence. Provider evidence includes mailbox, Graph message/conversation/internet IDs, sender/recipient metadata, timestamps, body text, Outlook link, and attachment presence. Draft evidence includes source, rationale, recommended next action/date, approval actor/time, sender actor/time, and the source message. `(tenantId, mailboxAddress, graphMessageId)` deduplicates provider imports. `(tenantId, submissionId)` prevents cross-tenant links.

Messages with one exact open email match link automatically. A known conversation keeps its existing opportunity link. Multiple plausible opportunities store bounded candidate IDs/labels without selecting one; a user must resolve the match. Unrelated mailbox messages are not persisted.

Updates use `(tenantId, id, revision)` optimistic concurrency. Creation uses a tenant-scoped unique request key plus a serializable duplicate check. An identical retried request from its creator returns the existing record. Notes, updates and audit entries are written in the same transaction. Author names are snapshots so history remains readable after identity changes.

Migration `20260916143000_inbound_opportunities` adds schema only plus a backfill of historical enquiry dates from creation time (Toronto date), last activity from update time, and digits-only phone matching. Existing status values and original payloads are unchanged; the existing rows default to WEBSITE_FORM. Database application needs explicit approval. No database migration is performed by local Prisma client generation or schema-diff generation.

Migration `20260918143000_inbound_correspondence` adds the correspondence enums, opportunity timestamps/mailbox, email ledger, tenant-composite references, deduplication, and query indexes. It does not backfill, send mail, change lifecycle status, or alter existing opportunity values.
