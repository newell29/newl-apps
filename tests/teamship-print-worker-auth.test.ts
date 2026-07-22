import { afterEach, describe, expect, it, vi } from "vitest";

import { authenticateTeamshipPrintWorkerRequest } from "@/server/teamship-print-worker-auth";

describe("Teamship print worker authentication", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("binds the worker to the configured tenant", () => {
    vi.stubEnv("TEAMSHIP_PRINT_WORKER_TOKEN", "worker-token");
    vi.stubEnv("TEAMSHIP_PRINT_WORKER_TENANT_SLUG", "newl-group");
    const request = new Request("https://newl.test/api/assistant/printing/jobs/claim", {
      method: "POST",
      headers: {
        authorization: "Bearer worker-token",
        "x-teamship-print-worker-id": "alex-mac-mini"
      }
    });
    expect(authenticateTeamshipPrintWorkerRequest(request)).toEqual({
      workerId: "alex-mac-mini",
      tenantSlug: "newl-group"
    });
  });
});
