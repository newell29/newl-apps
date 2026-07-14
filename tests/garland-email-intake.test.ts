import { describe, expect, it, beforeEach, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  garlandSourceEmail: { findUnique: vi.fn(), upsert: vi.fn(), findMany: vi.fn(), count: vi.fn() },
  garlandSourceAttachment: { findUnique: vi.fn(), upsert: vi.fn() },
  garlandEmailSyncRun: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
  integrationCredential: { findFirst: vi.fn() },
  auditLog: { create: vi.fn() },
  tenantModuleAccess: { findFirst: vi.fn() },
  tenantRoleModuleAccess: { findMany: vi.fn() },
  tenantRolePolicy: { findUnique: vi.fn() }
}));

vi.mock("@/server/db", () => ({ prisma: prismaMock }));

import {
  classifyGarlandEmail,
  groupGarlandEmailIntake,
  persistGarlandSourceEmails
} from "@/modules/shipment-documents/garland-email-intake";

describe("Garland email intake", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.garlandSourceEmail.findUnique.mockResolvedValue(null);
    prismaMock.garlandSourceEmail.upsert.mockImplementation(async ({ create }) => ({
      id: `source-${create.graphMessageId}`,
      ...create
    }));
    prismaMock.garlandSourceAttachment.findUnique.mockResolvedValue(null);
    prismaMock.garlandSourceAttachment.upsert.mockResolvedValue({});
  });

  it("classifies Garland PDF batch emails from subject, sender, and attachments", () => {
    const result = classifyGarlandEmail({
      subject: "RE: 12 ORDERS 13 PAGES - PS210235 - PS210246",
      bodyText: "Pls see attached.",
      fromAddress: "Ruqsonna.Alvi@garland-group.com",
      attachments: [{ name: "12 ORDERS 13 PAGES - PS210235 - PS210246.pdf", contentType: "application/pdf" }]
    });

    expect(result).toMatchObject({
      classification: "GARLAND_DOCUMENT_BATCH",
      expectedOrderCount: 12,
      expectedPageCount: 13,
      expectedPsStart: "PS210235",
      expectedPsEnd: "PS210246",
      hasPdfAttachment: true
    });
    expect(result.score).toBeGreaterThanOrEqual(90);
  });

  it("separates Garland follow-up emails from document batches when there is no PDF", () => {
    const result = classifyGarlandEmail({
      subject: "RE: 12 ORDERS 13 PAGES - PS210235 - PS210246",
      bodyText: "One shipment is delayed and will follow.",
      fromAddress: "Ruqsonna.Alvi@garland-group.com",
      attachments: []
    });

    expect(result.classification).toBe("GARLAND_FOLLOW_UP");
    expect(result.hasPdfAttachment).toBe(false);
  });

  it("upserts source emails and attachment metadata idempotently", async () => {
    prismaMock.garlandSourceEmail.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: "existing" });
    prismaMock.garlandSourceAttachment.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: "existing" });

    const message = {
      id: "graph-1",
      mailboxAddress: "Warehouse@Newl.ca",
      subject: "12 ORDERS 13 PAGES - PS210235 - PS210246",
      body: { content: "Pls see attached." },
      receivedDateTime: "2026-07-13T17:59:00Z",
      hasAttachments: true,
      from: { emailAddress: { name: "Ruqsonna Alvi", address: "Ruqsonna.Alvi@garland-group.com" } }
    };

    const result = await persistGarlandSourceEmails({
      tenantId: "tenant-a",
      actorUserId: "user-a",
      mailboxes: ["warehouse@newl.ca"],
      messages: [message, message],
      attachmentFetcher: async () => [
        { id: "att-1", name: "12 ORDERS 13 PAGES - PS210235 - PS210246.pdf", contentType: "application/pdf", size: 131_000 }
      ]
    });

    expect(result).toMatchObject({
      messageCount: 2,
      candidateMessageCount: 2,
      storedCount: 2,
      createdCount: 1,
      updatedCount: 1,
      attachmentsFetched: 2,
      attachmentsStored: 2,
      duplicateAttachmentCount: 1
    });
    expect(prismaMock.garlandSourceEmail.upsert).toHaveBeenCalledTimes(2);
    expect(prismaMock.garlandSourceEmail.upsert.mock.calls[0][0].where.tenantId_mailboxAddress_graphMessageId).toEqual({
      tenantId: "tenant-a",
      mailboxAddress: "warehouse@newl.ca",
      graphMessageId: "graph-1"
    });
    expect(prismaMock.garlandSourceAttachment.upsert.mock.calls[0][0].create).toMatchObject({
      tenantId: "tenant-a",
      sourceEmailId: "source-graph-1",
      graphAttachmentId: "att-1",
      fileName: "12 ORDERS 13 PAGES - PS210235 - PS210246.pdf",
      intakeStatus: "PDF_METADATA_READY"
    });
  });

  it("groups duplicate Garland follow-up emails by shipment batch instead of showing separate work items", () => {
    const baseEmail = {
      tenantId: "tenant-a",
      mailboxAddress: "warehouse@newl.ca",
      graphMessageId: "graph-1",
      internetMessageId: null,
      conversationId: "conversation-a",
      subject: "RE: 6 ORDERS 6 PAGES - PS210249 - PS210254",
      fromName: "Lily Morales",
      fromAddress: "lily.morales@newl.ca",
      toRecipients: [],
      ccRecipients: [],
      receivedAt: new Date("2026-07-14T14:09:00Z"),
      webLink: "https://outlook.example/email/1",
      bodyPreview: "Forwarding Garland docs.",
      normalizedBodyText: "Forwarding Garland docs.",
      bodyContentHash: null,
      classification: "GARLAND_FOLLOW_UP",
      classificationReason: "subject includes a PS range",
      candidateScore: 65,
      hasPdfAttachment: false,
      expectedOrderCount: 6,
      expectedPageCount: 6,
      expectedPsStart: "PS210249",
      expectedPsEnd: "PS210254",
      processedAt: new Date("2026-07-14T14:09:05Z"),
      id: "email-1",
      createdAt: new Date("2026-07-14T14:09:05Z"),
      updatedAt: new Date("2026-07-14T14:09:05Z"),
      attachments: []
    };

    const groups = groupGarlandEmailIntake([
      baseEmail,
      {
        ...baseEmail,
        id: "email-2",
        graphMessageId: "graph-2",
        fromName: "Suzy Boreham",
        fromAddress: "suzy.boreham@newlgroup.com",
        candidateScore: 60,
        receivedAt: new Date("2026-07-14T14:10:00Z"),
        webLink: "https://outlook.example/email/2"
      }
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      emailCount: 2,
      duplicateCount: 1,
      expectedPsStart: "PS210249",
      expectedPsEnd: "PS210254",
      expectedOrderCount: 6,
      expectedPageCount: 6
    });
    expect(groups[0].primaryEmail.id).toBe("email-1");
  });
});
