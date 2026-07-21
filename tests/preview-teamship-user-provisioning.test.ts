import { describe, expect, it } from "vitest";

import { readPreviewTeamshipUserProvisioningConfig } from "@/server/auth/preview-teamship-user-provisioning";

describe("Preview Teamship user provisioning", () => {
  const configured = {
    VERCEL_ENV: "preview",
    DATABASE_ENVIRONMENT: "preview",
    PREVIEW_TEAMSHIP_USER_EMAIL: "Alex.Newell@newl.ca",
    PREVIEW_TEAMSHIP_ENTRA_TENANT_ID: "11111111-1111-4111-8111-111111111111",
    PREVIEW_TEAMSHIP_ENTRA_OBJECT_ID: "22222222-2222-4222-8222-222222222222"
  };

  it("skips when Preview provisioning is not configured", () => {
    expect(readPreviewTeamshipUserProvisioningConfig({})).toBeNull();
  });

  it("normalizes a fully configured Preview Teamship user", () => {
    expect(readPreviewTeamshipUserProvisioningConfig(configured)).toEqual({
      email: "alex.newell@newl.ca",
      name: "Preview Teamship User",
      tenantId: configured.PREVIEW_TEAMSHIP_ENTRA_TENANT_ID,
      objectId: configured.PREVIEW_TEAMSHIP_ENTRA_OBJECT_ID
    });
  });

  it("rejects the same configuration outside Preview", () => {
    expect(() => readPreviewTeamshipUserProvisioningConfig({ ...configured, VERCEL_ENV: "production" }))
      .toThrow("allowed only in the Vercel Preview environment");
  });

  it("rejects invalid Microsoft identity values", () => {
    expect(() => readPreviewTeamshipUserProvisioningConfig({
      ...configured,
      PREVIEW_TEAMSHIP_ENTRA_OBJECT_ID: "not-a-guid"
    })).toThrow("Valid PREVIEW_TEAMSHIP_ENTRA_TENANT_ID");
  });
});
