export const TEAMSHIP_BATCH_RETRY_STATUS_PREFIX = "TEAMSHIP_BATCH_RETRY_PENDING_";
export const TEAMSHIP_BATCH_RETRY_STATUSES = [1, 2, 3].map(
  (attempt) => `${TEAMSHIP_BATCH_RETRY_STATUS_PREFIX}${attempt}`
);
export const TEAMSHIP_BATCH_RETRY_DELAY_MINUTES = 5;
export const TEAMSHIP_BATCH_RETRY_DELAY_MS = TEAMSHIP_BATCH_RETRY_DELAY_MINUTES * 60 * 1000;
export const MAX_TEAMSHIP_BATCH_RETRIES = TEAMSHIP_BATCH_RETRY_STATUSES.length;

export function isTeamshipBatchRetryStatus(intakeStatus: string | null | undefined) {
  return Boolean(intakeStatus?.startsWith(TEAMSHIP_BATCH_RETRY_STATUS_PREFIX));
}

export function readTeamshipBatchRetryAttempt(intakeStatus: string) {
  if (!isTeamshipBatchRetryStatus(intakeStatus)) return 0;

  const parsed = Number(intakeStatus.slice(TEAMSHIP_BATCH_RETRY_STATUS_PREFIX.length));
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= MAX_TEAMSHIP_BATCH_RETRIES ? parsed : 0;
}
