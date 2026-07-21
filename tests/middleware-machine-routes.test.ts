import { describe, expect, it } from "vitest";

import { config } from "@/middleware";

describe("middleware machine route exemptions", () => {
  it("lets the OpenClaw Teamship endpoint enforce its dedicated token auth", () => {
    expect(config.matcher[0]).toContain("api/assistant/teamship/read");
  });

  it("lets the Mac Mini browser worker endpoints enforce their dedicated token auth", () => {
    expect(config.matcher[0]).toContain("api/assistant/teamship/browser-jobs");
  });
});
