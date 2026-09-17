import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { EffectivenessReview, WorkImpactList } from "@/modules/website-growth/scout/effectiveness-view";
import { DEFAULT_MISSION, newWork } from "@/modules/website-growth/scout/model";
vi.mock("@/modules/website-growth/scout/actions", () => ({ refreshScoutEffectivenessAction: vi.fn() }));
const props = { review: null, items: [], mission: DEFAULT_MISSION, canReview: false, workspaceAvailable: true, truncated: false, competitorSummary: "No reports" };
describe("Scout effectiveness view", () => {
  it("keeps missing evidence distinct from a healthy site or zero traffic", () => {
    const html = renderToStaticMarkup(<EffectivenessReview {...props} />);
    expect(html).toContain("No site review is saved"); expect(html).toContain("not evidence of zero traffic");
    expect(html).toContain("Page performance"); expect(html).toContain("Opportunities"); expect(html).toContain("Work &amp; impact");
    expect(html).not.toContain("Refresh saved evidence"); expect(html).toContain("not historical conversion stages");
  });
  it("renders only the authorized refresh control and reports a work-history gap", () => {
    const html = renderToStaticMarkup(<EffectivenessReview {...props} canReview workspaceAvailable={false} />);
    expect(html).toContain("Refresh saved evidence"); expect(html).toContain("does not run Scout or consume a research step"); expect(html).toContain("Work history could not be loaded");
  });
  it("escapes the model briefing and clearly labels an unreviewed draft", () => {
    const item = { ...newWork("RESEARCH", null, "Site review", "Investigate", null, { source: "site-review" }), id: "review", artifact: { recommendation: "<script>untrusted</script>" } };
    const html = renderToStaticMarkup(<EffectivenessReview {...props} items={[item]} />);
    expect(html).toContain("&lt;script&gt;"); expect(html).not.toContain("<script>untrusted"); expect(html).toContain("Draft /");
  });
});


describe("delivered work evidence", () => {
  it.each(["DONE", "DISMISSED"] as const)("does not present %s research without a brief as prepared or delivered work", state => {
    const item = { ...newWork("PAGE", "synthetic-opportunity", "Abandoned investigation", "Research only", "/services/example"), id: "work-synthetic", state };
    const html = renderToStaticMarkup(<WorkImpactList items={[item]} />);
    expect(html).toContain("No delivered briefs or page outcome records yet");
    expect(html).not.toContain("Abandoned investigation"); expect(html).not.toContain("Prepared — not verified live");
  });
  it("distinguishes rejected and prepared briefs from confirmed publication", () => {
    const page = { ...newWork("PAGE", "synthetic-opportunity", "Service brief", "Improve clarity", "/services/example"), id: "work", draftId: "draft-synthetic" };
    const closed = renderToStaticMarkup(<WorkImpactList items={[{ ...page, state: "DISMISSED", evidence: { handoff: { draftStatus: "REJECTED" } } }]} />);
    expect(closed).toContain("Closed — not published"); expect(closed).not.toContain("Approved / build handoff");
    expect(renderToStaticMarkup(<WorkImpactList items={[page]} />)).toContain("Prepared — not verified live");
    expect(renderToStaticMarkup(<WorkImpactList items={[{ ...page, state: "DONE", evidence: { handoff: { draftStatus: "PUBLISHED" } } }]} />)).toContain(">Published<");
  });
});
