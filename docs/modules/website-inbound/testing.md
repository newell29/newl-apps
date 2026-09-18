# Inbound opportunity validation

Regression suites cover:

- Phone-only manual creation, invalid values, lost reasons, note bounds, missing/partial website contact evidence.
- Same-tenant duplicate warnings and explicit separate enquiry creation; request-key retries.
- Tenant/owner boundaries, authenticated actor selection, all three mutation guards, read-only behavior and safe error messages.
- Original form preservation, editable contact/service details, before/after history, optimistic conflicts, notes independent of lifecycle updates.
- Calendar-date and Toronto boundary handling, status overrides, combined filters, safe return URLs, queue/history pagination.
- Existing form intake, Finance routing, server-owned intake metadata and manual-entry exclusion from Website Growth evidence.
- Rendered detail UI with missing evidence, original payload, note history and read-only controls.
- Exact Inbox/Sent Items classification, internal-message exclusion, thread preservation and ambiguous-match refusal.
- Conversation presentation groups exact mailbox/Graph conversation IDs chronologically without merging mailbox handoffs or messages that lack a conversation ID.
- Owner-mailbox allowlisting, stale-recipient/thread/status send gates, explicit approval actions and uncertain-send non-retry behavior.

Local commands: `npm run prisma:generate`, `npm run typecheck`, `npm run lint`, `npm run build`, and `npm test -- tests/website-inbound-*.test.ts tests/website-inbound-ui.test.tsx tests/microsoft-graph-mail.test.ts tests/website-growth*.test.ts`.

Browser acceptance in an approved Vercel Preview must create a synthetic manual opportunity, edit a synthetic website submission, append notes, reload, filter statuses/channels/owners, check due views, exercise duplicate warnings and verify retained original evidence. Correspondence acceptance must first use read-only synchronization and synthetic messages. The exact recipient, owner mailbox, draft edit, stale-draft gate, Sent Items reconciliation and explicit approval control must be reviewed before sending one authorized synthetic message. Local unit suites mock database transactions; they are not evidence that a migration has been applied, Graph permissions exist, or live rollback behavior has been tested.

Vercel Preview builds automatically run database safety checks and Prisma migrations. Approval of the concrete preview migration is required before publishing a branch that triggers that build. Production remains unchanged until separate migration/deployment approvals and owner merge.
