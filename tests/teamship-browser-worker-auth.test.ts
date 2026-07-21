import { afterEach, describe, expect, it, vi } from "vitest";

import { authenticateTeamshipBrowserWorkerRequest } from "@/server/teamship-browser-worker-auth";

describe("Teamship browser worker authentication", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("binds an authenticated worker to the configured tenant slug", () => {
    vi.stubEnv("TEAMSHIP_BROWSER_WORKER_TOKEN", "dedicated-worker-token");
    vi.stubEnv("TEAMSHIP_BROWSER_WORKER_TENANT_SLUG", "newl-group");

    const request = new Request("https://newl.test/api/assistant/teamship/browser-jobs/claim", {
      method: "POST",
      headers: {
        authorization: "Bearer dedicated-worker-token",
        "x-teamship-browser-worker-id": "alex-mac-mini"
      }
    });

    expect(authenticateTeamshipBrowserWorkerRequest(request)).toEqual({
      workerId: "alex-mac-mini",
      tenantSlug: "newl-group"
    });
  });

  it("fails closed when the worker tenant scope is missing", () => {
    vi.stubEnv("TEAMSHIP_BROWSER_WORKER_TOKEN", "dedicated-worker-token");
    vi.stubEnv("TEAMSHIP_BROWSER_WORKER_TENANT_SLUG", "");

    const request = new Request("https://newl.test/api/assistant/teamship/browser-jobs/claim", {
      method: "POST",
      headers: { authorization: "Bearer dedicated-worker-token" }
    });

    expect(() => authenticateTeamshipBrowserWorkerRequest(request)).toThrow(/tenant scope is not configured/i);
  });
});
