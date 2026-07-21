import { describe, expect, it } from "vitest";
import { getToolPluginMetadata } from "openclaw/plugin-sdk/tool-plugin";

import plugin, { normalizeUuid } from "./index.js";

describe("Newl Teamship OpenClaw plugin", () => {
  it("declares only the identity-bound read tool", () => {
    expect(getToolPluginMetadata(plugin)?.tools.map((tool) => tool.name)).toEqual(["newl_teamship_read"]);
  });

  it("accepts only stable UUID-shaped Entra identities", () => {
    expect(normalizeUuid("22222222-2222-4222-8222-222222222222")).toBe("22222222-2222-4222-8222-222222222222");
    expect(normalizeUuid("alex.newell@newl.ca")).toBeNull();
  });
});
