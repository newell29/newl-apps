import { beforeEach, describe, expect, it, vi } from "vitest";
import { reviewScoutWorkAction } from "@/modules/website-growth/scout/actions";
import { ScoutWorkError } from "@/modules/website-growth/scout/model";
const mocks = vi.hoisted(() => ({ context: vi.fn(), review: vi.fn(), invalidate: vi.fn() }));
vi.mock("@/server/tenant-context", () => ({ getAuthenticatedContext: mocks.context }));
vi.mock("@/server/auth/authorization", () => ({ requireModule: vi.fn(), requireMutationAccess: vi.fn(), requireRole: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.invalidate }));
vi.mock("@/modules/website-growth/scout/store", () => ({ reviewScoutWork: mocks.review }));
vi.mock("@/modules/website-growth/scout/reply", () => ({ approveAndSendScoutReply: vi.fn() }));
const form = () => {
  const data = new FormData(); data.set("id", "synthetic-work"); data.set("revision", "3");
  data.set("decision", "REVISE"); data.set("feedback", "Use this saved next action."); return data;
};
beforeEach(() => { vi.resetAllMocks(); mocks.context.mockResolvedValue({ tenantId: "tenant-a", userId: "owner-synthetic", role: "ADMIN" }); });
describe("Scout owner review form", () => {
  it("saves the explicit decision without requiring a submit-button field", async () => {
    expect(await reviewScoutWorkAction(form())).toEqual({ error: null });
    expect(mocks.review).toHaveBeenCalledWith("tenant-a", "owner-synthetic", "synthetic-work", 3, "REVISE", "Use this saved next action.");
    expect(mocks.invalidate).toHaveBeenCalledWith("/website-growth");
  });
  it("keeps a missing decision error inside the form instead of crashing the page", async () => {
    const input = form(); input.delete("decision");
    expect(await reviewScoutWorkAction(input)).toEqual({ error: "Decision is required (maximum 50 characters)." });
    expect(mocks.review).not.toHaveBeenCalled();
  });
  it("shows a recoverable stale-review message", async () => {
    mocks.review.mockRejectedValue(new ScoutWorkError("This work changed. Reload before reviewing.", 409));
    expect(await reviewScoutWorkAction(form())).toEqual({ error: "This work changed. Reload before reviewing." });
  });
  it("does not expose private integration details when a review fails", async () => {
    mocks.review.mockRejectedValue(new Error("private integration detail"));
    expect((await reviewScoutWorkAction(form())).error).not.toContain("private integration detail");
  });
});
