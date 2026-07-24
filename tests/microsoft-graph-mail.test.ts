import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createAndSendMicrosoftGraphMailboxMessage,
  fetchMicrosoftGraphMessageAttachmentContent
} from "@/server/integrations/microsoft-graph-mail";

describe("Microsoft Graph mail attachment downloads", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("downloads attachment content through the raw value endpoint", async () => {
    const pdfBytes = Buffer.from("%PDF-1.7");
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => pdfBytes.buffer.slice(pdfBytes.byteOffset, pdfBytes.byteOffset + pdfBytes.byteLength)
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchMicrosoftGraphMessageAttachmentContent("token", "me", "message-1", "attachment-1")).resolves.toMatchObject({
      id: "attachment-1",
      contentBytes: pdfBytes.toString("base64")
    });

    const [url] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("https://graph.microsoft.com/v1.0/me/messages/message-1/attachments/attachment-1/$value");
  });
});

describe("Microsoft Graph outbound mail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("creates an immutable draft and sends that exact draft", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        id: "immutable-message-1",
        conversationId: "conversation-1",
        internetMessageId: "<message-1@example.com>"
      }), {
        status: 201,
        headers: { "content-type": "application/json" }
      }))
      .mockResolvedValueOnce(new Response(null, { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(createAndSendMicrosoftGraphMailboxMessage(
      "token",
      "me",
      {
        recipientEmail: "editor@publisher.example",
        recipientName: "Editor",
        subject: "Resource suggestion",
        body: "A short, reviewed message."
      }
    )).resolves.toEqual({
      id: "immutable-message-1",
      conversationId: "conversation-1",
      internetMessageId: "<message-1@example.com>"
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "https://graph.microsoft.com/v1.0/me/messages",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer token",
          Prefer: 'IdType="ImmutableId"'
        })
      })
    );
    const createRequest = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(createRequest.body))).toMatchObject({
      subject: "Resource suggestion",
      body: {
        contentType: "Text",
        content: "A short, reviewed message."
      },
      toRecipients: [{
        emailAddress: {
          address: "editor@publisher.example",
          name: "Editor"
        }
      }]
    });
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://graph.microsoft.com/v1.0/me/messages/immutable-message-1/send",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer token",
          Prefer: 'IdType="ImmutableId"'
        })
      })
    );
  });

  it("does not call send when draft creation fails", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        error: {
          message: "Mailbox permission denied."
        }
      }), {
        status: 403,
        headers: { "content-type": "application/json" }
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(createAndSendMicrosoftGraphMailboxMessage(
      "token",
      "me",
      {
        recipientEmail: "editor@publisher.example",
        subject: "Resource suggestion",
        body: "A short, reviewed message."
      }
    )).rejects.toThrow("Mailbox permission denied");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
