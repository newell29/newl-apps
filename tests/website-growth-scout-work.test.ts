import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_MISSION, DAY_MS, WORK_JOB, MISSION_JOB, STEP_JOB, isDue, newWork, parseMission, parseResult, stableId } from "@/modules/website-growth/scout/model";
import { claimScoutWork, completeScoutWork, reviewScoutWork, scoutWorkContext, reconcileScoutWork } from "@/modules/website-growth/scout/store";
import { buildTemplateWebsiteGrowthContentDraft } from "@/modules/website-growth/content-drafts";
import { WebsiteGrowthAction } from "@prisma/client";
import { reusableWebsiteGrowthResearchHashes } from "@/modules/website-growth/backlink-discovery";

const db = vi.hoisted(() => ({
  automationJobRun: { findFirst: vi.fn(), findMany: vi.fn(), count: vi.fn(), updateMany: vi.fn(), create: vi.fn(), upsert: vi.fn() },
  websiteGrowthOpportunity: { findMany: vi.fn(), findFirst: vi.fn(), updateMany: vi.fn(), upsert: vi.fn() },
  websiteGrowthContentDraft: { findMany: vi.fn(), create: vi.fn(), updateMany: vi.fn(), findFirst: vi.fn() },
  websiteGrowthBacklinkOpportunity: { findMany: vi.fn(), findFirst: vi.fn() }, auditLog: { create: vi.fn() }, $transaction: vi.fn()
}));
vi.mock("@/server/db", () => ({ prisma: db }));
vi.mock("@/modules/website-growth/newl-website-context-scanner", () => ({ resolveNewlWebsiteContext: vi.fn().mockResolvedValue({}) }));
const now = new Date("2026-06-15T12:00:00Z");
const work = () => newWork("PAGE", "opportunity-synthetic", "Improve warehouse information", "Explain service fit", "/services/warehouse", {}, now);
const leased = () => ({ ...work(), state: "WORKING" as const, lease: "lease-synthetic", leaseUntil: new Date(now.getTime() + DAY_MS).toISOString() });

beforeEach(() => {
  vi.clearAllMocks();
  db.$transaction.mockImplementation(async (callback: (client: typeof db) => unknown) => callback(db));
  db.automationJobRun.updateMany.mockResolvedValue({ count: 1 });
  db.automationJobRun.count.mockResolvedValue(0);
  db.websiteGrowthOpportunity.updateMany.mockResolvedValue({ count: 1 });
  db.websiteGrowthContentDraft.create.mockResolvedValue({ id: "draft-synthetic" });
});

describe("Scout work model", () => {
  it("starts paused and validates owner budgets", () => {
    expect(DEFAULT_MISSION.enabled).toBe(false);
    expect(() => parseMission({ ...DEFAULT_MISSION, dailySteps: 0 })).toThrow();
    expect(() => parseMission({ ...DEFAULT_MISSION, maxActive: 11 })).toThrow();
    expect(stableId("tenant-a", "same")).not.toBe(stableId("tenant-b", "same"));
  });
  it("distinguishes deferred research, expired leases, and external waits", () => {
    expect(isDue({ ...work(), state: "WAITING", nextReviewAt: new Date(now.getTime() + DAY_MS).toISOString() }, now)).toBe(false);
    expect(isDue({ ...leased(), leaseUntil: new Date(now.getTime() - 1).toISOString() }, now)).toBe(true);
    expect(isDue({ ...work(), evidence: { externalWait: true } }, now)).toBe(false);
  });
  it("requires concrete deliverables and bounded retry dates", () => {
    expect(() => parseResult({ decision: "DELIVER", summary: "Ready", nextAction: "Review" }, now)).toThrow();
    expect(() => parseResult({ decision: "WAIT", summary: "Missing source", nextAction: "Retry", reviewInDays: 0 }, now)).toThrow();
    expect(parseResult({ decision: "WAIT", summary: "Missing source", nextAction: "Retry", reviewInDays: 2 }, now).nextReviewAt).toBe("2026-06-17T12:00:00.000Z");
  });
  it("retries failed and legacy research, expires completed research, and preserves recent completed dedupe", () => {
    const base = { startedAt: now, output: { backlinkDiscovery: { seenUrlHashes: ["old"], reviewedUrlHashes: ["complete"] } } };
    expect(reusableWebsiteGrowthResearchHashes({ ...base, status: "ERROR" }, now)).toEqual([]);
    expect(reusableWebsiteGrowthResearchHashes({ ...base, status: "RUNNING" }, now)).toEqual([]);
    expect(reusableWebsiteGrowthResearchHashes({ ...base, status: "SUCCESS", output: { backlinkDiscovery: { seenUrlHashes: ["old"] } } }, now)).toEqual([]);
    expect(reusableWebsiteGrowthResearchHashes({ ...base, status: "SUCCESS" }, now)).toEqual(["complete"]);
    expect(reusableWebsiteGrowthResearchHashes({ ...base, status: "SUCCESS", startedAt: new Date(now.getTime() - 31 * DAY_MS) }, now)).toEqual([]);
    expect(reusableWebsiteGrowthResearchHashes({ ...base, status: "SUCCESS", output: null }, now)).toEqual([]);
  });
});

describe("Scout persisted work and budgets", () => {
  const setupClaim = (mission = { ...DEFAULT_MISSION, enabled: true }) => {
    db.automationJobRun.findFirst.mockResolvedValue({ input: mission });
    db.automationJobRun.findMany.mockResolvedValue([{ id: "work-synthetic", output: work() }]);
  };
  it("claims only tenant-scoped work and charges an immutable step inside a serializable transaction", async () => {
    setupClaim();
    const result = await claimScoutWork("tenant-a", "work-synthetic", "Highest value unfinished work", now);
    expect(result.state).toBe("WORKING");
    expect(db.automationJobRun.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { tenantId: "tenant-a", jobType: WORK_JOB } }));
    expect(db.automationJobRun.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ tenantId: "tenant-a", jobType: MISSION_JOB }) }));
    expect(db.automationJobRun.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ tenantId: "tenant-a", output: { path: ["revision"], equals: 0 } }) }));
    expect(db.automationJobRun.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ tenantId: "tenant-a", jobType: STEP_JOB }) }));
    expect(db.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "Serializable" });
  });
  it("refuses paused, exhausted, foreign, and concurrently claimed work", async () => {
    setupClaim(DEFAULT_MISSION);
    await expect(claimScoutWork("tenant-a", "work-synthetic", "Investigate", now)).rejects.toThrow("paused");
    setupClaim(); db.automationJobRun.count.mockResolvedValue(6);
    await expect(claimScoutWork("tenant-a", "work-synthetic", "Investigate", now)).rejects.toThrow("budget");
    db.automationJobRun.count.mockResolvedValue(0);
    await expect(claimScoutWork("tenant-b", "foreign", "Investigate", now)).rejects.toThrow("unavailable");
    db.automationJobRun.updateMany.mockResolvedValue({ count: 0 });
    await expect(claimScoutWork("tenant-a", "work-synthetic", "Investigate", now)).rejects.toThrow("concurrently");
    expect(db.automationJobRun.create).not.toHaveBeenCalled();
  });
  it("defers a declined candidate instead of returning it on every run", async () => {
    db.automationJobRun.findFirst.mockResolvedValue({ output: leased() });
    const saved = await completeScoutWork("tenant-a", "work-synthetic", "lease-synthetic", { decision: "WAIT", summary: "Existing page already answers the question", nextAction: "Review when evidence changes", reviewInDays: 30 }, now);
    expect(saved?.state).toBe("WAITING");
    expect(isDue(saved!, now)).toBe(false);
    expect(db.websiteGrowthContentDraft.create).not.toHaveBeenCalled();
  });
  it("returns a saved completion after a lost acknowledgement without creating another artifact", async () => {
    const saved = { ...work(), state: "NEEDS_REVIEW", history: [{ at: now.toISOString(), action: "COMPLETED:lease-synthetic", summary: "Saved" }] };
    db.automationJobRun.findFirst.mockResolvedValue({ output: saved });
    await expect(completeScoutWork("tenant-a", "work-synthetic", "lease-synthetic", { decision: "DELIVER", summary: "Saved", nextAction: "Review", artifact: { body: "Saved" } }, now)).resolves.toMatchObject({ state: "NEEDS_REVIEW" });
    expect(db.automationJobRun.updateMany).not.toHaveBeenCalled();
  });
  it("rejects wrong and expired leases", async () => {
    db.automationJobRun.findFirst.mockResolvedValue({ output: leased() });
    const input = { decision: "WAIT", summary: "Retry", nextAction: "Review" };
    await expect(completeScoutWork("tenant-a", "work-synthetic", "wrong", input, now)).rejects.toThrow("lease");
    await expect(completeScoutWork("tenant-a", "work-synthetic", "lease-synthetic", input, new Date(now.getTime() + 2 * DAY_MS))).rejects.toThrow("lease");
  });
  it("saves an unapproved page draft while discarding model-supplied approval and build fields", async () => {
    db.automationJobRun.findFirst.mockResolvedValue({ output: leased() });
    db.websiteGrowthOpportunity.findFirst.mockResolvedValue({ id: "opportunity-synthetic", targetPage: "/services/warehouse" });
    const draft = buildTemplateWebsiteGrowthContentDraft({ action: WebsiteGrowthAction.IMPROVE_EXISTING_PAGE, topic: "Warehouse information", primaryKeyword: "warehouse", targetPage: "/services/warehouse", sourcePage: null, score: 70, confidence: "medium", reason: "Improve clarity", recommendation: "Add helpful details", supportingKeywords: [], evidence: {} });
    await completeScoutWork("tenant-a", "work-synthetic", "lease-synthetic", { decision: "DELIVER", summary: "Specific copy prepared", nextAction: "Review brief", artifact: { ...draft, approvedByUserId: "forged", buildPackage: { status: "READY_FOR_PR" } } }, now);
    const created = db.websiteGrowthContentDraft.create.mock.calls[0][0].data;
    expect(created.tenantId).toBe("tenant-a");
    expect(created).not.toHaveProperty("approvedAt");
    expect(created.draftJson).not.toHaveProperty("buildPackage");
    expect(created.draftJson).not.toHaveProperty("approvedByUserId");
  });
  it("blocks stale publisher evidence and keeps page approvals in their existing review path", async () => {
    db.automationJobRun.findFirst.mockResolvedValue({ output: { ...leased(), kind: "RELATIONSHIP", evidence: { replyAt: "old" } } });
    db.websiteGrowthBacklinkOpportunity.findFirst.mockResolvedValue({ lastReplyAt: now });
    await expect(completeScoutWork("tenant-a", "work-synthetic", "lease-synthetic", { decision: "DELIVER", summary: "Prepared", nextAction: "Review", artifact: { subject: "Re: Editorial question", body: "Here is a proposed outline." } }, now)).rejects.toThrow("conversation changed");
    db.automationJobRun.findFirst.mockResolvedValue({ output: { ...work(), draftId: "draft-synthetic", state: "NEEDS_REVIEW" } });
    await expect(reviewScoutWork("tenant-a", "user-synthetic", "work-synthetic", 0, "ACCEPT", "Approved")).rejects.toThrow("complete brief");
  });
  it("cannot read foreign work context", async () => {
    db.automationJobRun.findFirst.mockResolvedValue(null);
    await expect(scoutWorkContext("tenant-b", "work-synthetic", "lease-synthetic")).rejects.toThrow("lease");
    expect(db.websiteGrowthOpportunity.findFirst).not.toHaveBeenCalled();
  });
});


describe("Scout conversation handoffs", () => {
  it("clears stale reviews and revoked in-flight leases without touching uncertain sends", async () => {
    const stale = { ...newWork("RELATIONSHIP", "publisher-synthetic", "Reply", "Respond", null, { replyAt: "2026-06-01T00:00:00.000Z" }), state: "NEEDS_REVIEW" };
    const uncertain = { ...stale, evidence: { ...stale.evidence, replySend: "UNCERTAIN" } };
    db.automationJobRun.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([
      { id: "stale", output: stale }, { id: "uncertain", output: uncertain }
    ]).mockResolvedValueOnce([]);
    db.automationJobRun.findFirst.mockResolvedValue(null);
    db.websiteGrowthBacklinkOpportunity.findFirst.mockResolvedValue({ status: "REPLIED", lastReplyAt: new Date("2026-06-02T00:00:00Z"), unsubscribedAt: null });
    db.websiteGrowthOpportunity.findMany.mockResolvedValue([]);
    db.websiteGrowthBacklinkOpportunity.findMany.mockResolvedValue([]);
    db.websiteGrowthContentDraft.findMany.mockResolvedValue([]);
    await reconcileScoutWork("tenant-a", now);
    expect(db.automationJobRun.updateMany).toHaveBeenCalledTimes(1);
    expect(db.automationJobRun.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ tenantId: "tenant-a", id: "stale" }), data: expect.objectContaining({ output: expect.objectContaining({ state: "DISMISSED", lease: null }) }) }));
  });
});
