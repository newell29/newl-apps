export const ASSISTANT_AUTOMATION_SCHEDULES = ["DAILY", "WEEKDAYS", "MONDAYS"] as const;

export type AssistantAutomationSchedule = (typeof ASSISTANT_AUTOMATION_SCHEDULES)[number];

export function parseAssistantAutomationSchedule(value: string | null | undefined): AssistantAutomationSchedule {
  if (value === "WEEKDAYS" || value === "MONDAYS") {
    return value;
  }

  return "DAILY";
}

export function normalizeAssistantAutomationTime(value: string | null | undefined) {
  if (!value) {
    return "08:00";
  }

  const normalized = value.trim();
  return /^\d{2}:\d{2}$/.test(normalized) ? normalized : "08:00";
}

export function summarizeAssistantAutomationSchedule(
  scheduleType: AssistantAutomationSchedule,
  scheduleTime: string,
  scheduleTimezone: string
) {
  const cadence =
    scheduleType === "WEEKDAYS" ? "Weekdays" : scheduleType === "MONDAYS" ? "Mondays" : "Daily";

  return `${cadence} at ${scheduleTime} (${scheduleTimezone})`;
}

export function summarizeAutomationResult(value: string) {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (normalized.length <= 180) {
    return normalized;
  }

  return `${normalized.slice(0, 177).trimEnd()}...`;
}
