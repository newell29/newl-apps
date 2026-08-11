import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const execFileAsync = promisify(execFile);

describe("Hunter Mac outreach handoff worker", () => {
  it("drains the server-owned queue after research and from an independent poller", async () => {
    const [research, worker, handoff] = await Promise.all([
      readFile(path.join(repoRoot, "ops/openclaw/hunter/hunter_company_research.py"), "utf8"),
      readFile(path.join(repoRoot, "ops/openclaw/hunter/hunter_worker.py"), "utf8"),
      readFile(path.join(repoRoot, "ops/openclaw/hunter/hunter_outreach_handoff.py"), "utf8")
    ]);

    expect(research).toContain("drain_outreach_handoff(");
    expect(worker).toContain("def run_outreach_handoff_poller(");
    expect(worker).toContain('name="hunter-outreach-handoff"');
    expect(worker).toContain("target=run_outreach_handoff_poller");
    expect(worker).toContain("daemon=True");
    expect(worker.indexOf("threading.Thread(")).toBeLessThan(worker.indexOf("while True:"));
    expect(worker.indexOf("threading.Thread(")).toBeLessThan(
      worker.lastIndexOf("process_once(base_url, token")
    );
    expect(handoff).toContain("/api/lead-gen/hunter/outreach-handoff/process");
    expect(handoff).toContain("max_requests: int = 100");
  });

  it("executes the independent poller without waiting for the TradeMining loop", async () => {
    const python = [
      "import sys",
      'sys.path.insert(0, "ops/openclaw/hunter")',
      "import hunter_worker as worker",
      "calls = []",
      'worker.drain_outreach_handoff = lambda base_url, token: calls.append((base_url, token)) or {"state": "idle"}',
      "class StopEvent:",
      "    stopped = False",
      "    def is_set(self): return self.stopped",
      "    def wait(self, seconds): self.stopped = True",
      "event = StopEvent()",
      'worker.run_outreach_handoff_poller("https://example.test", "redacted", 5000, event)',
      'assert calls == [("https://example.test", "redacted")]'
    ].join("\n");

    await expect(
      execFileAsync("/Library/Developer/CommandLineTools/usr/bin/python3", ["-c", python], {
        cwd: repoRoot,
        env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" }
      })
    ).resolves.toBeDefined();
  });
});
