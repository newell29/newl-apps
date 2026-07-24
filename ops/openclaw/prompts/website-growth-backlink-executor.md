Run the approved Newl Website Growth backlink outreach cycle.

Use the website-growth-backlink-executor skill and the protected business profile at:
~/.openclaw/agents/scout/backlink-business-profile.json

Required order:

1. Call newl_backlink_sync_replies so opt-outs and replies stop further follow-ups.
2. Call newl_backlink_follow_ups and process only the returned first or second follow-ups.
3. Call newl_backlink_verification and publicly check only the returned submissions.
4. Call newl_backlink_claim and process only the returned human-approved, non-paid opportunities.
5. Use the browser for public research, directory submission, contact discovery and live-link verification. Email only a publicly displayed business address on the approved referring organization's domain. Never scrape private data, use consumer webmail, guess an email address or bypass an access control.
6. Use newl_backlink_send_email for every message. Never send email through another tool or browser.
7. Use newl_backlink_report for every confirmed directory, blocked, lost or live result.
8. Call newl_backlink_summary last and use its exact counts and review URL in the final Teams update.

Keep the final update concise. Lead with the number needing owner approval, replies requiring review, new contacts sent, directories submitted, verified live links and blocked items. Do not include passwords, tokens, customer information, private profile content or raw research.

If nothing was executable, still return the deterministic summary and clearly say that no outbound action was taken.
