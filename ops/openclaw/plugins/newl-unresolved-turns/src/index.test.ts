import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  classifyToolFailure,
  registerUnresolvedTurnHooks
} from "./index.js";

const config = {
  baseUrl: "https://preview.example.com",
  tenantId: "11111111-1111-4111-8111-111111111111",
  developerObjectId: "33333333-3333-4333-8333-333333333333"
};

describe("Newl unresolved-turn OpenClaw plugin", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv("OPENCLAW_ASSISTANT_TOKEN", "assistant-token");
  });

  it("classifies only failed tool outcomes", () => {
    expect(classifyToolFailure({ details: { status: "ok" } })).toBeNull();
    expect(classifyToolFailure({
      content: [{ type: "text", text: "Teamship is not configured." }],
      details: { status: "not_configured" }
    })).toEqual({
      status: "not_configured",
      message: "Teamship is not configured."
    });
  });

  it("starts a Teams turn and removes it after a clean delivery", async () => {
    const { api, handlers } = fakeApi();
    registerUnresolvedTurnHooks(api, config);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("{}", { status: 200 }))
      .mockResolvedValueOnce(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await handlers.message_received?.({
      from: "employee",
      content: "Where is LPN 63991?",
      runId: "run-1",
      sessionKey: "session-1",
      senderId: "22222222-2222-4222-8222-222222222222"
    }, { channelId: "msteams", isGroup: false });
    await handlers.message_sent?.({
      to: "employee",
      content: "LPN 63991 is at 0802A.",
      success: true,
      sessionKey: "session-1"
    }, { channelId: "msteams", isGroup: false });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(readFetchBody(fetchMock, 0)).toMatchObject({ action: "start", runId: "run-1" });
    expect(readFetchBody(fetchMock, 1)).toEqual({ action: "complete", runId: "run-1" });
  });

  it("retains a failed tool turn with the visible Teams response", async () => {
    const { api, handlers } = fakeApi();
    registerUnresolvedTurnHooks(api, config);
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await handlers.message_received?.({
      from: "employee",
      content: "Check inventory for SKU ABC",
      runId: "run-2",
      sessionKey: "session-2",
      senderId: "22222222-2222-4222-8222-222222222222"
    }, { channelId: "msteams", isGroup: false });
    await handlers.after_tool_call?.({
      toolName: "newl_teamship_read",
      params: { prompt: "not persisted by capture" },
      runId: "run-2",
      toolCallId: "call-2",
      result: {
        content: [{ type: "text", text: "Teamship read failed." }],
        details: { status: "failed" }
      }
    }, {});
    await handlers.message_sent?.({
      to: "employee",
      content: "I could not complete the lookup.",
      success: true,
      sessionKey: "session-2"
    }, { channelId: "msteams", isGroup: false });

    const failureBody = readFetchBody(fetchMock, 1);
    expect(failureBody).toMatchObject({
      action: "fail",
      failureKind: "TOOL_FAILURE",
      toolName: "newl_teamship_read",
      response: "I could not complete the lookup."
    });
    expect(JSON.stringify(failureBody)).not.toContain("not persisted by capture");
  });

  it("does not interrupt Nemo when capture storage is unavailable", async () => {
    const { api, handlers, warn } = fakeApi();
    registerUnresolvedTurnHooks(api, config);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network unavailable")));

    await expect(handlers.message_received?.({
      from: "employee",
      content: "Hello",
      runId: "run-3",
      senderId: "22222222-2222-4222-8222-222222222222"
    }, { channelId: "msteams", isGroup: false })).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("network unavailable"));
  });
});

type HookHandlers = Partial<Record<string, (...args: unknown[]) => Promise<unknown> | unknown>>;

function fakeApi() {
  const handlers: HookHandlers = {};
  const warn = vi.fn();
  const api = {
    on(name: string, handler: HookHandlers[string]) {
      if (handler) handlers[name] = handler;
    },
    logger: { warn }
  } as unknown as OpenClawPluginApi;
  return { api, handlers, warn };
}

function readFetchBody(fetchMock: ReturnType<typeof vi.fn>, call: number) {
  const init = fetchMock.mock.calls[call]?.[1] as RequestInit | undefined;
  return JSON.parse(String(init?.body)) as Record<string, unknown>;
}
