# Hunter Apollo cadence drafts

Hunter uses two email-delivery shells. Newl Apps remains the source of truth for evidence, contact selection, generated copy, QA, approval, and audit history. Apollo supplies the mailbox, scheduling, unsubscribe handling, and delivery.

Approving a QA-passed Outreach Plan is the sole human authorization. Newl Apps then approves the selected contact, preserves its existing sender or assigns the approver, syncs every generated field, and queues Apollo enrollment automatically. Any sender, field, cadence, identity, reply-history, or QA failure stops enrollment and remains visible in the Apollo job result.

## Mailbox pools

- One Apollo user may own multiple connected mailboxes. Newl Apps synchronizes each Apollo email account as a separate sender identity without requiring an additional Apollo teammate.
- Every mailbox is configured with an active flag and routing weight from 0–100. Newly discovered default mailboxes start active at weight 100; additional mailboxes start inactive at weight 0 so a sync cannot silently expand live sending.
- The contact remains assigned to the Newl Apps rep/Apollo owner. At enrollment, Newl Apps chooses one eligible mailbox from that owner's pool using a deterministic company-level allocation. Every contact at the same company therefore stays on the same sender.
- The same mailbox allocation is resolved before drafting. Every email must end with that mailbox identity's first name on its own final line. `<sender>`, `[Sender Name]`, generic `Newl Group` signatures, the word `Hunter`, and internal evidence references fail QA and cannot be approved.
- The initial rollout is Alex 100, with every secondary mailbox inactive at weight 0. A later reviewed change may distribute weight across additional identities. Weight 0 excludes a mailbox without deleting its mapping.
- Existing in-flight Apollo enrollments are never reassigned when weights change. Mailbox display names, signatures, authentication, sending limits, and warm-up remain Apollo/mail-provider responsibilities.
- A no-reply contact is not discarded merely because Apollo has prior cadence history. Finished history may enter the
  approved Hunter cadence directly. If the contact is still active or paused in a different cadence, the approved
  plan authorizes Newl Apps to remove that membership and then enroll the contact in the selected Hunter cadence.
  Replies, bounces, rejected contacts, and do-not-contact records remain blocked.

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
