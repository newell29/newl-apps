import { describe, expect, it } from "vitest";

import {
  getTeamshipAssistantKnowledge,
  TEAMSHIP_CURATED_KNOWLEDGE_DOCUMENTS
} from "@/modules/assistant/teamship-knowledge";

describe("Teamship assistant knowledge", () => {
  it("indexes only the curated Nemo document allowlist", async () => {
    const result = await getTeamshipAssistantKnowledge();

    expect(result.documents).toHaveLength(TEAMSHIP_CURATED_KNOWLEDGE_DOCUMENTS.length);
    expect(result.documents.map((document) => document.externalId)).toEqual(
      TEAMSHIP_CURATED_KNOWLEDGE_DOCUMENTS.map((document) => document.path)
    );
    expect(result.documents.every((document) => document.metadata?.documentationStatus === "DRAFT")).toBe(true);
    expect(result.documents.map((document) => document.externalId).join(" ")).not.toMatch(
      /transcript|evidence-ledger|review|contradiction|frame/i
    );
  });

  it.each([
    ["How do I find an LPN and what does it mean?", "docs/wms/teamship/nemo/inventory.md", ["lpn", "handling-unit"]],
    ["What is the difference between an open receiving order and complete?", "docs/wms/teamship/nemo/orders.md", ["inventory order", "complete"]],
    ["What does picking and packing mean?", "docs/wms/teamship/nemo/orders.md", ["picking", "packing"]],
    ["Can Nemo show customer inventory from any warehouse?", "docs/wms/teamship/nemo/safety.md", ["every customer", "every warehouse"]]
  ])("supports representative employee question: %s", async (_question, expectedPath, expectedTerms) => {
    const result = await getTeamshipAssistantKnowledge();
    const document = result.documents.find((candidate) => candidate.externalId === expectedPath);

    expect(document).toBeDefined();
    for (const term of expectedTerms) {
      expect(document?.content.toLowerCase()).toContain(term);
    }
    expect(document?.title).toContain(expectedPath);
  });
});
