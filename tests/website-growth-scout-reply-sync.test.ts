import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { syncWebsiteGrowthOutreachReplies } from "@/modules/website-growth/backlink-outreach";
const mocks = vi.hoisted(() => ({ find: vi.fn(), update: vi.fn(), suppression: vi.fn(), audit: vi.fn(), transaction: vi.fn(), messages: vi.fn() }));
vi.mock("@/server/db", () => ({ prisma: { websiteGrowthBacklinkOpportunity: { findMany: mocks.find }, $transaction: mocks.transaction } }));
vi.mock("@/server/integrations/microsoft-graph-application", () => ({ getMicrosoftGraphApplicationAccessToken: vi.fn().mockResolvedValue("synthetic-token") }));
vi.mock("@/server/integrations/microsoft-graph-mail", () => ({ fetchMicrosoftGraphMailboxMessages: mocks.messages }));
const now = new Date("2026-06-20T12:00:00Z");
const lastReplyAt = new Date("2026-06-18T12:00:00Z");
function message(at: string, bodyPreview = "Please send an outline.") {
  return { receivedDateTime: at, subject: "Re: Useful guide", bodyPreview, conversationId: "thread-synthetic", from: { emailAddress: { address: "editor@example.com" } } };
}
beforeEach(() => {
  vi.resetAllMocks();
  for (const suffix of ["MAILBOX", "SENDER_NAME", "PUBLIC_BRAND", "PUBLIC_PHONE", "CANADA_LEGAL_NAME", "CANADA_ADDRESS", "US_LEGAL_NAME", "US_ADDRESS"]) vi.stubEnv(`WEBSITE_GROWTH_OUTREACH_${suffix}`, "Synthetic test identity");
  vi.stubEnv("WEBSITE_GROWTH_OUTREACH_WEBSITE", "https://example.com");
  mocks.find.mockResolvedValue([{ id: "publisher-synthetic", recipientEmail: "editor@example.com", contactedAt: new Date("2026-06-01T00:00:00Z"), lastReplyAt,
    messages: [{ conversationId: "thread-synthetic", subject: "Useful guide", sentAt: new Date("2026-06-01T00:00:00Z") }] }]);
  mocks.transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn({ websiteGrowthBacklinkOpportunity: { update: mocks.update }, websiteGrowthOutreachSuppression: { upsert: mocks.suppression }, auditLog: { create: mocks.audit } }));
});
afterEach(() => vi.unstubAllEnvs());
describe("Ongoing Scout publisher conversation sync", () => {
  it("keeps replied conversations in scope and records only the newest reply", async () => {
    mocks.messages.mockResolvedValue([message("2026-06-18T12:00:00Z"), message("2026-06-19T12:00:00Z")]);
    expect(await syncWebsiteGrowthOutreachReplies({ tenantId: "tenant-a", now })).toEqual({ replies: 1, unsubscribes: 0 });
    expect(mocks.find).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ tenantId: "tenant-a", status: { in: ["CONTACTED", "REPLIED"] }, OR: expect.arrayContaining([expect.objectContaining({ messages: expect.any(Object) })]) }) }));
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "publisher-synthetic", tenantId: "tenant-a" }, data: expect.objectContaining({ lastReplyAt: new Date("2026-06-19T12:00:00Z") }) }));
  });
  it("does not repeatedly record an already processed reply", async () => {
    mocks.messages.mockResolvedValue([message(lastReplyAt.toISOString())]);
    expect(await syncWebsiteGrowthOutreachReplies({ tenantId: "tenant-a", now })).toEqual({ replies: 0, unsubscribes: 0 });
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it("honors an opt-out even when a newer ordinary message is also present", async () => {
    mocks.messages.mockResolvedValue([message("2026-06-20T10:00:00Z"), message("2026-06-19T12:00:00Z", "Please unsubscribe me.")]);
    expect(await syncWebsiteGrowthOutreachReplies({ tenantId: "tenant-a", now })).toEqual({ replies: 1, unsubscribes: 1 });
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "LOST" }) }));
    expect(mocks.suppression).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ tenantId: "tenant-a", normalizedEmail: "editor@example.com" }) }));
  });
});
