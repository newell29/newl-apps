import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AuthorityBoard } from "@/modules/website-growth/authority/board";
import type { authorityWorkspace } from "@/modules/website-growth/authority/store";
import type { Action } from "@/modules/website-growth/authority/model";
vi.mock("@/modules/website-growth/authority/actions", () => ({ saveAuthorityCampaignAction: vi.fn(), reviewAuthorityPlanAction: vi.fn() }));
type Workspace = Awaited<ReturnType<typeof authorityWorkspace>>;
function workspace(): Workspace { return { campaign: null, researchEnabled: false, actions: [], opportunities: [], wake: null, truncated: false }; }
describe("Authority control centre walkthrough", () => {
  it("distinguishes research, approval, execution and measured outcomes in the empty pilot", () => {
    const html = renderToStaticMarkup(<AuthorityBoard workspace={workspace()} canReview />);
    for (const text of ["Authority campaigns", "Start the placement pilot", "Research:", "Executor:", "Runtime cutover is still required", "Your decisions", "Ready and working", "Verified placements", "retire"]) expect(html).toContain(text);
    expect(html).not.toContain("Approve all");
  });
  it("shows the exact proposal, concrete blockers, receipt and live evidence separately", () => {
    const base: Action = { version: 1, revision: 0, campaignId: "campaign", title: "Synthetic publisher", state: "REVIEW",
      sourceUpdatedAt: "2026-09-23", replyAt: null, approvedBy: null, approvedAt: null, claimId: null, lease: null, leaseUntil: null, startedAt: null, finishedAt: null,
      result: "Exact action ready", liveUrl: null, history: [], plan: { opportunityId: "publisher", method: "EMAIL", route: "https://publisher.example.com/contact",
        recipientEmail: "editor@example.com", recipientCountry: "US", consentBasis: "US_BUSINESS_OUTREACH", subject: "Distribution guide",
        body: '<script>unsafe()</script>Useful guide', fields: [], evidence: "Published editorial address", checkedAt: "2026-09-23", completion: "Accepted message",
        reason: "Relevant audience", free: true, accountRequired: false, termsUrl: "" } };
    const w = workspace(); w.actions = [{ id: "review", ...base }, { id: "manual", ...base, title: "Owner-only directory", plan: { ...base.plan, method: "MANUAL" as const } }, { id: "hold", ...base, state: "UNCERTAIN", result: "Reconcile publisher receipt" },
      { id: "live", ...base, state: "LIVE", liveUrl: "https://publisher.example.com/guide", result: "Verified anchor" }];
    const html = renderToStaticMarkup(<AuthorityBoard workspace={w} canReview />);
    expect(html).toContain("editor@example.com"); expect(html).toContain("Approve exact action"); expect(html).toContain("Record reconciliation and close");
    expect(html).toContain("Verified placement"); expect(html).toContain("&lt;script&gt;"); expect(html).not.toContain("<script>unsafe");
    expect(html).toContain("Record manual submission"); expect(html).toContain("marks the action submitted, not live");
    const readOnly = renderToStaticMarkup(<AuthorityBoard workspace={w} canReview={false} />);
    expect(readOnly).not.toContain("Approve exact action"); expect(readOnly).not.toContain("Record manual submission"); expect(readOnly).not.toContain("Save campaign"); expect(readOnly).not.toContain("Record reconciliation and close");
  });
});
