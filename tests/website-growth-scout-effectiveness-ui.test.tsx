import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { EffectivenessReview } from "@/modules/website-growth/scout/effectiveness-view";
import { DEFAULT_MISSION, newWork } from "@/modules/website-growth/scout/model";
vi.mock("@/modules/website-growth/scout/actions", () => ({ refreshScoutEffectivenessAction: vi.fn() }));
const props = { review: null, items: [], mission: DEFAULT_MISSION, canReview: false, workspaceAvailable: true, truncated: false, competitorSummary: "No reports" };
describe("Scout effectiveness view", () => {
  it("keeps missing evidence distinct from a healthy site or zero traffic", () => {
    const html = renderToStaticMarkup(<EffectivenessReview {...props} />);
    expect(html).toContain("No site review is saved"); expect(html).toContain("not evidence of zero traffic");
    expect(html).toContain("Page performance"); expect(html).toContain("Opportunities"); expect(html).toContain("Work &amp; impact");
    expect(html).not.toContain("Check review freshness"); expect(html).toContain("not historical conversion stages");
  });
  it("renders only the authorized refresh control and reports a work-history gap", () => {
    const html = renderToStaticMarkup(<EffectivenessReview {...props} canReview workspaceAvailable={false} />);
    expect(html).toContain("Check review freshness"); expect(html).toContain("Work history could not be loaded");
  });
  it("escapes the model briefing and clearly labels an unreviewed draft", () => {
    const item = { ...newWork("RESEARCH", null, "Site review", "Investigate", null, { source: "site-review" }), id: "review", artifact: { recommendation: "<script>untrusted</script>" } };
    const html = renderToStaticMarkup(<EffectivenessReview {...props} items={[item]} />);
    expect(html).toContain("&lt;script&gt;"); expect(html).not.toContain("<script>untrusted"); expect(html).toContain("Draft /");
  });
});
