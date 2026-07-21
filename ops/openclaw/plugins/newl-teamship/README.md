# Newl Teamship and Garland OpenClaw Plugin

This tool-only plugin keeps `newl_teamship_read` discoverable so the model can route Teamship questions reliably, but it executes only for Microsoft Teams turns with a trusted runtime sender ID. Calls without the Teams channel, a valid runtime sender UUID, or a valid configured tenant UUID are rejected before any network request. The model supplies only the normalized Teamship question. The plugin binds the Entra tenant and sender object ID outside model-controlled arguments and calls Newl Apps, where those claims resolve to the existing user and tenant membership.

The Teamship integration remains read-only. The Garland tools may save tenant-scoped PDFs, review records, employee feedback, approved-memory candidates, and development suggestions in Newl Apps. They cannot update Teamship, print, start Codex, merge, deploy, or send customer communications.

## Garland tools

- `newl_garland_pdf_review` requires the exact PS or SR number named by the employee and uses only PDF paths captured by the plugin from the same trusted Teams session and sender. The model cannot supply a filesystem path. It uploads the PDF in 3 MB hashed chunks, up to 20 MB total, then filters the parsed PDF before Teamship is queried. PS is preferred because an SR can identify multiple PDF orders. Missing and ambiguous references stop without a Teamship query; successful reviews check only the selected order and report how many other PDF orders were ignored.
- `newl_garland_explain` explains the latest saved deterministic check for a PS or SR number and labels any admin-approved lessons separately.
- `newl_operational_feedback` saves an employee's statement as reported evidence. It never promotes the statement into a Nemo rule.
- `newl_development_suggestion_digest` is admin-only at the Newl Apps boundary. It creates or reads an approval queue and does not start development.

Inbound Teams media is held in a short-lived, in-memory session map for at most ten minutes and removed after a successful review. Durable bytes are stored only through Newl Apps after tenant, membership, module, and mutation authorization.

Employees may ask with configured customer and warehouse names instead of Teamship IDs. Newl Apps resolves those names against the authenticated tenant's approved `readOnlyScopes` JSON, defaults a customer that has one configured warehouse, and keeps the confirmed Garland-to-Annagem default. The plugin does not store or expose a separate customer directory. Multi-warehouse customers still receive a warehouse-name clarification unless an approved default is later added to the tenant reference.

Configure the plugin with the Newl Apps base URL and the Teams channel's Entra tenant ID. `readTokenEnv` names the Teamship read token and `assistantTokenEnv` names the separate Garland assistant token. The assistant setting defaults to `OPENCLAW_ASSISTANT_TOKEN`; it never falls back to and must not name the same environment variable as `OPENCLAW_TEAMSHIP_READ_TOKEN`. `digestAdminObjectId` may hold the approved administrator's Entra object ID so a sender-less scheduled digest can authenticate; interactive calls always use the real Teams sender instead. Do not put tokens in the plugin source or manifest.

Repeated execution for the same Teams message, PDF content, and target reference reuses the tenant-scoped artifact instead of storing another copy. The complete source PDF remains stored as evidence, while the saved review contains only the selected order. If the selected PDF order or its Teamship result produces exactly one shipment date, Newl Apps records that date; otherwise Nemo must ask the employee for `YYYY-MM-DD` before saving a review with ambiguous history metadata.

For a scheduled personal Teams digest, target the existing direct conversation as `user:<aad-object-id>`. A bare UUID may be treated as a team/group lookup by Microsoft Graph. Keep the digest disabled until the production assistant credential, database migration, and reviewed application deployment are complete.

For a Vercel-protected Preview, set `vercelProtectionBypassEnv` to the name of an environment variable containing a dedicated Vercel Protection Bypass for Automation secret. The plugin adds that secret only as the `x-vercel-protection-bypass` request header. Leave this option unset for production or any unprotected host.

After installing the plugin and `teamship-read-only` skill, append the repository's `ops/openclaw/AGENTS.teamship.md` fragment to the live OpenClaw workspace `AGENTS.md`. This makes Nemo load the skill for every Teamship question, call the read tool in the same turn for current records, and read the exact curated file for procedure questions.

Follow `docs/ai/nemo-garland-production-rollout.md` for the reviewed production migration, deployment, plugin reload, supervised Teams PDF test, digest activation, and rollback order. The runbook does not itself authorize any live action.
