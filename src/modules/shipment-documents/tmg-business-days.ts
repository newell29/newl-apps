const DEFAULT_TMG_TIME_ZONE = "America/New_York";

type CalendarDate = {
  year: number;
  month: number;
  day: number;
};

export function getNextTmgPickupDate(
  receivedAt: Date,
  timeZone = DEFAULT_TMG_TIME_ZONE
) {
  if (Number.isNaN(receivedAt.getTime())) throw new Error("TMG email receipt time is invalid.");

  let candidate = addCalendarDays(toCalendarDate(receivedAt, timeZone), 1);
  while (!isUsBusinessDay(candidate)) candidate = addCalendarDays(candidate, 1);
  return formatCalendarDate(candidate);
}

function isUsBusinessDay(value: CalendarDate) {
  const weekday = dayOfWeek(value);
  if (weekday === 0 || weekday === 6) return false;

  const formatted = formatCalendarDate(value);
  const holidays = new Set<string>();
  for (const year of [value.year - 1, value.year, value.year + 1]) {
    for (const holiday of usFederalHolidays(year)) holidays.add(formatCalendarDate(holiday));
  }
  return !holidays.has(formatted);
}

function usFederalHolidays(year: number) {
  return [
    observedFixedHoliday(year, 1, 1),
    nthWeekdayOfMonth(year, 1, 1, 3),
    nthWeekdayOfMonth(year, 2, 1, 3),
    lastWeekdayOfMonth(year, 5, 1),
    observedFixedHoliday(year, 6, 19),
    observedFixedHoliday(year, 7, 4),
    nthWeekdayOfMonth(year, 9, 1, 1),
    nthWeekdayOfMonth(year, 10, 1, 2),
    observedFixedHoliday(year, 11, 11),
    nthWeekdayOfMonth(year, 11, 4, 4),
    observedFixedHoliday(year, 12, 25)
  ];
}

function observedFixedHoliday(year: number, month: number, day: number) {
  const value = { year, month, day };
  const weekday = dayOfWeek(value);
  if (weekday === 6) return addCalendarDays(value, -1);
  if (weekday === 0) return addCalendarDays(value, 1);
  return value;
}

function nthWeekdayOfMonth(year: number, month: number, weekday: number, occurrence: number) {
  const first = { year, month, day: 1 };
  const offset = (weekday - dayOfWeek(first) + 7) % 7;
  return { year, month, day: 1 + offset + (occurrence - 1) * 7 };
}

function lastWeekdayOfMonth(year: number, month: number, weekday: number) {
  const finalDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const last = { year, month, day: finalDay };
  const offset = (dayOfWeek(last) - weekday + 7) % 7;
  return { year, month, day: finalDay - offset };
}

function toCalendarDate(value: Date, timeZone: string): CalendarDate {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(value);
  const readPart = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value);
  const date = { year: readPart("year"), month: readPart("month"), day: readPart("day") };
  if (!date.year || !date.month || !date.day) throw new Error("Unable to resolve the TMG email receipt date.");
  return date;
}

function addCalendarDays(value: CalendarDate, days: number): CalendarDate {
  const next = new Date(Date.UTC(value.year, value.month - 1, value.day + days));
  return { year: next.getUTCFullYear(), month: next.getUTCMonth() + 1, day: next.getUTCDate() };
}

function dayOfWeek(value: CalendarDate) {
  return new Date(Date.UTC(value.year, value.month - 1, value.day)).getUTCDay();
}

function formatCalendarDate(value: CalendarDate) {
  return `${String(value.year).padStart(4, "0")}-${String(value.month).padStart(2, "0")}-${String(value.day).padStart(2, "0")}`;
}
