import { spawn } from "node:child_process";

const token = process.env.NEWL_AGENT_TOKEN?.trim() || process.env.INGESTION_API_TOKEN?.trim();

if (!token) {
  console.error("NEWL_AGENT_TOKEN is required. Run with NEWL_AGENT_TOKEN='<production ingestion token>' npm run worker:teamship-sr810465-vm");
  process.exit(1);
}

const child = spawn(
  "npm",
  [
    "run",
    "worker:teamship-phase2",
    "--",
    "--loop"
  ],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      TEAMSHIP_AGENT_MODE: "live-browser",
      TEAMSHIP_ALLOW_LIVE_UPDATES: "true",
      TEAMSHIP_BROWSER_HEADED: "true",
      TEAMSHIP_BROWSER_SLOW_MO_MS: process.env.TEAMSHIP_BROWSER_SLOW_MO_MS || "350",
      TEAMSHIP_BROWSER_PAUSE_ON_ERROR: "true",
      TEAMSHIP_LIVE_ALLOWLIST_SR_NUMBERS: "SR810465",
      NEWL_APPS_BASE_URL: process.env.NEWL_APPS_BASE_URL || "https://newl-apps.vercel.app",
      NEWL_AGENT_TOKEN: token,
      TEAMSHIP_BROWSER_EXECUTABLE_PATH: process.env.TEAMSHIP_BROWSER_EXECUTABLE_PATH || "/usr/bin/google-chrome"
    }
  }
);

child.on("exit", (code, signal) => {
  if (signal) {
    console.error(`Teamship SR810465 VM worker stopped by signal ${signal}.`);
    process.exit(1);
  }

  process.exit(code ?? 0);
});
