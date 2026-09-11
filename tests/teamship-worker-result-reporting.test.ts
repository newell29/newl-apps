import { describe, expect, it, vi } from "vitest";

import {
  reportTeamshipWorkerResultWithRetry,
  TeamshipWorkerResultReportingError
} from "@/modules/shipment-documents/teamship-worker-result-reporting";

const completion = {
  status: "SUCCESS" as const,
  result: {
    jobId: "synthetic-job-1",
    orders: [{ srNumber: "SR812345", status: "UPDATED" }]
  }
};

describe("Teamship worker result reporting", () => {
  it("retries a transient Newl Apps failure with the same immutable result", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "Server has closed the connection." }), {
          status: 500,
          headers: { "content-type": "application/json" }
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ job: { id: "synthetic-job-1", status: "SUCCESS" } }), {
          status: 200,
          headers: { "content-type": "application/json" }
        })
      );
    const sleep = vi.fn().mockResolvedValue(undefined);
    const onRetry = vi.fn();

    await expect(
      reportTeamshipWorkerResultWithRetry({
        baseUrl: "https://newl.test",
        token: "synthetic-token",
        agentId: "synthetic-agent",
        jobId: "synthetic-job-1",
        ...completion,
        fetchImpl,
        sleep,
        onRetry,
        maxAttempts: 3
      })
    ).resolves.toEqual({ job: { id: "synthetic-job-1", status: "SUCCESS" } });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[0]?.[1]?.body).toBe(fetchImpl.mock.calls[1]?.[1]?.body);
    expect(JSON.parse(String(fetchImpl.mock.calls[1]?.[1]?.body))).toEqual(completion);
    expect(sleep).toHaveBeenCalledWith(500);
    expect(onRetry).toHaveBeenCalledWith(
      expect.objectContaining({
        attempt: 1,
        delayMs: 500,
        error: expect.objectContaining({ retryable: true, statusCode: 500 })
      })
    );
  });

  it("retries a transport disconnect without rerunning any external work", async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(new Response(JSON.stringify({ job: { id: "synthetic-job-1" } }), { status: 200 }));

    await reportTeamshipWorkerResultWithRetry({
      baseUrl: "https://newl.test",
      token: "synthetic-token",
      agentId: "synthetic-agent",
      jobId: "synthetic-job-1",
      ...completion,
      fetchImpl,
      sleep: vi.fn().mockResolvedValue(undefined),
      maxAttempts: 2
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("does not retry a permanent authentication rejection", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "Invalid ingestion credentials." }), {
        status: 401,
        headers: { "content-type": "application/json" }
      })
    );
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(
      reportTeamshipWorkerResultWithRetry({
        baseUrl: "https://newl.test",
        token: "synthetic-token",
        agentId: "synthetic-agent",
        jobId: "synthetic-job-1",
        ...completion,
        fetchImpl,
        sleep,
        maxAttempts: 3
      })
    ).rejects.toMatchObject({
      name: TeamshipWorkerResultReportingError.name,
      retryable: false,
      statusCode: 401
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });
});
