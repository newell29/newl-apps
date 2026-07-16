# Teamship Phase 2 VM Services

This VM setup keeps the Garland Teamship Phase 2 worker running and keeps the VM checkout updated from GitHub `main`.

## What It Installs

- `newl-teamship-phase2-worker.service`: always-running `live-api` worker that polls Newl Apps for approved Teamship Phase 2 jobs.
- `newl-apps-auto-update.timer`: checks GitHub `main` every 5 minutes.
- `newl-apps-auto-update.service`: fast-forwards the VM repo when safe, runs `npm install` if dependencies changed, and restarts the worker.

The services are user-level `systemd` units for the `newln8n` user. Secrets stay in `~/newl-apps/.env.teamship-phase2-worker`, not in Git.

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

Optional but recommended so the worker survives logout/reboot:

```bash
sudo loginctl enable-linger "$USER"
```

## Environment File

Use `ops/teamship-phase2-vm/teamship-phase2-worker.env.example` as the template. Required:

- `NEWL_AGENT_TOKEN`: production ingestion token from Vercel.
- `NEWL_APPS_BASE_URL`: usually `https://newl-apps.vercel.app`.
- `TEAMSHIP_BROWSER_EXECUTABLE_PATH`: usually `/usr/bin/google-chrome`.
- `TEAMSHIP_LIVE_ALLOWLIST_SR_NUMBERS`: optional comma-separated SR list for limited rollout testing. Leave it unset/blank, or set it to `*`, to let the VM process every approved Newl Apps job.

Use `DISPLAY=:0` or `DISPLAY=:1` if headed Chrome needs the VNC display. The installer tries to copy the current shell's `DISPLAY` into the env file automatically.

## API Plus BOL Cleanup Flow

For `TEAMSHIP_AGENT_MODE=live-api`, the worker runs the Teamship API update first, including approved field updates and `pallets[]` rows for pallet quantity, DIMS, weight, unit, and commodity text. Browser automation is no longer used for pallet rows.

After each successful API update, the worker automatically opens the editable BOL in the VM browser for every successfully updated order that has planned BOL cleanup. The cleanup removes Teamship-generated weight values from the Customer Order Information weight column and records screenshots/readback evidence with the job.

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

## Safety Behavior

The updater only fast-forwards `main`. It skips updating when:

- The checkout is not on `main`.
- Tracked files have local changes.
- GitHub `origin/main` cannot be fast-forwarded cleanly.

This prevents the VM from accidentally overwriting local work while still keeping normal production code up to date.
