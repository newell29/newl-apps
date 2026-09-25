import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import { newWork, type Work } from "@/modules/website-growth/scout/model";
import { pageHandoffTransition, projectPageHandoffs, needsOwner } from "@/modules/website-growth/scout/lifecycle";
import { scoutCandidates, scoutCompetitorEvidence, scoutOutcomes } from "@/modules/website-growth/scout/learning";

const cache = vi.hoisted(() => vi.fn());
vi.mock("@/modules/website-growth/scout-run", () => ({ loadWebsiteGrowthSemrushCache: cache }));
const drafts = vi.fn(), builds = vi.fn();
const tx = { websiteGrowthContentDraft: { findMany: drafts }, automationJobRun: { findMany: builds } } as unknown as Prisma.TransactionClient;
const now = new Date("2026-06-15T12:00:00Z");
const page = (): Work & { id: string } => ({ ...newWork("PAGE", "opportunity-synthetic", "Warehouse", "Clarify service fit", "/services/warehouse", {}, now),
  id: "work-synthetic", draftId: "draft-synthetic", state: "NEEDS_REVIEW" });
beforeEach(() => { vi.resetAllMocks(); drafts.mockResolvedValue([]); builds.mockResolvedValue([]); });

describe("Authoritative page handoffs", () => {
  it("moves an approved brief out of the owner queue on read without waiting for a worker wake", async () => {
    drafts.mockResolvedValue([{ id: "draft-synthetic", opportunityId: "opportunity-synthetic", status: "APPROVED" }]);
    builds.mockResolvedValue([{ input: { contentDraftId: "draft-synthetic" }, output: { phase: "RUNNING", updatedAt: new Date().toISOString() }, status: "RUNNING", startedAt: new Date() }]);
    const [item] = await projectPageHandoffs(tx, "tenant-a", [page()]);
    expect(item.state).toBe("WAITING"); expect(needsOwner(item)).toBe(false);
    expect(item.nextAction).toContain("implementing"); expect(item.revision).toBe(0);
    expect(drafts).toHaveBeenCalledWith(expect.objectContaining({ where: { tenantId: "tenant-a", opportunityId: { in: ["opportunity-synthetic"] } } }));
    expect(builds).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ tenantId: "tenant-a" }) }));
  });
  it.each(["FAILED", "PR_OPEN", "PREVIEW_READY", "MISSING", "STALE"])("makes %s a specific owner action without restarting research", async phase => {
    drafts.mockResolvedValue([{ id: "draft-synthetic", opportunityId: "opportunity-synthetic", status: "APPROVED" }]);
    builds.mockResolvedValue(phase === "MISSING" ? [] : [{ input: { contentDraftId: "draft-synthetic" },
      output: { phase: phase === "STALE" ? "RUNNING" : phase }, status: phase === "FAILED" ? "ERROR" : "RUNNING", startedAt: new Date("2026-01-01") }]);
    const [item] = await projectPageHandoffs(tx, "tenant-a", [page()]);
    expect(needsOwner(item)).toBe(true); expect(item.evidence.externalWait).toBe(true);
    expect(scoutCandidates([item])).toEqual([]);
  });
  it("preserves owner-requested revision and projects published/rejected records even after an old lease", async () => {
    drafts.mockResolvedValue([{ id: "draft-synthetic", opportunityId: "opportunity-synthetic", status: "DRAFT" }]);
    const revision = { ...page(), state: "WORKING" as const, lease: "private-lease" };
    expect((await projectPageHandoffs(tx, "tenant-a", [revision]))[0]).toEqual(revision);
    for (const [status, state] of [["PUBLISHED", "DONE"], ["REJECTED", "DISMISSED"]]) {
      drafts.mockResolvedValue([{ id: "draft-synthetic", opportunityId: "opportunity-synthetic", status }]);
      const [item] = await projectPageHandoffs(tx, "tenant-a", [revision]);
      expect(item.state).toBe(state); expect(item.lease).toBeNull(); expect(needsOwner(item)).toBe(false);
    }
  });
  it("records a terminal handoff once even when the old build phase later changes", async () => {
    drafts.mockResolvedValue([{ id: "draft-synthetic", opportunityId: "opportunity-synthetic", status: "PUBLISHED" }]);
    builds.mockResolvedValue([{ input: { contentDraftId: "draft-synthetic" }, output: { phase: "RUNNING" }, status: "RUNNING", startedAt: now }]);
    const previous = page();
    const firstProjection = (await projectPageHandoffs(tx, "tenant-a", [previous]))[0];
    const transitioned = pageHandoffTransition(previous, firstProjection, now);
    expect(transitioned?.history.at(-1)?.action).toBe("HANDOFF");
    expect(transitioned?.evidence.handoff).toMatchObject({ draftStatus: "PUBLISHED", phase: null });

    builds.mockResolvedValue([{ input: { contentDraftId: "draft-synthetic" }, output: { phase: "PR_OPEN" }, status: "RUNNING", startedAt: now }]);
    const secondProjection = (await projectPageHandoffs(tx, "tenant-a", [{ id: previous.id, ...transitioned! }]))[0];
    expect(pageHandoffTransition(transitioned!, secondProjection, now)).toBeNull();
    expect(secondProjection.history).toHaveLength(transitioned!.history.length);
  });
});

describe("Results inform subsequent prioritization", () => {
  it("keeps due measurements and research visible, groups page candidates and excludes routes already being built", () => {
    const candidates = Array.from({ length: 60 }, (_, index) => ({ ...page(), id: `page-${index}`, route: `/resources/page-${index}`, state: "READY" as const }));
    const measurement = { ...newWork("MEASUREMENT", "draft", "Measure", "Test", "/services/warehouse", {}, now), id: "measurement" };
    const selected = scoutCandidates([...candidates, { ...measurement, kind: "RESEARCH", id: "research" }, measurement], now);
    expect(selected[0].id).toBe("measurement"); expect(selected[1].id).toBe("research"); expect(selected).toHaveLength(50);
    expect(scoutCandidates([{ ...page(), state: "READY" }, { ...page(), id: "duplicate", state: "READY" }], now)).toHaveLength(1);
    expect(scoutCandidates([{ ...page(), state: "READY" }, { ...page(), id: "building", state: "WAITING", evidence: { externalWait: true } }], now)).toHaveLength(0);
  });
  it("passes recorded partial results separately from interpretation and excludes correspondence", () => {
    const measurement = { ...page(), kind: "MEASUREMENT" as const, state: "WAITING" as const,
      evidence: { measurement: { status: "PARTIAL_OR_MISSING", sources: [{ source: "ga4", metrics: null }] } },
      artifact: { recommendation: "Wait for analytics", body: "Not for the selection packet" } };
    const outcomes = scoutOutcomes([measurement, { ...page(), kind: "RELATIONSHIP", state: "DONE", artifact: { body: "Private correspondence" } }]);
    expect(outcomes).toHaveLength(1); expect(outcomes[0].measurement).toEqual(measurement.evidence.measurement);
    expect(outcomes[0].interpretation?.recommendation).toBe("Wait for analytics");
    expect(JSON.stringify(outcomes)).not.toContain("correspondence"); expect(JSON.stringify(outcomes)).not.toContain("selection packet");
  });
  it("dates reports independently even when the tracking cache is fresh, and survives unavailable reports", async () => {
    cache.mockResolvedValue({ fresh: true, reports: [
      { reportType: "SEO_OVERVIEW", observedAt: "2026-01-01T00:00:00Z", metrics: {}, excerpt: "Historical report" },
      { reportType: "POSITION_TRACKING", observedAt: "2026-06-14T00:00:00Z", metrics: {}, excerpt: "Recent positions" }
    ], tracking: null });
    const evidence = await scoutCompetitorEvidence("tenant-a", now);
    expect(cache).toHaveBeenCalledWith("tenant-a", now);
    expect(evidence.reports.map(report => report.fresh)).toEqual([false, true]);
    cache.mockRejectedValue(new Error("Private integration details"));
    const missing = await scoutCompetitorEvidence("tenant-a", now);
    expect(missing.status).toBe("UNAVAILABLE"); expect(JSON.stringify(missing)).not.toContain("Private integration details");
  });
});
