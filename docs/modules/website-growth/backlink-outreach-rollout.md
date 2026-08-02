# Website Growth backlink outreach rollout

> Evidence status: Confirmed from code unless marked otherwise. Owner-approved operating profile received 2026-07-24.

## Safe launch state

The code supports automated directory submissions, owner-approved outreach, two follow-ups, reply/opt-out handling, verification, and Teams reporting. The installer deliberately creates the weekday OpenClaw job in a **disabled** state. Do not enable it until the production migration, protected configuration, Microsoft 365 permissions, and one supervised message have passed.

Scout uses its own OpenClaw agent and workspace. Deep website/backlink research uses Codex `gpt-5.6-sol` at high reasoning; the restricted weekday outreach executor uses the existing OpenAI `gpt-5.4-mini` connection because the current OpenClaw Codex harness exposes the plugin names without invoking them. Nemo is not used. Rivet is restricted to failure diagnosis and draft code-fix PRs after the owner enables the standing approval; Rivet cannot perform outreach or operational retries.

## Human approval boundary

- Scout may research and Codex-review prospects automatically.
- Only an Admin or Manager may approve an opportunity in Newl Apps.
- Approval authorizes the approved, non-paid outreach or ordinary free-directory action for that opportunity.
- An Admin or Manager may move an accidentally approved opportunity back to review while it is still `APPROVED`. Once Scout claims it and execution starts, the UI no longer offers that reversal.
- Paid placement, reciprocal-link requirements, unusual terms, content licensing/resale, MFA, CAPTCHA, and permission changes remain blocked for human review.
- Automatic opportunity approval is not implemented. Reconsider only after reviewing the first 20 completed opportunities, reply quality, opt-outs, and false positives.
- The owner retains all production, spending, and merge decisions.

## One-time production setup

1. Merge the reviewed pull request. Do not deploy this branch directly.
2. Apply the included Prisma migration through the normal guarded Vercel production deployment.
3. Confirm that the dedicated `partnerships@newlgroup.com` mailbox exists, its Microsoft 365 display name is `Vanessa`, and it can receive replies and password-reset messages.
4. Prefer Exchange Online **Application RBAC** for a new setup: assign the service principal only the `Application Mail.Send` and `Application Mail.Read` roles against a management scope containing the dedicated partnerships mailbox.
5. Do not also leave equivalent organization-wide Microsoft Graph application permissions assigned in Entra when using Application RBAC, because those grants are additive and would defeat the mailbox scope. If the tenant must use the legacy method, grant Graph application permissions `Mail.Send` and `Mail.Read` with admin consent and then restrict them with an Exchange Application Access Policy. Do not use both models or leave unrestricted access to all mailboxes.
   Newl Apps sends through the direct Microsoft Graph `sendMail` action, which requires `Mail.Send` but not `Mail.ReadWrite`. It records Graph's accepted response and matches later replies by conversation ID when available, with a recipient-and-normalized-subject fallback for direct-send messages.
6. Add the following protected Vercel production values:
   - `OPENCLAW_WEBSITE_GROWTH_BACKLINK_TOKEN` — a new random value, different from the read-only Scout token.
   - `WEBSITE_GROWTH_OUTREACH_MAILBOX`
   - `WEBSITE_GROWTH_OUTREACH_SENDER_NAME`
   - `WEBSITE_GROWTH_OUTREACH_PUBLIC_BRAND`
   - `WEBSITE_GROWTH_OUTREACH_PUBLIC_PHONE`
   - `WEBSITE_GROWTH_OUTREACH_WEBSITE`
   - `WEBSITE_GROWTH_OUTREACH_CANADA_LEGAL_NAME`
   - `WEBSITE_GROWTH_OUTREACH_CANADA_ADDRESS`
   - `WEBSITE_GROWTH_OUTREACH_US_LEGAL_NAME`
   - `WEBSITE_GROWTH_OUTREACH_US_ADDRESS`
   - `WEBSITE_GROWTH_RIVET_AUTO_TRIAGE_APPROVAL=OWNER_APPROVED_WEBSITE_GROWTH_FAILURE_TRIAGE` — optional one-time standing approval for code-defect diagnosis and draft PRs only.
7. Put the same executor token in the protected OpenClaw gateway environment as `OPENCLAW_WEBSITE_GROWTH_BACKLINK_TOKEN`. Do not put it in an agent prompt, Teams, source control, or the business-profile JSON.
8. Generate the local directory credential master once with `openssl rand -base64 48`. Add the result only to `~/.openclaw/.env` as `NEWL_DIRECTORY_PASSWORD_MASTER_V1=...`; do not add it to Vercel, Newl Apps, source control, an agent prompt, or Teams. Back up this single master in the owner's existing Apple Passwords/iCloud Keychain account. Losing it prevents deterministic recovery of directory passwords.
9. Re-run `ops/openclaw/install-website-growth-backlink-executor.sh` so the installed plugin and weekday job include `newl_backlink_fill_directory_credentials` and `newl_backlink_sync_directory_verifications`.
   The installer treats the returned command job as canonical and removes any retired agent-turn or duplicate job with the same declaration key before the schedule is enabled.
10. Keep the owner-approved public business profile outside source control with file mode `600`.
11. Restart or reload the OpenClaw gateway if required by the installed OpenClaw version, then validate that Scout uses the `minimal` tool profile with only the browser and dedicated `newl_backlink_*` tools. Shell, exec, arbitrary reads, writes, and source-code inspection must remain denied.

## Supervised launch test

1. Approve one known, low-risk free-directory or outreach opportunity in Newl Apps.
2. Run the disabled job manually while watching the dedicated mailbox and Newl Apps record.
3. Confirm the exact recipient came from a public business contact page on the approved referring organization's domain, has its country and consent basis recorded, and includes no customer information. Newl Apps independently reads that public page before an initial send. A different corporate email domain is permitted only when the exact address is visibly published on the approved referring organization's page; consumer webmail remains blocked.
4. Confirm the message is sent from the dedicated mailbox and includes the correct legal entity, public address, phone, website, and unsubscribe instruction.
5. Reply from the test recipient. Confirm the reply appears as `REPLIED`; an unsubscribe reply must set `LOST`, add a suppression record, and cancel follow-ups.
6. Confirm the Teams summary arrives even if no opportunity is available.
7. Enable the weekday schedule only after these checks pass by running `ops/openclaw/enable-website-growth-backlink-executor.sh`.

## Normal schedule

- Weekdays at 11:00 AM `America/Toronto`.
- Maximum five new contacts in a rolling 24-hour period and 20 new contacts in a rolling seven-day period.
- First follow-up at day 5, second at day 12, and close at day 21.
- The job first syncs replies and opt-outs, then handles due follow-ups and verification, then claims newly approved work.
- Public research uses the constrained browser tool to open each approved URL in a fresh tab. The executor focuses the returned stable tab handle before taking a bounded accessibility snapshot and never navigates an assumed active tab.
- The cron is a deterministic command job. It records the run start, invokes one constrained Scout work phase, calls the Newl Apps summary endpoint after the agent exits, and sends that exact Teams summary even when the Scout phase fails.
- Scout cannot send the Teams summary itself and cannot use shell, exec, arbitrary file reads, curl, direct HTTP, or source-code inspection. The bounded `newl_backlink_business_profile` tool is its only source for the owner-approved public identity.
- A Teams summary is sent after every run, including zero-opportunity and partially failed runs. It lists recent directory usernames/login URLs and verified backlink URLs, never passwords.
- The model-free failure monitor polls every 15 minutes, records each failed source run once, and sends a separate Teams alert. Code defects can queue Rivet for a draft PR; uncertain sends and permission failures never retry automatically. The second identical failure within seven days disables the executor.

## Directory-account credentials

Scout may create an ordinary free directory account using the dedicated mailbox. Newl Apps stores the login URL, username, credential reference/version, and account/challenge state—never a password. The local OpenClaw plugin deterministically derives a different password for every directory from the one protected owner-backed-up master, so no paid password-manager integration is required. Strict same-organization verification emails can activate automatically without exposing their tokenized URL. CAPTCHA, MFA, phone verification, payment, non-standard terms, or ambiguous email verification move the opportunity to the human-action queue with an exact next step.

## Rollback

Disable the OpenClaw cron first. Revoke `Mail.Send` from the Microsoft application or remove the mailbox scope, rotate the dedicated executor token in both Vercel and OpenClaw, and leave the database history intact for audit and suppression enforcement.
