import { describe, expect, it } from "vitest";
import { DEFAULT_MISSION, newWork } from "@/modules/website-growth/scout/model";
import { projectScoutWorkboard } from "@/modules/website-growth/scout/workboard-model";

const NOW = new Date("2026-09-17T16:00:00.000Z");
const item = (id: string, kind: Parameters<typeof newWork>[0], state: ReturnType<typeof newWork>["state"], nextReviewAt: string, evidence = {}) => ({
  ...newWork(kind, id, id, `Hypothesis for ${id}`, kind === "PAGE" ? `/${id}` : null, evidence, NOW), id, state, nextReviewAt
});

describe("Scout workboard projection", () => {
  it("separates due, future, external, working and owner-action work", () => {
    const result = projectScoutWorkboard([
      item("ready", "PAGE", "READY", NOW.toISOString()),
      item("due-wait", "RESEARCH", "WAITING", "2026-09-16T16:00:00.000Z"),
      item("future", "MEASUREMENT", "WAITING", "2026-10-17T16:00:00.000Z"),
      item("external", "PAGE", "WAITING", NOW.toISOString(), { externalWait: true }),
      { ...item("working", "RESEARCH", "WORKING", NOW.toISOString()), leaseUntil: "2026-09-17T16:30:00.000Z" },
      item("owner", "RELATIONSHIP", "NEEDS_REVIEW", NOW.toISOString())
    ], { ...DEFAULT_MISSION, enabled: true }, { usedSteps: 0, active: 1, available: true }, NOW);

    expect(result.due.map(value => value.id)).toEqual(["due-wait", "ready"]);
    expect(result.scheduled.map(value => value.id)).toEqual(["future"]);
    expect(result.external.map(value => value.id)).toEqual(["external"]);
    expect(result.working.map(value => value.id)).toEqual(["working"]);
    expect(result.ownerActions.map(value => value.id)).toEqual(["owner"]);
    expect(result.wakeStatus).toContain("choose one of 2 due items");
  });

  it("uses the same route deduplication as the worker selection packet", () => {
    const result = projectScoutWorkboard([
      item("first", "PAGE", "READY", NOW.toISOString()),
      { ...item("second", "PAGE", "READY", NOW.toISOString()), route: "/first" }
    ], { ...DEFAULT_MISSION, enabled: true }, { usedSteps: 0, active: 0, available: true }, NOW);

    expect(result.due).toHaveLength(1);
    expect(result.heldCandidates).toHaveLength(1);
    expect(result.due[0].route).toBe("/first");
    expect(result.heldCandidates[0].route).toBe("/first");
  });

  it("explains an empty wake and reports each durable source", () => {
    const result = projectScoutWorkboard([
      item("page", "PAGE", "WAITING", "2026-10-17T16:00:00.000Z"),
      item("reply", "RELATIONSHIP", "WAITING", "2026-10-17T16:00:00.000Z"),
      item("measurement", "MEASUREMENT", "WAITING", "2026-10-17T16:00:00.000Z"),
      item("exploration", "RESEARCH", "WAITING", "2026-10-17T16:00:00.000Z"),
      item("site", "RESEARCH", "WAITING", "2026-10-17T16:00:00.000Z", { source: "site-review" })
    ], { ...DEFAULT_MISSION, enabled: true }, { usedSteps: 0, active: 0, available: true }, NOW);

    expect(result.sourceCounts).toEqual({ pages: 1, replies: 1, measurements: 1, exploration: 1, siteReview: 1 });
    expect(result.wakeStatus).toContain("find nothing due");
    expect(result.wakeStatus).toContain("without using an AI research step");
  });

  it("explains budget and active-capacity stops before a due item", () => {
    const ready = [item("ready", "PAGE", "READY", NOW.toISOString())];
    expect(projectScoutWorkboard(ready, { ...DEFAULT_MISSION, enabled: true, dailySteps: 3 }, { usedSteps: 3, active: 0, available: false }, NOW).wakeStatus).toContain("research budget is used");
    expect(projectScoutWorkboard(ready, { ...DEFAULT_MISSION, enabled: true, maxActive: 2 }, { usedSteps: 0, active: 2, available: false }, NOW).wakeStatus).toContain("active-work limit is reached");
  });
});
