import { describe, expect, it, vi } from "vitest";

import {
  ensureMicrosoftEntraIdentityLink,
  readMicrosoftEntraIdentity
} from "@/server/auth/microsoft-entra-identity";

const tenantId = "11111111-1111-4111-8111-111111111111";
const objectId = "22222222-2222-4222-8222-222222222222";

describe("Microsoft Entra identity linking", () => {
  it("reads the stable tenant and object claims from an Entra profile", () => {
    expect(readMicrosoftEntraIdentity({ tid: tenantId.toUpperCase(), oid: objectId.toUpperCase() })).toEqual({
      tenantId,
      objectId
    });
    expect(readMicrosoftEntraIdentity({ tid: tenantId, oid: "not-an-object-id" })).toBeNull();
  });

  it("links an unclaimed identity to the email-provisioned Newl user", async () => {
    const store = {
      findByIdentity: vi.fn().mockResolvedValue(null),
      linkIdentity: vi.fn().mockResolvedValue(undefined)
    };

    await expect(ensureMicrosoftEntraIdentityLink({
      provider: "microsoft-entra-id",
      profile: { tid: tenantId, oid: objectId },
      user: { id: "user-1", microsoftEntraTenantId: null, microsoftEntraObjectId: null },
      store
    })).resolves.toBe("linked");
    expect(store.linkIdentity).toHaveBeenCalledWith("user-1", { tenantId, objectId });
  });

  it("fails closed when the user or another account already has a different identity", async () => {
    const store = {
      findByIdentity: vi.fn().mockResolvedValue({ id: "user-2" }),
      linkIdentity: vi.fn().mockResolvedValue(undefined)
    };

    await expect(ensureMicrosoftEntraIdentityLink({
      provider: "microsoft-entra-id",
      profile: { tid: tenantId, oid: objectId },
      user: { id: "user-1", microsoftEntraTenantId: null, microsoftEntraObjectId: null },
      store
    })).resolves.toBe("conflict");
    await expect(ensureMicrosoftEntraIdentityLink({
      provider: "microsoft-entra-id",
      profile: { tid: tenantId, oid: objectId },
      user: {
        id: "user-1",
        microsoftEntraTenantId: tenantId,
        microsoftEntraObjectId: "33333333-3333-4333-8333-333333333333"
      },
      store
    })).resolves.toBe("conflict");
    expect(store.linkIdentity).not.toHaveBeenCalled();
  });
});
