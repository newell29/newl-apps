import { afterEach, describe, expect, it, vi } from "vitest";
import { getToolPluginMetadata } from "openclaw/plugin-sdk/tool-plugin";

import plugin, {
  buildRequestHeaders,
  createDevelopmentSuggestionDigestTool,
  createGarlandExplainTool,
  createTeamshipReadTool,
  normalizeUuid
} from "./index.js";

describe("Newl Teamship OpenClaw plugin", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.OPENCLAW_ASSISTANT_TOKEN;
  });
  it("declares identity-bound Teamship, Garland, feedback, and approval-queue tools", () => {
    expect(getToolPluginMetadata(plugin)?.tools.map((tool) => tool.name)).toEqual([
      "newl_teamship_read",
      "newl_garland_pdf_review",
      "newl_garland_explain",
      "newl_operational_feedback",
      "newl_development_suggestion_digest"
    ]);
    const tool = createTeamshipReadTool({
      config: { baseUrl: "https://preview.example.com", tenantId: "11111111-1111-4111-8111-111111111111" },
      toolContext: {}
    });
    expect(tool.name).toBe("newl_teamship_read");
    expect(tool.description).toContain("do not ask them for numeric Teamship IDs");
    expect(tool.description).toContain("defaults Garland to Annagem");
  });

  it("keeps Garland explanations identity-bound too", async () => {
    const tool = createGarlandExplainTool({
      config: { baseUrl: "https://preview.example.com", tenantId: "11111111-1111-4111-8111-111111111111" },
      toolContext: {}
    });

    await expect(tool.execute("call-2", { reference: "PS123456" }))
      .resolves.toMatchObject({ details: { status: "unauthorized" } });
  });

  it("accepts only stable UUID-shaped Entra identities", () => {
    expect(normalizeUuid("22222222-2222-4222-8222-222222222222")).toBe("22222222-2222-4222-8222-222222222222");
    expect(normalizeUuid("alex.newell@newl.ca")).toBeNull();
  });

  it("keeps the tool discoverable while rejecting execution without trusted Teams identity", async () => {
    const tool = createTeamshipReadTool({
      config: {
        baseUrl: "https://preview.example.com",
        tenantId: "11111111-1111-4111-8111-111111111111"
      },
      toolContext: {}
    });

    expect(tool.name).toBe("newl_teamship_read");
    await expect(tool.execute("call-1", { prompt: "Find order SR812500" }))
      .resolves.toMatchObject({ details: { status: "unauthorized" } });
  });

  it("adds a Vercel Preview bypass only when one is explicitly configured", () => {
    const base = {
      token: "read-token",
      tenantId: "11111111-1111-4111-8111-111111111111",
      senderId: "22222222-2222-4222-8222-222222222222"
    };

    expect(buildRequestHeaders(base)).not.toHaveProperty("x-vercel-protection-bypass");
    expect(buildRequestHeaders({ ...base, bypassToken: "preview-token" }))
      .toHaveProperty("x-vercel-protection-bypass", "preview-token");
  });

  it("uses the configured admin identity only for a sender-less scheduled digest", async () => {
    process.env.OPENCLAW_ASSISTANT_TOKEN = "assistant-token";
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { awaitingApproval: [] } }), {
      status: 200,
      headers: { "content-type": "application/json" }
    }));
    vi.stubGlobal("fetch", fetchMock);
    const tool = createDevelopmentSuggestionDigestTool({
      config: {
        baseUrl: "https://preview.example.com",
        tenantId: "11111111-1111-4111-8111-111111111111",
        digestAdminObjectId: "22222222-2222-4222-8222-222222222222"
      },
      toolContext: { messageChannel: "msteams" }
    });

    await expect(tool.execute("call-3", {})).resolves.toMatchObject({ details: { status: "ok" } });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(URL),
      expect.objectContaining({
        headers: expect.objectContaining({
          "x-newl-teams-aad-object-id": "22222222-2222-4222-8222-222222222222"
        })
      })
    );
  });
});
