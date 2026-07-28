import { describe, expect, it, vi } from "vitest";

import {
  describeIncompleteBolCleanup,
  isBrowserSessionClosedError,
  runTeamshipBolCleanupBatch,
  type TeamshipBolCleanupOrderResult
} from "@/modules/shipment-documents/teamship-browser-update-execution";

const orders = [
  {
    psNumber: "PS123456",
    srNumber: "SR812345",
    teamshipOrderId: "12345"
  },
  {
    psNumber: "PS123457",
    srNumber: "SR812346",
    teamshipOrderId: "12346"
  }
];

function createSession({ connected = true, pageClosed = false } = {}) {
  return {
    browser: {
      close: vi.fn().mockResolvedValue(undefined),
      isConnected: vi.fn(() => connected)
    },
    page: {
      isClosed: vi.fn(() => pageClosed)
    }
  };
}

function updated(order: (typeof orders)[number]): TeamshipBolCleanupOrderResult {
  return {
    ...order,
    status: "UPDATED"
  };
}

function failed(order: (typeof orders)[number], error: unknown): TeamshipBolCleanupOrderResult {
  return {
    ...order,
    status: "FAILED",
    error: error instanceof Error ? error.message : String(error)
  };
}

describe("Teamship BOL cleanup browser recovery", () => {
  it("restarts one closed browser session and retries the interrupted order", async () => {
    const firstSession = createSession({ connected: false, pageClosed: true });
    const recoveredSession = createSession();
    const openSession = vi
      .fn()
      .mockResolvedValueOnce(firstSession)
      .mockResolvedValueOnce(recoveredSession);
    const executeOrder = vi
      .fn()
      .mockRejectedValueOnce(new Error("page.goto: Target page, context or browser has been closed"))
      .mockImplementation(async ({ order }) => updated(order));
    const recordFailure = vi.fn(async ({ order, error }) => failed(order, error));

    const result = await runTeamshipBolCleanupBatch({
      orders,
      openSession: openSession as never,
      executeOrder,
      recordFailure,
      maxBrowserRestarts: 1
    });

    expect(result.orders.map((order) => order.status)).toEqual(["UPDATED", "UPDATED"]);
    expect(result.browserRestartCount).toBe(1);
    expect(result.abortedReason).toBeNull();
    expect(openSession).toHaveBeenCalledTimes(2);
    expect(executeOrder).toHaveBeenCalledTimes(3);
    expect(recordFailure).not.toHaveBeenCalled();
    expect(firstSession.browser.close).toHaveBeenCalledTimes(1);
    expect(recoveredSession.browser.close).toHaveBeenCalledTimes(1);
  });

  it("stops the batch after the replacement browser also closes", async () => {
    const firstSession = createSession({ connected: false, pageClosed: true });
    const recoveredSession = createSession({ connected: false, pageClosed: true });
    const openSession = vi
      .fn()
      .mockResolvedValueOnce(firstSession)
      .mockResolvedValueOnce(recoveredSession);
    const executeOrder = vi.fn().mockRejectedValue(new Error("page.goto: Target page, context or browser has been closed"));
    const recordFailure = vi.fn(async ({ order, error }) => failed(order, error));

    const result = await runTeamshipBolCleanupBatch({
      orders,
      openSession: openSession as never,
      executeOrder,
      recordFailure,
      maxBrowserRestarts: 1
    });

    expect(result.orders.map((order) => order.status)).toEqual(["FAILED", "SKIPPED"]);
    expect(result.orders[1]?.error).toContain("Not attempted because");
    expect(result.browserRestartCount).toBe(1);
    expect(result.abortedReason).toContain("closed again");
    expect(executeOrder).toHaveBeenCalledTimes(2);
    expect(recordFailure).toHaveBeenCalledTimes(1);
  });

  it("continues after an order-specific failure when the browser is healthy", async () => {
    const session = createSession();
    const executeOrder = vi
      .fn()
      .mockRejectedValueOnce(new Error("Customer Order Information was not found"))
      .mockImplementation(async ({ order }) => updated(order));
    const recordFailure = vi.fn(async ({ order, error }) => failed(order, error));

    const result = await runTeamshipBolCleanupBatch({
      orders,
      openSession: (async () => session) as never,
      executeOrder,
      recordFailure,
      maxBrowserRestarts: 1
    });

    expect(result.orders.map((order) => order.status)).toEqual(["FAILED", "UPDATED"]);
    expect(result.browserRestartCount).toBe(0);
    expect(result.abortedReason).toBeNull();
    expect(executeOrder).toHaveBeenCalledTimes(2);
  });

  it("marks every cleanup as skipped when Chrome cannot start", async () => {
    const result = await runTeamshipBolCleanupBatch({
      orders,
      openSession: vi.fn().mockRejectedValue(new Error("Chrome launch failed")) as never,
      executeOrder: vi.fn(),
      recordFailure: vi.fn(),
      maxBrowserRestarts: 1
    });

    expect(result.orders.map((order) => order.status)).toEqual(["SKIPPED", "SKIPPED"]);
    expect(result.orders[0]?.error).toContain("Chrome launch failed");
    expect(result.abortedReason).toContain("could not be started");
  });

  it("recognizes the Playwright error returned by the July 28 batch", () => {
    expect(isBrowserSessionClosedError(new Error("page.goto: Target page, context or browser has been closed"))).toBe(true);
    expect(isBrowserSessionClosedError(new Error("Generated BOL was not found"))).toBe(false);
  });

  it("reports later orders as skipped instead of claiming that each one failed independently", () => {
    expect(
      describeIncompleteBolCleanup({
        status: "SKIPPED",
        error: "Not attempted because the replacement browser also closed."
      })
    ).toBe(
      "Teamship API update succeeded, but BOL weight cleanup was skipped: Not attempted because the replacement browser also closed."
    );
  });
});
