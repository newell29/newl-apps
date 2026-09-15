import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const repoRoot = process.cwd();
const servicePath = path.join(repoRoot, "ops/teamship-phase2-vm/newl-teamship-phase2-worker.service");
const installerPath = path.join(repoRoot, "scripts/install-teamship-phase2-vm-services.sh");

describe("Garland Teamship VM worker service", () => {
  it("runs headed Chrome inside a private virtual display", async () => {
    const service = await readFile(servicePath, "utf8");

    expect(service).toContain("Environment=TEAMSHIP_AGENT_MODE=live-api");
    expect(service).toContain("Environment=TEAMSHIP_BROWSER_HEADED=true");
    expect(service).toContain(
      'ExecStart=/usr/bin/xvfb-run -a -s "-screen 0 1440x1100x24 -nolisten tcp" /usr/bin/npm run worker:teamship-phase2 -- --loop'
    );
    expect(service).not.toContain("Environment=DISPLAY=");
    expect(service).not.toContain("Environment=XAUTHORITY=");
  });

  it("fails installation before changing services when Xvfb is unavailable", async () => {
    const installer = await readFile(installerPath, "utf8");

    const dependencyCheck = installer.indexOf("if [[ ! -x /usr/bin/xvfb-run ]]");
    const firstServiceCopy = installer.indexOf("cp ops/teamship-phase2-vm/newl-teamship-phase2-worker.service");

    expect(dependencyCheck).toBeGreaterThan(-1);
    expect(firstServiceCopy).toBeGreaterThan(dependencyCheck);
    expect(installer).toContain("sudo apt-get install -y xvfb xauth");
    expect(installer).toContain("No services were installed or changed.");
  });

  it("remains valid Bash", async () => {
    await expect(execFileAsync("/bin/bash", ["-n", installerPath])).resolves.toBeDefined();
  });
});
