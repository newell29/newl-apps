export type ApolloActivityWindow =
  | {
      kind: "day";
      label: "today" | "yesterday";
      start: Date;
      end: Date;
      exactDateLabel: string;
      timezone: string;
    }
  | {
      kind: "rolling";
      label: string;
      start: Date;
      end: Date;
      days: number;
      timezone: string;
    };

export type ApolloActivityPrompt =
  | {
      metric: "calls" | "connected_calls" | "emails" | "replies";
      repName: string;
      window: ApolloActivityWindow;
    }
  | null;

const DEFAULT_TIMEZONE = "America/Toronto";

export function parseApolloActivityPrompt(prompt: string, now = new Date(), timezone = DEFAULT_TIMEZONE): ApolloActivityPrompt {
  const normalized = prompt.trim();
  const lower = normalized.toLowerCase();

  if (!/(how many|count|number of)/.test(lower)) {
    return null;
  }

  const repName = extractRepName(normalized);
  if (!repName) {
    return null;
  }

  const window = parseActivityWindow(lower, now, timezone);
  if (!window) {
    return null;
  }

  const metric = parseMetric(lower);
  if (!metric) {
    return null;
  }

  return {
    metric,
    repName,
    window
  };
}

function extractRepName(prompt: string) {
  const directMatch = prompt.match(/how many\s+.+?\s+did\s+(.+?)\s+(?:make|send|get|log|have)\s+/i);
  if (directMatch?.[1]) {
    return cleanRepName(directMatch[1]);
  }

  const possessiveMatch = prompt.match(/(.+?)['’]s\s+.+?\s+(?:today|yesterday|this week|last \d+\s+days?)/i);
  if (possessiveMatch?.[1]) {
    return cleanRepName(possessiveMatch[1]);
  }

  return null;
}

function cleanRepName(value: string) {
  return value
    .replace(/\b(apollo|rep|user|teammate)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function parseActivityWindow(value: string, now: Date, timezone: string): ApolloActivityWindow | null {
  if (value.includes("today")) {
    const start = startOfLocalDay(now, timezone);
    const end = endOfLocalDay(now, timezone);
    return {
      kind: "day",
      label: "today",
      start,
      end,
      exactDateLabel: formatLocalDateLabel(start, timezone),
      timezone
    };
  }

  if (value.includes("yesterday")) {
    const localStart = startOfLocalDay(now, timezone);
    const start = new Date(localStart.getTime() - 24 * 60 * 60 * 1000);
    const end = new Date(localStart.getTime() - 1);
    return {
      kind: "day",
      label: "yesterday",
      start,
      end,
      exactDateLabel: formatLocalDateLabel(start, timezone),
      timezone
    };
  }

  const rollingMatch = value.match(/last\s+(\d+)\s+days?/i);
  if (rollingMatch) {
    const days = Number.parseInt(rollingMatch[1] ?? "", 10);
    if (!Number.isFinite(days) || days <= 0) {
      return null;
    }

    const end = endOfLocalDay(now, timezone);
    const start = startOfLocalDay(new Date(end.getTime() - (days - 1) * 24 * 60 * 60 * 1000), timezone);
    return {
      kind: "rolling",
      label: `last ${days} days`,
      start,
      end,
      days,
      timezone
    };
  }

  return null;
}

function parseMetric(value: string): ApolloActivityPrompt extends { metric: infer T } ? T : never {
  if (/connected\s+calls?/.test(value)) {
    return "connected_calls";
  }

  if (/\brepl(?:y|ies)\b/.test(value)) {
    return "replies";
  }

  if (/\bemails?\b/.test(value)) {
    return "emails";
  }

  if (/\bcalls?\b/.test(value)) {
    return "calls";
  }

  return null as never;
}

function startOfLocalDay(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  })
    .formatToParts(date)
    .reduce<Record<string, string>>((acc, part) => {
      if (part.type !== "literal") {
        acc[part.type] = part.value;
      }
      return acc;
    }, {});

  return new Date(`${parts.year}-${parts.month}-${parts.day}T00:00:00-04:00`);
}

function endOfLocalDay(date: Date, timezone: string) {
  const start = startOfLocalDay(date, timezone);
  return new Date(start.getTime() + 24 * 60 * 60 * 1000 - 1);
}

function formatLocalDateLabel(date: Date, timezone: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "long",
    day: "numeric"
  }).format(date);
}
