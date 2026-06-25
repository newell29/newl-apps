import { AssistantSourceKind, IntegrationProvider, IntegrationStatus } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const findIntegrationCredential = vi.fn();
const findAccount = vi.fn();
const transaction = vi.fn();

vi.mock("@/server/db", () => ({
  prisma: {
    integrationCredential: {
      findFirst: (...args: unknown[]) => findIntegrationCredential(...args)
    },
    account: {
      findFirst: (...args: unknown[]) => findAccount(...args)
    },
    $transaction: (...args: unknown[]) => transaction(...args)
  }
}));

import { syncMicrosoftGraphAssistantKnowledge } from "@/modules/assistant/microsoft-graph-sync";

describe("syncMicrosoftGraphAssistantKnowledge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => callback({}));
  });

  it("skips sync when the current user has not connected Microsoft 365 delegated access", async () => {
    findIntegrationCredential.mockResolvedValue({
      provider: IntegrationProvider.MICROSOFT_GRAPH,
      status: IntegrationStatus.ACTIVE,
      publicConfig: {
        clientId: "client-id-1",
        tenantId: "tenant-id-1",
        redirectUri: "https://newl-apps.vercel.app/api/auth/callback/microsoft-entra-id",
        scopes: ["User.Read", "offline_access", "Mail.Read", "Files.Read.All", "Sites.Read.All"],
        mailboxAccessMode: "SIGNED_IN_USER",
        mailSyncEnabled: true,
        fileSyncEnabled: true,
        draftingEnabled: false
      }
    });
    findAccount.mockResolvedValue(null);

    const result = await syncMicrosoftGraphAssistantKnowledge({
      tenantId: "tenant-1",
      tenantSlug: "tenant-1",
      tenantName: "Tenant 1",
      userId: "user-1",
      userEmail: "user@tenant.test",
      userName: "User One",
      role: "ADMIN"
    });

    expect(result).toMatchObject({
      documentCount: 0,
      skipped: true
    });
    expect(result.reason).toContain("Reconnect Microsoft 365");
  });

  it("maps recent mail and files into assistant knowledge documents", async () => {
    findIntegrationCredential.mockResolvedValue({
      provider: IntegrationProvider.MICROSOFT_GRAPH,
      status: IntegrationStatus.ACTIVE,
      publicConfig: {
        clientId: "client-id-1",
        tenantId: "tenant-id-1",
        redirectUri: "https://newl-apps.vercel.app/api/auth/callback/microsoft-entra-id",
        scopes: ["User.Read", "offline_access", "Mail.Read", "Files.Read.All", "Sites.Read.All"],
        mailboxAccessMode: "SIGNED_IN_USER",
        mailSyncEnabled: true,
        fileSyncEnabled: true,
        draftingEnabled: false
      }
    });
    findAccount.mockResolvedValue({
      access_token: "access-token",
      refresh_token: "refresh-token",
      expires_at: 1_786_090_000,
      scope: "openid profile email offline_access User.Read Mail.Read Files.Read.All Sites.Read.All"
    });

    const upsert = vi.fn().mockResolvedValue({ id: "doc-1" });
    const deleteMany = vi.fn().mockResolvedValue({});
    const createMany = vi.fn().mockResolvedValue({});
    transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) =>
      callback({
        assistantKnowledgeDocument: { upsert },
        assistantKnowledgeChunk: { deleteMany, createMany }
      })
    );

    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            value: [
              {
                id: "mail-1",
                subject: "Customer issue in Dallas",
                bodyPreview: "Shipment delayed at destination.",
                webLink: "https://outlook.office.com/mail/mail-1",
                internetMessageId: "<mail-1@test>",
                receivedDateTime: "2026-06-25T10:00:00.000Z",
                from: {
                  emailAddress: {
                    name: "Customer Ops",
                    address: "ops@example.com"
                  }
                }
              }
            ]
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            value: [
              {
                id: "file-1",
                name: "QBR Notes.docx",
                webUrl: "https://tenant.sharepoint.com/file-1",
                lastModifiedDateTime: "2026-06-24T15:00:00.000Z",
                size: 1024,
                file: {
                  mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                },
                lastModifiedBy: {
                  user: {
                    displayName: "Alex Newell"
                  }
                }
              }
            ]
          }),
          { status: 200 }
        )
      );

    const result = await syncMicrosoftGraphAssistantKnowledge({
      tenantId: "tenant-1",
      tenantSlug: "tenant-1",
      tenantName: "Tenant 1",
      userId: "user-1",
      userEmail: "user@tenant.test",
      userName: "User One",
      role: "ADMIN"
    });

    expect(result).toMatchObject({
      documentCount: 2,
      mailCount: 1,
      fileCount: 1,
      skipped: false
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(upsert).toHaveBeenCalledTimes(2);
    expect(upsert.mock.calls[0][0].create.sourceKind).toBe(AssistantSourceKind.EMAIL);
    expect(upsert.mock.calls[1][0].create.sourceKind).toBe(AssistantSourceKind.ONEDRIVE_FILE);

    fetchMock.mockRestore();
  });
});
