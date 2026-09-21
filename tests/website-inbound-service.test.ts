import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma, type WebsiteInboundSubmission } from "@prisma/client";
import type { AuthenticatedContext } from "@/server/tenant-context";

const db = vi.hoisted(() => ({
  websiteInboundSubmission: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    updateMany: vi.fn(),
    count: vi.fn(),
    groupBy: vi.fn()
  },
  membership: { findUnique: vi.fn(), findMany: vi.fn() },
  websiteInboundActivity: { create: vi.fn(), findMany: vi.fn(), count: vi.fn() },
  websiteInboundEmailMessage: { findMany: vi.fn() },
  auditLog: { create: vi.fn() }
}));
const transaction = vi.hoisted(() => vi.fn());
const mailboxConfiguration = vi.hoisted(() => vi.fn());
vi.mock("@/server/db", () => ({ prisma: { ...db, $transaction: transaction } }));
vi.mock("@/modules/website-inbound/correspondence", () => ({
  getWebsiteInboundMailboxConfiguration: mailboxConfiguration
}));
import {
  addOpportunityNote,
  createOpportunity,
  updateOpportunity
} from "@/modules/website-inbound/service";
import { getWebsiteInboundShell } from "@/modules/website-inbound/queries";
import { parseFilters, type OpportunityInput } from "@/modules/website-inbound/opportunities";

const ctx: AuthenticatedContext = {
  tenantId: "tenant-a",
  userId: "user-a",
  userName: "Test User",
  userEmail: "user@example.com",
  tenantSlug: "synthetic",
  tenantName: "Synthetic",
  role: "ADMIN"
};
const input: OpportunityInput = {
  company: "Synthetic Company",
  name: null,
  email: null,
  phone: "202-555-0100",
  phoneNormalized: "2025550100",
  primaryNeed: "Storage",
  status: "NEW",
  contactChannel: "PHONE",
  ownerUserId: null,
  receivedOn: new Date("2026-09-16Z"),
  followUpOn: null,
  nextAction: null,
  closedReason: null,
  source: "Website"
};
function existing(overrides: Partial<WebsiteInboundSubmission> = {}): WebsiteInboundSubmission {
  return {
    ...input,
    id: "row-a",
    tenantId: ctx.tenantId,
    createdAt: new Date("2026-09-16Z"),
    updatedAt: new Date("2026-09-16Z"),
    lastActivityAt: new Date("2026-09-16Z"),
    entryMethod: "WEBSITE_FORM",
    contactChannel: "WEBSITE_FORM",
    fields: { original: "Retain raw form" },
    rawPayload: null,
    utmSource: null,
    utmMedium: null,
    utmCampaign: null,
    utmTerm: null,
    utmContent: null,
    gclid: null,
    gbraid: null,
    wbraid: null,
    gaClientId: null,
    campaignId: null,
    adGroupId: null,
    creativeId: null,
    matchType: null,
    network: null,
    device: null,
    landingPage: null,
    landingPath: null,
    firstReferrer: null,
    firstReferrerDomain: null,
    sessionStartedAt: null,
    submittedAt: new Date("2026-09-16Z"),
    trafficSourceGuess: null,
    attributionConfidence: null,
    attributionChannel: "UNKNOWN",
    attributionLocation: null,
    isTest: false,
    marketingExcludedReason: null,
    formType: "assessment",
    pageUrl: "https://example.com/assessment",
    revision: 2,
    creationKey: null,
    createdByUserId: null,
    communicationMailbox: null,
    lastInboundEmailAt: null,
    lastOutboundEmailAt: null,
    ...overrides
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  mailboxConfiguration.mockResolvedValue({
    enabled: false,
    draftingEnabled: false,
    reason: "Not configured",
    mailboxes: [],
    ownerMailboxes: {}
  });
  transaction.mockImplementation(async (fn: (tx: typeof db) => Promise<unknown>) => fn(db));
  db.websiteInboundSubmission.findUnique.mockResolvedValue(null);
  db.websiteInboundSubmission.findFirst.mockResolvedValue(existing());
  db.websiteInboundSubmission.findMany.mockResolvedValue([]);
  db.websiteInboundSubmission.groupBy.mockResolvedValue([]);
  db.websiteInboundSubmission.create.mockImplementation(async ({ data }) =>
    existing({ ...data, id: "new-row" })
  );
  db.websiteInboundSubmission.updateMany.mockResolvedValue({ count: 1 });
  db.websiteInboundEmailMessage.findMany.mockResolvedValue([]);
  db.membership.findUnique.mockResolvedValue({ id: "member-a" });
});

describe("manual entry", () => {
  it("creates a tenant-scoped phone lead, note and audit together", async () => {
    expect(
      await createOpportunity(ctx, input, {
        creationKey: "key-a",
        separate: false,
        note: "Requested pricing"
      })
    ).toBe("new-row");
    expect(db.websiteInboundSubmission.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: "tenant-a",
        entryMethod: "MANUAL",
        fields: {},
        formType: "manual_enquiry",
        createdByUserId: "user-a"
      })
    });
    expect(db.websiteInboundActivity.create).toHaveBeenCalledTimes(2);
    expect(db.websiteInboundActivity.create).toHaveBeenLastCalledWith({
      data: expect.objectContaining({
        tenantId: "tenant-a",
        submissionId: "new-row",
        type: "NOTE",
        actorUserId: "user-a",
        body: "Requested pricing"
      })
    });
    expect(transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable
    });
  });
  it("warns about company/email/normalized-phone matches only inside the tenant", async () => {
    db.websiteInboundSubmission.findMany.mockResolvedValue([
      { id: "existing-a", company: "Synthetic Company", name: null }
    ]);
    await expect(
      createOpportunity(ctx, input, { creationKey: "key-a", separate: false, note: null })
    ).rejects.toMatchObject({ matches: [{ id: "existing-a", label: "Synthetic Company" }] });
    expect(db.websiteInboundSubmission.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tenantId: "tenant-a",
          NOT: { formType: "account_setup" },
          OR: [
            { company: { equals: input.company, mode: "insensitive" } },
            { phoneNormalized: input.phoneNormalized }
          ]
        }
      })
    );
    expect(db.websiteInboundSubmission.create).not.toHaveBeenCalled();
    await createOpportunity(ctx, input, { creationKey: "key-a", separate: true, note: null });
    expect(db.websiteInboundSubmission.create).toHaveBeenCalledOnce();
  });
  it("does not duplicate a retried request or return another creator's record", async () => {
    db.websiteInboundSubmission.findUnique.mockResolvedValue(
      existing({ createdByUserId: ctx.userId })
    );
    expect(
      await createOpportunity(ctx, input, { creationKey: "key-a", separate: false, note: null })
    ).toBe("row-a");
    expect(db.websiteInboundSubmission.create).not.toHaveBeenCalled();
    db.websiteInboundSubmission.findUnique.mockResolvedValue(
      existing({ createdByUserId: "someone-else" })
    );
    await expect(
      createOpportunity(ctx, input, { creationKey: "key-a", separate: false, note: null })
    ).rejects.toThrow("Reopen");
  });
});

describe("website form edits and notes", () => {
  it.each([
    { name: null, company: null, email: null, phone: null },
    { name: "Test Contact", company: null, email: null, phone: null }
  ])(
    "updates missing and partial contact evidence while preserving original intake: %j",
    async (evidence) => {
      const row = existing(evidence);
      db.websiteInboundSubmission.findFirst.mockResolvedValue(row);
      const updated = {
        ...input,
        ...evidence,
        phone: "202-555-0100",
        primaryNeed: "Storage and trucking",
        contactChannel: "WEBSITE_FORM" as const
      };
      await updateOpportunity(ctx, row.id, row.revision, updated);
      const args = db.websiteInboundSubmission.updateMany.mock.calls[0][0];
      expect(args.where).toEqual({ id: row.id, tenantId: "tenant-a", revision: 2 });
      expect(args.data.phone).toBe("202-555-0100");
      for (const protectedField of ["fields", "pageUrl", "formType", "entryMethod", "createdAt"])
        expect(args.data).not.toHaveProperty(protectedField);
      expect(db.websiteInboundActivity.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          changes: expect.objectContaining({ phone: { before: null, after: "202-555-0100" } }),
          type: "UPDATED",
          tenantId: "tenant-a"
        })
      });
      expect(db.auditLog.create).toHaveBeenCalledOnce();
    }
  );
  it("rejects cross-tenant records and owners", async () => {
    db.websiteInboundSubmission.findFirst.mockResolvedValueOnce(null);
    await expect(updateOpportunity(ctx, "foreign-row", 2, input)).rejects.toThrow("not found");
    expect(db.websiteInboundSubmission.findFirst).toHaveBeenCalledWith({
      where: { id: "foreign-row", tenantId: "tenant-a", NOT: { formType: "account_setup" } }
    });
    db.membership.findUnique.mockResolvedValue(null);
    await expect(
      updateOpportunity(ctx, "row-a", 2, { ...input, ownerUserId: "foreign-user" })
    ).rejects.toThrow("your organization");
    expect(db.websiteInboundSubmission.updateMany).not.toHaveBeenCalled();
  });
  it("rejects stale saves including races after the read", async () => {
    await expect(updateOpportunity(ctx, "row-a", 1, input)).rejects.toThrow("Someone updated");
    db.websiteInboundSubmission.updateMany.mockResolvedValue({ count: 0 });
    await expect(
      updateOpportunity(ctx, "row-a", 2, {
        ...input,
        contactChannel: "WEBSITE_FORM",
        primaryNeed: "Changed"
      })
    ).rejects.toThrow("Someone updated");
    expect(db.websiteInboundActivity.create).not.toHaveBeenCalled();
    expect(db.auditLog.create).not.toHaveBeenCalled();
  });
  it("preserves original channel, and rolls errors up from the transaction", async () => {
    await expect(updateOpportunity(ctx, "row-a", 2, input)).rejects.toThrow(
      "original contact channel"
    );
    db.auditLog.create.mockRejectedValue(new Error("Synthetic audit failure"));
    await expect(
      updateOpportunity(ctx, "row-a", 2, {
        ...input,
        contactChannel: "WEBSITE_FORM",
        status: "QUALIFIED"
      })
    ).rejects.toThrow("Synthetic audit failure");
    expect(transaction).toHaveBeenCalled();
  });
  it("keeps a manually selected Test status synchronized with durable exclusion fields", async () => {
    await updateOpportunity(ctx, "row-a", 2, {
      ...input,
      contactChannel: "WEBSITE_FORM",
      status: "TEST"
    });
    expect(db.websiteInboundSubmission.updateMany).toHaveBeenCalledWith({
      where: { id: "row-a", tenantId: "tenant-a", revision: 2 },
      data: expect.objectContaining({
        status: "TEST",
        isTest: true,
        marketingExcludedReason: "MANUAL_TEST_STATUS"
      })
    });

    db.websiteInboundSubmission.findFirst.mockResolvedValue(
      existing({ status: "TEST", isTest: true, marketingExcludedReason: "MANUAL_TEST_STATUS" })
    );
    await updateOpportunity(ctx, "row-a", 2, {
      ...input,
      contactChannel: "WEBSITE_FORM",
      status: "NEW"
    });
    expect(db.websiteInboundSubmission.updateMany).toHaveBeenLastCalledWith({
      where: { id: "row-a", tenantId: "tenant-a", revision: 2 },
      data: expect.objectContaining({
        status: "NEW",
        isTest: false,
        marketingExcludedReason: null
      })
    });
  });
  it("appends notes without changing contact details, status or the edit revision", async () => {
    await addOpportunityNote(ctx, "row-a", "Called about storage");
    expect(db.websiteInboundSubmission.updateMany).toHaveBeenCalledWith({
      where: { id: "row-a", tenantId: "tenant-a", NOT: { formType: "account_setup" } },
      data: { lastActivityAt: expect.any(Date) }
    });
    expect(db.websiteInboundActivity.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        body: "Called about storage",
        actorName: "Test User",
        type: "NOTE"
      })
    });
    db.websiteInboundSubmission.updateMany.mockResolvedValue({ count: 0 });
    await expect(addOpportunityNote(ctx, "foreign-row", "note")).rejects.toThrow("not found");
    expect(db.websiteInboundActivity.create).toHaveBeenCalledOnce();
  });
});

describe("queue and activity pagination", () => {
  it("clamps pages, fetches only tenant records, and limits payloads in table rows", async () => {
    db.websiteInboundSubmission.count.mockResolvedValue(26);
    db.membership.findMany.mockResolvedValue([
      { userId: "user-a", user: { name: "Test User", email: "user@example.com" } }
    ]);
    db.websiteInboundActivity.count.mockResolvedValue(26);
    db.websiteInboundActivity.findMany.mockResolvedValue([]);
    const shell = await getWebsiteInboundShell(ctx, parseFilters({ page: "900" }), "row-a", 900);
    expect(shell.page).toBe(2);
    expect(shell.activityPage).toBe(2);
    expect(db.websiteInboundSubmission.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ tenantId: "tenant-a" }),
        skip: 25,
        take: 25
      })
    );
    expect(db.websiteInboundSubmission.findMany.mock.calls[0][0].select).not.toHaveProperty(
      "fields"
    );
    expect(db.websiteInboundActivity.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId: "tenant-a", submissionId: "row-a" },
        skip: 25,
        take: 25
      })
    );
    expect(db.membership.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId: "tenant-a" } })
    );
  });
});
