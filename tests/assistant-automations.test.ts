import { describe, expect, it } from "vitest";

import {
  computeNextAssistantAutomationRunAt,
  isAssistantAutomationDue,
  normalizeAssistantAutomationTime,
  parseAssistantAutomationSchedule,
  summarizeAssistantAutomationSchedule,
  summarizeAutomationResult
} from "@/modules/assistant/automations";

describe("assistant automations helpers", () => {
  it("normalizes supported schedule values", () => {
    expect(parseAssistantAutomationSchedule("WEEKDAYS")).toBe("WEEKDAYS");
    expect(parseAssistantAutomationSchedule("MONDAYS")).toBe("MONDAYS");
    expect(parseAssistantAutomationSchedule("anything-else")).toBe("DAILY");
  });

  it("normalizes the saved run time", () => {
    expect(normalizeAssistantAutomationTime("07:30")).toBe("07:30");
    expect(normalizeAssistantAutomationTime("7:30")).toBe("08:00");
    expect(normalizeAssistantAutomationTime(undefined)).toBe("08:00");
  });

  it("summarizes schedules and run output cleanly", () => {
    expect(summarizeAssistantAutomationSchedule("DAILY", "08:00", "America/Toronto")).toBe(
      "Daily at 08:00 (America/Toronto)"
    );
    expect(summarizeAutomationResult("A".repeat(220)).endsWith("...")).toBe(true);
  });

  it("computes the next scheduled run in the configured timezone", () => {
    const nextRun = computeNextAssistantAutomationRunAt(
      "WEEKDAYS",
      "08:00",
      "America/Toronto",
      new Date("2026-06-26T13:30:00Z")
    );

    expect(nextRun.toISOString()).toBe("2026-06-29T12:00:00.000Z");
  });

  it("marks due runs only when active and on or past nextRunAt", () => {
    const now = new Date("2026-06-26T12:00:00Z");

    expect(isAssistantAutomationDue("ACTIVE", new Date("2026-06-26T11:59:00Z"), now)).toBe(true);
    expect(isAssistantAutomationDue("PAUSED", new Date("2026-06-26T11:59:00Z"), now)).toBe(false);
    expect(isAssistantAutomationDue("ACTIVE", new Date("2026-06-26T12:01:00Z"), now)).toBe(false);
  });
});
