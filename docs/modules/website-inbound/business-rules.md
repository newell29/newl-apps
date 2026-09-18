# Inbound opportunity business rules

> Requested scope confirmed by the owner: manual inbound entry, editable website leads, notes, owners, follow-up tracking, improved statuses and filters. Business outcome definitions below remain subject to review.

- Current opportunity details are editable; `fields`, `formType`, `pageUrl`, original creation time, and `entryMethod` are not changed by the editor.
- Website-form contact channel remains Website form. A manual enquiry can switch among Phone, Email, Referral, and Other.
- A new manual entry requires at least one of company, contact name, email, or phone. Existing submissions can be entirely missing contact evidence and still accept corrections and notes.
- Services/requirements are free text, allowing multiple services without imposing an unapproved taxonomy.
- New lifecycle choices: New, Contacted, Qualified, Quote sent, Won, Nurture, Lost, Not a fit / Spam. A lost opportunity requires an outcome reason.
- Existing Reviewed, Converted, and Closed values are preserved. They remain filterable and can be retained on existing records; they are not offered for new manual records. No migration reinterprets these business outcomes.
- Won, Lost, Not a fit / Spam, legacy Converted, and legacy Closed are outside open/due/overdue queues. Nurture remains open.
- Won is a manual tracking decision. It does not post revenue, create a customer, issue a quote, send communications, or trigger an external operation. The precise commercial definition of Won requires owner confirmation.
- Follow-up and enquiry dates are calendar dates. Today/overdue uses `America/Toronto`; enquiry range endpoints are inclusive.
- Duplicate checks use exact company/email ignoring case, or digits-only phone equality. They are advisory; different requirements at the same company may be separate opportunities.
- Existing module access and mutation policies apply. Every query, note, edit, and duplicate lookup is tenant scoped.
- Mailbox access is limited to the dedicated inbound-owner allowlist in Microsoft 365 settings, and each selected address must still exactly match a current tenant member email. The Assistant's shared/team inbox list does not grant inbound ownership. Assignment selects the sender before the first outbound email. A confirmed outbound email fixes the conversation mailbox until the newly assigned owner explicitly accepts a handoff.
- Correspondence synchronization can link by a known Graph conversation or one exact contact email. It never matches by name or company domain and never stores unrelated mailbox messages.
- Each provider message remains a separate audit record, while messages sharing an exact mailbox and Graph conversation ID display as one chronological conversation. Messages without a conversation ID remain separate.
- Received correspondence comes from an approved owner mailbox's Inbox. A website-form notification delivered only to another mailbox is not copied into the owner's email history.
- Draft generation and suggested next steps do not approve, send, change status, or save follow-up fields. Only the assigned owner can approve the exact customer-visible copy and send it.
- Automatic acknowledgements and follow-up sends are not enabled in the pilot. A changed recipient, closed status, mailbox handoff, or newer message invalidates an old draft.
