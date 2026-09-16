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
