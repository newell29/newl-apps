# Inbound opportunity integrations

`POST /api/website-inbound` keeps its existing website contract, spam filtering, token authentication and server-side tenant resolution. Phone normalization and enquiry date are added server-side. The external payload cannot set ownership, lifecycle status, actor, or manual entry origin. Account setup continues routing to Finance.

Website Growth's inbound count, landing-page grouping, and form evidence refresh explicitly restrict `entryMethod=WEBSITE_FORM`. Manual phone/email entries therefore do not inflate form-conversion reporting even if their lead source is Website. Website-sourced manual opportunities remain discoverable through the inbound source filter.

Microsoft Graph application access can synchronize Inbox and Sent Items for the tenant's selected admin mailboxes. Inbound correspondence uses only configured mailbox targets whose exact email also belongs to a tenant Membership. The pilot therefore needs Microsoft Graph application mail access plus an Exchange application access policy restricted to the approved owner mailboxes. Sending additionally requires `Mail.Send` and the existing Microsoft 365 **drafting enabled** setting.

The Vercel schedule calls `/api/website-inbound/correspondence/scheduled` at minute 7 of each hour through the existing `CRON_SECRET` and ingestion tenant context. The job reads and records correspondence only; it never generates or sends customer mail. Users with mutation access can also synchronize on demand.

Outbound mail remains human approved. New messages use Graph `sendMail`; a draft based on a linked inbound Graph message uses the original message's `reply` endpoint. An uncertain external send is not retried automatically. A later Sent Items synchronization can reconcile the local attempt.

There is still no call integration, CRM sync, automatic enrichment, automatic acknowledgement, or automatic follow-up send.
