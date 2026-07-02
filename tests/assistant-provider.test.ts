import { afterEach, describe, expect, it, vi } from "vitest";
import { IntegrationProvider, IntegrationStatus } from "@prisma/client";

import {
  buildAssistantProviderConfig,
  generateAssistantReply,
  parseAssistantProviderSettings
} from "@/server/integrations/assistant-provider";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("assistant provider model normalization", () => {
  it("normalizes 5.4 assistant model ids to API-safe ids", () => {
    const parsed = parseAssistantProviderSettings({
      provider: IntegrationProvider.OPENAI,
      status: IntegrationStatus.ACTIVE,
      publicConfig: {
        defaultModel: "gpt-5.4-mini",
        fallbackModel: "gpt-5.4-nano",
        liveResponsesEnabled: true
      }
    });

    expect(parsed.defaultModel).toBe("gpt-5-mini");
    expect(parsed.fallbackModel).toBe("gpt-5-nano");
  });

  it("stores normalized model ids in assistant provider config", () => {
    const config = buildAssistantProviderConfig({
      liveResponsesEnabled: true,
      defaultModel: "gpt-5.4-mini",
      fallbackModel: "gpt-5.4-nano",
      temperature: 0.2,
      maxTokens: 900,
      endpointUrl: null
    });

    expect(config.defaultModel).toBe("gpt-5-mini");
    expect(config.fallbackModel).toBe("gpt-5-nano");
  });

  it("uses max_completion_tokens for OpenAI GPT-5 chat requests", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: "Newl is a logistics business with active customer and TradeMining data."
            }
          }
        ]
      })
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("OPENAI_API_KEY", "test-openai-key");

    await generateAssistantReply({
      tenantName: "Newl Group",
      prompt: "What is your understanding of my business?",
      intent: "GENERAL_INSIGHT",
      conversationHistory: [
        {
          role: "user",
          content: "What do you know about my business?"
        }
      ],
      memorySnapshot: [
        {
          kind: "CUSTOMER_PROFILE",
          title: "ABC IMPORTS INC",
          summary: "2 imports, 0 contacts, priority score 86."
        }
      ],
      workspaceSnapshot: {
        companyCount: 64,
        contactCount: 20,
        knowledgeDocumentCount: 252,
        memoryCount: 73,
        topCompanyNames: ["ABC IMPORTS INC"]
      },
      sources: [
        {
          title: "ABC IMPORTS INC",
          excerpt: "2 imports, 0 contacts, priority score 86."
        }
      ],
      settings: {
        provider: "OPENAI",
        liveResponsesEnabled: true,
        defaultModel: "gpt-5-mini",
        fallbackModel: "gpt-5-nano",
        temperature: 0.2,
        maxTokens: 900,
        endpointUrl: null,
        status: IntegrationStatus.ACTIVE,
        runtimeReady: true,
        runtimeNotes: "ready"
      }
    });

    const requestBody = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as Record<string, unknown>;
    expect(requestBody.max_completion_tokens).toBe(900);
    expect(requestBody.max_tokens).toBeUndefined();
    expect(requestBody.temperature).toBeUndefined();
    const messages = requestBody.messages as Array<{ role: string; content: string }>;
    expect(messages[1]?.content).toContain("\"conversationHistory\"");
    expect(messages[1]?.content).toContain("\"memorySnapshot\"");
  });

  it("keeps OpenAI-compatible local model requests on max_tokens", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: "Local model response."
            }
          }
        ]
      })
    });
    vi.stubGlobal("fetch", fetchMock);

    await generateAssistantReply({
      tenantName: "Newl Group",
      prompt: "Hello",
      intent: "GENERAL_INSIGHT",
      conversationHistory: [],
      memorySnapshot: [],
      sources: [],
      settings: {
        provider: "LOCAL_LLM",
        liveResponsesEnabled: true,
        defaultModel: "gpt-5-mini",
        fallbackModel: null,
        temperature: 0.2,
        maxTokens: 900,
        endpointUrl: "http://assistant-internal:8000/v1",
        status: IntegrationStatus.ACTIVE,
        runtimeReady: true,
        runtimeNotes: "ready"
      }
    });

    const requestBody = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as Record<string, unknown>;
    expect(requestBody.max_tokens).toBe(900);
    expect(requestBody.temperature).toBe(0.2);
    expect(requestBody.max_completion_tokens).toBeUndefined();
  });
});
