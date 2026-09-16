import { beforeEach, describe, expect, it, vi } from "vitest";
import { approveAndSendScoutReply } from "@/modules/website-growth/scout/reply";
import { newWork } from "@/modules/website-growth/scout/model";
const mocks = vi.hoisted(() => ({ sync: vi.fn(), send: vi.fn(), token: vi.fn(),
  job: { findFirst: vi.fn(), updateMany: vi.fn() }, opportunity: { findFirst: vi.fn() }, suppression: { findUnique: vi.fn() },
  message: { create: vi.fn(), count: vi.fn(), updateMany: vi.fn() }, audit: { create: vi.fn() }, transaction: vi.fn() }));
vi.mock("@/server/db", () => ({ prisma: { automationJobRun: mocks.job, websiteGrowthBacklinkOpportunity: mocks.opportunity,
  websiteGrowthOutreachSuppression: mocks.suppression, websiteGrowthOutreachMessage: mocks.message, auditLog: mocks.audit, $transaction: mocks.transaction } }));
vi.mock("@/server/integrations/microsoft-graph-application", () => ({ getMicrosoftGraphApplicationAccessToken: mocks.token }));
vi.mock("@/server/integrations/microsoft-graph-mail", () => ({ createAndSendMicrosoftGraphMailboxMessage: mocks.send }));
vi.mock("@/modules/website-growth/backlink-outreach", () => ({ syncWebsiteGrowthOutreachReplies: mocks.sync,
  readWebsiteGrowthOutreachIdentity: () => ({ mailbox: "partnerships@example.com" }),
  assertSafeWebsiteGrowthOutreachCopy: vi.fn(), validateWebsiteGrowthOutreachConsent: vi.fn(),
  buildCompliantWebsiteGrowthOutreachBody: ({ body }: { body: string }) => `${body}\nApproved footer` }));
const replyAt = new Date("2026-06-15T10:00:00Z");
const work = { ...newWork("RELATIONSHIP", "publisher-synthetic", "Publisher question", "Prepare an outline", "/resources/guide", { replyAt: replyAt.toISOString(), replyRecipient: "editor@example.com" }),
  state: "NEEDS_REVIEW", artifact: { subject: "Re: Practical guide", body: "Here is the requested outline." } };
beforeEach(() => {
  vi.resetAllMocks();
  mocks.transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn({ automationJobRun: mocks.job, websiteGrowthBacklinkOpportunity: mocks.opportunity,
    websiteGrowthOutreachSuppression: mocks.suppression, websiteGrowthOutreachMessage: mocks.message, auditLog: mocks.audit }));
  mocks.job.findFirst.mockResolvedValue({ output: work }); mocks.job.updateMany.mockResolvedValue({ count: 1 });
  mocks.opportunity.findFirst.mockResolvedValue({ id: "publisher-synthetic", lastReplyAt: replyAt, recipientEmail: "editor@example.com", recipientCountry: "US",
    consentBasis: "US_BUSINESS_OUTREACH", contactSourceUrl: "https://example.com/contact" });
  mocks.suppression.findUnique.mockResolvedValue(null); mocks.message.count.mockResolvedValue(0);
  mocks.send.mockResolvedValue({ id: null, conversationId: null }); mocks.token.mockResolvedValue("synthetic-token");
});
describe("Owner-approved publisher response", () => {
  it("refreshes replies, reserves the exact message, and records human approval before Graph is called", async () => {
    await approveAndSendScoutReply("tenant-a", "owner-synthetic", "work-synthetic", 0);
    expect(mocks.sync).toHaveBeenCalledWith({ tenantId: "tenant-a" });
    expect(mocks.message.create.mock.invocationCallOrder[0]).toBeLessThan(mocks.send.mock.invocationCallOrder[0]);
    expect(mocks.audit.create.mock.invocationCallOrder[0]).toBeLessThan(mocks.send.mock.invocationCallOrder[0]);
    expect(mocks.send).toHaveBeenCalledWith("synthetic-token", "partnerships@example.com", expect.objectContaining({ recipientEmail: "editor@example.com", body: "Here is the requested outline.\nApproved footer" }));
    expect(mocks.message.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ tenantId: "tenant-a" }) }));
  });
  it("refuses a stale review, opt-out, or changed conversation before sending", async () => {
    await expect(approveAndSendScoutReply("tenant-a", "owner", "work", 99)).rejects.toThrow("changed");
    mocks.suppression.findUnique.mockResolvedValue({ id: "suppression" });
    await expect(approveAndSendScoutReply("tenant-a", "owner", "work", 0)).rejects.toThrow("opted out");
    mocks.opportunity.findFirst.mockResolvedValue(null);
    await expect(approveAndSendScoutReply("tenant-a", "owner", "work", 0)).rejects.toThrow("changed");
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it("rejects a recipient changed after the saved draft was prepared", async () => {
    mocks.opportunity.findFirst.mockResolvedValue({ id: "publisher-synthetic", lastReplyAt: replyAt, recipientEmail: "changed@example.com", recipientCountry: "US", consentBasis: "US_BUSINESS_OUTREACH", contactSourceUrl: "https://example.com/contact" });
    await expect(approveAndSendScoutReply("tenant-a", "owner", "work", 0)).rejects.toThrow("changed");
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it("does not send if another request already reserved the same approval", async () => {
    mocks.message.create.mockRejectedValue(new Error("Unique constraint"));
    await expect(approveAndSendScoutReply("tenant-a", "owner", "work", 0)).rejects.toThrow("Unique");
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it("holds uncertain delivery with an external-wait marker and never retries Graph", async () => {
    mocks.send.mockRejectedValue(new Error("Timeout after possible acceptance"));
    await expect(approveAndSendScoutReply("tenant-a", "owner", "work", 0)).rejects.toThrow("uncertain");
    expect(mocks.send).toHaveBeenCalledTimes(1);
    expect(mocks.job.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({ where: expect.objectContaining({ tenantId: "tenant-a" }),
      data: { output: expect.objectContaining({ state: "WAITING", evidence: expect.objectContaining({ replySend: "UNCERTAIN", externalWait: true }) }) } }));
  });
  it("honors the shared follow-up and response budget", async () => {
    mocks.message.count.mockResolvedValue(10);
    await expect(approveAndSendScoutReply("tenant-a", "owner", "work", 0)).rejects.toThrow("limit");
    expect(mocks.send).not.toHaveBeenCalled();
  });
});
