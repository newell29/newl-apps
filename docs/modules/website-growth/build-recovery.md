# Website Growth developer build recovery

> Evidence status: Confirmed from code.

## Purpose

An approved Website Growth brief dispatches a GitHub Actions build in the Newl website repository. The website workflow reports running, pull-request, preview, and failure states back to Newl Apps.

If GitHub Actions stops before its first callback, Newl Apps may still show the developer run as `DISPATCHED` even though the external workflow has already failed. This can happen during repository checkout or infrastructure startup.

The approved-brief package and status callback endpoints are machine routes. Middleware must allow them to reach their dedicated tenant-bound bearer-token authentication without requiring a browser session cookie. Otherwise the website workflow receives the login page instead of JSON and stops before either model runs.

## Stale-run recovery

- A `DISPATCHED` queued run becomes retryable when no callback has updated it for 10 minutes. The package fetch and initial running callback normally happen within seconds, so this shorter window recovers startup and authentication failures without waiting for the full model-build timeout.
- A `RUNNING` active run becomes retryable after a longer 45-minute callback window.
- Runs at `PR_OPEN` or `PREVIEW_READY` never become retryable through this timeout because a branch or review artifact already exists.
- Existing `ERROR` and `CANCELLED` runs remain retryable immediately.
- Retry reuses the same tenant-scoped, immutable approved brief and dispatches the workflow from the currently configured website base branch.
- Only an authenticated Admin or Manager with Website Growth mutation access may retry.

## Completed-build reconciliation

A developer may finish an approved build manually when the primary coding runner times out after receiving the immutable brief. The deployment callback can reconcile that completed build without creating a second Scout opportunity:

- The callback may identify the build by its automation-job ID or by the approved content-draft ID embedded in the job input. Both lookups remain restricted to the authenticated tenant and the Website Growth developer-build job type.
- A failed job may move back to `PREVIEW_READY` only when one callback supplies the HTTPS preview URL and full 40-character deployment commit SHA, plus either the exact approved content-draft ID or a matching HTTPS pull-request URL and positive pull-request number. The draft-ID path supports a manually recovered branch even when the older callback workflow did not send PR metadata; newer callbacks send both.
- Successful reconciliation records the pull request and preview on the existing content draft, moves that draft to `BUILT`, and moves the existing opportunity to `IN_PROGRESS`.
- Later callbacks preserve previously recorded GitHub, pull-request, preview, and commit evidence when a callback omits a field.
- Publishing remains separate. A preview recovery cannot mark a page published and does not bypass the human pull-request review and merge decision.

## User interface

- Approved opportunities with a saved draft display **View draft / build status** in the opportunity queue.
- A stale draft displays **Retry stale developer build** in its Build package section.
- The owner still reviews the resulting Vercel Preview and owns the merge decision. Retry does not publish or deploy production directly.

## Regression coverage

`tests/website-growth.test.ts` verifies the 10-minute dispatched and 45-minute running retry boundaries and confirms that a run with an open pull request is not treated as stale.

`tests/website-growth-build-completion.test.ts` verifies tenant-scoped job-or-draft lookup, rejects incomplete unscoped recovery evidence, covers the approved-draft fallback, and confirms that matched preview and pull-request evidence updates the existing draft and opportunity.

`tests/middleware-machine-routes.test.ts` verifies that the Website Growth build-request endpoints bypass browser-session middleware and retain their own worker-token and tenant authentication.
