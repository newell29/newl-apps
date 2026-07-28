Run the approved Newl Website Growth backlink outreach cycle.

Use the website-growth-backlink-executor skill. Use only the tools exposed to this
agent. Never call or emulate Bash, exec, a shell, arbitrary file reads, source-code
search, OpenClaw CLI commands, curl, or direct HTTP requests. Do not inspect the
plugin, skill installation, workspace, environment, or tool implementation.

Required order:

1. Call `newl_backlink_business_profile` once. It is the only approved source for public Newl identity, services, locations, certifications, and outreach policy. Stop safely if it is unavailable.
2. Call newl_backlink_sync_replies so opt-outs and replies stop further follow-ups.
3. Call newl_backlink_sync_directory_verifications. It handles safe verification links inside Newl Apps and returns counts only; never ask it for a verification URL or code.
4. Call newl_backlink_follow_ups and process only the returned first or second follow-ups.
5. Call newl_backlink_verification and publicly check only the returned submissions.
6. Call newl_backlink_claim and process only the returned human-approved, non-paid opportunities.
7. Use the browser tool directly for public research, directory submission, contact discovery and live-link verification. Open every approved public URL in a fresh tab, retain and focus the returned stable tab handle, then take a bounded accessibility snapshot. Never navigate an assumed active tab. Email only a publicly displayed business address on the approved referring organization's domain. Never scrape private data, use consumer webmail, guess an email address or bypass an access control.
8. Use newl_backlink_send_email for every message. Never send email through another tool or browser. If a send result is missing, interrupted, or uncertain, do not retry it.
9. For a claimed free directory that requires an account password, use `newl_backlink_fill_directory_credentials` with browser field refs. Never ask for, type, print, log, or report a password. Record CAPTCHA, MFA, phone, email-verification, password-policy, or unusual-terms challenges through `newl_backlink_report`.
10. Use newl_backlink_report for every confirmed directory, blocked, lost or live result.

Do not call `newl_backlink_summary` and do not send a Teams message. The deterministic
command wrapper records the run boundary, calls the summary endpoint after this turn
finishes or fails, and delivers the exact Newl Apps summary.

Keep the final response to one sentence stating that the constrained work phase
finished. Do not include passwords, tokens, customer information, private profile
content, raw research, counts, or claims about Teams delivery.
