import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const repoRoot = process.cwd();

const servicePath = path.join(
  repoRoot,
  "ops/teamship-phase2-vm/newl-tmg-order-intake-worker.service"
);
const envTemplatePath = path.join(
  repoRoot,
  "ops/teamship-phase2-vm/tmg-order-intake-worker.env.example"
);
const installerPath = path.join(repoRoot, "scripts/install-teamship-phase2-vm-services.sh");
const updaterPath = path.join(repoRoot, "scripts/teamship-phase2-vm-update.sh");

describe("TMG VM worker service", () => {
  it("runs the isolated TMG worker with its own protected environment", async () => {
    const service = await readFile(servicePath, "utf8");

    expect(service).toContain("EnvironmentFile=%h/newl-apps/.env.tmg-order-intake-worker");
    expect(service).toContain("ExecStart=/usr/bin/npm run worker:tmg-order-intake");
    expect(service).toContain("Restart=always");
    expect(service).toContain("Nice=5");
    expect(service).not.toContain("worker:teamship-phase2");
    expect(service).not.toContain(".env.teamship-phase2-worker");
  });

  it("keeps live TMG writes off in the committed environment template", async () => {
    const template = await readFile(envTemplatePath, "utf8");

    expect(template).toContain("TMG_WORKER_BASE_URL=https://newl-apps.vercel.app");
    expect(template).toContain("INGESTION_API_TOKEN=replace-with-production-ingestion-token");
    expect(template).toContain("TMG_ALLOW_LIVE_WRITES=false");
    expect(template).toContain("TEAMSHIP_BROWSER_EXECUTABLE_PATH=/usr/bin/google-chrome");
    expect(template).not.toMatch(/TMG_ALLOW_LIVE_WRITES=true/);
    expect(template).not.toContain("NEWL_AGENT_TOKEN=");
  });

  it("installs TMG without enabling or starting it", async () => {
    const installer = await readFile(installerPath, "utf8");

    expect(installer).toContain("newl-tmg-order-intake-worker.service");
    expect(installer).toContain("tmg-order-intake-worker.env.example");
    expect(installer).toContain('chmod 600 "$TMG_ENV_FILE"');
    expect(installer).not.toMatch(
      /^systemctl --user enable(?: --now)? newl-tmg-order-intake-worker\.service/m
    );
    expect(installer).not.toMatch(
      /^systemctl --user start newl-tmg-order-intake-worker\.service/m
    );
  });

  it("restarts only workers that were active before an auto-update", async () => {
    const updater = await readFile(updaterPath, "utf8");

    expect(updater).toContain(
      "DEFAULT_WORKER_SERVICES=\"newl-teamship-phase2-worker.service newl-tmg-order-intake-worker.service\""
    );
    expect(updater).toContain('systemctl --user is-active --quiet "$worker_service"');
    expect(updater).toContain('STOPPED_WORKER_SERVICES+=("$worker_service")');
    expect(updater).toContain('for worker_service in "${STOPPED_WORKER_SERVICES[@]}"');
    expect(updater).not.toContain("systemctl --user enable");
  });

  it("keeps both VM management scripts valid Bash", async () => {
    await expect(execFileAsync("/bin/bash", ["-n", installerPath])).resolves.toBeDefined();
    await expect(execFileAsync("/bin/bash", ["-n", updaterPath])).resolves.toBeDefined();
  });
});
