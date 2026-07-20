import { beforeEach, describe, expect, it, vi } from "vitest";

import { fetchMicrosoftGraphMessageAttachmentContent } from "@/server/integrations/microsoft-graph-mail";

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
