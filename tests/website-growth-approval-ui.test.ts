import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const detailPagePath = new URL(
  "../src/app/(authenticated)/website-growth/drafts/[draftId]/page.tsx",
  import.meta.url
);

describe("website growth brief approval UI", () => {
  it("keeps the human decision controls on the detailed brief", async () => {
    const source = await readFile(detailPagePath, "utf8");

    expect(source).toContain("updateWebsiteGrowthDraftAction");
    expect(source).toContain("Approve & start Codex build");
    expect(source).toContain("Reject brief");
    expect(source).toContain("name=\"claimsConfirmed\"");
    expect(source).toContain("required");
    expect(source).toContain("approvalBlocked");
  });

  it("states the approval boundary before Codex is started", async () => {
    const source = await readFile(detailPagePath, "utf8");

    expect(source).toContain(
      "Approval immediately starts the Codex website build on an isolated branch."
    );
    expect(source).toContain("It will not merge the PR or publish the page.");
    expect(source).toContain("An Admin or Manager with write access must approve or reject this brief.");
  });
});
