import { readFileSync } from "node:fs";
import { describe, expect, it, beforeEach, vi } from "vitest";
import { IntegrationProvider, IntegrationStatus, PlatformRole } from "@prisma/client";

const prismaMock = vi.hoisted(() => ({
  integrationCredential: { findFirst: vi.fn() },
  shipmentInquiryAutomationJob: { findUnique: vi.fn(), create: vi.fn() },
  auditLog: { create: vi.fn() },
  tenantModuleAccess: { findFirst: vi.fn() },
  tenantRoleModuleAccess: { findMany: vi.fn() },
  tenantRolePolicy: { findUnique: vi.fn() }
}));
const getMicrosoftGraphApplicationAccessTokenMock = vi.hoisted(() => vi.fn());
const resolveMicrosoftGraphMailboxFolderPathMock = vi.hoisted(() => vi.fn());
const fetchMicrosoftGraphMailboxFolderMessagesMock = vi.hoisted(() => vi.fn());

vi.mock("@/server/db", () => ({ prisma: prismaMock }));
vi.mock("@/server/integrations/microsoft-graph-application", () => ({
  getMicrosoftGraphApplicationAccessToken: getMicrosoftGraphApplicationAccessTokenMock
}));
vi.mock("@/server/integrations/microsoft-graph-mail", async () => {
  const actual = await vi.importActual<typeof import("@/server/integrations/microsoft-graph-mail")>(
    "@/server/integrations/microsoft-graph-mail"
  );

  return {
    ...actual,
    resolveMicrosoftGraphMailboxFolderPath: resolveMicrosoftGraphMailboxFolderPathMock,
    fetchMicrosoftGraphMailboxFolderMessages: fetchMicrosoftGraphMailboxFolderMessagesMock
  };
});

import {
  persistShipmentInquiryMessages,
  syncShipmentInquiryOutlookIntake,
  syncShipmentInquiryOutlookIntakeForUser
} from "@/modules/shipment-inquiries/outlook-intake";

const context = {
  tenantId: "tenant-a",
  tenantSlug: "newl-group",
  tenantName: "Newl Group",
  userId: "user-a",
  userEmail: "ops@newl.ca",
  userName: "Ops User",
  role: PlatformRole.ADMIN
};

describe("shipment inquiry Outlook intake", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.AUTH_MICROSOFT_ENTRA_ID_ID = "client-id";
    process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET = "client-secret";
    process.env.AZURE_AD_TENANT_ID = "tenant-id";
    process.env.AUTH_URL = "https://newl-apps.test";
    prismaMock.integrationCredential.findFirst.mockResolvedValue({
      provider: IntegrationProvider.MICROSOFT_GRAPH,
      status: IntegrationStatus.ACTIVE,
      publicConfig: {
        mailboxAccessMode: "ADMIN_SELECTED_MAILBOXES",
        adminMailboxTargets: ["pricing@newl.ca", "dispatch@newl.ca"],
        mailSyncEnabled: true,
        fileSyncEnabled: false,
        draftingEnabled: false,
        mailLookbackDays: 30,
        maxMailMessagesPerMailbox: 10
      }
    });
    prismaMock.shipmentInquiryAutomationJob.findUnique.mockResolvedValue(null);
    prismaMock.shipmentInquiryAutomationJob.create.mockResolvedValue({});
    prismaMock.auditLog.create.mockResolvedValue({});
    prismaMock.tenantModuleAccess.findFirst.mockResolvedValue({ id: "access-1" });
    prismaMock.tenantRoleModuleAccess.findMany.mockResolvedValue([
      { enabled: true, module: { key: "OCEAN_FREIGHT_PRICING" } }
    ]);
    prismaMock.tenantRolePolicy.findUnique.mockResolvedValue({ canMutate: true });
    getMicrosoftGraphApplicationAccessTokenMock.mockResolvedValue("graph-token");
    resolveMicrosoftGraphMailboxFolderPathMock.mockImplementation(async (_token, mailbox) => ({
      mailboxPath: `users/${mailbox}`,
      folder: { id: `${mailbox}-automation-folder`, displayName: "Automation" },
      messagesPath: `users/${mailbox}/mailFolders/${mailbox}-automation-folder/messages`
    }));
    fetchMicrosoftGraphMailboxFolderMessagesMock.mockImplementation(async (_token, mailbox) => [
      buildMessage(`${mailbox}-message-1`, mailbox)
    ]);
  });

  it("resolves Inbox/Automation and queues Pricing mailbox messages", async () => {
    await syncShipmentInquiryOutlookIntake(context, { maxMessagesPerMailbox: 5 });

    expect(resolveMicrosoftGraphMailboxFolderPathMock).toHaveBeenCalledWith("graph-token", "pricing@newl.ca", [
      "Inbox",
      "Automation"
    ]);
    expect(fetchMicrosoftGraphMailboxFolderMessagesMock).toHaveBeenCalledWith(
      "graph-token",
      "pricing@newl.ca",
      "pricing@newl.ca-automation-folder",
      { maxMessagesPerMailbox: 5 }
    );
    expect(prismaMock.shipmentInquiryAutomationJob.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: "tenant-a",
        mailboxAddress: "pricing@newl.ca",
        graphFolderId: "pricing@newl.ca-automation-folder",
        graphMessageId: "pricing@newl.ca-message-1",
        status: "PENDING",
        normalizedBodyText: "Need a quote from Toronto to Dallas."
      })
    });
  });

  it("resolves Inbox/Automation and queues Dispatch mailbox messages", async () => {
    await syncShipmentInquiryOutlookIntake(context);

    expect(prismaMock.shipmentInquiryAutomationJob.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        mailboxAddress: "dispatch@newl.ca",
        graphFolderId: "dispatch@newl.ca-automation-folder",
        graphMessageId: "dispatch@newl.ca-message-1"
      })
    });
  });

  it("records a mailbox-specific failure when Inbox/Automation is missing", async () => {
    resolveMicrosoftGraphMailboxFolderPathMock.mockImplementation(async (_token, mailbox) => {
      if (mailbox === "pricing@newl.ca") {
        throw new Error("Microsoft Graph mailbox pricing@newl.ca does not contain required mail folder Inbox/Automation.");
      }
      return {
        mailboxPath: `users/${mailbox}`,
        folder: { id: "dispatch-folder", displayName: "Automation" },
        messagesPath: `users/${mailbox}/mailFolders/dispatch-folder/messages`
      };
    });

    const result = await syncShipmentInquiryOutlookIntake(context);

    expect(result.failureCount).toBe(1);
    expect(result.mailboxes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          mailbox: "pricing@newl.ca",
          failure: expect.stringContaining("Inbox/Automation")
        }),
        expect.objectContaining({
          mailbox: "dispatch@newl.ca",
          failure: null
        })
      ])
    );
    expect(prismaMock.shipmentInquiryAutomationJob.create).toHaveBeenCalledTimes(1);
  });

  it("skips duplicate Graph message IDs", async () => {
    prismaMock.shipmentInquiryAutomationJob.findUnique.mockResolvedValue({ id: "existing-job" });

    const result = await persistShipmentInquiryMessages({
      tenantId: "tenant-a",
      mailboxAddress: "pricing@newl.ca",
      graphFolderId: "folder-1",
      messages: [buildMessage("message-1", "pricing@newl.ca")]
    });

    expect(result).toMatchObject({ createdCount: 0, skippedDuplicateCount: 1 });
    expect(prismaMock.shipmentInquiryAutomationJob.create).not.toHaveBeenCalled();
  });

  it("uses tenant scope in duplicate checks and created records", async () => {
    await persistShipmentInquiryMessages({
      tenantId: "tenant-b",
      mailboxAddress: "pricing@newl.ca",
      graphFolderId: "folder-1",
      messages: [buildMessage("message-1", "pricing@newl.ca")]
    });

    expect(prismaMock.shipmentInquiryAutomationJob.findUnique).toHaveBeenCalledWith({
      where: {
        tenantId_mailboxAddress_graphMessageId: {
          tenantId: "tenant-b",
          mailboxAddress: "pricing@newl.ca",
          graphMessageId: "message-1"
        }
      },
      select: { id: true }
    });
    expect(prismaMock.shipmentInquiryAutomationJob.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ tenantId: "tenant-b" })
    });
  });

  it("requires the existing ocean freight pricing module and mutation access for manual sync", async () => {
    await syncShipmentInquiryOutlookIntakeForUser(context);

    expect(prismaMock.tenantModuleAccess.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ tenantId: "tenant-a", module: { key: "OCEAN_FREIGHT_PRICING" } })
      })
    );
  });

  it("continues later mailboxes when one mailbox Graph call fails", async () => {
    fetchMicrosoftGraphMailboxFolderMessagesMock.mockImplementation(async (_token, mailbox) => {
      if (mailbox === "pricing@newl.ca") {
        throw new Error("Graph unavailable for pricing.");
      }
      return [buildMessage("dispatch-message-1", "dispatch@newl.ca")];
    });

    const result = await syncShipmentInquiryOutlookIntake(context);

    expect(result).toMatchObject({
      failureCount: 1,
      createdCount: 1
    });
    expect(prismaMock.shipmentInquiryAutomationJob.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ mailboxAddress: "dispatch@newl.ca" })
    });
  });

  it("does not depend on Gmail, OpenAI, TMS, TradeMining, or 7L", () => {
    const source = readFileSync("src/modules/shipment-inquiries/outlook-intake.ts", "utf8").toLowerCase();

    expect(source).not.toContain("gmail");
    expect(source).not.toContain("openai");
    expect(source).not.toContain("tms");
    expect(source).not.toContain("trademining");
    expect(source).not.toContain("seven");
    expect(source).not.toContain("7l");
  });
});

function buildMessage(id: string, mailbox: string) {
  return {
    id,
    mailboxAddress: mailbox,
    subject: "Shipment quote request",
    bodyPreview: "Need a quote",
    body: { contentType: "text", content: "Need a quote from Toronto to Dallas." },
    internetMessageId: `<${id}@example.test>`,
    conversationId: `conversation-${id}`,
    receivedDateTime: "2026-07-22T14:00:00.000Z",
    from: { emailAddress: { name: "Customer User", address: "customer@example.test" } }
  };
}
