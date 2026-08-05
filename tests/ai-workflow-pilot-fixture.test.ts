import { describe, expect, it } from "vitest";

import { formatPilotFeatureLabel } from "../tools/ai-workflow/pilot-fixture";

describe("formatPilotFeatureLabel", () => {
  it("passes ordinary text through unchanged", () => {
    expect(formatPilotFeatureLabel("Add a pilot feature")).toBe("Add a pilot feature");
  });

  it("trims leading and trailing whitespace", () => {
    expect(formatPilotFeatureLabel("  Add a pilot feature  ")).toBe("Add a pilot feature");
  });

  it("collapses repeated mixed whitespace to a single ASCII space", () => {
    expect(formatPilotFeatureLabel("Add\t  a  pilot\n\nfeature\r\n")).toBe("Add a pilot feature");
  });

  it("returns (untitled) for the empty string", () => {
    expect(formatPilotFeatureLabel("")).toBe("(untitled)");
  });

  it("returns (untitled) for whitespace-only input", () => {
    expect(formatPilotFeatureLabel(" \t\n  ")).toBe("(untitled)");
  });
});
