const DEFAULT_TMG_WORKER_POLL_INTERVAL_MS = 15_000;
const MIN_TMG_WORKER_POLL_INTERVAL_MS = 5_000;
const MAX_TMG_WORKER_POLL_INTERVAL_MS = 5 * 60_000;

export type TmgWorkerRuntimeSettings = {
  continuous: boolean;
  pollIntervalMs: number;
};

export function readTmgWorkerRuntimeSettings(
  environment: Record<string, string | undefined>
): TmgWorkerRuntimeSettings {
  return {
    continuous: environment.TMG_WORKER_RUN_ONCE !== "true",
    pollIntervalMs: readBoundedInteger(
      environment.TMG_WORKER_POLL_INTERVAL_MS,
      DEFAULT_TMG_WORKER_POLL_INTERVAL_MS,
      MIN_TMG_WORKER_POLL_INTERVAL_MS,
      MAX_TMG_WORKER_POLL_INTERVAL_MS
    )
  };
}

export async function runTmgWorkerLoop({
  settings,
  runOnce,
  wait = waitForNextPoll,
  onIterationError = () => undefined,
  signal
}: {
  settings: TmgWorkerRuntimeSettings;
  runOnce: () => Promise<void>;
  wait?: (milliseconds: number) => Promise<void>;
  onIterationError?: (error: unknown) => void;
  signal?: AbortSignal;
}) {
  do {
    try {
      await runOnce();
    } catch (error) {
      if (!settings.continuous) throw error;
      onIterationError(error);
    }

    if (!settings.continuous || signal?.aborted) return;
    await wait(settings.pollIntervalMs);
  } while (!signal?.aborted);
}

function readBoundedInteger(value: string | undefined, fallback: number, min: number, max: number) {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

async function waitForNextPoll(milliseconds: number) {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}
