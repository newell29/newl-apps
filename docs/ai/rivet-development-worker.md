# Rivet approved-development worker

> Evidence status: Confirmed from code. Live installation and production enablement remain approval-gated.

Rivet is the restricted local development worker for administrator-approved Newl Apps suggestions. It uses the authenticated Codex CLI bundled with or configured for the local Codex installation. It does not require an OpenAI API key.

## Approval and grouping

The daily digest and the Newl Apps feedback page call the same deterministic grouping service. Similar feedback is grouped by tenant, module, workflow, classification, and issue theme before a suggestion is presented for approval. Confirmed Garland themes include:

- Lot/Serial extraction and commodity formatting;
- Special Instructions extraction;
- missed-order and email processing;
- order-status responses.

Generic feedback is normalized and grouped only when its significant terms meet the configured similarity threshold. Different known Garland themes are never combined merely because they share the `CHECK_RESULT` classification.

Selecting **Approve & start Rivet** is the single approval to begin development. The approval transaction records the administrator decision and creates one tenant-scoped `AutomationJobRun` with job type `ASSISTANT_RIVET_DEVELOPMENT`. Repeated requests cannot approve the same suggestion twice.

## Required Garland understanding

Every approved job contains a deterministic `requiredContextPaths` manifest. Garland jobs require the repository instructions, architecture and assistant documentation, Shipment Documents documentation, and the Garland overview, review, Teamship, email, parsing, validation, edge-case, pallet, printing, and permission documents.

The local Codex prompt requires every listed document to be read before any file is changed. These repository files are the source of approved Garland understanding; generic WMS assumptions are prohibited.

## Worker flow

1. The local OpenClaw command schedule runs `ops/openclaw/run-rivet-development-job.sh` once per minute.
2. The worker authenticates with the existing distinct OpenClaw assistant token and Alex's configured Microsoft Entra identity.
3. Newl Apps returns at most one approved queued job and a short-lived, hashed server-side lease.
4. The worker creates a fresh `codex/rivet-*` Git worktree from the approved base branch.
5. Codex reads the required context, implements only the approved cohesive issue, adds regression tests, updates documentation, and returns schema-validated results.
6. The wrapper rejects blocked paths, checks the diff, commits, pushes the isolated branch, and opens a draft pull request.
7. Newl Apps records the branch, commit, PR URL, tests, limitations, and audit evidence. Rivet messages only the configured Teams target.

The worker uses a fine-grained GitHub token only to open the pull request. That token is removed from the environment passed to Codex. Git push continues through the workstation's trusted repository credential.

## Hunter quality-triggered development

The same dedicated Rivet runtime also schedules `ops/openclaw/run-rivet-hunter-quality-audit.sh` daily at 11:30 America/Toronto. It asks Newl Apps for a tenant-scoped five-company stratified sample plus deterministic TradeMining run-health findings. Codex independently researches the public web in read-only mode and returns schema-validated findings.

Only reproducible evidence-retrieval, evidence-handoff, deterministic-rule, or TradeMining code defects can enter the development queue, and only when the application environment contains the exact owner-approved value `HUNTER_RIVET_AUTO_TRIAGE_APPROVAL=OWNER_APPROVED_HUNTER_QUALITY_TRIAGE`. Subjective model judgment, credentials, transient runtime failures, and business configuration are Teams alerts, not automatic code changes.

The daily audit sends its own summary through `RIVET_TEAMS_TARGET`. If a development job is queued, the normal Rivet worker later sends the same PR-completion or failure notification used for other approved fixes.

## Permissions

Approval permits Rivet and Codex to read required repository context, edit an isolated feature branch, add tests and documentation, commit, push the feature branch, and open a draft PR.

Approval never permits Rivet or Codex to:

- merge or deploy;
- write production data or execute a database migration;
- update Teamship;
- print, ship, or release an order;
- change permissions;
- contact a customer.

The existing 10:00 AM digest remains read-only and cannot claim development work. The Rivet development worker is a separate OpenClaw command schedule with a protected environment file.

## Configuration and installation

Copy the variable names from `ops/openclaw/rivet-development.env.example` into `~/.openclaw/agents/rivet/.env`, supply the protected values locally, and set file permissions to `600`. `RIVET_TEAMS_TARGET` must be Alex's direct target in `user:<aad-object-id>` form.

After the application PR is reviewed, merged, and deployed, and after explicit approval to change the local OpenClaw runtime, run:

```text
/bin/zsh ops/openclaw/install-rivet-development-worker.sh
```

The installer creates a clean runtime worktree and registers the `NEWL Rivet Developer` and `NEWL Hunter Quality Auditor` command schedules. Do not install it against Preview or before the production API route is live.

Production auto-triage additionally requires the exact non-secret standing-approval value above in the Newl Apps application environment. The protected local Rivet file continues to supply the assistant identity, repository, and Teams target; it must not contain production database credentials.

The development-jobs API remains outside browser session middleware so the route can enforce its own assistant-token and administrator Teams-identity authentication. An unauthenticated request must reach that route and be rejected by its dedicated authentication instead of being redirected to `/login`.

## Failure handling

An active job uses a short-lived lease. A worker error or expired lease marks the job failed and sends a safe Teams message. Failed jobs are not automatically retried. The local worktree is preserved for investigation when a failure occurs; after checking that no uncertain branch or PR action is still running, an administrator may select **Retry Rivet** to create a new job and lease. Completed worktrees are removed after the PR URL is recorded.

Existing suggestions approved before this workflow are not automatically queued. Link or close their already-created PR work before enabling the worker so Rivet does not rebuild historical fixes.
