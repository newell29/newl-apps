import { describe, expect, it, vi } from "vitest";

import {
  readTmgWorkerRuntimeSettings,
  runTmgWorkerLoop
} from "@/modules/shipment-documents/tmg-worker-runtime";

describe("TMG Teamship worker runtime", () => {
  it("runs continuously by default and bounds its polling interval", () => {
    expect(readTmgWorkerRuntimeSettings({})).toEqual({ continuous: true, pollIntervalMs: 15_000 });
    expect(readTmgWorkerRuntimeSettings({ TMG_WORKER_RUN_ONCE: "true", TMG_WORKER_POLL_INTERVAL_MS: "1" }))
      .toEqual({ continuous: false, pollIntervalMs: 5_000 });
    expect(readTmgWorkerRuntimeSettings({ TMG_WORKER_POLL_INTERVAL_MS: "9999999" }).pollIntervalMs).toBe(300_000);
  });

  it("keeps polling after a transient claim failure and stops when signalled", async () => {
    const controller = new AbortController();
    const runOnce = vi.fn()
      .mockRejectedValueOnce(new Error("temporary claim failure"))
      .mockImplementationOnce(async () => controller.abort());
    const wait = vi.fn(async () => undefined);
    const onIterationError = vi.fn();

    await runTmgWorkerLoop({
      settings: { continuous: true, pollIntervalMs: 15_000 },
      runOnce,
      wait,
      onIterationError,
      signal: controller.signal
    });

    expect(runOnce).toHaveBeenCalledTimes(2);
    expect(wait).toHaveBeenCalledTimes(1);
    expect(onIterationError).toHaveBeenCalledWith(expect.any(Error));
  });

  it("preserves one-shot failure behavior when explicitly requested", async () => {
    await expect(runTmgWorkerLoop({
      settings: { continuous: false, pollIntervalMs: 15_000 },
      runOnce: async () => { throw new Error("claim failed"); }
    })).rejects.toThrow("claim failed");
  });
});
