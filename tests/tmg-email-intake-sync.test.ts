import { beforeEach, describe, expect, it, vi } from "vitest";

const batchTable = vi.hoisted(() => ({ findMany: vi.fn() }));
const auditTable = vi.hoisted(() => ({ create: vi.fn() }));
const getSettings = vi.hoisted(() => vi.fn());
const getAccessToken = vi.hoisted(() => vi.fn());
const fetchMessages = vi.hoisted(() => vi.fn());
const fetchAttachmentMetadata = vi.hoisted(() => vi.fn());

vi.mock("@/server/db", () => ({
  prisma: {
    tmgOrderIntakeBatch: batchTable,
    auditLog: auditTable
  }
}));
vi.mock("@/modules/shipment-documents/tmg-settings", () => ({ getTmgOrderIntakeSettings: getSettings }));
vi.mock("@/server/integrations/microsoft-graph-application", () => ({
  getMicrosoftGraphApplicationAccessToken: getAccessToken
}));
vi.mock("@/server/integrations/microsoft-graph-mail", () => ({
  fetchMicrosoftGraphMailboxMessages: fetchMessages,
  fetchMicrosoftGraphMessageAttachments: fetchAttachmentMetadata,
  fetchMicrosoftGraphMessageAttachmentContent: vi.fn()
}));

import { syncTmgEmailIntake } from "@/modules/shipment-documents/tmg-email-intake";

describe("TMG email intake synchronization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSettings.mockResolvedValue({
      enabled: true,
      configured: true,
      mailboxAddress: "csr@example.com",
      lookbackDays: 14,
      maxMessagesPerScan: 50,
      allowedSenderAddresses: ["orders@customer.example"],
      requiredRecipientAddresses: ["csr@example.com"],
      subjectPrefix: "TMG synthetic shipment-",
      teamship: { customerId: "1001" },
      configurationIssues: []
    });
    getAccessToken.mockResolvedValue("synthetic-access-token");
    fetchMessages.mockResolvedValue([{
      id: "graph-message-new",
      internetMessageId: "<stable-message@example.com>",
      subject: "TMG synthetic shipment-2026-09-04",
      receivedDateTime: "2026-09-03T17:00:00.000Z",
      hasAttachments: true,
      from: { emailAddress: { address: "orders@customer.example" } },
      toRecipients: [{ emailAddress: { address: "csr@example.com" } }],
      ccRecipients: []
    }]);
    batchTable.findMany.mockResolvedValue([{
      graphMessageId: "graph-message-old",
      internetMessageId: "<stable-message@example.com>"
    }]);
    auditTable.create.mockResolvedValue({ id: "audit-example" });
  });

  it("skips a mailbox-scoped stable message duplicate before attachment retrieval", async () => {
    const result = await syncTmgEmailIntake({
      tenantId: "tenant-example",
      tenantSlug: "synthetic",
      tenantName: "Synthetic Tenant",
      userId: "system:tmg-email-intake",
      userEmail: "system@example.com",
      userName: "Synthetic System",
      role: "ADMIN"
    });

    expect(batchTable.findMany).toHaveBeenCalledWith({
      where: {
        tenantId: "tenant-example",
        mailboxAddress: "csr@example.com",
        OR: [
          { graphMessageId: { in: ["graph-message-new"] } },
          { internetMessageId: { in: ["<stable-message@example.com>"], mode: "insensitive" } }
        ]
      },
      select: { graphMessageId: true, internetMessageId: true }
    });
    expect(fetchAttachmentMetadata).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      existingCandidateCount: 1,
      selectedCandidateCount: 0,
      deferredCandidateCount: 0,
      results: [],
      failures: []
    });
    expect(auditTable.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ tenantId: "tenant-example" })
    }));
  });
});
