# Nemo Garland production rollout

> Evidence status: Confirmed from code for technical controls. Each live action below requires the stated human approval.

This runbook is the production handoff for the Garland Phase 1 changes in Newl Apps and OpenClaw. It intentionally does not use Vercel Preview. It preserves the existing Teamship read-only workflow and does not authorize Teamship writes, printing, shipping, customer communication, merging, migration, deployment, or schedule activation by itself.

## Release boundary

Phase 1 enables these employee workflows in Microsoft Teams:

- explain why the latest saved Garland check passed, failed, was missing, or stayed pending;
- save employee feedback as unapproved evidence;
- attach an existing Garland order PDF, store it in tenant-scoped PostgreSQL, and run the existing deterministic read-only Teamship comparison;
- prepare an administrator-only development suggestion digest that cannot start development.

Phase 1 does not update Teamship or print BOLs, picking lists, or labels.

## Before production migration

The release owner must confirm all of the following before approving a migration:

1. The pull request is reviewed, mergeable, and based on current `main`.
2. Focused Newl Apps tests, the OpenClaw plugin tests/build, Prisma validation, and modified-file linting pass.
3. Production has a new `OPENCLAW_ASSISTANT_TOKEN` secret and OpenClaw has the matching value. Never print either value or place it in a command, issue, pull request, document, or chat.
4. `OPENCLAW_ASSISTANT_TOKEN` and `OPENCLAW_TEAMSHIP_READ_TOKEN` are both present and have different values. Do not rotate or replace the existing Teamship read token as part of this release.
5. The production OpenClaw plugin configuration uses the production Newl Apps HTTPS URL, the existing Teams tenant UUID, `readTokenEnv: "OPENCLAW_TEAMSHIP_READ_TOKEN"`, and `assistantTokenEnv: "OPENCLAW_ASSISTANT_TOKEN"`.
6. `vercelProtectionBypassEnv` is absent in production.
7. The digest is disabled. Record the intended direct-message target as `user:<aad-object-id>` without committing the real object ID.
8. A known Garland PDF is selected for the supervised smoke test. The test must not request a Teamship update or any printing action.

Changing production secrets or OpenClaw configuration requires Alex's explicit approval.

## Safe release order

### 1. Apply the additive database migration

Requires explicit approval for a production database migration.

After code review is complete but before merging the application change, dispatch `.github/workflows/production-migrations.yml` from the reviewed feature-branch ref. Approve the protected `production` environment only after the workflow identifies `DATABASE_ENVIRONMENT=production` and the expected database host/name. The workflow runs `npm run db:migrate:production` and does not deploy the application.

Do not run the migration from a local Codex or OpenClaw process and do not paste a production database URL into a terminal command.

The migration is additive: it creates workflow-artifact, feedback, approved-lesson, and development-suggestion tables and indexes. A successful migration may remain in place during an application rollback; do not drop these tables as an emergency rollback step.

### 2. Merge and deploy the reviewed application

Requires explicit approval to merge and deploy production.

Merge only after the production migration succeeds. Allow the normal production deployment from `main`, then confirm the deployment commit matches the reviewed pull request. Do not create or validate a Preview deployment for this release.

Run only read-only health checks at this stage:

- invalid or missing assistant authentication is rejected;
- the existing identity-bound `newl_teamship_read` path still returns its deterministic response;
- no Teamship, print, shipping, or customer-communication action is invoked.

### 3. Install or reload OpenClaw plugin 0.2.1

Requires explicit approval to change the live OpenClaw runtime.

Back up the current plugin manifest and workspace instructions without copying secret values. Install the reviewed `ops/openclaw/plugins/newl-teamship` package, retain the existing Teamship read configuration, add the separate assistant-token environment name, and append only the new Garland lines from `ops/openclaw/AGENTS.teamship.md` and `ops/openclaw/skills/teamship-read-only/SKILL.md`. Reload OpenClaw once.

Confirm the existing Teamship tools and unresolved-turn capture still load before testing Garland. Do not enable printing or Teamship write tools.

### 4. Run one supervised Teams PDF test

Requires explicit approval because it stores a real PDF and performs a live read-only Teamship lookup.

From the approved employee's normal Teams conversation:

1. attach one known Garland order PDF, preferably one containing multiple PS/SR records;
2. ask Nemo to check one exact PS number from the PDF and explicitly say to ignore the other orders;
3. confirm Nemo reports the saved artifact and review identifiers;
4. confirm the saved review is visible in Newl Apps and its returned artifact identifier belongs to the correct tenant-scoped storage record;
5. confirm the result names only the requested PS/SR, reports how many other PDF orders were ignored, and contains deterministic pass/fail/missing/pending counts;
6. ask why one saved result passed or failed;
7. submit one clearly labelled test feedback statement and confirm it remains `REPORTED`, not approved memory.

Do not send a new Teams message merely to test idempotency. Automated coverage verifies that OpenClaw retries of the same Teams message and PDF reuse the artifact; a genuinely new Teams message is separate source evidence.

Stop immediately if Nemo asks for a filesystem path, accepts an identity supplied in prompt text, uses a different tenant, updates Teamship, or attempts to print.

### 5. Enable the 10:00 AM development digest

Requires explicit approval to create the live schedule and send the first Teams message.

Enable this only after the supervised PDF test passes. Schedule it for 10:00 AM in `America/Toronto` and target Alex's existing direct Teams conversation as `user:<aad-object-id>`. Run it under the dedicated Rivet developer agent through the Codex harness. The scheduled run may call only `newl_development_suggestion_digest`; it summarizes approval-gated team suggestions and captured failed/unanswered Nemo queries. Its response must say that approval is required and no development was started.

Do not give the scheduled Nemo task Codex, GitHub write, deployment, Teamship write, printing, or arbitrary browser permissions. A later developer agent may summarize approved suggestions, but each build still requires a separate human-approved Codex task and reviewed pull request.

## Rollback

If the supervised test fails:

1. keep the digest disabled or remove its schedule;
2. restore the previous OpenClaw plugin package and workspace instructions, then reload OpenClaw;
3. verify `newl_teamship_read` and unresolved-turn capture still work;
4. roll the production application back to the prior reviewed deployment if the failure is server-side;
5. leave the additive database migration in place and preserve any uploaded artifact/audit evidence for investigation;
6. do not retry with Teamship writes, printing, a different employee identity, or direct database edits.

Record the failure, artifact identifier, review identifier, deployment commit, and non-secret error summary. Never record tokens, session cookies, PDF contents, or unrestricted customer data in the incident note.

## Post-release review

After the first business day, review audit records, failed artifacts, reported feedback, digest output, and database growth. PDF retention remains an owner decision. Printing remains a later phase with separate workstation/printer authorization, deterministic document selection, and explicit approval controls.
