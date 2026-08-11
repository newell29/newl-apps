# Newl Website Growth OpenClaw Plugin

This tool-only plugin gives the Scout agent a narrow execution surface for the curated Website Growth backlink queue. The model never receives the executor token. Newl Apps remains the tenant-scoped system of record and rechecks human approval, paid-placement exclusion, suppression, consent evidence, country, volume limits and allowed lifecycle transitions.

The plugin can return the bounded owner-approved public business profile, claim approved work, read due follow-ups, synchronize replies, return deterministic Teams-summary counts, send one compliant email through Newl Apps, and report directory or verification outcomes. It cannot read arbitrary files, approve an opportunity, purchase anything, accept payment terms, bypass access controls, reveal credentials, or read the raw Semrush backlink inventory.

The deterministic command wrapper records a UTC `runStartedAt` timestamp before Scout starts and calls the summary endpoint after Scout exits, including after a failed agent turn. Newl Apps uses that boundary to report current-run blockers separately from the unresolved lifetime total and returns deterministic blocker categories, reasons, next actions, and retry guidance.

Configure `baseUrl` with the production Newl Apps HTTPS URL. `backlinkTokenEnv` defaults to `OPENCLAW_WEBSITE_GROWTH_BACKLINK_TOKEN`; it names the protected environment variable and never contains the token itself. A Vercel Preview bypass may be configured only for supervised preview tests.

`businessProfilePath` points to the protected owner-approved public profile. Scout receives those bounded public fields only through `newl_backlink_business_profile`; its tool policy does not permit shell or arbitrary file access.

Install this plugin together with the repository-owned `website-growth-backlink-executor` skill. The weekday executor cron must remain disabled until the database migration, reviewed Newl Apps deployment, Microsoft 365 mailbox scope, public outreach profile and supervised one-message test are complete.

The plugin exposes separate initial-send and follow-up tools. Follow-ups accept only the approved opportunity ID and personalized message copy; recipient and consent evidence remain authoritative in Newl Apps. Runtime factories must preserve the declared TypeBox schemas so OpenClaw cannot invoke side-effect tools with empty objects.

Free directory accounts use `newl_backlink_fill_directory_credentials`. The plugin reads the dedicated local `NEWL_DIRECTORY_PASSWORD_MASTER_V1`, derives a stable unique 28-character password for the approved directory/account, fills it through OpenClaw's private `--fields-file` browser path, deletes the file, and returns no password. The master belongs only in the protected OpenClaw gateway environment; it must never be placed in Vercel, Newl Apps, prompts, Teams, Git, or the business profile.
