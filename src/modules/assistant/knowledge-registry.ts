import { ModuleKey } from "@prisma/client";

import type { TenantContext } from "@/server/tenant-context";
import { getCustomerCashflowAssistantKnowledge } from "@/modules/customer-cashflow/assistant-knowledge";
import { getLeadGenAssistantKnowledge } from "@/modules/lead-gen/assistant-knowledge";
import { getRateToolAssistantKnowledge } from "@/modules/assistant/rate-tool-knowledge";

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
  isEnabled?: (enabledModules: Set<ModuleKey>) => boolean;
  collect: (tenant: TenantContext) => Promise<AssistantKnowledgeAdapterResult>;
};

const ASSISTANT_KNOWLEDGE_ADAPTERS: AssistantKnowledgeAdapter[] = [
  {
    key: "lead-gen",
    moduleKeys: [ModuleKey.LEAD_GEN],
    collect: getLeadGenAssistantKnowledge
  },
  {
    key: "rate-tools",
    moduleKeys: [ModuleKey.UPS_TOOLS, ModuleKey.LTL_RATE_PORTAL],
    isEnabled: (enabledModules) =>
      enabledModules.has(ModuleKey.UPS_TOOLS) || enabledModules.has(ModuleKey.LTL_RATE_PORTAL),
    collect: getRateToolAssistantKnowledge
  },
  {
    key: "customer-cashflow",
    moduleKeys: [ModuleKey.CUSTOMER_CASHFLOW],
    collect: getCustomerCashflowAssistantKnowledge
  }
];

export function getEnabledAssistantKnowledgeAdapters(enabledModules: Set<ModuleKey>) {
  return ASSISTANT_KNOWLEDGE_ADAPTERS.filter((adapter) =>
    adapter.isEnabled ? adapter.isEnabled(enabledModules) : adapter.moduleKeys.some((key) => enabledModules.has(key))
  );
}
