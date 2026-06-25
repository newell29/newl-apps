import { AssistantSourceKind, IntegrationProvider, IntegrationStatus } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const findIntegrationCredential = vi.fn();
const findAccount = vi.fn();
const updateAccount = vi.fn();
const transaction = vi.fn();

vi.mock("@/server/db", () => ({
  prisma: {
    integrationCredential: {
      findFirst: (...args: unknown[]) => findIntegrationCredential(...args)
    },
    account: {
      findFirst: (...args: unknown[]) => findAccount(...args),
      update: (...args: unknown[]) => updateAccount(...args)
    },
    $transaction: (...args: unknown[]) => transaction(...args)
  }
}));

import {
  buildMicrosoftGraphMemoriesFromDocuments,
  syncMicrosoftGraphAssistantKnowledge
} from "@/modules/assistant/microsoft-graph-sync";

describe("syncMicrosoftGraphAssistantKnowledge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => callback({}));
    updateAccount.mockResolvedValue({});
    process.env.AUTH_MICROSOFT_ENTRA_ID_ID = "client-id-1";
    process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET = "client-secret-1";
    process.env.AZURE_AD_TENANT_ID = "tenant-id-1";
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
      id: "account-1",
      access_token: "access-token",
      refresh_token: "refresh-token",
      expires_at: 1_786_090_000,
      scope: "openid profile email offline_access User.Read Mail.Read Files.Read.All Sites.Read.All",
      token_type: "Bearer"
    });

    const upsert = vi.fn().mockResolvedValue({ id: "doc-1" });
    const deleteMany = vi.fn().mockResolvedValue({});
    const createMany = vi.fn().mockResolvedValue({});
    const deleteMemories = vi.fn().mockResolvedValue({});
    const createMemories = vi.fn().mockResolvedValue({});
    transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) =>
      callback({
        assistantKnowledgeDocument: { upsert },
        assistantKnowledgeChunk: { deleteMany, createMany }
        ,
        assistantMemory: { deleteMany: deleteMemories, createMany: createMemories }
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
    expect(updateAccount).not.toHaveBeenCalled();
    expect(createMemories).toHaveBeenCalledTimes(1);
    expect(upsert.mock.calls[0][0].create.sourceKind).toBe(AssistantSourceKind.EMAIL);
    expect(upsert.mock.calls[1][0].create.sourceKind).toBe(AssistantSourceKind.ONEDRIVE_FILE);

    fetchMock.mockRestore();
  });

  it("refreshes an expired delegated token before syncing", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-25T14:30:00.000Z"));

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
        fileSyncEnabled: false,
        draftingEnabled: false
      }
    });
    findAccount.mockResolvedValue({
      id: "account-1",
      access_token: "stale-access-token",
      refresh_token: "refresh-token",
      expires_at: Math.floor(new Date("2026-06-25T14:31:00.000Z").getTime() / 1000),
      scope: "openid profile email offline_access User.Read Mail.Read Files.Read.All Sites.Read.All",
      token_type: "Bearer"
    });

    const upsert = vi.fn().mockResolvedValue({ id: "doc-1" });
    const deleteMany = vi.fn().mockResolvedValue({});
    const createMany = vi.fn().mockResolvedValue({});
    const deleteMemories = vi.fn().mockResolvedValue({});
    const createMemories = vi.fn().mockResolvedValue({});
    transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) =>
      callback({
        assistantKnowledgeDocument: { upsert },
        assistantKnowledgeChunk: { deleteMany, createMany },
        assistantMemory: { deleteMany: deleteMemories, createMany: createMemories }
      })
    );

    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            access_token: "fresh-access-token",
            refresh_token: "fresh-refresh-token",
            expires_in: 3600,
            scope: "openid profile email offline_access User.Read Mail.Read Files.Read.All Sites.Read.All",
            token_type: "Bearer"
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            value: [
              {
                id: "mail-1",
                subject: "New opportunity",
                bodyPreview: "Customer requested new lane pricing.",
                receivedDateTime: "2026-06-25T14:00:00.000Z"
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
      documentCount: 1,
      mailCount: 1,
      fileCount: 0,
      skipped: false
    });
    expect(updateAccount).toHaveBeenCalledWith({
      where: { id: "account-1" },
      data: expect.objectContaining({
        access_token: "fresh-access-token",
        refresh_token: "fresh-refresh-token"
      })
    });

    fetchMock.mockRestore();
    vi.useRealTimers();
  });
});

describe("buildMicrosoftGraphMemoriesFromDocuments", () => {
  it("extracts customer, service, risk, and opportunity memory from email content", () => {
    const memories = buildMicrosoftGraphMemoriesFromDocuments(
      [
        {
          sourceKind: AssistantSourceKind.EMAIL,
          sourceSystem: "MICROSOFT_GRAPH_MAIL",
          externalId: "mail-1",
          title: "Urgent quote request",
          sourceUpdatedAt: new Date("2026-06-25T10:00:00.000Z"),
          metadata: {
            fromName: "Acme Imports",
            fromAddress: "shipping@acme.com"
          },
          content:
            "Microsoft 365 email message. From: Acme Imports <shipping@acme.com>. Call me at 555-222-3333. Need a quote for LTL and warehousing. We also had a delay issue. Website https://acme.com."
        }
      ],
      new Map([["MICROSOFT_GRAPH_MAIL:mail-1", "doc-1"]])
    );

    expect(memories.some((memory) => memory.kind === "CUSTOMER_PROFILE" && memory.summary.includes("shipping@acme.com"))).toBe(true);
    expect(memories.some((memory) => memory.kind === "SERVICE_CAPABILITY" && memory.summary.toLowerCase().includes("ltl"))).toBe(true);
    expect(memories.some((memory) => memory.kind === "OPERATIONAL_RISK")).toBe(true);
    expect(memories.some((memory) => memory.kind === "SALES_OPPORTUNITY")).toBe(true);
  });
});
