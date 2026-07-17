import { beforeEach, describe, expect, it, vi } from "vitest";

const findKnowledgeChunks = vi.fn();
const findTenantModuleAccess = vi.fn();

vi.mock("@/server/db", () => ({
  prisma: {
    assistantKnowledgeChunk: {
      findMany: (...args: unknown[]) => findKnowledgeChunks(...args)
    },
    tenantModuleAccess: {
      findMany: (...args: unknown[]) => findTenantModuleAccess(...args)
    }
  }
}));

import {
  createKnowledgeChunks,
  searchAssistantKnowledge,
  summarizeChunk
} from "@/modules/assistant/knowledge";

describe("createKnowledgeChunks", () => {
  it("splits long content into bounded chunks", () => {
    const chunks = createKnowledgeChunks(
      Array.from({ length: 24 }, (_, index) => `Sentence ${index + 1} about Acme Imports and Dallas freight.`).join(" ")
    );

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.length <= 900)).toBe(true);
  });

  it("creates a short excerpt for long content", () => {
    const summary = summarizeChunk("A".repeat(280));

    expect(summary.endsWith("...")).toBe(true);
    expect(summary.length).toBeLessThanOrEqual(220);
  });
});

describe("searchAssistantKnowledge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findTenantModuleAccess.mockResolvedValue([
      { module: { key: "LEAD_GEN" } },
      { module: { key: "INVOICE_VERIFICATION" } },
      { module: { key: "QUICKBOOKS_POSTING" } },
      { module: { key: "SHIPMENT_DOCUMENTS" } }
    ]);
  });

  it("ranks indexed chunks by prompt overlap and returns assistant sources", async () => {
    findKnowledgeChunks.mockResolvedValue([
      {
        id: "chunk-1",
        documentId: "doc-1",
        chunkIndex: 0,
        contentText: "Acme Imports ships furniture from Toronto into Dallas and Houston.",
        contentSummary: "Acme Imports furniture lanes into Dallas and Houston.",
        metadata: { contactCount: 4 },
        document: {
          id: "doc-1",
          sourceKind: "COMPANY",
          externalId: "company-1",
          title: "Acme Imports",
          sourceSystem: "NEWL_COMPANY",
          metadata: { priorityScore: 87 }
        }
      },
      {
        id: "chunk-2",
        documentId: "doc-2",
        chunkIndex: 0,
        contentText: "Northwind has a qualified lead but no Dallas activity.",
        contentSummary: "Northwind qualified lead.",
        metadata: null,
        document: {
          id: "doc-2",
          sourceKind: "LEAD",
          externalId: "lead-2",
          title: "Northwind lead",
          sourceSystem: "NEWL_LEAD",
          metadata: { score: 74 }
        }
      }
    ]);

    const sources = await searchAssistantKnowledge(
      {
        tenantId: "tenant-1",
        tenantSlug: "newl-group",
        tenantName: "Newl Group",
        role: "ADMIN"
      },
      "Need Dallas furniture context for Acme"
    );

    expect(findKnowledgeChunks).toHaveBeenCalledTimes(1);
    expect(sources[0]).toMatchObject({
      sourceKind: "COMPANY",
      sourceId: "company-1",
      title: "Acme Imports"
    });
    expect(sources[0]?.metadata).toMatchObject({
      priorityScore: 87,
      contactCount: 4,
      sourceSystem: "NEWL_COMPANY"
    });
  });

  it("filters module-tagged assistant sources by the user's role and tenant entitlements", async () => {
    findKnowledgeChunks.mockResolvedValue([
      {
        id: "chunk-finance",
        documentId: "doc-finance",
        chunkIndex: 0,
        contentText: "Acme invoice has a QuickBooks posting error that needs finance review.",
        contentSummary: "Acme QuickBooks posting error.",
        metadata: {
          assistantContext: {
            adapterKey: "invoice-automation",
            moduleKeys: ["INVOICE_VERIFICATION", "QUICKBOOKS_POSTING"]
          }
        },
        document: {
          id: "doc-finance",
          sourceKind: "OTHER",
          externalId: "invoice-summary",
          title: "Invoice automation assistant summary",
          sourceSystem: "NEWL_INVOICE_AUTOMATION",
          metadata: null
        }
      },
      {
        id: "chunk-lead",
        documentId: "doc-lead",
        chunkIndex: 0,
        contentText: "Acme lead has Dallas shipment history and needs sales follow-up.",
        contentSummary: "Acme lead follow-up.",
        metadata: {
          assistantContext: {
            adapterKey: "lead-gen",
            moduleKeys: ["LEAD_GEN"]
          }
        },
        document: {
          id: "doc-lead",
          sourceKind: "LEAD",
          externalId: "lead-summary",
          title: "Lead generation assistant summary",
          sourceSystem: "NEWL_LEAD_GEN",
          metadata: null
        }
      }
    ]);

    const sources = await searchAssistantKnowledge(
      {
        tenantId: "tenant-1",
        tenantSlug: "newl-group",
        tenantName: "Newl Group",
        role: "SALES"
      },
      "Acme review"
    );

    expect(sources.map((source) => source.title)).toEqual(["Lead generation assistant summary"]);
    expect(findTenantModuleAccess).toHaveBeenCalledWith({
      where: {
        tenantId: "tenant-1",
        enabled: true
      },
      select: {
        module: {
          select: {
            key: true
          }
        }
      }
    });
  });
});
