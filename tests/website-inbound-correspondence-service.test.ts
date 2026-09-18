import { beforeEach, describe, expect, it, vi } from "vitest";
import { WebsiteInboundEmailStatus } from "@prisma/client";

const db = vi.hoisted(() => ({
  integrationCredential: { findFirst: vi.fn() },
  membership: { findMany: vi.fn() },
  websiteInboundEmailMessage: {
    findFirst: vi.fn(),
    updateMany: vi.fn(),
    update: vi.fn()
  },
  websiteInboundSubmission: { update: vi.fn() },
  auditLog: { create: vi.fn() }
}));
const transaction = vi.hoisted(() => vi.fn());
const graph = vi.hoisted(() => ({ send: vi.fn(), reply: vi.fn(), token: vi.fn() }));

vi.mock("@/server/db", () => ({ prisma: { ...db, $transaction: transaction } }));
vi.mock("@/server/integrations/microsoft-graph", () => ({
  MICROSOFT_GRAPH_CREDENTIAL_NAME: "Microsoft 365 Assistant",
  parseMicrosoftGraphSettings: () => ({
    adminMailboxTargets: ["shared@example.com"],
    inboundOwnerMailboxTargets: ["owner@example.com"],
    mailboxAccessMode: "ADMIN_SELECTED_MAILBOXES",
    mailSyncEnabled: true,
    inboundCorrespondenceEnabled: true,
    draftingEnabled: true,
    applicationMailboxRuntimeReady: true,
    crossMailboxReady: true,
    runtimeNotes: "Ready"
  })
}));
vi.mock("@/server/integrations/microsoft-graph-application", () => ({
  getMicrosoftGraphApplicationAccessToken: graph.token
}));
vi.mock("@/server/integrations/microsoft-graph-mail", () => ({
  createAndSendMicrosoftGraphMailboxMessage: graph.send,
  replyToMicrosoftGraphMailboxMessage: graph.reply,
  fetchMicrosoftGraphMailboxCorrespondenceMessages: vi.fn()
}));

import {
  getWebsiteInboundMailboxConfiguration,
  sendWebsiteInboundEmailDraft
} from "@/modules/website-inbound/correspondence";

const ownerContext = {
  tenantId: "tenant-a",
  tenantSlug: "synthetic",
  tenantName: "Synthetic",
  userId: "owner-a",
  userName: "Owner",
  userEmail: "owner@example.com",
  role: "ADMIN" as const
};
const draft = {
  id: "draft-a",
  tenantId: "tenant-a",
  submissionId: "lead-a",
  status: WebsiteInboundEmailStatus.DRAFT,
  mailboxAddress: "owner@example.com",
  recipients: [{ address: "buyer@example.com" }],
  createdAt: new Date("2026-09-18T12:00:00Z"),
  basedOnMessageId: null,
  submission: {
    id: "lead-a",
    ownerUserId: "owner-a",
    email: "buyer@example.com",
    name: "Buyer",
    status: "NEW",
    communicationMailbox: null,
    owner: { userId: "owner-a", user: { email: "owner@example.com" } }
  }
};

beforeEach(() => {
  vi.resetAllMocks();
  db.integrationCredential.findFirst.mockResolvedValue({ status: "ACTIVE" });
  db.membership.findMany.mockResolvedValue([
    { userId: "owner-a", user: { email: "owner@example.com" } }
  ]);
  db.websiteInboundEmailMessage.updateMany.mockResolvedValue({ count: 1 });
  db.websiteInboundEmailMessage.update.mockResolvedValue({});
  db.websiteInboundSubmission.update.mockResolvedValue({});
  db.auditLog.create.mockResolvedValue({});
  graph.token.mockResolvedValue("token");
  graph.send.mockResolvedValue({ id: null, conversationId: null, internetMessageId: null });
  transaction.mockImplementation(
    async (operations: Promise<unknown>[] | ((tx: typeof db) => Promise<unknown>)) =>
      typeof operations === "function" ? operations(db) : Promise.all(operations)
  );
});

describe("approved inbound email sends", () => {
  it("uses the dedicated inbound owner allowlist instead of Assistant mailboxes", async () => {
    db.membership.findMany.mockResolvedValue([
      { userId: "owner-a", user: { email: "owner@example.com" } },
      { userId: "shared-user", user: { email: "shared@example.com" } }
    ]);

    await expect(getWebsiteInboundMailboxConfiguration("tenant-a")).resolves.toMatchObject({
      enabled: true,
      mailboxes: ["owner@example.com"],
      ownerMailboxes: { "owner-a": "owner@example.com" }
    });
  });

  it("rejects approval by anyone except the assigned owner", async () => {
    db.websiteInboundEmailMessage.findFirst.mockResolvedValueOnce(draft);
    await expect(
      sendWebsiteInboundEmailDraft(
        { ...ownerContext, userId: "other-user", userEmail: "other@example.com" },
        { draftId: "draft-a", subject: "Re: Request", body: "Reviewed response" }
      )
    ).rejects.toThrow("Only the assigned owner");
    expect(graph.send).not.toHaveBeenCalled();
  });

  it("invalidates a draft when newer correspondence exists", async () => {
    db.websiteInboundEmailMessage.findFirst
      .mockResolvedValueOnce(draft)
      .mockResolvedValueOnce({ id: "newer-message" });
    await expect(
      sendWebsiteInboundEmailDraft(ownerContext, {
        draftId: "draft-a",
        subject: "Re: Request",
        body: "Reviewed response"
      })
    ).rejects.toThrow("New correspondence arrived");
    expect(db.websiteInboundEmailMessage.updateMany).not.toHaveBeenCalled();
    expect(graph.send).not.toHaveBeenCalled();
  });

  it("uses the server-selected owner mailbox and saved opportunity recipient", async () => {
    db.websiteInboundEmailMessage.findFirst
      .mockResolvedValueOnce(draft)
      .mockResolvedValueOnce(null);
    await sendWebsiteInboundEmailDraft(ownerContext, {
      draftId: "draft-a",
      subject: "Re: Request",
      body: "Reviewed response"
    });
    expect(db.websiteInboundEmailMessage.findFirst).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ where: { tenantId: "tenant-a", id: "draft-a" } })
    );
    expect(graph.send).toHaveBeenCalledWith("token", "owner@example.com", {
      recipientEmail: "buyer@example.com",
      recipientName: "Buyer",
      subject: "Re: Request",
      body: "Reviewed response"
    });
  });
});
