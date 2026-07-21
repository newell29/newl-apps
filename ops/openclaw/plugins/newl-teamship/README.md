# Newl Teamship OpenClaw Plugin

This tool-only plugin exposes `newl_teamship_read` only for Microsoft Teams turns with a trusted runtime sender ID. The model supplies only the normalized Teamship question. The plugin binds the Entra tenant and sender object ID outside model-controlled arguments and calls Newl Apps, where those claims resolve to the existing user and tenant membership.

The plugin is read-only. It does not accept an email, Teamship credential, customer scope expansion, or Teamship write action as tool input.

Configure the plugin with the Newl Apps base URL, the Teams channel's Entra tenant ID, and the name of the environment variable containing `OPENCLAW_TEAMSHIP_READ_TOKEN`. Do not put the token in the plugin source or manifest.

For a Vercel-protected Preview, set `vercelProtectionBypassEnv` to the name of an environment variable containing a dedicated Vercel Protection Bypass for Automation secret. The plugin adds that secret only as the `x-vercel-protection-bypass` request header. Leave this option unset for production or any unprotected host.
