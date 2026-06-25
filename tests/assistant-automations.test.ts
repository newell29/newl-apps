import { describe, expect, it } from "vitest";

import {
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
});
