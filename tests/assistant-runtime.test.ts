import { beforeEach, describe, expect, it, vi } from "vitest";
import { AssistantSourceKind, IntegrationProvider, IntegrationStatus, PlatformRole } from "@prisma/client";

const integrationCredentialFindFirst = vi.fn();
const searchAssistantKnowledge = vi.fn();
const getAssistantWorkspace = vi.fn();
const buildAssistantSources = vi.fn();
const buildAssistantAnswerForPrompt = vi.fn();
const maybeRunAssistantRateRequest = vi.fn();
const maybeRunAssistantApolloActivityRequest = vi.fn();
const generateAssistantReply = vi.fn();

vi.mock("@/server/db", () => ({
  prisma: {
    integrationCredential: {
      findFirst: (...args: unknown[]) => integrationCredentialFindFirst(...args)
    }
  }
}));

vi.mock("@/modules/assistant/knowledge", () => ({
  searchAssistantKnowledge: (...args: unknown[]) => searchAssistantKnowledge(...args)
}));

vi.mock("@/modules/assistant/rate-tools", () => ({
  maybeRunAssistantRateRequest: (...args: unknown[]) => maybeRunAssistantRateRequest(...args)
}));

vi.mock("@/modules/assistant/apollo-workflow", () => ({
  maybeRunAssistantApolloActivityRequest: (...args: unknown[]) => maybeRunAssistantApolloActivityRequest(...args)
}));

vi.mock("@/modules/assistant/queries", () => ({
  getAssistantWorkspace: (...args: unknown[]) => getAssistantWorkspace(...args),
  buildAssistantSources: (...args: unknown[]) => buildAssistantSources(...args),
  buildAssistantAnswerForPrompt: (...args: unknown[]) => buildAssistantAnswerForPrompt(...args)
}));

vi.mock("@/server/integrations/assistant-provider", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/integrations/assistant-provider")>();

  return {
    ...actual,
    generateAssistantReply: (...args: unknown[]) => generateAssistantReply(...args)
  };
});

import { runAssistantPrompt } from "@/modules/assistant/runtime";

const context = {
  tenantId: "tenant-1",
  tenantSlug: "newl-group",
  tenantName: "Newl Group",
  userId: "user-1",
  userEmail: "admin@newl.ca",
  userName: "Admin User",
  role: PlatformRole.ADMIN,
  memberships: []
};

function buildWorkspace() {
  return {
    stats: {
      companyCount: 64,
      contactCount: 20,
      openLeadCount: 8,
      importRecordCount: 103,
      knowledgeDocumentCount: 0,
      memoryCount: 0
    },
    integrations: [
      {
        provider: IntegrationProvider.OPENAI,
        activeCount: 1
      }
    ],
    topCompanies: [
      {
        id: "company-1",
        name: "ABC IMPORTS INC",
        priorityScore: 86,
        importRecordCount: 2,
        contactCount: 0
      }
    ],
    recentRateJobs: [],
    recentMemories: [],
    activeThread: null
  };
}

describe("runAssistantPrompt", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("OPENAI_API_KEY", "test-openai-key");
    getAssistantWorkspace.mockResolvedValue(buildWorkspace());
    searchAssistantKnowledge.mockResolvedValue([]);
    buildAssistantSources.mockReturnValue([
      {
        sourceKind: AssistantSourceKind.COMPANY,
        sourceId: "company-1",
        title: "ABC IMPORTS INC",
        excerpt: "2 imports, 0 contacts, priority score 86."
      }
    ]);
    buildAssistantAnswerForPrompt.mockReturnValue({
      intent: "CUSTOMER_CONTEXT",
      answer: [
        "The assistant can currently ground customer answers in 64 companies, 20 contacts, and 103 TradeMining records.",
        "The highest-priority visible company is ABC IMPORTS INC with score 86."
      ]
    });
    maybeRunAssistantRateRequest.mockResolvedValue(null);
    maybeRunAssistantApolloActivityRequest.mockResolvedValue(null);
  });

  it("loads the newest assistant provider row deterministically", async () => {
    integrationCredentialFindFirst.mockResolvedValue({
      provider: IntegrationProvider.OPENAI,
      status: IntegrationStatus.ACTIVE,
      publicConfig: {
        liveResponsesEnabled: true,
        defaultModel: "gpt-5-mini",
        fallbackModel: "gpt-5-nano",
        temperature: 0.2,
        maxTokens: 900
      }
    });
    generateAssistantReply.mockResolvedValue({
      content: "ABC IMPORTS INC is the strongest visible account right now based on TradeMining score.",
      provider: "OPENAI",
      model: "gpt-5-mini",
      usedFallbackModel: false,
      rawResponse: {}
    });

    const result = await runAssistantPrompt(context, "what do you know about my business");

    expect(integrationCredentialFindFirst).toHaveBeenCalledWith({
      where: {
        tenantId: "tenant-1",
        name: "Company Assistant Provider"
      },
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
      select: {
        provider: true,
        status: true,
        publicConfig: true
      }
    });
    expect(result.provider).toBe("OPENAI");
    expect(result.answer).toContain("ABC IMPORTS INC is the strongest visible account");
    expect(generateAssistantReply).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationHistory: [],
        memorySnapshot: [],
        workspaceSnapshot: expect.objectContaining({
          companyCount: 64,
          contactCount: 20,
          topCompanyNames: ["ABC IMPORTS INC"]
        })
      })
    );
  });

  it("stores provider fallback state in run metadata when live reply fails", async () => {
    integrationCredentialFindFirst.mockResolvedValue({
      provider: IntegrationProvider.OPENAI,
      status: IntegrationStatus.ACTIVE,
      publicConfig: {
        liveResponsesEnabled: true,
        defaultModel: "gpt-5-mini",
        fallbackModel: "gpt-5-nano",
        temperature: 0.2,
        maxTokens: 900
      }
    });
    generateAssistantReply.mockRejectedValue(new Error("Model request failed."));

    const result = await runAssistantPrompt(context, "what do you know about my business");

    expect(result.provider).toBe("NEWL_DETERMINISTIC");
    expect(result.runMetadata).toMatchObject({
      deterministic: true,
      providerFallback: true,
      liveReplyAttempted: true,
      liveReplyError: "Model request failed."
    });
  });

  it("falls back when the live provider returns an empty response", async () => {
    integrationCredentialFindFirst.mockResolvedValue({
      provider: IntegrationProvider.OPENAI,
      status: IntegrationStatus.ACTIVE,
      publicConfig: {
        liveResponsesEnabled: true,
        defaultModel: "gpt-5-mini",
        fallbackModel: "gpt-5-nano",
        temperature: 0.2,
        maxTokens: 900
      }
    });
    generateAssistantReply.mockResolvedValue({
      content: "   ",
      provider: "OPENAI",
      model: "gpt-5-mini",
      usedFallbackModel: false,
      rawResponse: {}
    });

    const result = await runAssistantPrompt(context, "what do you know about my business");

    expect(result.provider).toBe("NEWL_DETERMINISTIC");
    expect(result.runMetadata).toMatchObject({
      deterministic: true,
      providerFallback: true,
      liveReplyAttempted: true,
      liveReplyError: "Assistant provider returned an empty response."
    });
  });

  it("returns a clear interactive greeting instead of a vague fallback", async () => {
    integrationCredentialFindFirst.mockResolvedValue(null);

    const result = await runAssistantPrompt(context, "Hello");

    expect(result.provider).toBe("NEWL_GUIDANCE");
    expect(result.answer).toContain("I’m here and working.");
    expect(result.answer).toContain("customers, Apollo activity, rates, opportunities, risks, or email drafting");
  });

  it("explains why inbox questions are blocked when Microsoft knowledge is not ready", async () => {
    getAssistantWorkspace.mockResolvedValue({
      ...buildWorkspace(),
      integrations: [],
      topCompanies: [],
      openLeads: [],
      stats: {
        companyCount: 0,
        contactCount: 0,
        openLeadCount: 0,
        importRecordCount: 0,
        knowledgeDocumentCount: 0,
        memoryCount: 0
      }
    });
    integrationCredentialFindFirst.mockResolvedValue(null);

    const result = await runAssistantPrompt(context, "What is in our shared inbox?");

    expect(result.provider).toBe("NEWL_GUIDANCE");
    expect(result.answer).toContain("Microsoft 365 knowledge is not fully available");
    expect(result.runMetadata).toMatchObject({
      blocked: "microsoft-knowledge-not-ready"
    });
  });
});
