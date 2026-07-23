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

## User interface

- Approved opportunities with a saved draft display **View draft / build status** in the opportunity queue.
- A stale draft displays **Retry stale developer build** in its Build package section.
- The owner still reviews the resulting Vercel Preview and owns the merge decision. Retry does not publish or deploy production directly.

## Regression coverage

`tests/website-growth.test.ts` verifies the 10-minute dispatched and 45-minute running retry boundaries and confirms that a run with an open pull request is not treated as stale.

`tests/middleware-machine-routes.test.ts` verifies that the Website Growth build-request endpoints bypass browser-session middleware and retain their own worker-token and tenant authentication.
