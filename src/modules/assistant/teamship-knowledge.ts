import { readFile } from "node:fs/promises";
import path from "node:path";

import { AssistantSourceKind } from "@prisma/client";

import type { AssistantKnowledgeAdapterResult } from "@/modules/assistant/knowledge-registry";

export const TEAMSHIP_CURATED_KNOWLEDGE_DOCUMENTS = [
  {
    path: "docs/wms/teamship/nemo/navigation.md",
    title: "Teamship Navigation For Nemo (Draft)"
  },
  {
    path: "docs/wms/teamship/nemo/inventory.md",
    title: "Teamship Inventory For Nemo (Draft)"
  },
  {
    path: "docs/wms/teamship/nemo/orders.md",
    title: "Teamship Orders For Nemo (Draft)"
  },
  {
    path: "docs/wms/teamship/nemo/safety.md",
    title: "Teamship Read-Only Safety For Nemo (Draft)"
  }
] as const;

export async function getTeamshipAssistantKnowledge(): Promise<AssistantKnowledgeAdapterResult> {
  const documents = await Promise.all(
    TEAMSHIP_CURATED_KNOWLEDGE_DOCUMENTS.map(async (document) => ({
      sourceKind: AssistantSourceKind.MANUAL,
      sourceSystem: "NEWL_TEAMSHIP_DOCUMENTATION",
      externalId: document.path,
      title: `${document.title} [${document.path}]`,
      sourceUpdatedAt: null,
      metadata: {
        documentationPath: document.path,
        documentationStatus: "DRAFT",
        evidencePolicy: "CURATED_ONLY",
        requiresAttribution: true
      },
      content: await readFile(path.resolve(process.cwd(), document.path), "utf8")
    }))
  );

  return { documents };
}
