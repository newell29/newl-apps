import { reviewWindows } from "@/modules/website-growth/scout/effectiveness-model";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_MISSION, DAY_MS, WORK_JOB, MISSION_JOB, STEP_JOB, isDue, newWork, parseMission, parseResult, stableId } from "@/modules/website-growth/scout/model";
import { claimScoutWork, completeScoutWork, reviewScoutWork, scoutWorkContext, reconcileScoutWork } from "@/modules/website-growth/scout/store";
import { buildTemplateWebsiteGrowthContentDraft } from "@/modules/website-growth/content-drafts";
import { WebsiteGrowthAction } from "@prisma/client";
import { reusableWebsiteGrowthResearchHashes } from "@/modules/website-growth/backlink-discovery";
import { WEBSITE_GROWTH_BUILD_JOB_TYPE } from "@/modules/website-growth/build-requests";

const db = vi.hoisted(() => ({
  automationJobRun: { findFirst: vi.fn(), findMany: vi.fn(), count: vi.fn(), updateMany: vi.fn(), create: vi.fn(), upsert: vi.fn() },
  websiteGrowthOpportunity: { findMany: vi.fn(), findFirst: vi.fn(), updateMany: vi.fn(), upsert: vi.fn() },
  websiteGrowthContentDraft: { findMany: vi.fn(), create: vi.fn(), updateMany: vi.fn(), findFirst: vi.fn() },
  websiteGrowthBacklinkOpportunity: { findMany: vi.fn(), findFirst: vi.fn() }, auditLog: { create: vi.fn() }, $transaction: vi.fn()
}));
vi.mock("@/server/db", () => ({ prisma: db }));
vi.mock("@/modules/website-growth/newl-website-context-scanner", () => ({ resolveNewlWebsiteContext: vi.fn().mockResolvedValue({}) }));
const now = new Date("2026-06-15T12:00:00Z");
const supervisor = { verdict: "PASS", reason: "Sources and complete deliverable reviewed." };
const measurement = { status: "AVAILABLE", sources: [{ source: "search_console", period: "after", status: "AVAILABLE", metrics: { clicks: 20 } }] };
const work = () => newWork("PAGE", "opportunity-synthetic", "Improve warehouse information", "Explain service fit", "/services/warehouse", {}, now);
const leased = () => ({ ...work(), state: "WORKING" as const, lease: "lease-synthetic", leaseUntil: new Date(now.getTime() + DAY_MS).toISOString() });

beforeEach(() => {
  vi.resetAllMocks();
  db.$transaction.mockImplementation(async (callback: (client: typeof db) => unknown) => callback(db));
  db.automationJobRun.updateMany.mockResolvedValue({ count: 1 });
  db.automationJobRun.count.mockResolvedValue(0);
  db.automationJobRun.findMany.mockResolvedValue([]);
  db.websiteGrowthContentDraft.findMany.mockResolvedValue([]);
  db.websiteGrowthContentDraft.findFirst.mockResolvedValue({ status: "DRAFT", approvedAt: null });
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
    await completeScoutWork("tenant-a", "work-synthetic", "lease-synthetic", { decision: "DELIVER", supervisor, summary: "Specific copy prepared", nextAction: "Review brief", artifact: { ...draft, approvedByUserId: "forged", buildPackage: { status: "READY_FOR_PR" } } }, now);
    const created = db.websiteGrowthContentDraft.create.mock.calls[0][0].data;
    expect(created.tenantId).toBe("tenant-a");
    expect(created).not.toHaveProperty("approvedAt");
    expect(created.draftJson).not.toHaveProperty("buildPackage");
    expect(created.draftJson).not.toHaveProperty("approvedByUserId");
  });
  it("blocks stale publisher evidence and keeps page approvals in their existing review path", async () => {
    db.automationJobRun.findFirst.mockResolvedValue({ output: { ...leased(), kind: "RELATIONSHIP", evidence: { replyAt: "old" } } });
    db.websiteGrowthBacklinkOpportunity.findFirst.mockResolvedValue({ lastReplyAt: now });
    await expect(completeScoutWork("tenant-a", "work-synthetic", "lease-synthetic", { decision: "DELIVER", supervisor, summary: "Prepared", nextAction: "Review", artifact: { subject: "Re: Editorial question", body: "Here is a proposed outline." } }, now)).rejects.toThrow("conversation changed");
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

it("preserves the prior artifact when interrupted research is deferred", async () => {
  const artifact = { recommendation: "Verified research already saved", evidence: ["https://example.com/guide"] };
  db.automationJobRun.findFirst.mockResolvedValue({ output: { ...leased(), kind: "RESEARCH", artifact } });
  const result = await completeScoutWork("tenant-a", "work", "lease-synthetic", { decision: "WAIT", summary: "Source unavailable", nextAction: "Retry source tomorrow", reviewInDays: 1, artifact: null }, now);
  expect(result.artifact).toEqual(artifact);
  expect(result.state).toBe("WAITING");
});

it("promotes an evidence-backed idea to a page task without approving or building it", async () => {
  db.automationJobRun.findFirst.mockResolvedValue({ output: { ...leased(), kind: "RESEARCH" } });
  const result = await completeScoutWork("tenant-a", "work", "lease-synthetic", { decision: "DELIVER", supervisor, summary: "Useful page opportunity", nextAction: "Prepare full brief", artifact: { proposedTitle: "Warehouse selection guide", proposedRoute: "/resources/warehouse-guide", hypothesis: "Answer a recurring service-fit question", newPage: true } }, now);
  expect(result.state).toBe("DONE");
  expect(db.websiteGrowthOpportunity.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ tenantId: "tenant-a", status: "REVIEWING", action: "CREATE_PAGE" }) }));
  expect(db.automationJobRun.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ tenantId: "tenant-a", jobType: WORK_JOB, output: expect.objectContaining({ kind: "PAGE", state: "READY" }) }) }));
  expect(db.websiteGrowthContentDraft.create).not.toHaveBeenCalled();
});

it("replenishes completed research immediately and respects an existing dated research wait", async () => {
  db.automationJobRun.findMany.mockResolvedValue([]);
  db.websiteGrowthOpportunity.findMany.mockResolvedValue([]); db.websiteGrowthBacklinkOpportunity.findMany.mockResolvedValue([]); db.websiteGrowthContentDraft.findMany.mockResolvedValue([]);
  const research = { ...newWork("RESEARCH", null, "Research", "Find useful work", null), state: "DONE" };
  db.automationJobRun.findFirst.mockImplementation(async (query: { where: { jobType: string } }) => query.where.jobType === WORK_JOB ? { id: "completed-research", output: research } : null);
  await reconcileScoutWork("tenant-a", now);
  expect(db.automationJobRun.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ id: stableId("tenant-a", "research:after:completed-research"), output: expect.objectContaining({ state: "READY", kind: "RESEARCH" }) }) }));
  db.automationJobRun.upsert.mockClear(); research.state = "WAITING";
  await reconcileScoutWork("tenant-a", now);
  expect(db.automationJobRun.upsert).not.toHaveBeenCalled();
});

it("allows a new outcome review to improve the same published page while retaining active-work deduplication", async () => {
  db.automationJobRun.findFirst.mockResolvedValue({ output: { ...leased(), kind: "MEASUREMENT", evidence: { measurement } } });
  db.websiteGrowthOpportunity.findFirst.mockResolvedValue(null);
  const input = { decision: "DELIVER", supervisor, summary: "Another improvement is warranted", nextAction: "Prepare the next brief", artifact: { proposedTitle: "Warehouse guide", proposedRoute: "/resources/warehouse-guide", hypothesis: "Improve the next conversion step", newPage: false } };
  await completeScoutWork("tenant-a", "first-outcome-review", "lease-synthetic", input, now);
  await completeScoutWork("tenant-a", "later-outcome-review", "lease-synthetic", input, now);
  const createdIds = db.websiteGrowthOpportunity.upsert.mock.calls.map(call => call[0].create.id);
  expect(createdIds[0]).not.toEqual(createdIds[1]);
  expect(db.websiteGrowthOpportunity.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ tenantId: "tenant-a", status: { in: ["NEW", "REVIEWING", "APPROVED", "IN_PROGRESS"] } }) }));
  db.websiteGrowthOpportunity.findFirst.mockResolvedValue({ id: "active-page-work" });
  await completeScoutWork("tenant-a", "another-review", "lease-synthetic", input, now);
  expect(db.websiteGrowthOpportunity.upsert).toHaveBeenLastCalledWith(expect.objectContaining({ where: { id: "active-page-work", tenantId: "tenant-a" }, update: {} }));
});

it.each(["WAIT", "CONTINUE", "DISMISS"])("does not promote an unfinished or rejected %s research artifact", async decision => {
  db.automationJobRun.findFirst.mockResolvedValue({ output: { ...leased(), kind: "RESEARCH" } });
  const result = await completeScoutWork("tenant-a", "work", "lease-synthetic", { decision, summary: "Research is not ready", nextAction: "Retain the evidence without promoting it", reviewInDays: 1,
    artifact: { proposedTitle: "Incomplete idea", proposedRoute: "/resources/incomplete", hypothesis: "Unverified", prospects: [{ incomplete: true }] } }, now);
  expect(result.state).toBe(decision === "WAIT" ? "WAITING" : decision === "CONTINUE" ? "READY" : "DISMISSED");
  expect(db.websiteGrowthOpportunity.upsert).not.toHaveBeenCalled();
  expect(db.automationJobRun.upsert).not.toHaveBeenCalled();
  expect(db.websiteGrowthBacklinkOpportunity.findMany).not.toHaveBeenCalled();
});

it.each([undefined, { verdict: "REVISE", reason: "Unsupported assertion" }, { verdict: "invalid", reason: "Invalid review" }])("preserves unchecked research without delivering or promoting it", async review => {
  db.automationJobRun.findFirst.mockResolvedValue({ output: { ...leased(), kind: "RESEARCH" } });
  const artifact = { proposedRoute: "/resources/guide", proposedTitle: "Guide", hypothesis: "Test", newPage: true };
  const saved = await completeScoutWork("tenant-a", "work", "lease-synthetic", { decision: "DELIVER", supervisor: review, summary: "Prepared", nextAction: "Review", artifact }, now);
  expect(saved.state).toBe("WAITING"); expect(saved.artifact).toEqual(artifact);
  expect(db.websiteGrowthOpportunity.upsert).not.toHaveBeenCalled(); expect(db.websiteGrowthContentDraft.create).not.toHaveBeenCalled();
});

it.each(["PARTIAL_OR_MISSING", "WAITING_FOR_DATA", undefined])("does not promote a measurement proposal with %s and no usable evidence even if the model passes it", async status => {
  db.automationJobRun.findFirst.mockResolvedValue({ output: { ...leased(), kind: "MEASUREMENT", evidence: { measurement: status ? { status } : null } } });
  const saved = await completeScoutWork("tenant-a", "work", "lease-synthetic", { decision: "DELIVER", supervisor, summary: "Proposal", nextAction: "Create page",
    artifact: { proposedRoute: "/resources/guide", proposedTitle: "Guide", hypothesis: "Test" } }, now);
  expect(saved.state).toBe("WAITING"); expect(db.websiteGrowthOpportunity.upsert).not.toHaveBeenCalled();
});

it("records a reviewed measurement without asking the owner to approve an informational report", async () => {
  db.automationJobRun.findFirst.mockResolvedValue({ output: { ...leased(), kind: "MEASUREMENT", evidence: { measurement } } });
  const saved = await completeScoutWork("tenant-a", "work", "lease-synthetic", { decision: "DELIVER", supervisor, summary: "Keep monitoring", nextAction: "Learn from this", artifact: { outcome: "KEEP", recommendation: "Retain the useful copy", confidence: "LOW" } }, now);
  expect(saved.state).toBe("DONE"); expect(saved.evidence.supervisor).toMatchObject({ verdict: "PASS" });
});

it("can learn and propose from partial post-change evidence with explicit low confidence", async () => {
  db.automationJobRun.findFirst.mockResolvedValue({ output: { ...leased(), kind: "MEASUREMENT", evidence: { measurement: { ...measurement, status: "PARTIAL_OR_MISSING" } } } });
  const saved = await completeScoutWork("tenant-a", "work", "lease-synthetic", { decision: "DELIVER", supervisor, summary: "Search supports another test", nextAction: "Prepare a brief",
    artifact: { proposedRoute: "/resources/guide", proposedTitle: "Guide", hypothesis: "Test a clearer answer", confidence: "HIGH", limitations: "Analytics is unavailable; this is not evidence of lead lift." } }, now);
  expect(saved.state).toBe("DONE"); expect(saved.artifact?.confidence).toBe("LOW"); expect(db.websiteGrowthOpportunity.upsert).toHaveBeenCalled();
});

it("escalates repeated quality failures and resumes only when the owner supplies direction", async () => {
  db.automationJobRun.findFirst.mockResolvedValue({ output: { ...leased(), kind: "RESEARCH", attempts: 3 } });
  const saved = await completeScoutWork("tenant-a", "work", "lease-synthetic", { decision: "DELIVER", supervisor: { verdict: "REVISE", reason: "Need verified evidence" }, summary: "Prepared", nextAction: "Review", artifact: { recommendation: "Unverified" } }, now);
  expect(saved.evidence.externalWait).toBe(true); expect(saved.evidence.escalation).toBeTruthy(); expect(isDue(saved, new Date("2027-01-01"))).toBe(false);
  db.automationJobRun.findFirst.mockResolvedValue({ output: saved });
  await reviewScoutWork("tenant-a", "user-synthetic", "work", saved.revision, "REVISE", "Use the approved public service facts");
  expect(db.automationJobRun.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ output: expect.objectContaining({ state: "READY", evidence: expect.objectContaining({ escalation: null, externalWait: false }) }) }) }));
});

it("does not allow a stale workboard to revise an already-approved brief", async () => {
  db.automationJobRun.findFirst.mockResolvedValue({ output: { ...work(), draftId: "draft-synthetic", state: "NEEDS_REVIEW" } });
  db.websiteGrowthContentDraft.findFirst.mockResolvedValue({ status: "APPROVED", approvedAt: now });
  await expect(reviewScoutWork("tenant-a", "user-synthetic", "work", 0, "REVISE", "Try again")).rejects.toThrow("left brief review");
  expect(db.automationJobRun.updateMany).not.toHaveBeenCalled();
});

it("frees capacity after approval using current source records inside the claim transaction", async () => {
  db.automationJobRun.findFirst.mockResolvedValue({ input: { ...DEFAULT_MISSION, enabled: true, maxActive: 1 } });
  db.automationJobRun.findMany.mockImplementation(async ({ where }: { where: { jobType: string } }) => where.jobType === WEBSITE_GROWTH_BUILD_JOB_TYPE
    ? [{ input: { contentDraftId: "draft-approved" }, output: { phase: "RUNNING", updatedAt: new Date().toISOString() }, status: "RUNNING", startedAt: new Date() }]
    : [{ id: "approved-work", output: { ...work(), state: "NEEDS_REVIEW", draftId: "draft-approved" } },
      { id: "next-work", output: { ...work(), referenceId: "opportunity-next", route: "/resources/guide" } }]);
  db.websiteGrowthContentDraft.findMany.mockResolvedValue([{ id: "draft-approved", opportunityId: "opportunity-synthetic", status: "APPROVED" }]);
  expect((await claimScoutWork("tenant-a", "next-work", "Continue useful work", now)).state).toBe("WORKING");
  await expect(claimScoutWork("tenant-a", "approved-work", "Stale research claim", now)).rejects.toThrow("unavailable");
});

it("refuses a second candidate for a route already being researched even with spare capacity", async () => {
  db.automationJobRun.findFirst.mockResolvedValue({ input: { ...DEFAULT_MISSION, enabled: true } });
  db.automationJobRun.findMany.mockResolvedValue([{ id: "candidate", output: work() }, { id: "active", output: leased() }]);
  await expect(claimScoutWork("tenant-a", "candidate", "Duplicate work", now)).rejects.toThrow("already has active");
  expect(db.automationJobRun.create).not.toHaveBeenCalled();
});

it("records a quality-reviewed site briefing without adding an owner acknowledgement task", async () => {
  db.automationJobRun.findFirst.mockResolvedValue({ output: { ...leased(), kind: "RESEARCH", evidence: { source: "site-review", effectiveness: { status: "PARTIAL_OR_STALE" } } } });
  const saved = await completeScoutWork("tenant-a", "site-review", "lease-synthetic", { decision: "DELIVER", supervisor, summary: "Investigated site changes", nextAction: "Review in two weeks", reviewInDays: 14,
    artifact: { recommendation: "Wait for more traffic while completing the existing service brief", limitations: "Analytics is unavailable", proposedRoute: "", prospects: [] } }, now);
  expect(saved.state).toBe("DONE"); expect(saved.nextReviewAt).toBe("2026-06-29T12:00:00.000Z");
  expect(saved.evidence.previousReviews).toHaveLength(1);
  expect(db.websiteGrowthOpportunity.upsert).not.toHaveBeenCalled();
});

it("reuses active page work even when a site review proposes a different title for the same route", async () => {
  db.automationJobRun.findFirst.mockResolvedValue({ output: { ...leased(), kind: "RESEARCH", evidence: { source: "site-review" } } });
  db.websiteGrowthOpportunity.findFirst.mockResolvedValue({ id: "existing-route-work" });
  await completeScoutWork("tenant-a", "site-review", "lease-synthetic", { decision: "DELIVER", supervisor, summary: "Investigated", nextAction: "Continue existing work", artifact: { proposedRoute: routeForTest(), proposedTitle: "Different title", hypothesis: "Clearer answer", prospects: [] } }, now);
  const query = db.websiteGrowthOpportunity.findFirst.mock.calls[0][0];
  expect(query.where.targetPage).toBe(routeForTest()); expect(query.where).not.toHaveProperty("topic");
  expect(db.websiteGrowthOpportunity.upsert.mock.calls[0][0].where.id).toBe("existing-route-work");
});
function routeForTest() { return "/services/warehouse"; }

it("reuses one due site-review record and respects a future review date", async () => {
  const id = stableId("tenant-a", "research:site-effectiveness");
  const site = { ...newWork("RESEARCH", null, "Site review", "Investigate", null, { source: "site-review" }, now), state: "DONE", nextReviewAt: now.toISOString() };
  db.websiteGrowthOpportunity.findMany.mockResolvedValue([]); db.websiteGrowthBacklinkOpportunity.findMany.mockResolvedValue([]);
  db.automationJobRun.findFirst.mockImplementation(async ({ where }) => {
    if (where.jobType === "WEBSITE_GROWTH_SCOUT_EFFECTIVENESS") return { output: { version: 1, attemptedAt: now.toISOString(), nextRefreshAt: now.toISOString(), windows: reviewWindows(now), inventory: { routes: [] }, sources: Object.fromEntries(["search_console", "ga4", "enquiries"].map(name => [name, { status: "UNAVAILABLE", attemptedAt: now.toISOString(), observedAt: null, data: null }])) } };
    if (where.id === id) return { id, output: site };
    return null;
  });
  await reconcileScoutWork("tenant-a", now);
  expect(db.automationJobRun.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id }), data: expect.objectContaining({ output: expect.objectContaining({ state: "READY", attempts: 0 }) }) }));
  db.automationJobRun.updateMany.mockClear(); site.nextReviewAt = "2026-07-01T00:00:00Z";
  await reconcileScoutWork("tenant-a", now); expect(db.automationJobRun.updateMany).not.toHaveBeenCalled();
});

it("allows a later cycle of the reusable site review to revisit a previously published proposal", async () => {
  db.websiteGrowthOpportunity.findFirst.mockResolvedValue(null);
  const input = { decision: "DELIVER", supervisor, summary: "Next improvement", nextAction: "Prepare brief", artifact: { proposedRoute: "/services/warehouse", proposedTitle: "Improve warehouse page", hypothesis: "Test the next weakness", prospects: [] } };
  for (const revision of [2, 8]) {
    db.automationJobRun.findFirst.mockResolvedValue({ output: { ...leased(), revision, kind: "RESEARCH", evidence: { source: "site-review" } } });
    await completeScoutWork("tenant-a", "same-recurring-review", "lease-synthetic", input, now);
  }
  expect(db.websiteGrowthOpportunity.upsert.mock.calls[0][0].create.id).not.toEqual(db.websiteGrowthOpportunity.upsert.mock.calls[1][0].create.id);
});
