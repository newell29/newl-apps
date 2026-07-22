export const DEFAULT_APOLLO_STATUS_SYNC_INTERVAL_HOURS = 4;
export const DEFAULT_APOLLO_STATUS_SYNC_BATCH_SIZE = 50;
export const APOLLO_STATUS_SYNC_MAX_ATTEMPTS = 3;

export function getApolloStatusSyncIntervalHours() {
  return readBoundedInteger(
    process.env.APOLLO_STATUS_SYNC_INTERVAL_HOURS,
    DEFAULT_APOLLO_STATUS_SYNC_INTERVAL_HOURS,
    1,
    24
  );
}

export function getApolloStatusSyncBatchSize() {
  return readBoundedInteger(
    process.env.APOLLO_STATUS_SYNC_BATCH_SIZE,
    DEFAULT_APOLLO_STATUS_SYNC_BATCH_SIZE,
    1,
    100
  );
}

export function getNextApolloSyncAt(now = new Date(), intervalHours = getApolloStatusSyncIntervalHours()) {
  return new Date(now.getTime() + intervalHours * 60 * 60 * 1000);
}

export function getApolloFailureRetryAt(failureCount: number, now = new Date()) {
  const minutes = Math.min(240, 15 * 2 ** Math.max(0, failureCount - 1));
  return new Date(now.getTime() + minutes * 60 * 1000);
}

function readBoundedInteger(value: string | undefined, fallback: number, minimum: number, maximum: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
}
