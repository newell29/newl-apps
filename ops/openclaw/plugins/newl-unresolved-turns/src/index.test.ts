import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  classifyToolFailure,
  classifyVisibleResponse,
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

  it("classifies explicit failed and unavailable tool outcomes", () => {
    expect(classifyToolFailure({ details: { status: "ok" } })).toBeNull();
    expect(classifyToolFailure({
      content: [{ type: "text", text: "Teamship is not configured." }],
      details: { status: "not_configured" }
    })).toEqual({
      status: "not_configured",
      message: "Teamship is not configured."
    });
    expect(classifyToolFailure({
      details: { status: "unsupported" }
    })).toEqual({
      status: "unsupported",
      message: "Tool returned unsupported."
    });
  });

  it("classifies explicit capability gaps and local-only spreadsheet links", () => {
    expect(classifyVisibleResponse("I can't verify whether that invoice is open."))
      .toMatchObject({ failureKind: "CAPABILITY_GAP" });
    expect(classifyVisibleResponse(
      "Created [availability.xlsx](/Users/example/.openclaw/workspace/availability.xlsx)."
    )).toMatchObject({ failureKind: "ARTIFACT_DELIVERY_FAILURE" });
    expect(classifyVisibleResponse(
      "Saved it at /tmp/nemo/availability.csv"
    )).toMatchObject({ failureKind: "ARTIFACT_DELIVERY_FAILURE" });
    expect(classifyVisibleResponse("I wasn't able to retrieve that customer ID."))
      .toMatchObject({ failureKind: "CAPABILITY_GAP" });
    expect(classifyVisibleResponse("SKU 80559 has 6 units available.")).toBeNull();
  });

  it("starts a Teams turn and removes it after a clean delivery", async () => {
    const { api, handlers } = fakeApi();
    registerUnresolvedTurnHooks(api, config);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("{}", { status: 200 }))
      .mockResolvedValueOnce(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await handlers.before_agent_run?.({
      prompt: "Where is LPN 63991?",
      messages: [],
      channelId: "msteams",
      senderId: "22222222-2222-4222-8222-222222222222"
    }, {
      runId: "run-1",
      sessionKey: "session-1",
      messageProvider: "msteams"
    });
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

    await handlers.before_agent_run?.({
      prompt: "Check inventory for SKU ABC",
      messages: [],
      channelId: "msteams",
      senderId: "22222222-2222-4222-8222-222222222222"
    }, {
      runId: "run-2",
      sessionKey: "session-2",
      messageProvider: "msteams"
    });
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

  it("retains a delivered answer that explicitly reports a capability gap", async () => {
    const { api, handlers } = fakeApi();
    registerUnresolvedTurnHooks(api, config);
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await handlers.before_agent_run?.({
      prompt: "Are there open invoices for TMG Industrial?",
      messages: [],
      channelId: "msteams",
      senderId: "22222222-2222-4222-8222-222222222222"
    }, {
      runId: "run-3",
      sessionKey: "session-3",
      messageProvider: "msteams"
    });
    await handlers.message_sent?.({
      to: "employee",
      content: "I can't check open invoices from this chat.",
      success: true,
      sessionKey: "session-3"
    }, { channelId: "msteams", isGroup: false });

    expect(readFetchBody(fetchMock, 1)).toMatchObject({
      action: "fail",
      failureKind: "CAPABILITY_GAP",
      errorCode: "assistant_capability_gap",
      response: "I can't check open invoices from this chat."
    });
  });

  it("retains a local spreadsheet link as an artifact delivery failure", async () => {
    const { api, handlers } = fakeApi();
    registerUnresolvedTurnHooks(api, config);
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await handlers.before_agent_run?.({
      prompt: "Create a spreadsheet",
      messages: [],
      channelId: "msteams",
      senderId: "22222222-2222-4222-8222-222222222222"
    }, {
      runId: "run-4",
      sessionKey: "session-4",
      messageProvider: "msteams"
    });
    await handlers.message_sent?.({
      to: "employee",
      content: "Created [availability.csv](/Users/example/.openclaw/workspace/availability.csv).",
      success: true,
      sessionKey: "session-4"
    }, { channelId: "msteams", isGroup: false });

    expect(readFetchBody(fetchMock, 1)).toMatchObject({
      action: "fail",
      failureKind: "ARTIFACT_DELIVERY_FAILURE",
      errorCode: "local_file_not_uploaded"
    });
  });

  it("does not interrupt Nemo when capture storage is unavailable", async () => {
    const { api, handlers, warn } = fakeApi();
    registerUnresolvedTurnHooks(api, config);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network unavailable")));

    await expect(handlers.before_agent_run?.({
      prompt: "Hello",
      messages: [],
      channelId: "msteams",
      senderId: "22222222-2222-4222-8222-222222222222"
    }, {
      runId: "run-5",
      messageProvider: "msteams"
    })).resolves.toBeUndefined();
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
