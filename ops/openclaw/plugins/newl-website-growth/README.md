# Newl Website Growth OpenClaw Plugin

This tool-only plugin gives the Scout agent a narrow execution surface for the curated Website Growth backlink queue. The model never receives the executor token. Newl Apps remains the tenant-scoped system of record and rechecks human approval, paid-placement exclusion, suppression, consent evidence, country, volume limits and allowed lifecycle transitions.

The plugin can claim approved work, read due follow-ups, synchronize replies, return deterministic Teams-summary counts, send one compliant email through Newl Apps, and report directory or verification outcomes. It cannot approve an opportunity, purchase anything, accept payment terms, bypass access controls, reveal credentials, or read the raw Semrush backlink inventory.

Configure `baseUrl` with the production Newl Apps HTTPS URL. `backlinkTokenEnv` defaults to `OPENCLAW_WEBSITE_GROWTH_BACKLINK_TOKEN`; it names the protected environment variable and never contains the token itself. A Vercel Preview bypass may be configured only for supervised preview tests.

Install this plugin together with the repository-owned `website-growth-backlink-executor` skill. The weekday executor cron must remain disabled until the database migration, reviewed Newl Apps deployment, Microsoft 365 mailbox scope, public outreach profile and supervised one-message test are complete.
