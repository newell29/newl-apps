import { describe, expect, it } from "vitest";
import { IntegrationProvider, IntegrationStatus } from "@prisma/client";

import {
  buildAssistantProviderConfig,
  parseAssistantProviderSettings
} from "@/server/integrations/assistant-provider";

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
});
