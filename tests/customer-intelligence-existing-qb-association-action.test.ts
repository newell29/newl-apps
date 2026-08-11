import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  associate: vi.fn(),
  resolve: vi.fn(),
  revalidatePath: vi.fn(),
  context: {
    tenantId: "tenant-a",
    tenantSlug: "tenant-a",
    tenantName: "Tenant A",
    userId: "admin-1",
    userEmail: "admin@example.com",
    userName: "Admin",
    role: "ADMIN"
  }
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/server/tenant-context", () => ({
  getAuthenticatedContext: vi.fn(async () => mocks.context)
}));
vi.mock("@/modules/customer-intelligence/actions", () => ({
  associateQuickBooksCredential: mocks.associate
}));
vi.mock("@/modules/customer-intelligence/existing-quickbooks-association", () => ({
  resolveExistingQuickBooksAssociations: mocks.resolve
}));

import { associateExistingQuickBooksConnectionAction } from "@/modules/customer-intelligence/existing-quickbooks-association-actions";
import { EXISTING_QUICKBOOKS_ASSOCIATION_CONFIRMATION } from "@/modules/customer-intelligence/existing-quickbooks-association-state";
import { QuickBooksAssociationError } from "@/modules/customer-intelligence/quickbooks-association-error";

describe("associateExistingQuickBooksConnectionAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolve.mockResolvedValue([
      {
        operatingCompanyId: "oc-usa",
        operatingCompanySlug: "newl-usa",
        status: "AVAILABLE",
        companyName: "Synthetic USA",
        environment: "production",
        candidate: { id: "cred-server", realmId: "realm-server" }
      }
    ]);
    mocks.associate.mockResolvedValue({ id: "oc-usa" });
  });

  it("requires exact confirmation and performs no lookup or write when absent", async () => {
    const form = new FormData();
    form.set("operatingCompanyId", "oc-usa");

    const result = await associateExistingQuickBooksConnectionAction({ status: "idle" }, form);

    expect(result.status).toBe("error");
    expect(mocks.resolve).not.toHaveBeenCalled();
    expect(mocks.associate).not.toHaveBeenCalled();
  });

  it("uses only the server-resolved credential and realm for one company", async () => {
    const form = new FormData();
    form.set("operatingCompanyId", "oc-usa");
    form.set("confirmation", EXISTING_QUICKBOOKS_ASSOCIATION_CONFIRMATION);
    form.set("quickBooksCredentialId", "attacker-selected");
    form.set("quickBooksRealmId", "attacker-realm");

    const result = await associateExistingQuickBooksConnectionAction({ status: "idle" }, form);

    expect(result.status).toBe("success");
    expect(mocks.associate).toHaveBeenCalledWith(mocks.context, {
      operatingCompanyId: "oc-usa",
      quickBooksCredentialId: "cred-server",
      quickBooksRealmId: "realm-server"
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/settings");
  });

  it("refuses stale or ambiguous discovery and redacts internal errors", async () => {
    const form = new FormData();
    form.set("operatingCompanyId", "oc-usa");
    form.set("confirmation", EXISTING_QUICKBOOKS_ASSOCIATION_CONFIRMATION);
    mocks.resolve.mockResolvedValueOnce([
      {
        operatingCompanyId: "oc-usa",
        operatingCompanySlug: "newl-usa",
        status: "AMBIGUOUS",
        companyName: null,
        environment: null,
        candidate: null
      }
    ]);
    const stale = await associateExistingQuickBooksConnectionAction({ status: "idle" }, form);
    expect(stale.status).toBe("error");
    expect(mocks.associate).not.toHaveBeenCalled();

    mocks.resolve.mockRejectedValueOnce(new Error("secretRef=private-value"));
    const failed = await associateExistingQuickBooksConnectionAction({ status: "idle" }, form);
    expect(failed.code).toBe("LOOKUP_FAILED");
    expect(failed.message).not.toContain("private-value");
  });

  it("returns only the safe deterministic failure code from the association boundary", async () => {
    const form = new FormData();
    form.set("operatingCompanyId", "oc-usa");
    form.set("confirmation", EXISTING_QUICKBOOKS_ASSOCIATION_CONFIRMATION);
    mocks.associate.mockRejectedValueOnce(
      new QuickBooksAssociationError(
        "TRANSACTION_FAILED",
        "The association transaction could not be started or committed."
      )
    );

    const failed = await associateExistingQuickBooksConnectionAction({ status: "idle" }, form);

    expect(failed).toEqual({
      status: "error",
      code: "TRANSACTION_FAILED",
      message:
        "TRANSACTION_FAILED: The association transaction could not be started or committed."
    });
  });
});
