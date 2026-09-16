import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  context: vi.fn(),
  module: vi.fn(),
  mutate: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  note: vi.fn(),
  revalidate: vi.fn(),
  redirect: vi.fn()
}));
vi.mock("@/server/tenant-context", () => ({ getAuthenticatedContext: mocks.context }));
vi.mock("@/server/auth/authorization", () => ({
  requireModule: mocks.module,
  requireMutationAccess: mocks.mutate,
  AuthorizationError: class extends Error {}
}));
vi.mock("@/modules/website-inbound/service", () => ({
  createOpportunity: mocks.create,
  updateOpportunity: mocks.update,
  addOpportunityNote: mocks.note,
  DuplicateOpportunitiesError: class extends Error {}
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
import {
  createOpportunityAction,
  updateOpportunityAction,
  addOpportunityNoteAction
} from "@/modules/website-inbound/actions";
import { AuthorizationError } from "@/server/auth/authorization";
const context = { tenantId: "tenant-a", userId: "user-a", role: "ADMIN" };
const initial = { status: "idle" as const };
function form() {
  const data = new FormData();
  for (const [key, value] of Object.entries({
    company: "Synthetic Company",
    phone: "202-555-0100",
    status: "NEW",
    contactChannel: "PHONE",
    receivedOn: "2026-09-16",
    submissionId: "row-a",
    revision: "2",
    creationKey: "00000000-0000-4000-8000-000000000001",
    note: "Follow up on quote",
    tenantId: "attacker-tenant",
    actorUserId: "attacker-user"
  }))
    data.set(key, value);
  return data;
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.context.mockResolvedValue(context);
  mocks.create.mockResolvedValue("new-row");
  mocks.update.mockResolvedValue(3);
  mocks.redirect.mockImplementation(() => {
    throw new Error("NEXT_REDIRECT");
  });
});
describe("inbound action security", () => {
  it.each([createOpportunityAction, updateOpportunityAction, addOpportunityNoteAction])(
    "requires current authentication, module entitlement and mutation permission",
    async (action) => {
      mocks.context.mockRejectedValueOnce(new Error("Unauthenticated"));
      expect((await action(initial, form())).status).toBe("error");
      mocks.module.mockRejectedValueOnce(new AuthorizationError("Module unavailable"));
      expect((await action(initial, form())).message).toBe("Module unavailable");
      mocks.mutate.mockRejectedValueOnce(
        new AuthorizationError("Read-only users cannot perform this action.")
      );
      expect((await action(initial, form())).message).toContain("Read-only");
      expect(mocks.create).not.toHaveBeenCalled();
      expect(mocks.update).not.toHaveBeenCalled();
      expect(mocks.note).not.toHaveBeenCalled();
    }
  );
  it("uses the authenticated actor and tenant, not form-supplied values", async () => {
    const result = await updateOpportunityAction(initial, form());
    expect(result.status).toBe("success");
    expect(result.revision).toBe(3);
    expect(mocks.module).toHaveBeenCalledWith(context, "WEBSITE_INBOUND");
    expect(mocks.update).toHaveBeenCalledWith(
      context,
      "row-a",
      2,
      expect.not.objectContaining({ tenantId: "attacker-tenant" })
    );
    expect(mocks.revalidate).toHaveBeenCalledWith("/website-inbound");
  });
  it("rejects malformed versions and redacts unexpected persistence errors", async () => {
    const data = form();
    data.set("revision", "");
    expect((await updateOpportunityAction(initial, data)).status).toBe("error");
    expect(mocks.update).not.toHaveBeenCalled();
    mocks.note.mockRejectedValue(new Error("private connection details"));
    const result = await addOpportunityNoteAction(initial, form());
    expect(result.status).toBe("error");
    expect(result.message).not.toContain("private");
  });
  it("redirects a created opportunity locally and retains filters", async () => {
    const data = form();
    data.set("returnTo", "/website-inbound?view=ALL&channel=PHONE");
    await expect(createOpportunityAction(initial, data)).rejects.toThrow("NEXT_REDIRECT");
    expect(mocks.redirect).toHaveBeenCalledWith(expect.stringContaining("selected=new-row"));
    expect(mocks.redirect).toHaveBeenCalledWith(expect.stringContaining("view=ALL"));
  });
});
