# Website Growth backlink outreach rollout

> Evidence status: Confirmed from code unless marked otherwise. Owner-approved operating profile received 2026-07-24.

## Safe launch state

The code supports automated directory submissions, owner-approved outreach, two follow-ups, reply/opt-out handling, verification, and Teams reporting. The installer deliberately creates the weekday OpenClaw job in a **disabled** state. Do not enable it until the production migration, protected configuration, Microsoft 365 permissions, and one supervised message have passed.

Scout uses its own OpenClaw agent and workspace with Codex `gpt-5.6-sol` at high reasoning. Nemo and Rivet are not used for this workflow.

## Human approval boundary

- Scout may research and Codex-review prospects automatically.
- Only an Admin or Manager may approve an opportunity in Newl Apps.
- Approval authorizes the approved, non-paid outreach or ordinary free-directory action for that opportunity.
- Paid placement, reciprocal-link requirements, unusual terms, content licensing/resale, MFA, CAPTCHA, and permission changes remain blocked for human review.
- Automatic opportunity approval is not implemented. Reconsider only after reviewing the first 20 completed opportunities, reply quality, opt-outs, and false positives.
- The owner retains all production, spending, and merge decisions.

## One-time production setup

1. Merge the reviewed pull request. Do not deploy this branch directly.
2. Apply the included Prisma migration through the normal guarded Vercel production deployment.
3. Confirm that the dedicated `partnerships@newlgroup.com` mailbox exists, its Microsoft 365 display name is `Vanessa`, and it can receive replies and password-reset messages.
4. In Microsoft Entra, add Microsoft Graph **application** permissions `Mail.Send` and `Mail.Read` to the existing server application and grant admin consent.
5. Restrict that application to the dedicated partnerships mailbox with Exchange Online Application RBAC or an Application Access Policy. Do not grant unrestricted access to all mailboxes.
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
7. Put the same executor token in the protected OpenClaw gateway environment as `OPENCLAW_WEBSITE_GROWTH_BACKLINK_TOKEN`. Do not put it in an agent prompt, Teams, source control, or the business-profile JSON.
8. Keep the owner-approved public business profile outside source control with file mode `600`.
9. Run `ops/openclaw/install-website-growth-backlink-executor.sh`. It installs the dedicated Scout agent, plugin, skill, protected profile, and disabled weekday schedule.
10. Restart or reload the OpenClaw gateway if required by the installed OpenClaw version, then validate that only Scout has the Website Growth executor tools.

## Supervised launch test

1. Approve one known, low-risk free-directory or outreach opportunity in Newl Apps.
2. Run the disabled job manually while watching the dedicated mailbox and Newl Apps record.
3. Confirm the exact recipient came from a public business contact page on the approved referring organization's domain, uses that organization's business email domain, has its country and consent basis recorded, and includes no customer information.
4. Confirm the message is sent from the dedicated mailbox and includes the correct legal entity, public address, phone, website, and unsubscribe instruction.
5. Reply from the test recipient. Confirm the reply appears as `REPLIED`; an unsubscribe reply must set `LOST`, add a suppression record, and cancel follow-ups.
6. Confirm the Teams summary arrives even if no opportunity is available.
7. Enable the weekday schedule only after these checks pass.

## Normal schedule

- Weekdays at 11:00 AM `America/Toronto`.
- Maximum five new contacts in a rolling 24-hour period and 20 new contacts in a rolling seven-day period.
- First follow-up at day 5, second at day 12, and close at day 21.
- The job first syncs replies and opt-outs, then handles due follow-ups and verification, then claims newly approved work.
- A Teams summary is sent after every run, including zero-opportunity runs. It lists recent directory usernames/login URLs and verified backlink URLs, never passwords.

## Directory-account credentials

Scout may create an ordinary free directory account using the dedicated mailbox. Newl Apps stores the login URL and username, never a password. Email-link, password-reset, CAPTCHA, MFA, payment, or non-standard terms that cannot be completed safely move the opportunity to `BLOCKED`. Any credential that must be retained requires an owner-approved password manager before this step can be automated.

## Rollback

Disable the OpenClaw cron first. Revoke `Mail.Send` from the Microsoft application or remove the mailbox scope, rotate the dedicated executor token in both Vercel and OpenClaw, and leave the database history intact for audit and suppression enforcement.
