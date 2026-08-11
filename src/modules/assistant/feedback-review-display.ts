const ACTIVE_FEEDBACK_STATUSES = new Set(["REPORTED", "INVESTIGATING"]);

export function partitionFeedbackReview<T extends { status: string }>(feedback: T[]) {
  const active: T[] = [];
  const archived: T[] = [];

  for (const item of feedback) {
    if (ACTIVE_FEEDBACK_STATUSES.has(item.status.trim().toUpperCase())) {
      active.push(item);
    } else {
      archived.push(item);
    }
  }

  return { active, archived };
}
