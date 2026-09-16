# Inbound opportunity validation

Regression suites cover:

- Phone-only manual creation, invalid values, lost reasons, note bounds, missing/partial website contact evidence.
- Same-tenant duplicate warnings and explicit separate enquiry creation; request-key retries.
- Tenant/owner boundaries, authenticated actor selection, all three mutation guards, read-only behavior and safe error messages.
- Original form preservation, editable contact/service details, before/after history, optimistic conflicts, notes independent of lifecycle updates.
- Calendar-date and Toronto boundary handling, status overrides, combined filters, safe return URLs, queue/history pagination.
- Existing form intake, Finance routing, server-owned intake metadata and manual-entry exclusion from Website Growth evidence.
- Rendered detail UI with missing evidence, original payload, note history and read-only controls.

Local commands: `npm run prisma:generate`, `npm run typecheck`, `npm run lint`, `npm run build`, and `npm test -- tests/website-inbound-*.test.ts tests/website-inbound-ui.test.tsx tests/website-growth*.test.ts`.

Browser acceptance in an approved Vercel Preview must create a synthetic manual opportunity, edit a synthetic website submission, append notes, reload, filter statuses/channels/owners, check due views, exercise duplicate warnings and verify retained original evidence. Use reserved synthetic contacts and no external communication. Local unit suites mock database transactions; they are not evidence that a migration has been applied or that live rollback behavior has been tested.

Vercel Preview builds automatically run database safety checks and Prisma migrations. Approval of the concrete preview migration is required before publishing a branch that triggers that build. Production remains unchanged until separate migration/deployment approvals and owner merge.
