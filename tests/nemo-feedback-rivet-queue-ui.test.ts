import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const feedbackClientPath = new URL(
  "../src/modules/assistant/components/nemo-feedback-client.tsx",
  import.meta.url
);

describe("Nemo feedback Rivet queue UI", () => {
  it("shows that approval queues work and gives waiting jobs an explicit status", async () => {
    const source = await readFile(feedbackClientPath, "utf8");

    expect(source).toContain("Approve &amp; queue Rivet");
    expect(source).toContain("APPROVED — WAITING FOR RIVET");
    expect(source).toContain("then it will start automatically");
  });

  it("renders Rivet decision feedback beside the development suggestions", async () => {
    const source = await readFile(feedbackClientPath, "utf8");

    expect(source).toContain('role="status"');
    expect(source).toContain('aria-live="polite"');
    expect(source).toContain("{suggestionMessage}");
  });
});
