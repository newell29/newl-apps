import { ModuleKey } from "@prisma/client";

import type { TenantContext } from "@/server/tenant-context";
import { getCustomerCashflowAssistantKnowledge } from "@/modules/customer-cashflow/assistant-knowledge";
import { getInvoiceAutomationAssistantKnowledge } from "@/modules/invoice-automation/assistant-knowledge";
import { getLeadGenAssistantKnowledge } from "@/modules/lead-gen/assistant-knowledge";
import { getShipmentDocumentsAssistantKnowledge } from "@/modules/shipment-documents/assistant-knowledge";
import { getRateToolAssistantKnowledge } from "@/modules/assistant/rate-tool-knowledge";
import { getTeamshipAssistantKnowledge } from "@/modules/assistant/teamship-knowledge";

export type AssistantKnowledgeDocumentSeed = {
  sourceKind: import("@prisma/client").AssistantSourceKind;
  sourceSystem: string;
  externalId: string;
  title: string;
  sourceUpdatedAt: Date | null;
  metadata?: Record<string, unknown>;
  content: string;
};

export type AssistantMemorySeed = {
  kind: import("@prisma/client").AssistantMemoryKind;
  subjectType: string;
  subjectId: string | null;
  title: string;
  summary: string;
  confidence: number;
  status?: "ACTIVE" | "ARCHIVED";
  lastObservedAt?: Date | null;
  sourceRef?: {
    sourceSystem: string;
    externalId: string;
  };
};

export type AssistantKnowledgeAdapterResult = {
  documents: AssistantKnowledgeDocumentSeed[];
  memories?: AssistantMemorySeed[];
};

export type AssistantKnowledgeAdapter = {
  key: string;
  moduleKeys: ModuleKey[];
  capability: {
    label: string;
    summary: string;
    contextTypes: string[];
    sampleQuestions: string[];
  };
  isEnabled?: (enabledModules: Set<ModuleKey>) => boolean;
  collect: (tenant: TenantContext) => Promise<AssistantKnowledgeAdapterResult>;
};

const ASSISTANT_KNOWLEDGE_ADAPTERS: AssistantKnowledgeAdapter[] = [
  {
    key: "lead-gen",
    moduleKeys: [ModuleKey.LEAD_GEN],
    capability: {
      label: "Lead generation",
      summary: "Companies, contacts, leads, candidate ranking, and recent TradeMining import context.",
      contextTypes: ["companies", "contacts", "leads", "TradeMining imports"],
      sampleQuestions: ["Which prospects need follow-up?", "What TradeMining leads look strongest?"]
    },
    collect: getLeadGenAssistantKnowledge
  },
  {
    key: "rate-tools",
    moduleKeys: [ModuleKey.UPS_TOOLS, ModuleKey.LTL_RATE_PORTAL],
    capability: {
      label: "Rate tools",
      summary: "UPS and LTL bulk quote job history, quote status, and rate workflow context.",
      contextTypes: ["UPS bulk quote jobs", "LTL bulk quote jobs", "rate request workflow"],
      sampleQuestions: ["What rate jobs ran recently?", "What details are missing for this quote?"]
    },
    isEnabled: (enabledModules) =>
      enabledModules.has(ModuleKey.UPS_TOOLS) || enabledModules.has(ModuleKey.LTL_RATE_PORTAL),
    collect: getRateToolAssistantKnowledge
  },
  {
    key: "customer-cashflow",
    moduleKeys: [ModuleKey.CUSTOMER_CASHFLOW],
    capability: {
      label: "Customer cashflow",
      summary: "Customer payment risk, credit usage, open alerts, and finance memory context.",
      contextTypes: ["cashflow summaries", "credit alerts", "risk memories"],
      sampleQuestions: ["Which customers are risky right now?", "What finance issues need attention?"]
    },
    collect: getCustomerCashflowAssistantKnowledge
  },
  {
    key: "shipment-documents",
    moduleKeys: [ModuleKey.SHIPMENT_DOCUMENTS],
    capability: {
      label: "Garland / Teamship shipment documents",
      summary: "Garland PDF intake, Teamship review runs, order exceptions, update jobs, and learned pallet dimensions.",
      contextTypes: ["Teamship review runs", "Garland source emails", "Teamship update jobs", "product dimensions"],
      sampleQuestions: ["What Garland orders need review?", "Which Teamship update jobs failed?"]
    },
    collect: getShipmentDocumentsAssistantKnowledge
  },
  {
    key: "invoice-automation",
    moduleKeys: [ModuleKey.INVOICE_VERIFICATION, ModuleKey.QUICKBOOKS_POSTING],
    capability: {
      label: "Invoice automation and QuickBooks posting",
      summary: "Invoice batches, operations review queues, accounting approvals, posting outcomes, and correction memory.",
      contextTypes: ["invoice batches", "invoice exceptions", "QuickBooks posting", "correction memory"],
      sampleQuestions: ["Which invoices are stuck in review?", "What QuickBooks postings failed?"]
    },
    isEnabled: (enabledModules) =>
      enabledModules.has(ModuleKey.INVOICE_VERIFICATION) || enabledModules.has(ModuleKey.QUICKBOOKS_POSTING),
    collect: getInvoiceAutomationAssistantKnowledge
  },
  {
    key: "teamship",
    moduleKeys: [ModuleKey.SHIPMENT_DOCUMENTS],
    capability: {
      label: "Teamship WMS knowledge",
      summary: "Draft Teamship navigation, inventory, order, and safety procedures plus scoped read-only record lookup.",
      contextTypes: ["Teamship navigation", "inventory terminology", "order procedures", "safety guidance"],
      sampleQuestions: ["Where is this SKU in Teamship?", "What does Available mean in Teamship?"]
    },
    collect: getTeamshipAssistantKnowledge
  }
];

export function getEnabledAssistantKnowledgeAdapters(enabledModules: Set<ModuleKey>) {
  return ASSISTANT_KNOWLEDGE_ADAPTERS.filter((adapter) =>
    adapter.isEnabled ? adapter.isEnabled(enabledModules) : adapter.moduleKeys.some((key) => enabledModules.has(key))
  );
}

export function getEnabledAssistantCapabilityManifest(enabledModules: Set<ModuleKey>) {
  return getEnabledAssistantKnowledgeAdapters(enabledModules).map((adapter) => ({
    key: adapter.key,
    moduleKeys: adapter.moduleKeys,
    ...adapter.capability
  }));
}
