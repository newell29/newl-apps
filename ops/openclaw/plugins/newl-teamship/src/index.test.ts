import { describe, expect, it } from "vitest";
import { getToolPluginMetadata } from "openclaw/plugin-sdk/tool-plugin";

import plugin, {
  buildRequestHeaders,
  createTeamshipReadTool,
  normalizeUuid
} from "./index.js";

describe("Newl Teamship OpenClaw plugin", () => {
  it("declares only the identity-bound read tool", () => {
    expect(getToolPluginMetadata(plugin)?.tools.map((tool) => tool.name)).toEqual(["newl_teamship_read"]);
    const tool = createTeamshipReadTool({
      config: { baseUrl: "https://preview.example.com", tenantId: "11111111-1111-4111-8111-111111111111" },
      toolContext: {}
    });
    expect(tool.name).toBe("newl_teamship_read");
    expect(tool.description).toContain("customer 420 and warehouse 102");
    expect(tool.description).toContain("What is shipping order ORDER status customer CUSTOMER warehouse WAREHOUSE?");
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
});
