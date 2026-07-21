import { normalizeMicrosoftEntraId } from "@/server/auth/microsoft-entra-identity";

export type PreviewTeamshipUserProvisioningConfig = {
  email: string;
  name: string;
  tenantId: string;
  objectId: string;
};

export function readPreviewTeamshipUserProvisioningConfig(
  env: Record<string, string | undefined>
): PreviewTeamshipUserProvisioningConfig | null {
  const email = env.PREVIEW_TEAMSHIP_USER_EMAIL?.trim().toLowerCase();
  if (!email) {
    return null;
  }

  if (env.VERCEL_ENV !== "preview" || env.DATABASE_ENVIRONMENT?.trim().toLowerCase() !== "preview") {
    throw new Error("Preview Teamship user provisioning is allowed only in the Vercel Preview environment.");
  }

  const tenantId = normalizeMicrosoftEntraId(env.PREVIEW_TEAMSHIP_ENTRA_TENANT_ID);
  const objectId = normalizeMicrosoftEntraId(env.PREVIEW_TEAMSHIP_ENTRA_OBJECT_ID);
  if (!tenantId || !objectId) {
    throw new Error(
      "Valid PREVIEW_TEAMSHIP_ENTRA_TENANT_ID and PREVIEW_TEAMSHIP_ENTRA_OBJECT_ID values are required."
    );
  }

  return {
    email,
    name: env.PREVIEW_TEAMSHIP_USER_NAME?.trim() || "Preview Teamship User",
    tenantId,
    objectId
  };
}
