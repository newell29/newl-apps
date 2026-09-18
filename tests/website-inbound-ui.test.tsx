import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ query: vi.fn(), canMutate: vi.fn() }));
vi.mock("@/server/tenant-context", () => ({
  getAuthenticatedContext: async () => ({ tenantId: "tenant-a", userId: "user-a", role: "ADMIN" })
}));
vi.mock("@/server/auth/authorization", () => ({
  requireModule: async () => {},
  resolveRoleCanMutate: mocks.canMutate
}));
vi.mock("@/modules/website-inbound/queries", () => ({ getWebsiteInboundShell: mocks.query }));
vi.mock("@/modules/website-inbound/actions", () => ({
  addOpportunityNoteAction: vi.fn(),
  createOpportunityAction: vi.fn(),
  updateOpportunityAction: vi.fn(),
  generateOpportunityEmailDraftAction: vi.fn(),
  handoffOpportunityMailboxAction: vi.fn(),
  linkOpportunityEmailAction: vi.fn(),
  sendOpportunityEmailDraftAction: vi.fn(),
  syncOpportunityCorrespondenceAction: vi.fn()
}));
import Page from "@/app/(authenticated)/website-inbound/page";
const detail = {
  id: "row-a",
  revision: 0,
  company: null,
  name: null,
  phone: null,
  email: null,
  primaryNeed: null,
  source: null,
  status: "NEW",
  ownerUserId: null,
  receivedOn: new Date("2026-09-16Z"),
  followUpOn: null,
  nextAction: null,
  closedReason: null,
  entryMethod: "WEBSITE_FORM",
  contactChannel: "WEBSITE_FORM",
  fields: { Message: "Synthetic original request" },
  pageUrl: null,
  communicationMailbox: null
};
beforeEach(() => {
  mocks.canMutate.mockResolvedValue(true);
  mocks.query.mockResolvedValue({
    submissions: [detail],
    detail,
    owners: [{ id: "user-a", label: "Test User", email: "user@example.com", mailboxAddress: "user@example.com" }],
    formTypes: [],
    metrics: { totalCount: 1, newCount: 1, openCount: 1, overdueCount: 0 },
    page: 1,
    pageCount: 1,
    activities: [
      {
        id: "note-a",
        type: "NOTE",
        actorName: "Test User",
        createdAt: new Date("2026-09-16Z"),
        body: "Synthetic follow-up note",
        changes: null
      }
    ],
    activityPages: 1,
    correspondence: [],
    unmatchedCorrespondence: [],
    mailboxConfiguration: {
      enabled: true,
      draftingEnabled: true,
      reason: null,
      mailboxes: ["user@example.com"],
      ownerMailboxes: { "user-a": "user@example.com" }
    }
  });
});
describe("inbound opportunity interface", () => {
  it("renders editable missing website contact details, notes and original evidence together", async () => {
    const html = renderToStaticMarkup(
      await Page({ searchParams: Promise.resolve({ selected: "row-a" }) })
    );
    for (const text of [
      "Save opportunity",
      'name="phone"',
      'name="name"',
      'name="primaryNeed"',
      "Add a note",
      "Synthetic follow-up note",
      "Original website submission",
      "Synthetic original request",
      "Unassigned",
      "Microsoft 365 correspondence",
      "Email correspondence"
    ])
      expect(html).toContain(text);
    expect(html).toContain('name="contactChannel" value="WEBSITE_FORM"');
  });
  it("hides mutation controls for read-only members while keeping the history readable", async () => {
    mocks.canMutate.mockResolvedValue(false);
    const html = renderToStaticMarkup(
      await Page({ searchParams: Promise.resolve({ selected: "row-a" }) })
    );
    expect(html).not.toContain("Save opportunity");
    expect(html).not.toContain("+ Add opportunity");
    expect(html).not.toContain("Add a note");
    expect(html).not.toContain("Sync mail now");
    expect(html).not.toContain("Prepare initial email");
    expect(html).toContain("view-only access");
    expect(html).toContain("Synthetic follow-up note");
    expect(html).toContain("disabled");
  });
  it("explains disabled Microsoft 365 configuration even when an owner is already assigned", async () => {
    mocks.query.mockResolvedValue({
      submissions: [{ ...detail, ownerUserId: "user-a" }],
      detail: { ...detail, ownerUserId: "user-a" },
      owners: [{ id: "user-a", label: "Test User", email: "user@example.com", mailboxAddress: null }],
      formTypes: [],
      metrics: { totalCount: 1, newCount: 1, openCount: 1, overdueCount: 0 },
      page: 1,
      pageCount: 1,
      activities: [],
      activityPages: 1,
      correspondence: [],
      unmatchedCorrespondence: [],
      mailboxConfiguration: {
        enabled: false,
        draftingEnabled: false,
        reason: "Microsoft 365 is not active for this organization.",
        mailboxes: [],
        ownerMailboxes: {}
      }
    });
    const html = renderToStaticMarkup(
      await Page({ searchParams: Promise.resolve({ selected: "row-a" }) })
    );
    expect(html).toContain("Microsoft 365 correspondence is not enabled for this organization.");
    expect(html).toContain(
      "Email tracking and drafts will appear here after Microsoft 365 correspondence is enabled."
    );
    expect(html).not.toContain(
      "Assign this opportunity to an approved mailbox owner to prepare email."
    );
  });
});
