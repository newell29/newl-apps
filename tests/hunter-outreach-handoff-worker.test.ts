import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();

describe("Hunter Mac outreach handoff worker", () => {
  it("drains the server-owned queue after research and resumes it from the main loop", async () => {
    const [research, worker, handoff] = await Promise.all([
      readFile(path.join(repoRoot, "ops/openclaw/hunter/hunter_company_research.py"), "utf8"),
      readFile(path.join(repoRoot, "ops/openclaw/hunter/hunter_worker.py"), "utf8"),
      readFile(path.join(repoRoot, "ops/openclaw/hunter/hunter_outreach_handoff.py"), "utf8")
    ]);

    expect(research).toContain("drain_outreach_handoff(");
    expect(worker).toContain("drain_outreach_handoff(base_url, token)");
    expect(handoff).toContain("/api/lead-gen/hunter/outreach-handoff/process");
    expect(handoff).toContain("max_requests: int = 100");
  });
});
