import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createApiTool,
  createParameterizedApiTool
} from "./index.js";

describe("Newl Website Growth OpenClaw plugin", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.TEST_BACKLINK_TOKEN;
  });

  it("does not call Newl Apps when the protected token is missing", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const tool = createApiTool("/claim", { limit: 5 })({
      config: {
        baseUrl: "https://newl-apps.example.com",
        backlinkTokenEnv: "TEST_BACKLINK_TOKEN"
      }
    });

    const result = await tool.execute();

    expect(result.details.status).toBe("not_configured");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("binds the token outside model-controlled arguments", async () => {
    process.env.TEST_BACKLINK_TOKEN = "protected-token";
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: { updated: true } }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    const tool = createParameterizedApiTool("/report")({
      config: {
        baseUrl: "https://newl-apps.example.com/",
        backlinkTokenEnv: "TEST_BACKLINK_TOKEN"
      }
    });

    const result = await tool.execute("call-1", {
      opportunityId: "opportunity-1",
      status: "BLOCKED",
      notes: "CAPTCHA requires human review."
    });

    expect(result.details.status).toBe("ok");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://newl-apps.example.com/report",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer protected-token"
        })
      })
    );
  });
});
