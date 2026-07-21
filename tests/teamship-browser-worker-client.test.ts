import { describe, expect, it } from "vitest";

import {
  buildTeamshipBrowserWorkerHeaders,
  isTransientTeamshipBrowserWorkerClaimStatus
} from "@/modules/teamship/browser-worker-client";

describe("Teamship browser worker client", () => {
  it("sends the worker identity without a Preview bypass by default", () => {
    expect(buildTeamshipBrowserWorkerHeaders({
      token: "worker-token",
      workerId: "mac-mini-teamship-browser",
      vercelProtectionBypass: null
    })).toEqual({
      authorization: "Bearer worker-token",
      "content-type": "application/json",
      "x-teamship-browser-worker-id": "mac-mini-teamship-browser"
    });
  });

  it("adds the Vercel automation header only when explicitly configured", () => {
    expect(buildTeamshipBrowserWorkerHeaders({
      token: "worker-token",
      workerId: "mac-mini-teamship-browser",
      vercelProtectionBypass: "preview-bypass"
    })).toMatchObject({
      "x-vercel-protection-bypass": "preview-bypass"
    });
  });

  it("retries transient Preview claim failures without treating authorization errors as transient", () => {
    expect([502, 503, 504].every(isTransientTeamshipBrowserWorkerClaimStatus)).toBe(true);
    expect([400, 401, 403, 404, 500].some(isTransientTeamshipBrowserWorkerClaimStatus)).toBe(false);
  });
});
