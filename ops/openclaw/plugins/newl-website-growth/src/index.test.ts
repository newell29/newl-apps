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
    const tool = createApiTool("newl_backlink_claim", "/claim", { limit: 5 })({
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
    const tool = createParameterizedApiTool("newl_backlink_report", "/report")({
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

  it("registers each factory under its declared OpenClaw tool name", () => {
    const config = {
      baseUrl: "https://newl-apps.example.com",
      backlinkTokenEnv: "TEST_BACKLINK_TOKEN"
    };
    expect(
      createApiTool("newl_backlink_claim", "/claim", { limit: 5 })({ config }).name
    ).toBe("newl_backlink_claim");
    expect(
      createParameterizedApiTool("newl_backlink_send_email", "/send")({ config }).name
    ).toBe("newl_backlink_send_email");
  });

  it("passes the executor run start time to the deterministic summary", async () => {
    process.env.TEST_BACKLINK_TOKEN = "protected-token";
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: { blockedThisRun: 1, blockedTotal: 5 } }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    const tool = createParameterizedApiTool("newl_backlink_summary", "/summary")({
      config: {
        baseUrl: "https://newl-apps.example.com",
        backlinkTokenEnv: "TEST_BACKLINK_TOKEN"
      }
    });

    await tool.execute("call-summary", {
      runStartedAt: "2026-07-27T14:00:00.000Z"
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://newl-apps.example.com/summary",
      expect.objectContaining({
        body: JSON.stringify({
          runStartedAt: "2026-07-27T14:00:00.000Z"
        })
      })
    );
  });
});
