# Teamship VM Services

This VM setup keeps the Garland Teamship Phase 2 worker running, provides a separately activated TMG order-intake worker, and keeps the VM checkout updated from GitHub `main`.

## What It Installs

- `newl-teamship-phase2-worker.service`: always-running `live-api` worker that polls Newl Apps for approved Teamship Phase 2 jobs.
- `newl-tmg-order-intake-worker.service`: isolated TMG worker that polls only for CSR-approved TMG create/upload jobs. The installer places this unit but does not enable or start it.
- `newl-apps-auto-update.timer`: checks GitHub `main` every 5 minutes.
- `newl-apps-auto-update.service`: fast-forwards the VM repo when safe, runs `npm install` if dependencies changed, and restarts only the Garland/TMG workers that were active before the update.

The services are user-level `systemd` units for the `newln8n` user. Secrets stay in `~/newl-apps/.env.teamship-phase2-worker` and `~/newl-apps/.env.tmg-order-intake-worker`, not in Git. TMG shares the VM host, Chrome installation, and Tailscale-supported administration with Garland, but not Garland's process, environment, queue, or browser worker.

## Install On The VM

From the VM:

```bash
cd ~/newl-apps
git pull origin main
bash scripts/install-teamship-phase2-vm-services.sh
nano .env.teamship-phase2-worker
systemctl --user start newl-teamship-phase2-worker.service
systemctl --user start newl-apps-auto-update.timer
```

The installer also creates `.env.tmg-order-intake-worker` with live writes disabled. Do not enable or start the TMG service as part of ordinary Garland installation.

Optional but recommended so the worker survives logout/reboot:

```bash
sudo loginctl enable-linger "$USER"
```

## Environment File

Use `ops/teamship-phase2-vm/teamship-phase2-worker.env.example` as the template. Required:

- `NEWL_AGENT_TOKEN`: production ingestion token from Vercel.
- `NEWL_APPS_BASE_URL`: usually `https://newl-apps.vercel.app`.
- `TEAMSHIP_BROWSER_EXECUTABLE_PATH`: usually `/usr/bin/google-chrome`.
- `TEAMSHIP_LIVE_ALLOWLIST_SR_NUMBERS`: optional comma-separated SR list for limited rollout testing. Set it to `*` only when the VM should process every approved Newl Apps job. Leave it unset/blank to block live jobs until an explicit rollout choice is made.

Use `DISPLAY=:0` or `DISPLAY=:1` if headed Chrome needs the VNC display. The installer tries to copy the current shell's `DISPLAY` into the env file automatically.

## TMG Environment And Activation

Use `ops/teamship-phase2-vm/tmg-order-intake-worker.env.example` as the template. Required:

- `TMG_WORKER_BASE_URL`: usually `https://newl-apps.vercel.app`.
- `INGESTION_API_TOKEN`: the production ingestion token expected by the TMG worker routes.
- `TEAMSHIP_BROWSER_EXECUTABLE_PATH`: usually `/usr/bin/google-chrome`.
- `TMG_ALLOW_LIVE_WRITES`: remains `false` until the separately approved live activation.

The worker launches its own short-lived Chrome process for each approved document upload and does not reuse Garland's browser profile. It processes one approved TMG job at a time and has a lower process priority than Garland. During a separately approved supervised activation:

```bash
nano .env.tmg-order-intake-worker
systemctl --user enable --now newl-tmg-order-intake-worker.service
```

Before enabling it, set the real ingestion token, change `TMG_ALLOW_LIVE_WRITES=true`, and confirm the browser executable plus any headed-browser `DISPLAY`/`XAUTHORITY` values. Enabling the service authorizes it to claim only jobs that already carry CSR approval; it does not remove the CSR approval boundary.

## API Plus BOL Cleanup Flow

For `TEAMSHIP_AGENT_MODE=live-api`, the worker runs the Teamship API update first, including approved field updates and `pallets[]` rows for pallet quantity, DIMS, weight, unit, and commodity text. Browser automation is no longer used for pallet rows. When one SKU has multiple serials, the commodity line is grouped as `SKU: <sku> SN: <serial>, <serial>, <serial>`; non-serialized lines use `SKU: <sku> QTY: <quantity>`.

After each successful API update, the worker automatically opens the editable BOL in the VM browser for every successfully updated order that has planned BOL cleanup. The cleanup removes Teamship-generated weight values from the Customer Order Information weight column and records screenshots/readback evidence with the job.

The worker uses a bounded browser recovery policy for this post-API step:

- A closed Playwright page, context, browser, or disconnected Chrome process triggers one fresh browser session and retries the interrupted cleanup order.
- The API update is not repeated during this browser recovery.
- If the replacement browser also closes, the interrupted order fails, remaining cleanup orders are marked skipped under the shared browser incident, and the batch stops.
- A later production cleanup retry is not automatic and still requires an explicitly approved action.

To temporarily turn off the browser cleanup while keeping API updates enabled, set one of:

```bash
TEAMSHIP_BROWSER_BOL_CLEANUP=false
TEAMSHIP_BROWSER_DISABLE_BOL_CLEANUP=true
```

Do not set `TEAMSHIP_AGENT_MODE=live-browser` for production pallet updates. That legacy pallet-browser path was retired after the Teamship shipping-order API was validated.

## Operations

Check worker status:

```bash
systemctl --user status newl-teamship-phase2-worker.service
```

Watch worker logs:

```bash
journalctl --user -u newl-teamship-phase2-worker.service -f
```

Check updater timer:

```bash
systemctl --user list-timers newl-apps-auto-update.timer
```

Run update immediately:

```bash
systemctl --user start newl-apps-auto-update.service
```

Restart worker manually:

```bash
systemctl --user restart newl-teamship-phase2-worker.service
```

Check or follow the isolated TMG worker:

```bash
systemctl --user status newl-tmg-order-intake-worker.service
journalctl --user -u newl-tmg-order-intake-worker.service -f
```

## Safety Behavior

The updater only fast-forwards `main`. It skips updating when:

- The checkout is not on `main`.
- Tracked files have local changes.
- GitHub `origin/main` cannot be fast-forwarded cleanly.

This prevents the VM from accidentally overwriting local work while still keeping normal production code up to date.

The updater records which worker services were active before it changes the checkout. Inactive services remain stopped, so installing the TMG unit cannot silently activate live writes during a later repository update.
