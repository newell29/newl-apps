# Inbound opportunity integrations

`POST /api/website-inbound` keeps its existing website contract, spam filtering, token authentication and server-side tenant resolution. Phone normalization and enquiry date are added server-side. The external payload cannot set ownership, lifecycle status, actor, or manual entry origin. Account setup continues routing to Finance.

Website Growth's inbound count, landing-page grouping, and form evidence refresh explicitly restrict `entryMethod=WEBSITE_FORM`. Manual phone/email entries therefore do not inflate form-conversion reporting even if their lead source is Website. Website-sourced manual opportunities remain discoverable through the inbound source filter.

There is no mailbox sync, call integration, CRM sync, automatic enrichment or notification sending in this release. All manual intake and follow-up tracking happens in the authenticated module.
