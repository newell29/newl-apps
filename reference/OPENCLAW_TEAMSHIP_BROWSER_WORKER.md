# OpenClaw Teamship Browser Read Worker

Draft operator guide for running the read-only Teamship browser worker on Alex's Mac Mini.

## Purpose

The OpenClaw Teamship read endpoint on Vercel remains the authentication, tenant-scope, and audit boundary. Browser-only reads run on the Mac Mini because it already has Google Chrome installed and can stay online as a small internal server.

Flow:

1. OpenClaw/Nemo calls `POST /api/assistant/teamship/read` on Newl Apps.
2. Newl Apps validates the bearer token, employee membership, named-user policy, tenant module access, Teamship settings, and exact customer/warehouse scope.
3. If the request needs Inventory All, Ship by LPN, Receiving Order, or Product History, Newl Apps enqueues a `TeamshipBrowserReadJob`.
4. The Mac Mini worker polls Newl Apps over outbound HTTPS, claims one tenant-bound job, receives the tenant-scoped Teamship credentials only in the claim response, runs the guarded Playwright reader in Chrome, and completes or fails the job.
5. Newl Apps normalizes the returned rows, records the existing Teamship read audit, and returns the answer to Nemo.

The Mac Mini does not need an inbound public port. It also does not need a separate local Teamship email or password: the authorized claim response supplies the active tenant's credentials from the encrypted `Teamship WMS` integration in Newl Apps. The local worker needs only its Newl Apps URL, dedicated worker token, worker ID, allowed hosts, and Chrome runtime settings.

## Vercel environment variables

Set these on the Newl Apps Vercel project after the PR is deployed:

```dotenv
TEAMSHIP_BROWSER_WORKER_QUEUE_ENABLED=true
TEAMSHIP_BROWSER_WORKER_TOKEN=<separate random token for the Mac worker>
TEAMSHIP_BROWSER_WORKER_TENANT_SLUG=newl-group
```

Keep the existing OpenClaw endpoint variables configured as before:

```dotenv
OPENCLAW_TEAMSHIP_READ_TOKEN=<OpenClaw endpoint token>
OPENCLAW_TEAMSHIP_TENANT_SLUG=newl-group
```

Do not set `TEAMSHIP_BROWSER_READ_RUNTIME_ENABLED=true` on Vercel for the Mac-worker rollout. Vercel should enqueue browser jobs, not launch Chrome itself.

## Mac Mini environment variables

Put these in the environment used by the worker process, for example `~/.openclaw/.env`:

```dotenv
NEWL_APPS_BASE_URL=https://newl-apps.vercel.app
TEAMSHIP_BROWSER_WORKER_TOKEN=<same Mac worker token from Vercel>
TEAMSHIP_BROWSER_WORKER_ID=alex-mac-mini-teamship
TEAMSHIP_BROWSER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
TEAMSHIP_BROWSER_READ_HEADED=false
TEAMSHIP_BROWSER_READ_TIMEOUT_MS=30000
TEAMSHIP_BROWSER_WORKER_POLL_MS=2000
TEAMSHIP_BROWSER_ALLOWED_HOSTS=app.teamshipos.com,members.fulfillit.io
TEAMSHIP_WORKER_REPO_PATH=/Users/alexnewellmm/Developer/newl-apps
```

Do not put Teamship credentials in OpenClaw memory or the Mac `.env`. The worker receives tenant-scoped Teamship credentials only after it claims an authorized job.

## Manual smoke test

From the local `newl-apps` repo on the Mac Mini:

```bash
set -a
source ~/.openclaw/.env
set +a
npm run worker:teamship-browser-read -- --once
```

Expected results:

- If no browser job is waiting: `No Teamship browser read job is waiting.`
- If a job is waiting: one claim, one Chrome read, then either completed or failed with a sanitized error.

The live Teamship Inventory search is applied by pressing Enter in the search field. The visible search icon does not submit the current query reliably and must not be used by the worker.

In another terminal, trigger a browser-backed query through the existing OpenClaw wrapper, such as Inventory All, LPN, Receiving Order, or Product History with exact customer and warehouse IDs.

## launchd service

Install the checked-in LaunchAgent, align the worker with the same Preview URL used by Nemo, and start it:

```bash
ops/openclaw/install-teamship-browser-read-worker.sh \
  --base-url https://the-reviewed-preview.vercel.app
```

The installer validates required environment names without printing values, renders `ops/openclaw/launchd/com.newl.teamship-browser-read-worker.plist.template`, writes persistent logs under `~/Library/Logs/newl-apps/`, and uses `RunAtLoad` plus `KeepAlive` so the worker returns after login, reboot, or an unexpected exit. The runner imports only the worker's allowlisted environment names and safely accepts quoted or unquoted paths containing spaces.

Verify it:

```bash
launchctl print gui/$(id -u)/com.newl.teamship-browser-read-worker
tail -n 20 ~/Library/Logs/newl-apps/teamship-browser-read-worker.out.log
tail -n 20 ~/Library/Logs/newl-apps/teamship-browser-read-worker.err.log
```

Stop it:

```bash
launchctl bootout gui/$(id -u)/com.newl.teamship-browser-read-worker
```

If Inventory All waits about 60 seconds and returns `Teamship could not complete the read-only request`, first verify that this LaunchAgent is loaded and that the worker and Nemo use the same Newl Apps Preview URL. API-backed shipping-order reads do not use this worker.

## Safety limits

The worker supports only the existing read-only browser operations:

- Inventory All by exact SKU
- Ship by LPN by exact SKU or LPN
- Receiving Order detail by exact order ID
- Product History by exact product ID

It must not click Save, Edit, Add, Print, Warehouse Receipt, Delete Order, Complete Receiving, receiving/picking/packing actions, billing controls, or admin mutation controls.

If Chrome, Teamship, the Mac, or the worker token is unavailable, the current-record question should fail with a clear browser-worker unavailable message while API-backed shipping-order reads continue to work.

The Vercel token is bound to `TEAMSHIP_BROWSER_WORKER_TENANT_SLUG`. A worker authenticated with that token cannot claim, complete, or fail jobs belonging to another tenant.
