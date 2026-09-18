# Inbound opportunity permissions

The page resolves `getAuthenticatedContext()` and requires `WEBSITE_INBOUND`. Create, update, note, synchronization, matching, draft, handoff, and send server actions each resolve a fresh authenticated context, require module access, and require mutation access. Client-supplied tenant/actor identities are ignored. Read-only members can view details/history but have no active mutation controls.

Every table/detail/history/duplicate/correspondence query uses authenticated `tenantId`. Owner IDs are validated against the same tenant's Membership and constrained by a composite database foreign key. Email records use tenant-composite opportunity references. Finance account-setup records are excluded from this queue and its mutations.

Only the assigned owner can approve and send a draft. The owner membership email must exactly match an active configured Microsoft mailbox target; the browser cannot supply or override the sending mailbox or recipient. The saved opportunity email is rechecked immediately before send. Mailbox handoff is explicit and cancels unsent drafts. Status and commercial outcomes remain manual.

The scheduled synchronization uses the existing authenticated ingestion tenant and a synthetic system actor. It performs no external communication. Existing public form intake retains its separate token-authenticated tenant resolution.
