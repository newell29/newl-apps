import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();

describe("OpenClaw Teamship browser worker launchd service", () => {
  it("keeps the worker alive and writes persistent logs", () => {
    const template = readFileSync(
      path.join(repoRoot, "ops/openclaw/launchd/com.newl.teamship-browser-read-worker.plist.template"),
      "utf8"
    );

    expect(template).toContain("<string>com.newl.teamship-browser-read-worker</string>");
    expect(template).toMatch(/<key>RunAtLoad<\/key>\s*<true\/>/);
    expect(template).toMatch(/<key>KeepAlive<\/key>\s*<true\/>/);
    expect(template).toContain("__RUNNER_PATH__");
    expect(template).toContain("__ENV_FILE__");
    expect(template).toContain("teamship-browser-read-worker.out.log");
    expect(template).toContain("teamship-browser-read-worker.err.log");
  });

  it("installs the service and starts the read-only worker command", () => {
    const installer = readFileSync(
      path.join(repoRoot, "ops/openclaw/install-teamship-browser-read-worker.sh"),
      "utf8"
    );
    const runner = readFileSync(
      path.join(repoRoot, "ops/openclaw/run-teamship-browser-read-worker.sh"),
      "utf8"
    );

    expect(installer).toContain("launchctl bootstrap");
    expect(installer).toContain("launchctl kickstart");
    expect(installer).toContain("NEWL_APPS_BASE_URL");
    expect(runner).toContain("npm run worker:teamship-browser-read");
    expect(runner).toContain("TEAMSHIP_BROWSER_EXECUTABLE_PATH");
    expect(runner).toContain('/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin');
    expect(runner).not.toContain('source "${worker_env_file}"');
  });
});
