import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";
import { getToolPluginMetadata } from "openclaw/plugin-sdk/tool-plugin";

import plugin, {
  buildRequestHeaders,
  createDevelopmentSuggestionDigestTool,
  createGarlandApproveUpdateTool,
  createGarlandExplainTool,
  createGarlandPdfReviewTool,
  createTeamshipReadTool,
  normalizeUuid,
  registerTrustedTeamsMediaCapture
} from "./index.js";

describe("Newl Teamship OpenClaw plugin", () => {
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    vi.unstubAllGlobals();
    delete process.env.OPENCLAW_ASSISTANT_TOKEN;
    delete process.env.OPENCLAW_TEAMSHIP_READ_TOKEN;
    await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, {
      recursive: true,
      force: true
    })));
  });
  it("declares identity-bound Teamship, Garland, feedback, and approval-queue tools", () => {
    expect(getToolPluginMetadata(plugin)?.tools.map((tool) => tool.name)).toEqual([
      "newl_teamship_read",
      "newl_garland_pdf_review",
      "newl_garland_approve_update",
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
    expect(tool.description).toContain("serial number");
  });

  it("keeps Garland explanations identity-bound too", async () => {
    const tool = createGarlandExplainTool({
      config: { baseUrl: "https://preview.example.com", tenantId: "11111111-1111-4111-8111-111111111111" },
      toolContext: {}
    });

    await expect(tool.execute("call-2", { reference: "PS123456" }))
      .resolves.toMatchObject({ details: { status: "unauthorized" } });
  });

  it("keeps Garland Teamship approval identity-bound and exact", async () => {
    process.env.OPENCLAW_ASSISTANT_TOKEN = "assistant-token";
    process.env.OPENCLAW_TEAMSHIP_READ_TOKEN = "read-token";
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      data: { jobId: "job-1", status: "APPROVED" }
    }));
    vi.stubGlobal("fetch", fetchMock);
    const tool = createGarlandApproveUpdateTool({
      config: {
        baseUrl: "https://newl.example.com",
        tenantId: "11111111-1111-4111-8111-111111111111"
      },
      toolContext: {
        messageChannel: "msteams",
        requesterSenderId: "22222222-2222-4222-8222-222222222222"
      }
    });

    await expect(tool.execute("approve-1", {
      artifactId: "artifact-1",
      jobId: "job-1",
      targetReference: "PS210235"
    })).resolves.toMatchObject({
      details: { status: "ok" },
      content: [{ text: expect.stringContaining("Completion has not yet been verified") }]
    });
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/artifacts/artifact-1/update");
    expect(JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body))).toEqual({
      jobId: "job-1",
      targetReference: "PS210235",
      confirmation: "APPROVE_TEAMSHIP_UPDATE"
    });
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
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: {
        awaitingApproval: [{ id: "suggestion-1", title: "Improve Garland parser", feedbackCount: 2 }],
        unresolvedQueries: [{ failureKind: "TOOL_FAILURE", promptText: "Check PS210235", toolName: "newl_garland_pdf_review" }]
      }
    }), {
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

    await expect(tool.execute("call-3", {})).resolves.toMatchObject({
      details: { status: "ok" },
      content: [{ text: expect.stringMatching(/suggestion-1[\s\S]*1 failed or unanswered Nemo query[\s\S]*TOOL_FAILURE/) }]
    });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(URL),
      expect.objectContaining({
        headers: expect.objectContaining({
          "x-newl-teams-aad-object-id": "22222222-2222-4222-8222-222222222222"
        })
      })
    );
  });

  it("never falls back to or reuses the Teamship read credential for Garland writes", async () => {
    process.env.OPENCLAW_TEAMSHIP_READ_TOKEN = "read-token";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const toolContext = {
      messageChannel: "msteams",
      requesterSenderId: "22222222-2222-4222-8222-222222222222"
    };

    const missingAssistantToken = createGarlandExplainTool({
      config: {
        baseUrl: "https://newl.example.com",
        tenantId: "11111111-1111-4111-8111-111111111111"
      },
      toolContext
    });
    await expect(missingAssistantToken.execute("call-4", { reference: "PS123456" }))
      .resolves.toMatchObject({ details: { status: "not_configured" } });

    const sharedEnvironmentName = createGarlandExplainTool({
      config: {
        baseUrl: "https://newl.example.com",
        tenantId: "11111111-1111-4111-8111-111111111111",
        assistantTokenEnv: "OPENCLAW_TEAMSHIP_READ_TOKEN"
      },
      toolContext
    });
    await expect(sharedEnvironmentName.execute("call-5", { reference: "PS123456" }))
      .resolves.toMatchObject({ details: { status: "not_configured" } });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uploads only the PDF captured from the same trusted Teams session and consumes the capture", async () => {
    process.env.OPENCLAW_ASSISTANT_TOKEN = "assistant-token";
    process.env.OPENCLAW_TEAMSHIP_READ_TOKEN = "read-token";
    const directory = await mkdtemp(join(tmpdir(), "newl-garland-plugin-"));
    temporaryDirectories.push(directory);
    const pdfPath = join(directory, "Garland order.pdf");
    await writeFile(pdfPath, Buffer.from("%PDF-1.4\n%%EOF\n"));

    let messageHandler: ((event: Record<string, unknown>, context: Record<string, unknown>) => void) | undefined;
    registerTrustedTeamsMediaCapture({
      on: vi.fn((eventName: string, handler: typeof messageHandler) => {
        if (eventName === "message_received") messageHandler = handler;
      })
    } as never);
    expect(messageHandler).toBeTypeOf("function");
    messageHandler?.(
      {
        messageId: "teams-message-1",
        metadata: { mediaPath: pdfPath }
      },
      {
        channelId: "msteams",
        senderId: "22222222-2222-4222-8222-222222222222",
        sessionKey: "teams-session-1",
        conversationId: "teams-conversation-1"
      }
    );

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        data: { id: "artifact-1", status: "UPLOADING" }
      }, 201))
      .mockResolvedValueOnce(jsonResponse({
        data: { artifactId: "artifact-1", chunkIndex: 0 }
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: {
          artifactId: "artifact-1",
          reviewRunId: "review-1",
          fileName: "Garland order.pdf",
          extraction: {
            targetReference: "PS210235",
            selectedPsNumber: "PS210235",
            selectedSrNumber: "SR810263",
            totalOrderCount: 2,
            orderCount: 1,
            ignoredOrderCount: 1
          },
          review: {
            passedCount: 1,
            failedCount: 0,
            missingTeamshipCount: 0,
            pendingTeamshipCount: 0
          },
          updateProposal: {
            jobId: "job-1",
            status: "DRAFT",
            approvalRequired: true,
            proposedActions: [
              "Set pallet 1 for SKU ABC to 48 x 40 x 50 in and 500 lbs.",
              "Remove Teamship-generated Customer Order Information weights from the editable BOL."
            ],
            investigationItems: ["Confirm carrier selection."]
          }
        }
      }));
    vi.stubGlobal("fetch", fetchMock);

    const tool = createGarlandPdfReviewTool({
      config: {
        baseUrl: "https://newl.example.com",
        tenantId: "11111111-1111-4111-8111-111111111111"
      },
      toolContext: {
        messageChannel: "msteams",
        requesterSenderId: "22222222-2222-4222-8222-222222222222",
        sessionKey: "teams-session-1"
      }
    });

    await expect(tool.execute("call-missing-reference", {}))
      .rejects.toThrow("targetReference must be between 1 and 10 characters");
    expect(fetchMock).not.toHaveBeenCalled();
    await expect(tool.execute("call-6", { targetReference: "PS210235" })).resolves.toMatchObject({
      details: { status: "ok" },
      content: [{ text: expect.stringMatching(/checked only PS210235 \/ SR810263.*1 other order.*was ignored[\s\S]*Update draft job-1[\s\S]*Explicit approval is required[\s\S]*Confirm carrier selection/) }]
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/api/assistant/garland/artifacts");
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain("/chunks/0");
    expect(String(fetchMock.mock.calls[2]?.[0])).toContain("/finalize");
    const createRequest = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(createRequest.body))).toMatchObject({ targetReference: "PS210235" });
    await expect(tool.execute("call-7", { targetReference: "PS210235" })).resolves.toMatchObject({
      details: { status: "failed" },
      content: [{ text: expect.stringContaining("attach it again") }]
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}
