import { describe, expect, it } from "vitest";
import { getToolPluginMetadata } from "openclaw/plugin-sdk/tool-plugin";

import plugin, { buildRequestHeaders, normalizeUuid } from "./index.js";

describe("Newl Teamship OpenClaw plugin", () => {
  it("declares only the identity-bound read tool", () => {
    expect(getToolPluginMetadata(plugin)?.tools.map((tool) => tool.name)).toEqual(["newl_teamship_read"]);
  });

  it("accepts only stable UUID-shaped Entra identities", () => {
    expect(normalizeUuid("22222222-2222-4222-8222-222222222222")).toBe("22222222-2222-4222-8222-222222222222");
    expect(normalizeUuid("alex.newell@newl.ca")).toBeNull();
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
