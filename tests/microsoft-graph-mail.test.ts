import { beforeEach, describe, expect, it, vi } from "vitest";

import { fetchMicrosoftGraphMessageAttachmentContent } from "@/server/integrations/microsoft-graph-mail";

describe("Microsoft Graph mail attachment downloads", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("casts attachment downloads to fileAttachment before selecting contentBytes", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id: "attachment-1",
        name: "orders.pdf",
        contentBytes: "JVBERi0x"
      })
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchMicrosoftGraphMessageAttachmentContent("token", "me", "message-1", "attachment-1")).resolves.toMatchObject({
      id: "attachment-1",
      contentBytes: "JVBERi0x"
    });

    const [url] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe(
      "https://graph.microsoft.com/v1.0/me/messages/message-1/attachments/attachment-1/microsoft.graph.fileAttachment?$select=id,name,contentType,size,isInline,lastModifiedDateTime,contentBytes"
    );
  });
});
