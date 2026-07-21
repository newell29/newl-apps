# Newl Teamship OpenClaw Plugin

This tool-only plugin keeps `newl_teamship_read` discoverable so the model can route Teamship questions reliably, but it executes only for Microsoft Teams turns with a trusted runtime sender ID. Calls without the Teams channel, a valid runtime sender UUID, or a valid configured tenant UUID are rejected before any network request. The model supplies only the normalized Teamship question. The plugin binds the Entra tenant and sender object ID outside model-controlled arguments and calls Newl Apps, where those claims resolve to the existing user and tenant membership.

The plugin is read-only. It does not accept an email, Teamship credential, customer scope expansion, or Teamship write action as tool input.

Employees may ask with configured customer and warehouse names instead of Teamship IDs. Newl Apps resolves those names against the authenticated tenant's approved `readOnlyScopes` JSON, defaults a customer that has one configured warehouse, and keeps the confirmed Garland-to-Annagem default. The plugin does not store or expose a separate customer directory. Multi-warehouse customers still receive a warehouse-name clarification unless an approved default is later added to the tenant reference.

Configure the plugin with the Newl Apps base URL, the Teams channel's Entra tenant ID, and the name of the environment variable containing `OPENCLAW_TEAMSHIP_READ_TOKEN`. Do not put the token in the plugin source or manifest.

For a Vercel-protected Preview, set `vercelProtectionBypassEnv` to the name of an environment variable containing a dedicated Vercel Protection Bypass for Automation secret. The plugin adds that secret only as the `x-vercel-protection-bypass` request header. Leave this option unset for production or any unprotected host.

After installing the plugin and `teamship-read-only` skill, append the repository's `ops/openclaw/AGENTS.teamship.md` fragment to the live OpenClaw workspace `AGENTS.md`. This makes Nemo load the skill for every Teamship question, call the read tool in the same turn for current records, and read the exact curated file for procedure questions.
