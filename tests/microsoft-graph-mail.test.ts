import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createAndSendMicrosoftGraphMailboxMessage,
  fetchMicrosoftGraphMailboxFolderMessages,
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

describe("Microsoft Graph mailbox folders", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("reads messages only from the named Inbox child folder", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ value: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        value: [{ id: "semrush-folder-id", displayName: "Semrush" }]
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        value: [{ id: "message-1", subject: "Scout - Weekly Newl Position Tracking" }]
      }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchMicrosoftGraphMailboxFolderMessages(
      "token",
      "partnerships@example.com",
      "Inbox/Semrush",
      { lookbackDays: 21, maxMessagesPerMailbox: 50 }
    )).resolves.toEqual([
      expect.objectContaining({ id: "message-1" })
    ]);

    expect(String(fetchMock.mock.calls[1]?.[0])).toContain(
      "users/partnerships%40example.com/mailFolders/inbox/childFolders"
    );
    expect(String(fetchMock.mock.calls[2]?.[0])).toContain(
      "users/partnerships%40example.com/mailFolders/semrush-folder-id/messages"
    );
  });

  it("fails closed when the named child folder is missing", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ value: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ value: [] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchMicrosoftGraphMailboxFolderMessages(
      "token",
      "partnerships@example.com",
      "Inbox/Semrush",
      { lookbackDays: 21, maxMessagesPerMailbox: 50 }
    )).rejects.toThrow("could not find the Semrush mail folder");
  });
});

describe("Microsoft Graph outbound mail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("sends directly with Mail.Send instead of requiring draft write access", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(null, { status: 202 })
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(createAndSendMicrosoftGraphMailboxMessage(
      "token",
      "partnerships@example.com",
      {
        recipientEmail: "editor@publisher.example",
        recipientName: "Editor",
        subject: "Resource suggestion",
        body: "A short, reviewed message."
      }
    )).resolves.toEqual({
      id: null,
      conversationId: null,
      internetMessageId: null
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "https://graph.microsoft.com/v1.0/users/partnerships%40example.com/sendMail",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer token"
        })
      })
    );
    const sendRequest = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(sendRequest.body))).toMatchObject({
      message: {
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
      },
      saveToSentItems: true
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("surfaces a direct send failure without making a second request", async () => {
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
