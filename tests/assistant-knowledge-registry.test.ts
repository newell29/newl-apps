import { ModuleKey } from "@prisma/client";
import { describe, expect, it } from "vitest";

import {
  getEnabledAssistantCapabilityManifest,
  getEnabledAssistantKnowledgeAdapters
} from "@/modules/assistant/knowledge-registry";

describe("getEnabledAssistantKnowledgeAdapters", () => {
  it("includes finance indexing when customer cashflow is enabled", () => {
    const adapters = getEnabledAssistantKnowledgeAdapters(
      new Set([ModuleKey.ASSISTANT, ModuleKey.CUSTOMER_CASHFLOW])
    );

    expect(adapters.map((adapter) => adapter.key)).toContain("customer-cashflow");
  });

  it("includes rate indexing when either UPS or LTL is enabled", () => {
    const upsOnly = getEnabledAssistantKnowledgeAdapters(new Set([ModuleKey.ASSISTANT, ModuleKey.UPS_TOOLS]));
    const ltlOnly = getEnabledAssistantKnowledgeAdapters(new Set([ModuleKey.ASSISTANT, ModuleKey.LTL_RATE_PORTAL]));

    expect(upsOnly.map((adapter) => adapter.key)).toContain("rate-tools");
    expect(ltlOnly.map((adapter) => adapter.key)).toContain("rate-tools");
  });

  it("includes Garland and invoice modules in the assistant capability manifest", () => {
    const manifest = getEnabledAssistantCapabilityManifest(
      new Set([
        ModuleKey.ASSISTANT,
        ModuleKey.SHIPMENT_DOCUMENTS,
        ModuleKey.INVOICE_VERIFICATION,
        ModuleKey.QUICKBOOKS_POSTING
      ])
    );

    expect(manifest.map((capability) => capability.key)).toEqual(
      expect.arrayContaining(["shipment-documents", "invoice-automation"])
    );
    expect(manifest.find((capability) => capability.key === "shipment-documents")?.summary).toContain("Garland");
    expect(manifest.find((capability) => capability.key === "invoice-automation")?.contextTypes).toContain(
      "QuickBooks posting"
    );
  });
});
