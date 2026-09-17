import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import ScoutWorkPage from "@/app/(authenticated)/website-growth/marketing/page";
import { DEFAULT_MISSION, newWork } from "@/modules/website-growth/scout/model";
const mocks = vi.hoisted(() => ({ context: vi.fn(), workspace: vi.fn(), recipients: vi.fn(), canMutate: vi.fn() }));
vi.mock("@/server/tenant-context", () => ({ getAuthenticatedContext: mocks.context }));
vi.mock("@/server/auth/authorization", () => ({ requireModule: vi.fn(), resolveRoleCanMutate: mocks.canMutate }));
vi.mock("@/server/db", () => ({ prisma: { websiteGrowthBacklinkOpportunity: { findMany: mocks.recipients } } }));
vi.mock("@/modules/website-growth/scout/store", () => ({ scoutWorkspace: mocks.workspace }));
vi.mock("@/modules/website-growth/scout/workboard-refresh", () => ({ WorkboardRefresh: () => null }));
vi.mock("@/modules/website-growth/scout/actions", () => ({ proposeScoutPageAction: vi.fn(), refreshScoutWorkAction: vi.fn(), reviewScoutWorkAction: vi.fn(), saveScoutMissionAction: vi.fn(), sendScoutReplyAction: vi.fn() }));
beforeEach(() => {
  mocks.context.mockResolvedValue({ tenantId: "tenant-a", role: "ADMIN" }); mocks.canMutate.mockResolvedValue(true);
  mocks.recipients.mockResolvedValue([{ id: "publisher-synthetic", recipientEmail: "editor@example.com" }]);
  mocks.workspace.mockResolvedValue({ configured: false, mission: DEFAULT_MISSION, items: [], truncated: false });
});
describe("Scout marketing workboard", () => {
  it("shows a useful paused setup and empty states", async () => {
    const html = renderToStaticMarkup(await ScoutWorkPage());
    expect(html).toContain("Scout marketing workboard"); expect(html).toContain("Research paused");
    expect(html).toContain("No work needs your decision"); expect(html).toContain("Save direction");
    expect(html).toContain("What happens when Scout wakes"); expect(html).toContain("Where new work comes from");
    expect(html).toContain("stop because research is paused");
  });
  it("shows the exact proposed recipient and response with an explicit send confirmation", async () => {
    const item = { ...newWork("RELATIONSHIP", "publisher-synthetic", "Publisher follow-up", "Prepare useful response", null), id: "work-synthetic",
      state: "NEEDS_REVIEW", artifact: { subject: "Re: Outline", body: "Here is a practical outline." } };
    mocks.workspace.mockResolvedValue({ configured: true, mission: DEFAULT_MISSION, items: [item], truncated: false });
    const html = renderToStaticMarkup(await ScoutWorkPage());
    expect(html).toContain("editor@example.com"); expect(html).toContain("Here is a practical outline.");
    expect(html).toContain("I approve sending this response"); expect(html).toContain("Approve and send response");
  });
  it("does not render mutation controls for read-only users", async () => {
    mocks.context.mockResolvedValue({ tenantId: "tenant-a", role: "READ_ONLY" });
    const html = renderToStaticMarkup(await ScoutWorkPage());
    expect(html).not.toContain("Save direction"); expect(html).not.toContain("Check for newly available work"); expect(html).not.toContain("Approve and send");
  });
  it("renders unsafe model text as escaped text rather than executable markup", async () => {
    mocks.workspace.mockResolvedValue({ configured: true, mission: DEFAULT_MISSION, truncated: false,
      items: [{ ...newWork("RESEARCH", null, "Research", "Investigate", null), id: "work", state: "NEEDS_REVIEW",
        artifact: { recommendation: '<script>alert("unsafe")</script>', evidence: ["Public source"] } }] });
    const html = renderToStaticMarkup(await ScoutWorkPage());
    expect(html).not.toContain('<script>alert("unsafe")</script>'); expect(html).toContain("&lt;script&gt;");
  });
});

it("shows recorded source measurements separately from the model with missing sources labelled", async () => {
  mocks.workspace.mockResolvedValue({ configured: true, mission: DEFAULT_MISSION, truncated: false,
    items: [{ ...newWork("MEASUREMENT", "draft-synthetic", "Measure page", "Review outcomes", "/services/warehouse"), id: "measurement", state: "NEEDS_REVIEW",
      evidence: { measurement: { windows: { before: { startDate: "2026-01-01", endDate: "2026-01-28" } }, sources: [
        { source: "search_console", period: "before", status: "AVAILABLE", metrics: { clicks: 42 } },
        { source: "search_console", period: "after", status: "NO_MATCHING_ROWS", metrics: null }
      ] } }, artifact: { recommendation: "Wait for more evidence." } }] });
  const html = renderToStaticMarkup(await ScoutWorkPage());
  expect(html).toContain("42 clicks"); expect(html).toContain("No matching data"); expect(html).toContain("Unavailable");
  expect(html).toContain("Wait for more evidence."); expect(html).toContain("2026-01-01");
});

it("does not present available research as an owner decision", async () => {
  mocks.workspace.mockResolvedValue({ configured: true, mission: DEFAULT_MISSION, truncated: false,
    items: [{ ...newWork("PAGE", "opportunity-synthetic", "Investigate page", "Improve clarity", "/resources/guide"), id: "work-synthetic" }] });
  const html = renderToStaticMarkup(await ScoutWorkPage());
  expect(html).toContain("Available to Scout — 1 item");
  expect(html).not.toMatch(/<select[^>]*name="decision"/);
  expect(html).not.toContain("Save decision");
});

it("shows approved builds as external work with no second brief decision or fictional research date", async () => {
  mocks.workspace.mockResolvedValue({ configured: true, mission: DEFAULT_MISSION, truncated: false,
    items: [{ ...newWork("PAGE", "opportunity", "Build page", "Improve clarity", "/resources/guide"), id: "work", draftId: "draft-synthetic", state: "WAITING",
      nextAction: "The website builder is implementing your approved brief.", evidence: { externalWait: true, handoff: { draftStatus: "APPROVED", phase: "RUNNING", needsOwner: false } } }] });
  const html = renderToStaticMarkup(await ScoutWorkPage());
  expect(html).toContain("No work needs your decision"); expect(html).toContain("External systems"); expect(html).toContain("Open build and preview");
  expect(html).not.toContain("Save decision"); expect(html).not.toContain("Scout checks again");
  expect(html).toContain("Available to Scout"); expect(html).toContain("No page outcome has been measured yet");
});

it("separates future reviews from due work and only shows decisions for owner actions", async () => {
  const future = { ...newWork("MEASUREMENT", "draft-future", "Future measurement", "Measure later", "/future"), id: "future", state: "WAITING" as const,
    nextReviewAt: "2099-01-01T00:00:00.000Z" };
  const due = { ...newWork("RESEARCH", null, "Resume quality review", "Finish review", null), id: "due", state: "WAITING" as const,
    nextReviewAt: "2020-01-01T00:00:00.000Z" };
  const owner = { ...newWork("RESEARCH", null, "Needs direction", "Owner input", null), id: "owner", state: "WAITING" as const,
    evidence: { escalation: "Three attempts need direction." } };
  mocks.workspace.mockResolvedValue({ configured: true, mission: { ...DEFAULT_MISSION, enabled: true }, items: [future, due, owner], truncated: false,
    capacity: { usedSteps: 0, active: 0, available: true } });
  const html = renderToStaticMarkup(await ScoutWorkPage());
  expect(html).toContain("Scheduled reviews"); expect(html).toContain("Future measurement");
  expect(html).toContain("Available to Scout — 1 item"); expect(html).toContain("Resume quality review");
  expect(html).toContain("Your decisions"); expect(html).toContain("Needs direction"); expect(html).toContain("Waiting for your decision");
  expect(html.match(/Save decision/g)).toHaveLength(1);
});
