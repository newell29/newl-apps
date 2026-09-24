import { describe, expect, it } from "vitest";
import { DEFAULT_MISSION, isDue, newWork, type Work } from "@/modules/website-growth/scout/model";
import { projectSupervisorCorrections, scoutCandidates } from "@/modules/website-growth/scout/learning";
import { projectScoutWorkboard } from "@/modules/website-growth/scout/workboard-model";

const completed = new Date("2026-06-15T21:00:00.000Z");
const nextWake = new Date("2026-06-16T13:00:00.000Z");
const revision = (): Work & { id: string } => ({
  ...newWork("RESEARCH", null, "Synthetic publisher draft", "Finish verified work", null, {}, completed),
  id: "work-synthetic", state: "WAITING", attempts: 1, nextReviewAt: "2026-06-16T21:00:00.000Z",
  nextAction: "Remove the unsupported capacity claim", artifact: { recommendation: "Saved draft" },
  evidence: {
    supervisor: { verdict: "REVISE", reason: "Remove the unsupported capacity claim", reviewedAt: completed.toISOString() },
    waitBlocker: { type: "PUBLIC_RESEARCH", evidenceNeeded: "Verified public service facts", resolutionAction: "Check the public service page", resolvableByScout: true }
  }
});

describe("Supervisor corrections at the next available wake", () => {
  it("recovers an after-hours legacy wait for the next morning without changing saved history or approving work", () => {
    const saved = revision();
    const before = structuredClone(saved);
    const [ready] = projectSupervisorCorrections([saved]);
    expect(saved).toEqual(before);
    expect(ready).toMatchObject({ state: "READY", nextReviewAt: completed.toISOString(), attempts: 1, revision: 0,
      artifact: saved.artifact, nextAction: saved.nextAction, history: saved.history, evidence: saved.evidence });
    expect(isDue(ready, nextWake)).toBe(true);
    expect(scoutCandidates([ready], nextWake)).toEqual([ready]);
    const board = projectScoutWorkboard([ready], { ...DEFAULT_MISSION, enabled: true }, { available: true, usedSteps: 0, active: 0 }, nextWake);
    expect(board.due).toEqual([ready]);
    expect(board.scheduled).toEqual([]);
    expect(board.ownerActions).toEqual([]);
    expect(projectSupervisorCorrections([ready])).toEqual([ready]);
  });

  it.each(["DATA_REFRESH", "LOW_VOLUME", "EXTERNAL_SYSTEM", "TECHNICAL", "OWNER_INPUT"])("preserves a %s dependency and its date", type => {
    const saved = revision();
    saved.evidence.waitBlocker = { ...(saved.evidence.waitBlocker as object), type };
    expect(projectSupervisorCorrections([saved])).toEqual([saved]);
    expect(isDue(saved, nextWake)).toBe(false);
  });

  it.each([
    { supervisor: null }, { supervisor: { verdict: "REVISE" } },
    { supervisor: { verdict: "REVISE", reason: "Check source", reviewedAt: "invalid" } },
    { supervisor: { verdict: "WAIT", reason: "Source unavailable", reviewedAt: completed.toISOString() } },
    { waitBlocker: null }, { waitBlocker: { type: "PUBLIC_RESEARCH" } },
    { waitBlocker: { type: "PUBLIC_RESEARCH", resolvableByScout: true } },
    { externalWait: true }, { escalation: { reason: "Support required" } }
  ])("does not accelerate missing/partial review evidence or an external hold: %j", evidence => {
    const saved = revision(); saved.evidence = { ...saved.evidence, ...evidence };
    expect(projectSupervisorCorrections([saved])).toEqual([saved]);
  });

  it.each(["WORKING", "NEEDS_REVIEW", "DONE", "DISMISSED"] as const)("does not reopen %s work", state => {
    const saved = { ...revision(), state };
    expect(projectSupervisorCorrections([saved])).toEqual([saved]);
  });

  it.each([null, {}])("keeps an empty or missing draft deferred: %j", artifact => {
    const saved = { ...revision(), artifact };
    expect(projectSupervisorCorrections([saved])).toEqual([saved]);
  });

  it("retains the attempt cap, daily budget and active-work limit", () => {
    const exhausted = { ...revision(), attempts: 3 };
    expect(projectSupervisorCorrections([exhausted])).toEqual([exhausted]);
    const ready = projectSupervisorCorrections([revision()]);
    const mission = { ...DEFAULT_MISSION, enabled: true, dailySteps: 7, maxActive: 2 };
    expect(projectScoutWorkboard(ready, mission, { available: false, usedSteps: 7, active: 0 }, nextWake).wakeStatus).toContain("budget is used");
    expect(projectScoutWorkboard(ready, mission, { available: false, usedSteps: 0, active: 2 }, nextWake).wakeStatus).toContain("active-work limit");
  });

  it.each([undefined, { status: "PARTIAL_OR_MISSING", sources: [] },
    { status: "PARTIAL_OR_MISSING", sources: [{ period: "after", status: "UNAVAILABLE", metrics: null }] },
    { status: "AVAILABLE", sources: [{ period: "after", status: "AVAILABLE", metrics: { clicks: 4 } }] },
    { status: "AVAILABLE", windows: { ready: false }, sources: [{ period: "after", status: "AVAILABLE", metrics: { clicks: 4 } }] }
  ])("preserves a measurement wait without usable completed-window evidence: %j", measurement => {
    const saved = { ...revision(), kind: "MEASUREMENT" as const };
    saved.evidence.measurement = measurement;
    expect(projectSupervisorCorrections([saved])).toEqual([saved]);
  });

  it("allows a narrative correction with partial but usable post-change results", () => {
    const saved = { ...revision(), kind: "MEASUREMENT" as const };
    saved.evidence.measurement = { status: "PARTIAL_OR_MISSING", windows: { ready: true }, sources: [
      { period: "after", status: "AVAILABLE", metrics: { clicks: 4 } }, { period: "after", status: "UNAVAILABLE", metrics: null }
    ] };
    expect(projectSupervisorCorrections([saved])[0].state).toBe("READY");
  });
});
