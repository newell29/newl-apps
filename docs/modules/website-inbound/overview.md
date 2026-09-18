# Inbound opportunities

> Evidence status: implemented on the inbound-opportunity-tracking feature branch; deployment and migrations require review.

The existing `/website-inbound` module is now the shared inbound opportunity queue for website forms and manually entered phone, email, referral, and other enquiries. The navigation label is **Inbound Opportunities**; the route and `WEBSITE_INBOUND` entitlement remain unchanged.

Both intake types support edits to company, contact name, email, phone, service requirements, source, enquiry date, owner, status, next action, follow-up date, and outcome reason. Original website payloads and page URLs are retained separately. Notes are appended with author and timestamp; field changes appear in the same activity history.

The correspondence pilot adds an opportunity-level Microsoft 365 email history for approved owner mailboxes. Incoming and sent messages synchronize hourly and on demand. Exact conversation and contact-email evidence links mail automatically; ambiguous exact-email matches wait for a person to choose the opportunity. The assigned owner can prepare an AI-assisted or safe-template draft, edit it, and approve the exact message for sending. No follow-up is sent automatically.

Default view: all open opportunities. Quick views: New, My opportunities, Due today, Overdue, All opportunities. Filters include status, channel, owner, source, service, text search, form type, and inclusive enquiry dates. Both the queue and activity history paginate in groups of 25.

See [workflow](workflow.md), [business rules](business-rules.md), [data model](data-model.md), and [testing](testing.md).
