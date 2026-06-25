export const ASSISTANT_AUTOMATION_SCHEDULES = ["DAILY", "WEEKDAYS", "MONDAYS"] as const;

export type AssistantAutomationSchedule = (typeof ASSISTANT_AUTOMATION_SCHEDULES)[number];

type ZonedDateParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number;
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

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

export function computeNextAssistantAutomationRunAt(
  scheduleType: AssistantAutomationSchedule,
  scheduleTime: string,
  scheduleTimezone: string,
  fromDate: Date
) {
  const [hour, minute] = scheduleTime.split(":").map((value) => Number(value));
  const zonedNow = getZonedDateParts(fromDate, scheduleTimezone);

  for (let offset = 0; offset < 14; offset += 1) {
    const localDate = addDaysToLocalDate(zonedNow.year, zonedNow.month, zonedNow.day, offset);

    if (!isScheduledDay(scheduleType, localDate.year, localDate.month, localDate.day)) {
      continue;
    }

    const candidate = zonedTimeToUtc(
      localDate.year,
      localDate.month,
      localDate.day,
      hour,
      minute,
      scheduleTimezone
    );

    if (candidate.getTime() > fromDate.getTime()) {
      return candidate;
    }
  }

  return new Date(fromDate.getTime() + MS_PER_DAY);
}

export function isAssistantAutomationDue(status: string, nextRunAt: Date | null | undefined, now: Date) {
  if (status !== "ACTIVE" || !nextRunAt) {
    return false;
  }

  return nextRunAt.getTime() <= now.getTime();
}

function isScheduledDay(scheduleType: AssistantAutomationSchedule, year: number, month: number, day: number) {
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();

  if (scheduleType === "MONDAYS") {
    return weekday === 1;
  }

  if (scheduleType === "WEEKDAYS") {
    return weekday >= 1 && weekday <= 5;
  }

  return true;
}

function addDaysToLocalDate(year: number, month: number, day: number, days: number) {
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);

  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate()
  };
}

function getZonedDateParts(date: Date, timeZone: string): ZonedDateParts {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    weekday: "short"
  });

  const parts = formatter.formatToParts(date);

  return {
    year: readPart(parts, "year"),
    month: readPart(parts, "month"),
    day: readPart(parts, "day"),
    hour: readPart(parts, "hour"),
    minute: readPart(parts, "minute"),
    second: readPart(parts, "second"),
    weekday: readWeekday(parts.find((part) => part.type === "weekday")?.value ?? "Sun")
  };
}

function zonedTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string
) {
  const guess = Date.UTC(year, month - 1, day, hour, minute, 0);
  const offset = getTimeZoneOffsetMilliseconds(new Date(guess), timeZone);

  return new Date(guess - offset);
}

function getTimeZoneOffsetMilliseconds(date: Date, timeZone: string) {
  const zoned = getZonedDateParts(date, timeZone);
  const asUtc = Date.UTC(zoned.year, zoned.month - 1, zoned.day, zoned.hour, zoned.minute, zoned.second);
  return asUtc - date.getTime();
}

function readPart(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes) {
  const value = parts.find((part) => part.type === type)?.value;

  if (!value) {
    return 0;
  }

  return Number(value);
}

function readWeekday(value: string) {
  if (value.startsWith("Mon")) return 1;
  if (value.startsWith("Tue")) return 2;
  if (value.startsWith("Wed")) return 3;
  if (value.startsWith("Thu")) return 4;
  if (value.startsWith("Fri")) return 5;
  if (value.startsWith("Sat")) return 6;
  return 0;
}
