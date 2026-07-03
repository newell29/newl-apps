import { AssistantSourceKind, IntegrationProvider, IntegrationStatus } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const findIntegrationCredential = vi.fn();
const findAccount = vi.fn();
const updateAccount = vi.fn();
const transaction = vi.fn();
const findMemberships = vi.fn();
const upsertMailboxSyncState = vi.fn();

vi.mock("@/server/db", () => ({
  prisma: {
    integrationCredential: {
      findFirst: (...args: unknown[]) => findIntegrationCredential(...args)
    },
    account: {
      findFirst: (...args: unknown[]) => findAccount(...args),
      update: (...args: unknown[]) => updateAccount(...args)
    },
    membership: {
      findMany: (...args: unknown[]) => findMemberships(...args)
    },
    assistantMailboxSyncState: {
      upsert: (...args: unknown[]) => upsertMailboxSyncState(...args)
    },
    $transaction: (...args: unknown[]) => transaction(...args)
  }
}));

import {
  buildMicrosoftGraphMemoriesFromDocuments,
  syncMicrosoftGraphAssistantKnowledge,
  syncTenantMicrosoftGraphAssistantKnowledge
} from "@/modules/assistant/microsoft-graph-sync";

describe("syncMicrosoftGraphAssistantKnowledge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => callback({}));
    updateAccount.mockResolvedValue({});
    upsertMailboxSyncState.mockResolvedValue({});
    findMemberships.mockResolvedValue([]);
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
    const findCompanies = vi.fn().mockResolvedValue([]);
    const findContacts = vi.fn().mockResolvedValue([]);
    transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) =>
      callback({
        company: { findMany: findCompanies },
        contact: { findMany: findContacts },
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
            value: [
              {
                id: "mail-1",
                subject: "Customer issue in Dallas",
                bodyPreview: "Shipment delayed at destination.",
                body: {
                  contentType: "text",
                  content: "Customer issue in Dallas. Please call 555-111-2222 and review https://customer.example.com."
                },
                webLink: "https://outlook.office.com/mail/mail-1",
                internetMessageId: "<mail-1@test>",
                conversationId: "conversation-1",
                receivedDateTime: "2026-06-25T10:00:00.000Z",
                from: {
                  emailAddress: {
                    name: "Customer Ops",
                    address: "ops@example.com"
                  }
                },
                toRecipients: [
                  {
                    emailAddress: {
                      name: "Alex Newell",
                      address: "alex@newl.ca"
                    }
                  }
                ]
              }
            ]
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            value: [{ id: "probe-1" }]
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
    expect(deleteMemories).toHaveBeenCalledWith({
      where: {
        tenantId: "tenant-1",
        sourceRunId: null,
        sourceDocument: {
          is: {
            sourceSystem: {
              in: ["MICROSOFT_GRAPH_MAIL", "MICROSOFT_GRAPH_FILE"]
            }
          }
        }
      }
    });
    expect(upsert.mock.calls[0][0].create.sourceKind).toBe(AssistantSourceKind.EMAIL);
    expect(upsert.mock.calls[1][0].create.sourceKind).toBe(AssistantSourceKind.ONEDRIVE_FILE);
    expect(upsert.mock.calls[0][0].create.metadata.toRecipients).toContain("Alex Newell <alex@newl.ca>");

    fetchMock.mockRestore();
  });

  it("returns a structured skip reason when delegated Graph mail access fails", async () => {
    findIntegrationCredential.mockResolvedValue({
      provider: IntegrationProvider.MICROSOFT_GRAPH,
      status: IntegrationStatus.ACTIVE,
      publicConfig: {
        scopes: ["User.Read", "offline_access", "Mail.Read", "Files.Read.All", "Sites.Read.All"],
        mailboxAccessMode: "SIGNED_IN_USER",
        mailSyncEnabled: true,
        fileSyncEnabled: false,
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

    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          error: {
            code: "ErrorAccessDenied",
            message: "Access is denied. Check credentials and try again."
          }
        }),
        { status: 403 }
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
      documentCount: 0,
      mailCount: 0,
      fileCount: 0,
      skipped: true
    });
    expect(result.reason).toContain("ErrorAccessDenied");
    expect(transaction).not.toHaveBeenCalled();

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
    const findCompanies = vi.fn().mockResolvedValue([]);
    const findContacts = vi.fn().mockResolvedValue([]);
    transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) =>
      callback({
        company: { findMany: findCompanies },
        contact: { findMany: findContacts },
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
            value: [{ id: "probe-2" }]
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
                body: {
                  contentType: "text",
                  content: "Customer requested new lane pricing for LTL freight."
                },
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

  it("syncs every connected tenant user through the machine-triggerable tenant sync path", async () => {
    findMemberships.mockResolvedValue([
      {
        role: "ADMIN",
        user: {
          id: "user-1",
          email: "alex@newl.ca",
          name: "Alex",
          accounts: [{ id: "account-1" }]
        }
      },
      {
        role: "MANAGER",
        user: {
          id: "user-2",
          email: "ops@newl.ca",
          name: "Ops",
          accounts: [{ id: "account-2" }]
        }
      },
      {
        role: "SALES",
        user: {
          id: "user-3",
          email: "sales@newl.ca",
          name: "Sales",
          accounts: []
        }
      }
    ]);

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
    findAccount
      .mockResolvedValueOnce({
        id: "account-1",
        access_token: "access-token-1",
        refresh_token: "refresh-token-1",
        expires_at: 1_786_090_000,
        scope: "openid profile email offline_access User.Read Mail.Read Files.Read.All Sites.Read.All",
        token_type: "Bearer"
      })
      .mockResolvedValueOnce({
        id: "account-2",
        access_token: "access-token-2",
        refresh_token: "refresh-token-2",
        expires_at: 1_786_090_000,
        scope: "openid profile email offline_access User.Read Mail.Read Files.Read.All Sites.Read.All",
        token_type: "Bearer"
      });

    const upsert = vi.fn().mockResolvedValue({ id: "doc-1" });
    const deleteMany = vi.fn().mockResolvedValue({});
    const createMany = vi.fn().mockResolvedValue({});
    const deleteMemories = vi.fn().mockResolvedValue({});
    const createMemories = vi.fn().mockResolvedValue({});
    const findCompanies = vi.fn().mockResolvedValue([]);
    const findContacts = vi.fn().mockResolvedValue([]);
    transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) =>
      callback({
        company: { findMany: findCompanies },
        contact: { findMany: findContacts },
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
            value: [
              {
                id: "mail-1",
                subject: "Issue",
                bodyPreview: "Customer issue.",
                body: { contentType: "text", content: "Delay issue in Dallas." },
                receivedDateTime: "2026-06-25T10:00:00.000Z"
              }
            ]
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            value: [{ id: "probe-1" }]
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            value: [
              {
                id: "mail-2",
                subject: "Opportunity",
                bodyPreview: "New quote request.",
                body: { contentType: "text", content: "Need a quote for LTL freight." },
                receivedDateTime: "2026-06-25T11:00:00.000Z"
              }
            ]
          }),
          { status: 200 }
        )
      );

    const result = await syncTenantMicrosoftGraphAssistantKnowledge({
      tenantId: "tenant-1",
      tenantSlug: "tenant-1",
      tenantName: "Tenant 1"
    });

    expect(result).toMatchObject({
      connectedUserCount: 2,
      syncedUserCount: 2,
      skippedUserCount: 0,
      documentCount: 2,
      mailCount: 2,
      fileCount: 0,
      skipped: false
    });
    expect(result.userResults.map((entry) => entry.userEmail)).toEqual(["alex@newl.ca", "ops@newl.ca"]);

    fetchMock.mockRestore();
  });

  it("uses Microsoft Graph application permissions for admin-selected mailboxes", async () => {
    process.env.MICROSOFT_GRAPH_APP_CLIENT_ID = "graph-app-client";
    process.env.MICROSOFT_GRAPH_APP_CLIENT_SECRET = "graph-app-secret";
    process.env.MICROSOFT_GRAPH_APP_TENANT_ID = "graph-app-tenant";

    findIntegrationCredential.mockResolvedValue({
      provider: IntegrationProvider.MICROSOFT_GRAPH,
      status: IntegrationStatus.ACTIVE,
      publicConfig: {
        clientId: "client-id-1",
        tenantId: "tenant-id-1",
        redirectUri: "https://newl-apps.vercel.app/api/auth/callback/microsoft-entra-id",
        scopes: ["User.Read", "offline_access", "Mail.Read", "Files.Read.All", "Sites.Read.All"],
        adminMailboxTargets: ["shared@newl.ca", "ops@newl.ca"],
        mailboxAccessMode: "ADMIN_SELECTED_MAILBOXES",
        mailSyncEnabled: true,
        fileSyncEnabled: false,
        draftingEnabled: false
      }
    });

    const upsert = vi.fn().mockResolvedValue({ id: "doc-1" });
    const deleteMany = vi.fn().mockResolvedValue({});
    const createMany = vi.fn().mockResolvedValue({});
    const deleteMemories = vi.fn().mockResolvedValue({});
    const createMemories = vi.fn().mockResolvedValue({});
    const findCompanies = vi.fn().mockResolvedValue([]);
    const findContacts = vi.fn().mockResolvedValue([]);
    transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) =>
      callback({
        company: { findMany: findCompanies },
        contact: { findMany: findContacts },
        assistantKnowledgeDocument: { upsert },
        assistantKnowledgeChunk: { deleteMany, createMany },
        assistantMemory: { deleteMany: deleteMemories, createMany: createMemories }
      })
    );

    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);

      if (url.includes("/oauth2/v2.0/token")) {
        return new Response(JSON.stringify({ access_token: "application-token" }), { status: 200 });
      }

      if (url.includes("/users/shared%40newl.ca/messages?$top=1&$select=id")) {
        return new Response(JSON.stringify({ value: [{ id: "probe-shared" }] }), { status: 200 });
      }

      if (
        url.includes("/users/shared%40newl.ca/messages?") &&
        url.includes("$select=id,subject,bodyPreview,body,webLink,internetMessageId,conversationId,receivedDateTime,from,toRecipients,ccRecipients")
      ) {
        return new Response(
          JSON.stringify({
            value: [
              {
                id: "mail-1",
                subject: "Shared mailbox issue",
                bodyPreview: "Customer complaint.",
                body: { contentType: "text", content: "Delay issue for shipment 123." },
                receivedDateTime: "2026-06-25T10:00:00.000Z"
              }
            ]
          }),
          { status: 200 }
        );
      }

      if (url.includes("/users/ops%40newl.ca/messages?$top=1&$select=id")) {
        return new Response(JSON.stringify({ value: [{ id: "probe-ops" }] }), { status: 200 });
      }

      if (
        url.includes("/users/ops%40newl.ca/messages?") &&
        url.includes("$select=id,subject,bodyPreview,body,webLink,internetMessageId,conversationId,receivedDateTime,from,toRecipients,ccRecipients")
      ) {
        return new Response(
          JSON.stringify({
            value: [
              {
                id: "mail-2",
                subject: "Sales mailbox opportunity",
                bodyPreview: "Need pricing.",
                body: { contentType: "text", content: "Need a quote for LTL freight." },
                receivedDateTime: "2026-06-25T11:00:00.000Z"
              }
            ]
          }),
          { status: 200 }
        );
      }

      throw new Error(`Unexpected fetch URL in test: ${url}`);
    });

    const result = await syncTenantMicrosoftGraphAssistantKnowledge({
      tenantId: "tenant-1",
      tenantSlug: "tenant-1",
      tenantName: "Tenant 1"
    });

    expect(result).toMatchObject({
      connectedUserCount: 2,
      syncedUserCount: 2,
      skippedUserCount: 0,
      documentCount: 2,
      mailCount: 2,
      fileCount: 0,
      skipped: false
    });
    expect(findMemberships).not.toHaveBeenCalled();
    expect(findAccount).not.toHaveBeenCalled();
    expect(upsert.mock.calls[0][0].create.externalId).toBe("ops@newl.ca:mail-2");
    expect(upsert.mock.calls[1][0].create.externalId).toBe("shared@newl.ca:mail-1");

    fetchMock.mockRestore();
    delete process.env.MICROSOFT_GRAPH_APP_CLIENT_ID;
    delete process.env.MICROSOFT_GRAPH_APP_CLIENT_SECRET;
    delete process.env.MICROSOFT_GRAPH_APP_TENANT_ID;
  });

  it("reuses the Microsoft Entra auth app credentials for admin-selected mailbox sync when dedicated app env vars are not set", async () => {
    delete process.env.MICROSOFT_GRAPH_APP_CLIENT_ID;
    delete process.env.MICROSOFT_GRAPH_APP_CLIENT_SECRET;
    delete process.env.MICROSOFT_GRAPH_APP_TENANT_ID;
    process.env.AUTH_MICROSOFT_ENTRA_ID_ID = "entra-client";
    process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET = "entra-secret";
    process.env.AZURE_AD_TENANT_ID = "entra-tenant";

    findIntegrationCredential.mockResolvedValue({
      provider: IntegrationProvider.MICROSOFT_GRAPH,
      status: IntegrationStatus.ACTIVE,
      publicConfig: {
        adminMailboxTargets: ["dispatch@newl.ca"],
        mailboxAccessMode: "ADMIN_SELECTED_MAILBOXES",
        mailSyncEnabled: true,
        fileSyncEnabled: false,
        draftingEnabled: false
      }
    });

    const upsert = vi.fn().mockResolvedValue({ id: "doc-1" });
    const deleteMany = vi.fn().mockResolvedValue({});
    const createMany = vi.fn().mockResolvedValue({});
    const deleteMemories = vi.fn().mockResolvedValue({});
    const createMemories = vi.fn().mockResolvedValue({});
    const findCompanies = vi.fn().mockResolvedValue([]);
    const findContacts = vi.fn().mockResolvedValue([]);
    transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) =>
      callback({
        company: { findMany: findCompanies },
        contact: { findMany: findContacts },
        assistantKnowledgeDocument: { upsert },
        assistantKnowledgeChunk: { deleteMany, createMany },
        assistantMemory: { deleteMany: deleteMemories, createMany: createMemories }
      })
    );

    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);

      if (url.includes("/oauth2/v2.0/token")) {
        return new Response(JSON.stringify({ access_token: "application-token" }), { status: 200 });
      }

      if (url.includes("/users/dispatch%40newl.ca/messages?$top=1&$select=id")) {
        return new Response(JSON.stringify({ value: [{ id: "probe-dispatch" }] }), { status: 200 });
      }

      if (
        url.includes("/users/dispatch%40newl.ca/messages?") &&
        url.includes("$select=id,subject,bodyPreview,body,webLink,internetMessageId,conversationId,receivedDateTime,from,toRecipients,ccRecipients")
      ) {
        return new Response(
          JSON.stringify({
            value: [
              {
                id: "mail-1",
                subject: "Dispatch mailbox issue",
                bodyPreview: "Customer complaint.",
                body: { contentType: "text", content: "Delay issue for shipment 123." },
                receivedDateTime: "2026-06-25T10:00:00.000Z"
              }
            ]
          }),
          { status: 200 }
        );
      }

      throw new Error(`Unexpected fetch URL in test: ${url}`);
    });

    const result = await syncTenantMicrosoftGraphAssistantKnowledge({
      tenantId: "tenant-1",
      tenantSlug: "tenant-1",
      tenantName: "Tenant 1"
    });

    expect(result).toMatchObject({
      documentCount: 1,
      mailCount: 1,
      fileCount: 0,
      skipped: false
    });
    expect(fetchMock.mock.calls[0]?.[0]).toContain("/entra-tenant/oauth2/v2.0/token");

    fetchMock.mockRestore();
  });

  it("resolves valid mailbox aliases when Graph rejects the raw mailbox target as an invalid user", async () => {
    process.env.MICROSOFT_GRAPH_APP_CLIENT_ID = "graph-app-client";
    process.env.MICROSOFT_GRAPH_APP_CLIENT_SECRET = "graph-app-secret";
    process.env.MICROSOFT_GRAPH_APP_TENANT_ID = "graph-app-tenant";

    findIntegrationCredential.mockResolvedValue({
      provider: IntegrationProvider.MICROSOFT_GRAPH,
      status: IntegrationStatus.ACTIVE,
      publicConfig: {
        adminMailboxTargets: ["sales@newl.ca"],
        mailboxAccessMode: "ADMIN_SELECTED_MAILBOXES",
        mailSyncEnabled: true,
        fileSyncEnabled: false,
        draftingEnabled: false
      }
    });

    const upsert = vi.fn().mockResolvedValue({ id: "doc-1" });
    const deleteMany = vi.fn().mockResolvedValue({});
    const createMany = vi.fn().mockResolvedValue({});
    const deleteMemories = vi.fn().mockResolvedValue({});
    const createMemories = vi.fn().mockResolvedValue({});
    const findCompanies = vi.fn().mockResolvedValue([]);
    const findContacts = vi.fn().mockResolvedValue([]);
    transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) =>
      callback({
        company: { findMany: findCompanies },
        contact: { findMany: findContacts },
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
            access_token: "application-token"
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: {
              code: "ErrorInvalidUser",
              message: "The requested user 'sales@newl.ca' is invalid."
            }
          }),
          { status: 404 }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            value: [
              {
                id: "user-sales-1",
                mail: "sales@newlgroup.com",
                userPrincipalName: "sales@newlgroup.onmicrosoft.com",
                proxyAddresses: ["SMTP:sales@newlgroup.com", "smtp:sales@newl.ca"]
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
                id: "mail-1",
                subject: "Sales mailbox quote request",
                bodyPreview: "Need pricing.",
                body: { contentType: "text", content: "Need a quote for LTL freight." },
                receivedDateTime: "2026-06-25T11:00:00.000Z"
              }
            ]
          }),
          { status: 200 }
        )
      );

    const result = await syncTenantMicrosoftGraphAssistantKnowledge({
      tenantId: "tenant-1",
      tenantSlug: "tenant-1",
      tenantName: "Tenant 1"
    });

    expect(result).toMatchObject({
      documentCount: 1,
      mailCount: 1,
      fileCount: 0,
      skipped: false
    });
    expect(fetchMock.mock.calls[3]?.[0]).toContain("users/user-sales-1/messages");

    fetchMock.mockRestore();
    delete process.env.MICROSOFT_GRAPH_APP_CLIENT_ID;
    delete process.env.MICROSOFT_GRAPH_APP_CLIENT_SECRET;
    delete process.env.MICROSOFT_GRAPH_APP_TENANT_ID;
  });

  it("paginates mailbox messages within the configured lookback window", async () => {
    process.env.MICROSOFT_GRAPH_APP_CLIENT_ID = "graph-app-client";
    process.env.MICROSOFT_GRAPH_APP_CLIENT_SECRET = "graph-app-secret";
    process.env.MICROSOFT_GRAPH_APP_TENANT_ID = "graph-app-tenant";

    findIntegrationCredential.mockResolvedValue({
      provider: IntegrationProvider.MICROSOFT_GRAPH,
      status: IntegrationStatus.ACTIVE,
      publicConfig: {
        adminMailboxTargets: ["dispatch@newl.ca"],
        mailboxAccessMode: "ADMIN_SELECTED_MAILBOXES",
        mailLookbackDays: 120,
        maxMailMessagesPerMailbox: 2,
        mailSyncEnabled: true,
        fileSyncEnabled: false,
        draftingEnabled: false
      }
    });

    const upsert = vi.fn().mockResolvedValue({ id: "doc-1" });
    const deleteMany = vi.fn().mockResolvedValue({});
    const createMany = vi.fn().mockResolvedValue({});
    const deleteMemories = vi.fn().mockResolvedValue({});
    const createMemories = vi.fn().mockResolvedValue({});
    const findCompanies = vi.fn().mockResolvedValue([]);
    const findContacts = vi.fn().mockResolvedValue([]);
    transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) =>
      callback({
        company: { findMany: findCompanies },
        contact: { findMany: findContacts },
        assistantKnowledgeDocument: { upsert },
        assistantKnowledgeChunk: { deleteMany, createMany },
        assistantMemory: { deleteMany: deleteMemories, createMany: createMemories }
      })
    );

    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);

      if (url.includes("/oauth2/v2.0/token")) {
        return new Response(JSON.stringify({ access_token: "application-token" }), { status: 200 });
      }

      if (url.includes("/users/dispatch%40newl.ca/messages?$top=1&$select=id")) {
        return new Response(JSON.stringify({ value: [{ id: "probe-dispatch" }] }), { status: 200 });
      }

      if (url.includes("$top=2") && url.includes("$filter=receivedDateTime%20ge")) {
        return new Response(
          JSON.stringify({
            value: [
              {
                id: "mail-page-1",
                subject: "First dispatch issue",
                bodyPreview: "First issue.",
                body: { contentType: "text", content: "First customer delay issue." },
                receivedDateTime: "2026-06-25T10:00:00.000Z"
              }
            ],
            "@odata.nextLink": "https://graph.microsoft.com/v1.0/users/dispatch/messages?page=2"
          }),
          { status: 200 }
        );
      }

      if (url.includes("page=2")) {
        return new Response(
          JSON.stringify({
            value: [
              {
                id: "mail-page-2",
                subject: "Second dispatch opportunity",
                bodyPreview: "Need a quote.",
                body: { contentType: "text", content: "Second customer needs a quote for LTL." },
                receivedDateTime: "2026-06-24T10:00:00.000Z"
              }
            ]
          }),
          { status: 200 }
        );
      }

      throw new Error(`Unexpected fetch URL in test: ${url}`);
    });

    const result = await syncTenantMicrosoftGraphAssistantKnowledge({
      tenantId: "tenant-1",
      tenantSlug: "tenant-1",
      tenantName: "Tenant 1"
    });

    expect(result).toMatchObject({
      documentCount: 2,
      mailCount: 2,
      skipped: false
    });
    expect(fetchMock.mock.calls.some((call) => String(call[0]).includes("page=2"))).toBe(true);

    fetchMock.mockRestore();
    delete process.env.MICROSOFT_GRAPH_APP_CLIENT_ID;
    delete process.env.MICROSOFT_GRAPH_APP_CLIENT_SECRET;
    delete process.env.MICROSOFT_GRAPH_APP_TENANT_ID;
  });

  it("returns a structured skip reason when application mailbox token retrieval fails", async () => {
    process.env.MICROSOFT_GRAPH_APP_CLIENT_ID = "graph-app-client";
    process.env.MICROSOFT_GRAPH_APP_CLIENT_SECRET = "graph-app-secret";
    process.env.MICROSOFT_GRAPH_APP_TENANT_ID = "graph-app-tenant";

    findIntegrationCredential.mockResolvedValue({
      provider: IntegrationProvider.MICROSOFT_GRAPH,
      status: IntegrationStatus.ACTIVE,
      publicConfig: {
        adminMailboxTargets: ["ops@newl.ca"],
        mailboxAccessMode: "ADMIN_SELECTED_MAILBOXES",
        mailSyncEnabled: true,
        fileSyncEnabled: false,
        draftingEnabled: false
      }
    });

    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          error: "invalid_client",
          error_description: "Client authentication failed."
        }),
        { status: 401 }
      )
    );

    const result = await syncTenantMicrosoftGraphAssistantKnowledge({
      tenantId: "tenant-1",
      tenantSlug: "tenant-1",
      tenantName: "Tenant 1"
    });

    expect(result).toMatchObject({
      documentCount: 0,
      mailCount: 0,
      fileCount: 0,
      skipped: true,
      connectedUserCount: 0,
      syncedUserCount: 0
    });
    expect(result.reason).toContain("Client authentication failed");
    expect(findMemberships).not.toHaveBeenCalled();

    fetchMock.mockRestore();
    delete process.env.MICROSOFT_GRAPH_APP_CLIENT_ID;
    delete process.env.MICROSOFT_GRAPH_APP_CLIENT_SECRET;
    delete process.env.MICROSOFT_GRAPH_APP_TENANT_ID;
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
      new Map([["MICROSOFT_GRAPH_MAIL:mail-1", "doc-1"]]),
      {
        companiesByDomain: new Map(),
        companiesByNormalizedName: new Map(),
        contactsByEmail: new Map()
      }
    );

    expect(memories.some((memory) => memory.kind === "CUSTOMER_PROFILE" && memory.summary.includes("shipping@acme.com"))).toBe(true);
    expect(memories.some((memory) => memory.kind === "SERVICE_CAPABILITY" && memory.summary.toLowerCase().includes("ltl"))).toBe(true);
    expect(memories.some((memory) => memory.kind === "OPERATIONAL_RISK")).toBe(true);
    expect(memories.some((memory) => memory.kind === "SALES_OPPORTUNITY")).toBe(true);
  });

  it("reconciles repeated email memories onto existing company and contact records", () => {
    const memories = buildMicrosoftGraphMemoriesFromDocuments(
      [
        {
          sourceKind: AssistantSourceKind.EMAIL,
          sourceSystem: "MICROSOFT_GRAPH_MAIL",
          externalId: "mail-1",
          title: "Lane request",
          sourceUpdatedAt: new Date("2026-06-25T10:00:00.000Z"),
          metadata: {
            fromName: "Acme Imports",
            fromAddress: "shipping@acme.com"
          },
          content: "From: Acme Imports <shipping@acme.com>. LTL request. Call 555-222-3333."
        },
        {
          sourceKind: AssistantSourceKind.EMAIL,
          sourceSystem: "MICROSOFT_GRAPH_MAIL",
          externalId: "mail-2",
          title: "Warehouse follow up",
          sourceUpdatedAt: new Date("2026-06-25T11:00:00.000Z"),
          metadata: {
            fromName: "Acme Imports",
            fromAddress: "shipping@acme.com"
          },
          content: "From: Acme Imports <shipping@acme.com>. Need warehousing support. https://acme.com"
        }
      ],
      new Map([
        ["MICROSOFT_GRAPH_MAIL:mail-1", "doc-1"],
        ["MICROSOFT_GRAPH_MAIL:mail-2", "doc-2"]
      ]),
      {
        companiesByDomain: new Map([
          ["acme.com", { id: "company-1", name: "Acme Imports", domain: "acme.com" }]
        ]),
        companiesByNormalizedName: new Map([
          ["acme imports", { id: "company-1", name: "Acme Imports", domain: "acme.com" }]
        ]),
        contactsByEmail: new Map([
          [
            "shipping@acme.com",
            {
              id: "contact-1",
              fullName: "Shipping Desk",
              email: "shipping@acme.com",
              companyId: "company-1",
              companyName: "Acme Imports"
            }
          ]
        ])
      }
    );

    expect(memories.some((memory) => memory.subjectType === "Contact" && memory.subjectId === "contact-1")).toBe(true);
    expect(memories.some((memory) => memory.subjectType === "Company" && memory.subjectId === "company-1")).toBe(true);
    expect(
      memories.some(
        (memory) =>
          memory.kind === "SERVICE_CAPABILITY" &&
          memory.summary.toLowerCase().includes("ltl") &&
          memory.summary.toLowerCase().includes("warehousing")
      )
    ).toBe(true);
  });
});
