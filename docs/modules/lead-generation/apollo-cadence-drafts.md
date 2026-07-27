# Hunter Apollo cadence drafts

Hunter uses two email-delivery shells. Newl Apps remains the source of truth for evidence, contact selection, generated copy, QA, approval, and audit history. Apollo supplies the mailbox, scheduling, unsubscribe handling, and delivery.

Approving a QA-passed Outreach Plan is the sole human authorization. Newl Apps then approves the selected contact, preserves its existing sender or assigns the approver, syncs every generated field, and queues Apollo enrollment automatically. Any sender, field, cadence, identity, reply-history, or QA failure stops enrollment and remains visible in the Apollo job result.

## Mailbox pools

- One Apollo user may own multiple connected mailboxes. Newl Apps synchronizes each Apollo email account as a separate sender identity without requiring an additional Apollo teammate.
- Every mailbox is configured with an active flag and routing weight from 0–100. Newly discovered default mailboxes start active at weight 100; additional mailboxes start inactive at weight 0 so a sync cannot silently expand live sending.
- The contact remains assigned to the Newl Apps rep/Apollo owner. At enrollment, Newl Apps chooses one eligible mailbox from that owner's pool using a deterministic company-level allocation. Every contact at the same company therefore stays on the same sender.
- A weight of 80/10/10 makes the first mailbox the dominant sender while allowing two secondary identities to share a small portion of new companies. Weight 0 excludes a mailbox without deleting its mapping.
- Existing in-flight Apollo enrollments are never reassigned when weights change. Mailbox display names, signatures, authentication, sending limits, and warm-up remain Apollo/mail-provider responsibilities.

## Hunter - Email Only

- Audience: operations, warehousing, logistics, supply-chain, distribution, procurement, and import buyers.
- Email 1: day 0; subject `{{NEWL Email 1 Subject}}`; body `{{NEWL Email 1 Body}}`.
- Email 2: day 4; subject `{{NEWL Email 2 Subject}}`; body `{{NEWL Email 2 Body}}`.
- Email 3: day 10; subject `{{NEWL Email 3 Subject}}`; body `{{NEWL Email 3 Body}}`.
- No automated call or LinkedIn task.

## Hunter - Executive Referral

- Audience: presidents, owners, founders, C-suite, managing directors, general managers, and vice presidents.
- The same three custom-field steps and timing are used.
- Copy asks the executive to direct Newl to the operating owner; it must not imply the executive personally owns logistics.
- No automated call or LinkedIn task.

## Hot-opportunity call rule

Calls are not cadence steps. A day-7 call brief may be stored in `NEWL Hot Opportunity Call Brief` only when the saved Hunter opportunity tier is `HOT_OPPORTUNITY`. A person must still approve and place the call.

## Required Apollo contact fields

- `NEWL Email 1 Subject`
- `NEWL Email 1 Body`
- `NEWL Email 2 Subject`
- `NEWL Email 2 Body`
- `NEWL Email 3 Subject`
- `NEWL Email 3 Body`
- `NEWL Hot Opportunity Call Brief` (optional; Hot opportunities only)

The legacy `NEWL Email Subject Draft` and `NEWL Email Body Draft` fields remain populated with email 1 during transition. The legacy Tier 1/2/3 sequences must not be selected for an eligible Hunter handoff.
