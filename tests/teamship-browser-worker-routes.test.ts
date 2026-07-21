import { describe, expect, it, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  claim: vi.fn(),
  complete: vi.fn(),
  fail: vi.fn()
}));

vi.mock("@/server/teamship-browser-worker-auth", () => ({
  TeamshipBrowserWorkerAuthError: class TeamshipBrowserWorkerAuthError extends Error {
    status: number;
    constructor(message: string, status = 401) {
      super(message);
      this.status = status;
    }
  },
  authenticateTeamshipBrowserWorkerRequest: (...args: unknown[]) => mocks.auth(...args)
}));

vi.mock("@/modules/teamship/browser-read-jobs", () => ({
  TeamshipBrowserJobValidationError: class TeamshipBrowserJobValidationError extends Error {},
  claimNextTeamshipBrowserJob: (...args: unknown[]) => mocks.claim(...args),
  completeTeamshipBrowserJob: (...args: unknown[]) => mocks.complete(...args),
  failTeamshipBrowserJob: (...args: unknown[]) => mocks.fail(...args)
}));

import { POST as claimPost } from "@/app/api/assistant/teamship/browser-jobs/claim/route";
import { POST as completePost } from "@/app/api/assistant/teamship/browser-jobs/[jobId]/complete/route";
import { POST as failPost } from "@/app/api/assistant/teamship/browser-jobs/[jobId]/fail/route";
import { TeamshipBrowserJobValidationError } from "@/modules/teamship/browser-read-jobs";

describe("Teamship browser worker routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockReturnValue({ workerId: "mac-mini", tenantSlug: "newl-group" });
  });

  it("claims a sanitized browser job and returns credentials only to the authenticated worker", async () => {
    mocks.claim.mockResolvedValue({
      id: "job-1",
      operation: "searchLpn",
      input: { operation: "searchLpn", queryType: "LPN", query: "63991" },
      scope: { customerId: "420", customerName: "Garland Canada Distribution", warehouseId: "102", warehouseName: "Annagem" },
      credentials: { email: "teamship@example.com", password: "secret-password", apiBaseUrl: null }
    });

    const response = await claimPost(buildRequest({}));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.claim).toHaveBeenCalledWith("mac-mini", "newl-group");
    expect(body.data.job).toMatchObject({ id: "job-1", operation: "searchLpn" });
    expect(body.data.job.credentials.password).toBe("secret-password");
  });

  it("reports no work without exposing credentials", async () => {
    mocks.claim.mockResolvedValue(null);

    const response = await claimPost(buildRequest({}));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ data: { job: null } });
  });

  it("completes only a job claimed by the authenticated worker", async () => {
    mocks.complete.mockResolvedValue(true);

    const response = await completePost(
      buildRequest({ result: { operation: "searchInventoryAll", rows: [] } }),
      { params: Promise.resolve({ jobId: "job-1" }) }
    );

    expect(response.status).toBe(200);
    expect(mocks.complete).toHaveBeenCalledWith(
      "job-1",
      "mac-mini",
      "newl-group",
      { operation: "searchInventoryAll", rows: [] }
    );
  });

  it("returns conflict when a different worker tries to complete the job", async () => {
    mocks.complete.mockResolvedValue(false);

    const response = await completePost(
      buildRequest({ result: { operation: "searchInventoryAll", rows: [] } }),
      { params: Promise.resolve({ jobId: "job-1" }) }
    );

    expect(response.status).toBe(409);
  });

  it("rejects a malformed worker result without completing the job", async () => {
    mocks.complete.mockRejectedValue(new TeamshipBrowserJobValidationError("Result operation did not match."));

    const response = await completePost(
      buildRequest({ result: { operation: "searchLpn", rows: [] } }),
      { params: Promise.resolve({ jobId: "job-1" }) }
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Result operation did not match." });
  });

  it("records worker failures without returning raw stack traces", async () => {
    mocks.fail.mockResolvedValue(true);

    const response = await failPost(
      buildRequest({ errorCode: "WORKER_ERROR", errorMessage: "Selector timed out" }),
      { params: Promise.resolve({ jobId: "job-1" }) }
    );

    expect(response.status).toBe(200);
    expect(mocks.fail).toHaveBeenCalledWith(
      "job-1",
      "mac-mini",
      "newl-group",
      "WORKER_ERROR",
      "Selector timed out"
    );
  });
});

function buildRequest(body: unknown) {
  return new Request("https://newl.test/api/assistant/teamship/browser-jobs/claim", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer token" },
    body: JSON.stringify(body)
  });
}
